// 正規化済み本文が参照しているファイルの収集。
//
// サーバーは受け取った本文を自分で解析し、参照されたアセットを**必須blob**として扱う。
// 送らなかったアセットを本文が参照しているとその記事は公開されないので、迷う形は拾う側へ
// 倒す（余分に拾っても、実在しなければ指摘が1件出るだけで公開は止まらない）。
//
// 入力はObsidian記法の正規化後で`[[…]]`は残っていないため、見るのは標準Markdownの
// インラインリンク・参照定義、限定HTMLの`src`・`href`、leaf directiveの`url`。
//
// Markdownを正規表現で近似的に読むので、次は取りこぼす: 2段以上入れ子になった括弧を含む
// dest、バックスラッシュエスケープ、4スペースのインデントコードブロック（`segments.ts`と
// 同じ割り切り）。逆に`](…)`はラベル側の括弧の対応を見ずに拾うので、リンクでない文章を
// 参照と読むことがある。
import type { IssueCollector } from "../content/issues";
import {
  directoryOf,
  isArticlePath,
  isCanonicalPath,
  resolveRelativePath,
  toContentRootRelative,
} from "../vault/paths";
import { classifyAssetPath, isMarkdownPath, isTransferableAsset } from "./assets";
import type { NormalizeContext } from "./context";
import { joinBodyLines, replaceOutsideCode, splitBodyLines } from "./segments";
import { classifyReferenceUrl, decodeReferencePath } from "./url";

export interface CollectedReferences {
  /** 参照アセットのvaultルート相対path（本文中の出現順・重複なし） */
  assetPaths: string[];
  /** リンクした公開対象記事のコンテンツルート相対path（出現順・重複なし） */
  linkedArticlePaths: string[];
}

/** `<…>`で囲まれたdest、または括弧を1段だけ入れ子にできる素のdest */
const DESTINATION = "(<[^<>]*>|(?:[^\\s()]|\\([^\\s()]*\\))*)";

/** destの後ろに続けられるタイトル */
const TITLE = "(?:\\s+(?:\"[^\"]*\"|'[^']*'|\\([^()]*\\)))?";

const INLINE_DESTINATION = new RegExp(`\\]\\(\\s*${DESTINATION}${TITLE}\\s*\\)`, "g");

const REFERENCE_DEFINITION = new RegExp(
  `^ {0,3}\\[[^\\]]*\\]:\\s*${DESTINATION}${TITLE}\\s*$`,
  "gm",
);

