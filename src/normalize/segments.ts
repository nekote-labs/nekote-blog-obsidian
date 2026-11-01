// 本文を「書き換えてよい部分」と「触ってはいけない部分」へ分けるための走査。
//
// Obsidian記法の正規化は本文の文字列置換で行うが、**コードの中身は原文のまま
// 送る**必要がある（`[[foo]]`の書き方を説明する記事が壊れる）。フェンス付き
// コードブロックとインラインコードを避ける。サーバーのパーサー（CommonMark）と
// 同じく、引用の中のフェンスと、段落の中で行をまたぐインラインコードもコードとして扱う。
//
// コメントも2種類見つける。
// - HTMLコメント（`<!--`〜`-->`）: サーバーは中を公開も参照の収集もしないので、コードと同じく
//   書き換えない。行頭の`<!--`はCommonMarkのHTMLブロックとして`-->`を含む行まで（空行もまたぐ。
//   閉じなければ本文（引用・リスト項目の中ならそれ）の最後まで）。HTMLブロックの行は段落を区切り、
//   前後の段落とインラインコードをつながない。それ以外は同じ段落の中で閉じたものだけを
//   コメントとし、閉じない`<!--`はただの文字として扱う
// - Obsidianのコメント（`%%`〜`%%`）: 送る前に中身ごと取り除く（`comment.ts`）。読み方は
//   Obsidian 1.14の閲覧表示に合わせる。行頭（引用・リストの記号の後ろ）の`%%`は、同じ行に
//   ほかの`%`が無ければ次の`%%`までのブロックのコメントで、空行もコードもまたぐ。閉じなければ
//   本文（引用の中なら引用）の最後まで。それ以外の`%%`は、同じ行で閉じたものだけをコメントとする
//
// 段落の中では、先に始まったもの（インラインコード・HTMLコメント・`%%`）が優先される。
//
// 段落の切れ目は空行と行頭の記号（見出し・リスト項目・表の行など）で近似する。迷う行は
// 段落の切れ目とみなし、インラインコードを行をまたいでつながない。表は行頭の`|`を
// 省略できるので、区切り行（`--- | ---`）を見つけたら、その直前の行から表が終わるまでを
// 1行ずつ読む（見出しとの列数の一致は確かめない）。
//
// 対象外（既知の割り切り）: 4スペースのインデントコードブロックと、コメント以外のHTMLブロックの
// 中身は書き換え対象に入る。前者は行の文脈（直前の空行・リストの内側）まで見ないと
// 判定できず、後者はHTML内の`[[…]]`が実用上ほぼ無いため。リスト項目の中のフェンスと、
// HTMLコメントで始まるHTMLブロックも、リストの字下げを数えずに開始を判定するので、行頭の字下げが
// スペース3個までのときだけ認識する（タブは不可）。HTMLブロックがリスト項目と一緒に終わるのは、
// 同じ行にリストの記号があるときだけ。
// 引用の中の`%%`のブロックのコメントは、`>`の無い行で閉じる（Obsidianは段落の続きとして
// 引用に含めることがある）。

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
   * 行頭の引用記号`>`の階層数。フェンス・ブロックのコメントの内側では、それを含む引用の
   * 階層数（それより後ろの`>`はコードやコメントの中身）
   */
  quoteDepth: number;
  /** インラインコードの範囲（バックティックを含む）。行をまたぐコードは、この行に入る部分 */
  inlineCode: CodeRange[];
  /** HTMLコメントの範囲（`<!--`・`-->`を含む）。行をまたぐコメントは、この行に入る部分 */
  htmlComments: CodeRange[];
  /** HTMLコメントで始まるHTMLブロックの行か（開始行と`-->`の行も含む） */
  htmlBlock: boolean;
  /** Obsidianのコメントの範囲（`%%`を含む）。行をまたぐコメントは、この行に入る部分 */
  obsidianComments: CodeRange[];
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

/** 行頭のリスト記号（入れ子を含む）と後ろの空白。記号の後ろの空白で区切り、読み方を1通りにする */
const LIST_MARKERS = String.raw`(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)*`;

