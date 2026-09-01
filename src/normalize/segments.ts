// 本文を「書き換えてよい部分」と「触ってはいけない部分」へ分けるための走査。
//
// Obsidian記法の正規化は本文の文字列置換で行うが、**コードの中身は原文のまま
// 送る**必要がある（`[[foo]]`の書き方を説明する記事が壊れる）。フェンス付き
// コードブロックとインラインコードだけを避ける。
//
// 対象外（既知の割り切り）: 4スペースのインデントコードブロックとHTMLブロックの
// 中身は書き換え対象に入る。前者は行の文脈（直前の空行・リストの内側）まで見ないと
// 判定できず、後者はHTML内の`[[…]]`が実用上ほぼ無いため。

export interface BodyLine {
  /** 改行を含まない行の内容 */
  text: string;
  /** フェンス付きコードブロックの内側か（開始・終了のフェンス行自体も含む） */
  fenced: boolean;
}

interface OpenFence {
  character: "`" | "~";
  length: number;
}

/** 行頭のフェンス（``` または ~~~）。閉じフェンスは情報文字列を持てない */
function readFence(line: string): { fence: OpenFence; info: string } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.replace(/\r$/, ""));
  if (match === null) return null;
  const marker = match[1] as string;
  const character = marker[0] as "`" | "~";
  // ```の情報文字列にバックティックは書けない（CommonMark）。`a ``b`` c`のような
  // インラインコードを開始フェンスと読み違えないための判定
  if (character === "`" && match[2]?.includes("`") === true) return null;
  return { fence: { character, length: marker.length }, info: match[2] ?? "" };
}

function closesFence(line: string, open: OpenFence): boolean {
  const read = readFence(line);
  if (read === null) return false;
  return (
    read.fence.character === open.character &&
    read.fence.length >= open.length &&
    read.info.trim() === ""
  );
}

/** 本文を行へ分ける。`joinBodyLines()`で元の文字列へ戻せる */
export function splitBodyLines(body: string): BodyLine[] {
  const lines: BodyLine[] = [];
  let open: OpenFence | null = null;

  for (const text of body.split("\n")) {
    if (open === null) {
      const read = readFence(text);
      if (read !== null) {
        open = read.fence;
        lines.push({ text, fenced: true });
        continue;
      }
      lines.push({ text, fenced: false });
      continue;
    }

    const closing = closesFence(text, open);
    lines.push({ text, fenced: true });
    if (closing) open = null;
  }

  return lines;
}

export function joinBodyLines(lines: readonly string[]): string {
  return lines.join("\n");
}

/**
 * 1行の中の、インラインコードでない部分だけを`replace`へ通す。
 *
 * 開いたまま閉じないバックティックは、コードではなくただの文字として扱う
 * （CommonMarkの解釈と同じ）
 */
function replaceOutsideInlineCode(line: string, replace: (text: string) => string): string {
  let result = "";
  let index = 0;

  while (index < line.length) {
    const open = line.indexOf("`", index);
    if (open === -1) {
      result += replace(line.slice(index));
      break;
    }

    let openLength = 0;
    while (line[open + openLength] === "`") openLength += 1;

    const close = findClosingBackticks(line, open + openLength, openLength);
    if (close === -1) {
      // 閉じないバックティック以降にもう一度コードが始まることはないので、残りは全部テキスト
      result += replace(line.slice(index));
      break;
    }

    result += replace(line.slice(index, open));
    result += line.slice(open, close + openLength);
    index = close + openLength;
  }

  return result;
}

/** ちょうど`length`本のバックティックの並びが始まる位置。無ければ-1 */
function findClosingBackticks(line: string, from: number, length: number): number {
  let index = from;
  while (index < line.length) {
    const next = line.indexOf("`", index);
    if (next === -1) return -1;
    let run = 0;
    while (line[next + run] === "`") run += 1;
    if (run === length) return next;
    index = next + run;
  }
  return -1;
}

/**
 * 本文のうちコード（フェンス付きブロック・インラインコード）以外へ`replace`を当てる。
 *
 * `replace`は行をまたがない断片ごとに呼ばれる。Obsidianのwikilink・embedは
 * 1行に収まる記法なので、この粒度で足りる
 */
export function replaceOutsideCode(body: string, replace: (text: string) => string): string {
  return joinBodyLines(
    splitBodyLines(body).map((line) =>
      line.fenced ? line.text : replaceOutsideInlineCode(line.text, replace),
    ),
  );
}
