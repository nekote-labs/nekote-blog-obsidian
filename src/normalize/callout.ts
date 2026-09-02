// ObsidianのCalloutを`:::`コンテナ記法へ正規化する。
//
// Nekoteのtypeは7種だけなので、Obsidianの識別子（別名を含む）をここで寄せる。**未対応の
// 識別子はnoteへ落として警告する**（記事ごと落とさない）。折りたたみ指定`+`/`-`と入れ子の
// Calloutに対応する表現はNekoteに無く、前者は捨て、後者は通常の引用として残す。
//
// 行頭の空白が4個以上の`>`はインデントコードブロックと区別できないため対象外にする。
import type { IssueCollector } from "../content/issues";
import { getTranslations } from "../i18n";
import { joinBodyLines, splitBodyLines } from "./segments";
import { containerFenceFor, escapeBracketLabel } from "./text";

type NekoteCalloutType = "note" | "info" | "check" | "tip" | "help" | "warning" | "alert";

/** 識別子（小文字）→ Nekoteのtype。識別子は利用者の入力なので、`constructor`等が当たらないMapで引く */
const CALLOUT_TYPES = new Map<string, NekoteCalloutType>([
  ["note", "note"],
  ["abstract", "note"],
  ["summary", "note"],
  ["tldr", "note"],
  ["example", "note"],
  ["quote", "note"],
  ["cite", "note"],
  ["info", "info"],
  ["todo", "check"],
  ["success", "check"],
  ["check", "check"],
  ["done", "check"],
  ["tip", "tip"],
  ["hint", "tip"],
  ["important", "tip"],
  ["question", "help"],
  ["help", "help"],
  ["faq", "help"],
  ["warning", "warning"],
  ["caution", "warning"],
  ["attention", "warning"],
  ["failure", "alert"],
  ["fail", "alert"],
  ["missing", "alert"],
  ["danger", "alert"],
  ["error", "alert"],
  ["bug", "alert"],
]);

/**
 * 引用1階層分。先頭の空白は0〜3個まで、`>`の直後の空白は1つだけ落とす。
 * 行末の`\r`（CRLFの本文）は`.`に含まれないので、行の中身は`[\s\S]`で取る
 */
const QUOTE_LINE = /^( {0,3})>[ \t]?([\s\S]*)$/;
const CALLOUT_HEAD = /^\[!([^\]\n]*)\]([+-]?)([\s\S]*)$/;

interface CalloutHead {
  /** 利用者が書いた識別子（trim済み・大小はそのまま） */
  identifier: string;
  /** 明示されたタイトル。省略時は空文字 */
  title: string;
}

/** ObsidianのCalloutを`:::`コンテナ記法へ正規化する。本文以外は変えない */
export function normalizeCallouts(body: string, issues: IssueCollector): string {
  const lines = splitBodyLines(body);
  const result: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (!isQuoteLine(line.fenced, line.text)) {
      result.push(line.text);
      index += 1;
      continue;
    }

    const block: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (current === undefined || !isQuoteLine(current.fenced, current.text)) break;
      block.push(current.text);
      index += 1;
    }

    appendBlock(result, block, lines[index]?.text, issues);
  }

  return joinBodyLines(result);
}

function isQuoteLine(fenced: boolean, text: string): boolean {
  return !fenced && QUOTE_LINE.test(text);
}

/** blockquote 1ブロック分を変換して`result`へ足す */
function appendBlock(
  result: string[],
  block: readonly string[],
  nextText: string | undefined,
  issues: IssueCollector,
): void {
  const first = block[0];
  if (first === undefined) return;

  const quote = QUOTE_LINE.exec(first);
  const head = quote === null ? null : parseCalloutHead(quote[2] ?? "");
  if (quote === null || head === null) {
    for (const line of block) result.push(rewriteNestedCallout(line, issues));
    return;
  }

  const indent = quote[1] ?? "";
  const eol = first.endsWith("\r") ? "\r" : "";
  const label = buildLabel(titleOf(head));
  const type = resolveType(head.identifier, issues);

  const content = dropTrailingBlank(
    block.slice(1).map((line) => rewriteNestedCallout(stripOneQuote(line), issues)),
  );
  const fence = containerFenceFor(joinBodyLines(content));

  // `:::`が直前・直後の段落の続きとして読まれないよう空行で挟む
  const previous = result.at(-1);
  if (previous !== undefined && !isBlank(previous)) result.push(eol);

  result.push(`${indent}${fence}${type}${label}${eol}`);
  for (const line of content) result.push(isBlank(line) ? line : indent + line);
  result.push(`${indent}${fence}${eol}`);

  if (nextText !== undefined && !isBlank(nextText)) result.push(eol);
}

function parseCalloutHead(text: string): CalloutHead | null {
  const match = CALLOUT_HEAD.exec(text);
  if (match === null) return null;
  return { identifier: (match[1] ?? "").trim(), title: (match[3] ?? "").trim() };
}

/**
 * 表示するタイトル。省略時はObsidianの既定タイトル（**利用者が書いた識別子**の
 * タイトルケース）で、寄せた先のtype名ではない（`[!tldr]`は`Tldr`）
 */
function titleOf(head: CalloutHead): string {
  if (head.title !== "") return head.title;
  const identifier = head.identifier;
  if (identifier === "") return "";
  return identifier.charAt(0).toUpperCase() + identifier.slice(1).toLowerCase();
}

function buildLabel(title: string): string {
  return title === "" ? "" : `[${escapeBracketLabel(title)}]`;
}

function resolveType(identifier: string, issues: IssueCollector): NekoteCalloutType {
  const type = CALLOUT_TYPES.get(identifier.toLowerCase());
  if (type !== undefined) return type;
  // 識別子が無い`[!]`は伝える種類が無いので黙ってnoteにする
  if (identifier !== "") {
    issues.warning(getTranslations().normalize.unsupportedCalloutType(identifier));
  }
  return "note";
}

/** 深い階層に残ったCallout記法。入れ子は作れないので見出しをタイトルへ置き換えて引用のまま残す */
function rewriteNestedCallout(line: string, issues: IssueCollector): string {
  const eol = line.endsWith("\r") ? "\r" : "";
  const { markers, rest } = splitQuoteMarkers(eol === "" ? line : line.slice(0, -1));
  if (markers === "") return line;
  const head = parseCalloutHead(rest);
  if (head === null) return line;
  issues.warning(getTranslations().normalize.nestedCallout);
  return markers + titleOf(head) + eol;
}

/** 引用の`>`を1階層ずつ剥がす。1本の正規表現で繰り返すと空白の解釈が分岐して総当たりになる */
function splitQuoteMarkers(line: string): { markers: string; rest: string } {
  let rest = line;
  for (;;) {
    const match = QUOTE_LINE.exec(rest);
    if (match === null) break;
    rest = match[2] ?? "";
  }
  return { markers: line.slice(0, line.length - rest.length), rest };
}

function stripOneQuote(line: string): string {
  return QUOTE_LINE.exec(line)?.[2] ?? line;
}

function dropTrailingBlank(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0 && isBlank(lines[end - 1] ?? "")) end -= 1;
  return lines.slice(0, end);
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}