/** `%%`のブロックのコメントの開始。Obsidianは字下げの深さを問わない */
const OBSIDIAN_BLOCK_COMMENT = new RegExp(String.raw`^([ \t]*${LIST_MARKERS})%%[^%]*$`);

/** HTMLコメントで始まるHTMLブロック（CommonMarkの種類2） */
const HTML_BLOCK_COMMENT = new RegExp(String.raw`^( {0,3}${LIST_MARKERS})<!--`);

type CommentKind = "html" | "obsidian";

const COMMENT_CLOSE: Record<CommentKind, string> = { html: "-->", obsidian: "%%" };

interface Fence {
  character: "`" | "~";
  length: number;
}

interface OpenFence extends Fence {
  kind: "fence";
  /** フェンスを含む引用の階層数 */
  quoteDepth: number;
}

interface OpenComment {
  kind: CommentKind;
  /** コメントを含む引用の階層数 */
  quoteDepth: number;
  /**
   * リスト項目の中で始まったHTMLブロックが続くのに要る字下げ（引用記号の後ろから数える）。
   * これより浅い行でリスト項目が終わり、ブロックも閉じる。リストの外は0
   */
  indent: number;
}

/** 行をまたいで続くブロック */
type OpenBlock = OpenFence | OpenComment;

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
  let open: OpenBlock | null = null;

  for (const text of body.split("\n")) {
    const line: BodyLine = {
      text,
      fenced: false,
      quoteDepth: 0,
      inlineCode: [],
      htmlComments: [],
      htmlBlock: false,
      obsidianComments: [],
    };
    lines.push(line);

    if (open !== null) {
      const quote = readQuote(text, open.quoteDepth);
      // 引用・リスト項目が途切れると、その中のブロックも閉じる。この行は改めて読む
      if (quote.depth === open.quoteDepth && !leavesListItem(quote.content, open)) {
        line.quoteDepth = open.quoteDepth;
        if (open.kind === "fence") {
          line.fenced = true;
          if (closesFence(quote.content, open)) open = null;
        } else {
          const start = text.length - quote.content.length;
          open = readComment(line, open, start, start);
        }
        continue;
      }
    }

    const quote = readQuote(text);
    line.quoteDepth = quote.depth;
    const read = readFence(quote.content);
    if (read !== null) {
      line.fenced = true;
      open = { kind: "fence", ...read.fence, quoteDepth: quote.depth };
      continue;
    }
    open = startComment(line, text.length - quote.content.length, quote.depth);
  }

  markInlineSpans(lines);
  return lines;
}

/** リスト項目の中のHTMLブロックが、字下げの足りない行で項目ごと終わるか。空行では終わらない */
function leavesListItem(content: string, open: OpenBlock): boolean {
  if (open.kind === "fence" || open.indent === 0 || content.trim() === "") return false;
  return content.length - content.trimStart().length < open.indent;
}

/** `from`から始まるブロックのコメント。閉じずに行が終われば、開いたままのコメントを返す */
function startComment(line: BodyLine, from: number, quoteDepth: number): OpenComment | null {
  const rest = line.text.slice(from);
  const obsidian = OBSIDIAN_BLOCK_COMMENT.exec(rest);
  const html = obsidian === null ? HTML_BLOCK_COMMENT.exec(rest) : null;
  const match = obsidian ?? html;
  if (match === null) return null;

  const prefix = match[1] as string;
  const start = from + prefix.length;
  // 閉じる記号は開始の記号の3文字目から探す（`<!-->`も閉じたHTMLコメント）
  return readComment(
    line,
    {
      kind: obsidian === null ? "html" : "obsidian",
      quoteDepth,
      indent: html !== null && prefix.trim() !== "" ? prefix.length : 0,
    },
    start,
    start + 2,
  );
}

