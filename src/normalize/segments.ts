// 本文を「書き換えてよい部分」と「触ってはいけない部分」へ分けるための走査。
//
// Obsidian記法の正規化は本文の文字列置換で行うが、**コードの中身は原文のまま
// 送る**必要がある（`[[foo]]`の書き方を説明する記事が壊れる）。フェンス付き
// コードブロックとインラインコードだけを避ける。サーバーのパーサー（CommonMark）と
// 同じく、引用の中のフェンスと、段落の中で行をまたぐインラインコードもコードとして扱う。
//
// 段落の切れ目は空行と行頭の記号（見出し・リスト項目・表の行など）で近似する。迷う行は
// 段落の切れ目とみなし、インラインコードを行をまたいでつながない。表は行頭の`|`を
// 省略できるので、区切り行（`--- | ---`）を見つけたら、その直前の行から表が終わるまでを
// 1行ずつ読む（見出しとの列数の一致は確かめない）。
//
// 対象外（既知の割り切り）: 4スペースのインデントコードブロックとHTMLブロックの
// 中身は書き換え対象に入る。前者は行の文脈（直前の空行・リストの内側）まで見ないと
// 判定できず、後者はHTML内の`[[…]]`が実用上ほぼ無いため。リスト項目の中のフェンスも、
// リストの字下げを数えないので、行頭の字下げがスペース3個までのときだけ認識する（タブは不可）。

export interface CodeRange {
  start: number;
  /** この位置は含まない */
  end: number;
}

export interface BodyLine {
  /** 改行を含まない行の内容 */
  text: string;
  /** フェンス付きコードブロックの内側か（開始・終了のフェンス行自体も含む） */
  fenced: boolean;
  /**
   * 行頭の引用記号`>`の階層数。フェンスの内側では、そのフェンスを含む引用の階層数
   * （それより後ろの`>`はコードの中身）
   */
  quoteDepth: number;
  /** インラインコードの範囲（バックティックを含む）。行をまたぐコードは、この行に入る部分 */
  inlineCode: CodeRange[];
}

/**
 * 引用1階層分。先頭の空白は0〜3個まで、`>`の直後の空白は1つだけ落とす。
 * 行末の`\r`（CRLFの本文）は`.`に含まれないので、行の中身は`[\s\S]`で取る
 */
export const QUOTE_LINE = /^( {0,3})>[ \t]?([\s\S]*)$/;

/** バックスラッシュでエスケープできる文字（CommonMarkのASCII句読点） */
export const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;

/** 1行で終わるブロック: ATX見出し・表の行・directive・区切り線・setext見出しの下線 */
const SINGLE_LINE_BLOCK = /^(?:#{1,6}(?:\s|$)|\||:{2,}|([-*_])(?:[ \t]*\1){2,}\s*$|(?:=+|-+)\s*$)/;

/** 前の段落を区切って始まるブロック: リスト項目・HTML */
const BLOCK_START = /^(?:(?:[-+*]|\d{1,9}[.)])(?:\s|$)|<[A-Za-z/!?])/;

/** 表の区切り行。`|`を含まない`---`は区切り線・setext見出しなので、別に`|`の有無を見る */
const TABLE_DELIMITER = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?\s*$/;

interface Fence {
  character: "`" | "~";
  length: number;
}

interface OpenFence extends Fence {
  /** フェンスを含む引用の階層数 */
  quoteDepth: number;
}

/** 行頭のフェンス（``` または ~~~）。閉じフェンスは情報文字列を持てない */
function readFence(line: string): { fence: Fence; info: string } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ""));
  if (match === null) return null;
  const marker = match[1] as string;
  const character = marker[0] as "`" | "~";
  // ```の情報文字列にバックティックは書けない（CommonMark）。`a ``b`` c`のような
  // インラインコードを開始フェンスと読み違えないための判定
  if (character === "`" && match[2]?.includes("`") === true) return null;
  return { fence: { character, length: marker.length }, info: match[2] ?? "" };
}

function closesFence(line: string, open: Fence): boolean {
  const read = readFence(line);
  if (read === null) return false;
  return (
    read.fence.character === open.character &&
    read.fence.length >= open.length &&
    read.info.trim() === ""
  );
}

/** 行頭の引用記号を`limit`階層まで剥がす */
function readQuote(text: string, limit = Infinity): { depth: number; content: string } {
  let depth = 0;
  let content = text;
  while (depth < limit) {
    const match = QUOTE_LINE.exec(content);
    if (match === null) break;
    content = match[2] ?? "";
    depth += 1;
  }
  return { depth, content };
}

/** 本文を行へ分ける。`joinBodyLines()`で元の文字列へ戻せる */
export function splitBodyLines(body: string): BodyLine[] {
  const lines: BodyLine[] = [];
  let open: OpenFence | null = null;

  for (const text of body.split("\n")) {
    if (open !== null) {
      const quote = readQuote(text, open.quoteDepth);
      // 引用が途切れると、その中のコードブロックも閉じる。この行は改めて読む
      if (quote.depth === open.quoteDepth) {
        lines.push({ text, fenced: true, quoteDepth: open.quoteDepth, inlineCode: [] });
        if (closesFence(quote.content, open)) open = null;
        continue;
      }
      open = null;
    }

    const quote = readQuote(text);
    const read = readFence(quote.content);
    if (read !== null) open = { ...read.fence, quoteDepth: quote.depth };
    lines.push({ text, fenced: read !== null, quoteDepth: quote.depth, inlineCode: [] });
  }

  markInlineCode(lines);
  return lines;
}

