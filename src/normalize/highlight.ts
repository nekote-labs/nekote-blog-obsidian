// Obsidianの色付きハイライト`==🔴テキスト==`を、Nekoteの色付きマーカー`:marker[テキスト]{red}`へ直す。
//
// 色の無い`==テキスト==`はNekoteでもマーカーとして読まれるので変えない。ハイライトの範囲は
// Obsidianの閲覧モード（1.14）の読み方に合わせる: 直後が空白でない`==`で開き、直前が空白で
// ない最初の`==`で閉じる。終了は文字の並びだけで探し、間にインラインコードがあっても区別しない。
// 色は中身の先頭1文字で決まる。
//
// 対象外（既知の割り切り）: 行をまたぐハイライトは変換しない。
import { findClosingBackticks, joinBodyLines, splitBodyLines } from "./segments";

/** 先頭の絵文字 → Nekoteの色名。Obsidianは丸と四角のどちらでも同じ色にする */
const HIGHLIGHT_COLORS = new Map<string, string>([
  ["🔴", "red"],
  ["🟥", "red"],
  ["🟠", "orange"],
  ["🟧", "orange"],
  ["🟡", "yellow"],
  ["🟨", "yellow"],
  ["🟢", "green"],
  ["🟩", "green"],
  ["🔵", "blue"],
  ["🟦", "blue"],
  ["🟣", "purple"],
  ["🟪", "purple"],
]);

/** バックスラッシュでエスケープできる文字（CommonMarkのASCII句読点） */
const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;

const WHITESPACE = /^\s$/;

/** Obsidianの色付きハイライトをNekoteのマーカーへ正規化する */
export function normalizeHighlights(body: string): string {
  return joinBodyLines(
    splitBodyLines(body).map((line) => (line.fenced ? line.text : normalizeLine(line.text))),
  );
}

function normalizeLine(line: string): string {
  const lastClose = lastCloseIndex(line);
  let result = "";
  let index = 0;
  /** `result`の末尾の文字がバックスラッシュでエスケープされているか */
  let escapedTail = false;

  while (index < line.length) {
    const char = line[index] as string;

    if (char === "\\" && ASCII_PUNCTUATION.test(line[index + 1] ?? "")) {
      result += line.slice(index, index + 2);
      index += 2;
      escapedTail = true;
      continue;
    }

    if (char === "`") {
      const end = codeSpanEnd(line, index);
      result += line.slice(index, end);
      index = end;
      escapedTail = false;
      continue;
    }

    const highlight = readHighlight(line, index, lastClose);
    if (highlight !== null) {
      const marker = toMarker(highlight.content);
      if (marker === null) {
        // 変換しないハイライトも丸ごと飛ばす（Obsidianと同じく、中の`==`を次の開始と読まない）
        result += line.slice(index, highlight.end);
      } else {
        // `::marker`はdirectiveとして読まれないので、直前の`:`をエスケープする
        if (result.endsWith(":") && !escapedTail) result = `${result.slice(0, -1)}\\:`;
        result += marker;
      }
      index = highlight.end;
      escapedTail = false;
      continue;
    }

    result += char;
    index += 1;
    escapedTail = false;
  }

  return result;
}

/** `index`から始まるバックティックの並びの後ろ。閉じればコードの終わり、閉じなければ並びの終わり */
function codeSpanEnd(line: string, index: number): number {
  let length = 0;
  while (line[index + length] === "`") length += 1;
  const close = findClosingBackticks(line, index + length, length);
  return close === -1 ? index + length : close + length;
}

/**
 * `start`の`==`から始まるハイライト。中身は開始と終了の`==`を除いた部分。
 *
 * 終了になれるかは開始の位置によらないので、行で最後の終了`lastClose`より後ろは探さない
 * （閉じない開始が多い行でも、行の長さに比例する手間で済む）
 */
function readHighlight(
  line: string,
  start: number,
  lastClose: number,
): { content: string; end: number } | null {
  if (start + 3 > lastClose) return null;
  if (!line.startsWith("==", start) || line.startsWith("====", start)) return null;
  if (WHITESPACE.test(line[start + 2] ?? " ")) return null;

  for (let close = start + 3; close <= lastClose; close += 1) {
    if (isClose(line, close)) return { content: line.slice(start + 2, close), end: close + 2 };
  }
  return null;
}

/** 行で最後の終了の`==`の位置。無ければ-1 */
function lastCloseIndex(line: string): number {
  for (let close = line.length - 2; close >= 1; close -= 1) {
    if (isClose(line, close)) return close;
  }
  return -1;
}

/** `close`から始まる`==`がハイライトを閉じられるか（直前が空白でない） */
function isClose(line: string, close: number): boolean {
  return line[close] === "=" && line[close + 1] === "=" && !WHITESPACE.test(line[close - 1] ?? "");
}

/** 色付きハイライトの中身をマーカーにする。色が無い・ラベルにできないときはnull */
function toMarker(content: string): string | null {
  const emoji = String.fromCodePoint(content.codePointAt(0) as number);
  const color = HIGHLIGHT_COLORS.get(emoji);
  if (color === undefined) return null;

  const text = content.slice(emoji.length);
  // 空のラベルの`:marker[]`はサーバーが原文へ戻すので、変換しても色は付かない
  if (text === "" || !closesAsLabel(text)) return null;
  return `:marker[${text}]{${color}}`;
}

/**
 * `[text]`としたとき、ちょうど最後の`]`でラベルが閉じるか。
 *
 * directiveのラベルは対応の取れた`[]`を中に持てて、`\[`・`\]`・`\\`がエスケープになる
 * （micromark-extension-directive）。インラインコードの中の括弧も数えられるので、閉じ方が
 * 変わる中身は変換せずに残す
 */
function closesAsLabel(text: string): boolean {
  const label = `${text}]`;
  let depth = 0;
  for (let index = 0; index < label.length; index += 1) {
    const char = label[index];
    const next = label[index + 1];
    if (char === "\\" && (next === "[" || next === "]" || next === "\\")) {
      index += 1;
    } else if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      if (depth === 0) return index === label.length - 1;
      depth -= 1;
    }
  }
  return false;
}