/** `start`からのコメントを読み、閉じる記号を`searchFrom`から探す */
function readComment(
  line: BodyLine,
  open: OpenComment,
  start: number,
  searchFrom: number,
): OpenComment | null {
  const ranges = open.kind === "html" ? line.htmlComments : line.obsidianComments;
  if (open.kind === "html") line.htmlBlock = true;
  const marker = COMMENT_CLOSE[open.kind];
  const close = line.text.indexOf(marker, searchFrom);
  if (close === -1) {
    pushRange(ranges, start, contentEnd(line.text));
    return open;
  }

  const end = close + marker.length;
  pushRange(ranges, start, end);
  // Obsidianは閉じた`%%`の後ろから次のブロックを読む。HTMLブロックは`-->`の行の終わりまで続く
  return open.kind === "obsidian" ? startComment(line, end, open.quoteDepth) : null;
}

/** 行末の`\r`を除いた行の終わり */
function contentEnd(text: string): number {
  return text.endsWith("\r") ? text.length - 1 : text.length;
}

function pushRange(ranges: CodeRange[], start: number, end: number): void {
  if (start < end) ranges.push({ start, end });
}

export function joinBodyLines(lines: readonly string[]): string {
  return lines.join("\n");
}

interface InlineLine {
  line: BodyLine;
  /** インラインの記法を探す内容。フェンスの中は空、ブロックのコメントは同じ長さの空白にする */
  text: string;
}

function inlineLineOf(line: BodyLine): InlineLine {
  if (line.fenced) return { line, text: "" };
  let text = line.text;
  for (const range of [...line.htmlComments, ...line.obsidianComments]) {
    text = text.slice(0, range.start) + " ".repeat(range.end - range.start) + text.slice(range.end);
  }
  return { line, text };
}

/** 段落ごとにインラインコードと行内のコメントを探し、各行へ入れる */
function markInlineSpans(lines: readonly BodyLine[]): void {
  let paragraph: InlineLine[] = [];
  let previous: InlineLine | null = null;
  /** 表の中なら、その表を含む引用の階層数 */
  let tableDepth: number | null = null;
  const flush = (): void => {
    if (paragraph.length > 0) assignInlineSpans(paragraph);
    paragraph = [];
  };
  const pushAlone = (entry: InlineLine): void => {
    flush();
    paragraph.push(entry);
    flush();
  };

  for (const entry of lines.map(inlineLineOf)) {
    // HTMLブロックの行は段落に入らない。`-->`の後ろに残る文字は、その行の中だけで読む
    if (entry.line.htmlBlock) {
      pushAlone(entry);
      previous = null;
      tableDepth = null;
      continue;
    }

    const { quoteDepth } = entry.line;
    const content = readQuote(entry.text).content.trimStart();
    if (content.trim() === "") {
      flush();
      previous = null;
      tableDepth = null;
      continue;
    }

    const singleLine = SINGLE_LINE_BLOCK.test(content);
    const blockStart = BLOCK_START.test(content);
    const header = previous;
    previous = entry;

    if (tableDepth !== null) {
      if (quoteDepth === tableDepth && (content.startsWith("|") || !(singleLine || blockStart))) {
        pushAlone(entry);
        continue;
      }
      tableDepth = null;
    }

    if (
      header !== null &&
      header.line.quoteDepth === quoteDepth &&
      content.includes("|") &&
      TABLE_DELIMITER.test(content)
    ) {
      // 見出し行は段落の最後の行として読み始めているので、段落から外して1行で読み直す
      if (paragraph.at(-1) === header) {
        paragraph.pop();
        pushAlone(header);
      }
      pushAlone(entry);
      tableDepth = quoteDepth;
      continue;
    }

    if (singleLine || blockStart || quoteDepth !== paragraph.at(-1)?.line.quoteDepth) {
      flush();
    }
    paragraph.push(entry);
    if (singleLine) flush();
  }
  flush();
}

function assignInlineSpans(paragraph: readonly InlineLine[]): void {
  const spans = findInlineSpans(joinBodyLines(paragraph.map((entry) => entry.text)));
  let offset = 0;
  let next = 0;

  for (const { line, text } of paragraph) {
    const end = offset + text.length;
    while (next < spans.length && (spans[next] as InlineSpan).end <= offset) next += 1;
    for (let index = next; index < spans.length; index += 1) {
      const span = spans[index] as InlineSpan;
      if (span.start >= end) break;
      const ranges =
        span.kind === "code"
          ? line.inlineCode
          : span.kind === "html"
            ? line.htmlComments
            : line.obsidianComments;
      ranges.push({
        start: Math.max(span.start, offset) - offset,
        end: Math.min(span.end, end) - offset,
      });
    }
    offset = end + 1;
  }
}