export function joinBodyLines(lines: readonly string[]): string {
  return lines.join("\n");
}

/** 段落ごとにインラインコードを探し、各行の`inlineCode`へ入れる */
function markInlineCode(lines: readonly BodyLine[]): void {
  let paragraph: BodyLine[] = [];
  let previous: { line: BodyLine; content: string } | null = null;
  /** 表の中なら、その表を含む引用の階層数 */
  let tableDepth: number | null = null;
  const flush = (): void => {
    if (paragraph.length > 0) assignInlineCode(paragraph);
    paragraph = [];
  };
  const pushAlone = (line: BodyLine): void => {
    flush();
    paragraph.push(line);
    flush();
  };

  for (const line of lines) {
    const content = line.fenced ? "" : readQuote(line.text).content.trimStart();
    if (content.trim() === "") {
      flush();
      previous = null;
      tableDepth = null;
      continue;
    }

    const singleLine = SINGLE_LINE_BLOCK.test(content);
    const blockStart = BLOCK_START.test(content);
    const header = previous;
    previous = { line, content };

    if (tableDepth !== null) {
      if (
        line.quoteDepth === tableDepth &&
        (content.startsWith("|") || !(singleLine || blockStart))
      ) {
        pushAlone(line);
        continue;
      }
      tableDepth = null;
    }

    if (
      header !== null &&
      header.line.quoteDepth === line.quoteDepth &&
      header.content.includes("|") &&
      content.includes("|") &&
      TABLE_DELIMITER.test(content)
    ) {
      // 見出し行は段落の最後の行として読み始めているので、段落から外して1行で読み直す
      if (paragraph.at(-1) === header.line) {
        paragraph.pop();
        pushAlone(header.line);
      }
      pushAlone(line);
      tableDepth = line.quoteDepth;
      continue;
    }

    if (singleLine || blockStart || line.quoteDepth !== paragraph.at(-1)?.quoteDepth) {
      flush();
    }
    paragraph.push(line);
    if (singleLine) flush();
  }
  flush();
}

function assignInlineCode(paragraph: readonly BodyLine[]): void {
  const ranges = findInlineCode(joinBodyLines(paragraph.map((line) => line.text)));
  let offset = 0;
  let next = 0;

  for (const line of paragraph) {
    const end = offset + line.text.length;
    while (next < ranges.length && (ranges[next] as CodeRange).end <= offset) next += 1;
    for (let index = next; index < ranges.length; index += 1) {
      const range = ranges[index] as CodeRange;
      if (range.start >= end) break;
      line.inlineCode.push({
        start: Math.max(range.start, offset) - offset,
        end: Math.min(range.end, end) - offset,
      });
    }
    offset = end + 1;
  }
}

/**
 * インラインコードの範囲。
 *
 * 閉じないバックティックの並びは、コードではなくただの文字として扱う
 * （CommonMarkの解釈と同じ）。その後ろにある別の長さの並びはコードを始められる
 */
function findInlineCode(text: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];
    if (char === "\\" && ASCII_PUNCTUATION.test(text[index + 1] ?? "")) {
      index += 2;
      continue;
    }
    if (char !== "`") {
      index += 1;
      continue;
    }

    let length = 0;
    while (text[index + length] === "`") length += 1;
    const close = findClosingBackticks(text, index + length, length);
    if (close === -1) {
      index += length;
      continue;
    }
    ranges.push({ start: index, end: close + length });
    index = close + length;
  }

  return ranges;
}

/** ちょうど`length`本のバックティックの並びが始まる位置。無ければ-1 */
function findClosingBackticks(text: string, from: number, length: number): number {
  let index = from;
  while (index < text.length) {
    const next = text.indexOf("`", index);
    if (next === -1) return -1;
    let run = 0;
    while (text[next + run] === "`") run += 1;
    if (run === length) return next;
    index = next + run;
  }
  return -1;
}

const keep = (text: string): string => text;

/** 行をコードとそれ以外の断片に分け、コード以外へ`outside`、コードへ`inside`を当てて繋ぐ */
function mapCode(
  body: string,
  outside: (text: string) => string,
  inside: (code: string) => string,
): string {
  return joinBodyLines(
    splitBodyLines(body).map((line) => {
      if (line.fenced) return inside(line.text);

      let result = "";
      let index = 0;
      for (const code of line.inlineCode) {
        if (code.start > index) result += outside(line.text.slice(index, code.start));
        result += inside(line.text.slice(code.start, code.end));
        index = code.end;
      }
      return index < line.text.length ? result + outside(line.text.slice(index)) : result;
    }),
  );
}

/**
 * 本文のうちコード（フェンス付きブロック・インラインコード）以外へ`replace`を当てる。
 *
 * `replace`は行をまたがない断片ごとに呼ばれる。Obsidianのwikilink・embedは
 * 1行に収まる記法なので、この粒度で足りる
 */
export function replaceOutsideCode(body: string, replace: (text: string) => string): string {
  return mapCode(body, replace, keep);
}

/** 本文のうちコードの部分だけへ`replace`を当てる。`replace`は行ごとの断片で呼ばれる */
export function replaceInsideCode(body: string, replace: (code: string) => string): string {
  return mapCode(body, keep, replace);
}