/** 直前の1文字も見て、`data-src`のような別の属性を拾わない。引用符なしの値もHTMLとして有効 */
const HTML_ATTRIBUTE =
  /(?:^|[\s"'])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/** サーバーがHASTから集める leaf directive。`url`だけがアセット参照 */
const DIRECTIVE_URL =
  /::(?:audio|file)(?:\[[^\]]*\])?\{[^}]*?\burl\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

/**
 * 「コードの外」を示す目印。コードの中身にも空白はあり得るが、その位置は潰しても
 * 残しても空白なので結果は変わらない
 */
const OUTSIDE_CODE_MARK = " ";

interface FoundDestination {
  /** 行頭からの位置。出現順を決めるためだけに使う */
  index: number;
  /** 原文のdest（`<…>`を含む） */
  text: string;
}

/** 正規化済み本文が参照しているファイルを集める */
export function collectReferences(
  body: string,
  context: NormalizeContext,
  issues: IssueCollector,
): CollectedReferences {
  const baseDirectory = directoryOf(context.articleVaultPath);
  const seen = new Set<string>();
  const assetPaths = new Set<string>();
  const linkedArticlePaths = new Set<string>();

  // フェンスとインラインコードを潰した本文で探す。行をまたぐ `](\n dest)` も拾う
  for (const found of findDestinations(maskCode(body))) {
    if (seen.has(found.text)) continue;
    seen.add(found.text);

    const target = readDestination(found.text);
    if (target === null) continue;

    const vaultPath = resolveRelativePath(baseDirectory, target);
    if (vaultPath === null) {
      issues.warning(`vaultの外を指す参照は取り込めません: ${found.text}`);
      continue;
    }

    if (isMarkdownPath(vaultPath)) {
      collectArticleLink(vaultPath, context, linkedArticlePaths);
      continue;
    }
    collectAsset(vaultPath, context, issues, assetPaths);
  }

  return { assetPaths: [...assetPaths], linkedArticlePaths: [...linkedArticlePaths] };
}

/**
 * インラインコードの中身を同じ長さの空白へ潰す。
 *
 * `replaceOutsideCode()`はコード**以外**を置換するので、いったんコード以外を目印で潰し、
 * 目印が残った位置をコード以外として組み直す（バックティックの走査を作り直さないため）。
 * 長さを保つので、行のどこで見つけた参照かで出現順を決められる
 */
function maskInlineCode(line: string): string {
  if (!line.includes("`")) return line;

  const marked = replaceOutsideCode(line, (text) => OUTSIDE_CODE_MARK.repeat(text.length));
  return line
    .split("")
    .map((character, index) => (marked[index] === OUTSIDE_CODE_MARK ? character : " "))
    .join("");
}

/** フェンスとインラインコードを同じ長さの空白へ潰す（出現位置を保つ） */
function maskCode(body: string): string {
  return joinBodyLines(
    splitBodyLines(body).map((line) =>
      line.fenced ? OUTSIDE_CODE_MARK.repeat(line.text.length) : maskInlineCode(line.text),
    ),
  );
}

function quotedOrBare(match: RegExpMatchArray): string {
  return match[1] ?? match[2] ?? match[3] ?? "";
}

/** コードを潰した本文に含まれるdestを出現順に */
function findDestinations(masked: string): FoundDestination[] {
  const found: FoundDestination[] = [];

  for (const match of masked.matchAll(INLINE_DESTINATION)) {
    found.push({ index: match.index, text: match[1] ?? "" });
  }
  for (const match of masked.matchAll(REFERENCE_DEFINITION)) {
    found.push({ index: match.index, text: match[1] ?? "" });
  }
  for (const match of masked.matchAll(HTML_ATTRIBUTE)) {
    found.push({ index: match.index, text: quotedOrBare(match) });
  }
  for (const match of masked.matchAll(DIRECTIVE_URL)) {
    found.push({ index: match.index, text: quotedOrBare(match) });
  }

  return found.sort((left, right) => left.index - right.index);
}

/** destをvault内の相対pathとして読む。vault内のファイルを指していなければnull */
function readDestination(destination: string): string | null {
  const trimmed = destination.trim();
  const url = (
    trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed
  ).trim();

  if (classifyReferenceUrl(url) !== "relative") return null;

  const path = decodeReferencePath(url);
  // decode後の絶対pathはvaultの外。`resolveRelativePath()`もnullを返すが、警告を出す
  // 「vaultの外へ出る参照」とは区別してここで落とす
  if (path === null || path === "" || path.startsWith("/")) return null;
  return path;
}

/**
 * リンク先が実在しなくても加える。リンク先が後から追加されたときに、サーバーが
 * リンク元の記事を変換し直すための契約に合わせる
 */
function collectArticleLink(vaultPath: string, context: NormalizeContext, into: Set<string>): void {
  const articlePath = toContentRootRelative(vaultPath, context.contentRoot);
  if (articlePath === null || !isArticlePath(articlePath)) return;
  into.add(articlePath);
}

function collectAsset(
  vaultPath: string,
  context: NormalizeContext,
  issues: IssueCollector,
  into: Set<string>,
): void {
  if (context.findByPath(vaultPath) === null) {
    issues.error(`本文が参照するファイルが見つかりません: ${vaultPath}`);
    return;
  }

  const kind = classifyAssetPath(vaultPath);
  if (isTransferableAsset(kind)) {
    if (!isCanonicalPath(vaultPath)) {
      issues.warning(`pathに使えない文字が含まれるため参照を落としました: ${vaultPath}`);
      return;
    }
    into.add(vaultPath);
    return;
  }
  // 対応していない形式はサーバーも原文のまま残すので、指摘は出さない
  if (kind === "svg") issues.warning(`SVGは公開できないため参照を落としました: ${vaultPath}`);
}