interface InlineSpan extends CodeRange {
  kind: "code" | CommentKind;
}

/**
 * 段落の中のインラインコードと行内のコメント。
 *
 * 閉じないバックティックの並び・`<!--`・`%%`は、ただの文字として扱う（CommonMark・Obsidianの
 * 解釈と同じ）。その後ろにある別の長さのバックティックの並びはコードを始められる
 */
function findInlineSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let index = 0;
  /** 後ろに`-->`が無いと分かったら、以降の`<!--`では探さない */
  let htmlCommentClosable = true;

  while (index < text.length) {
    const char = text[index];
    if (char === "\\" && ASCII_PUNCTUATION.test(text[index + 1] ?? "")) {
      index += 2;
      continue;
    }

    if (char === "`") {
      let length = 0;
      while (text[index + length] === "`") length += 1;
      const close = findClosingBackticks(text, index + length, length);
      if (close === -1) {
        index += length;
        continue;
      }
      spans.push({ kind: "code", start: index, end: close + length });
      index = close + length;
      continue;
    }

    if (htmlCommentClosable && text.startsWith("<!--", index)) {
      const close = text.indexOf("-->", index + 2);
      if (close === -1) {
        htmlCommentClosable = false;
      } else {
        spans.push({ kind: "html", start: index, end: close + 3 });
        index = close + 3;
        continue;
      }
    }

    if (text.startsWith("%%", index)) {
      // 行内のコメントは同じ行で閉じる。閉じない`%%`からの探索は次の`%%`で止まるので、
      // 段落全体でも本文の長さに比例する手間で済む
      const close = text.indexOf("%%", index + 2);
      if (close === -1 || text.slice(index + 2, close).includes("\n")) {
        index += 2;
        continue;
      }
      spans.push({ kind: "obsidian", start: index, end: close + 2 });
      index = close + 2;
      continue;
    }

    index += 1;
  }

  return spans;
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

/**
 * 行をコード・HTMLコメントとそれ以外の断片に分け、それ以外へ`outside`、コード・HTMLコメントへ
 * `inside`を当てて繋ぐ
 */
function mapCodeAndHtmlComments(
  body: string,
  outside: (text: string) => string,
  inside: (code: string) => string,
): string {
  return joinBodyLines(
    splitBodyLines(body).map((line) => {
      if (line.fenced) return inside(line.text);

      const ranges = [...line.inlineCode, ...line.htmlComments].sort(
        (left, right) => left.start - right.start,
      );
      let result = "";
      let index = 0;
      for (const range of ranges) {
        if (range.start > index) result += outside(line.text.slice(index, range.start));
        result += inside(line.text.slice(range.start, range.end));
        index = range.end;
      }
      return index < line.text.length ? result + outside(line.text.slice(index)) : result;
    }),
  );
}

/**
 * 本文のうちコード（フェンス付きブロック・インラインコード）とHTMLコメント以外へ`replace`を当てる。
 *
 * `replace`は行をまたがない断片ごとに呼ばれる。Obsidianのwikilink・embedは
 * 1行に収まる記法なので、この粒度で足りる。
 *
 * Obsidianのコメントは`removeObsidianComments()`で先に取り除いておく。取り除いた後に残る`%%`は
 * Obsidianがコメントと読まなかった文字なので、ここでは普通の文字として扱う
 */
export function replaceOutsideCodeAndHtmlComments(
  body: string,
  replace: (text: string) => string,
): string {
  return mapCodeAndHtmlComments(body, replace, keep);
}

/** 本文のうちコードとHTMLコメントの部分だけへ`replace`を当てる。`replace`は行ごとの断片で呼ばれる */
export function replaceInsideCodeAndHtmlComments(
  body: string,
  replace: (code: string) => string,
): string {
  return mapCodeAndHtmlComments(body, keep, replace);
}
