// Obsidianのwikilink・embedを標準Markdownへ直す。
//
// vaultの中でだけ通じる`[[…]]`・`![[…]]`を、公開後も同じ場所を指す相対リンクへ
// 置き換える。**解決できない・公開できない参照はリンクを落として表示テキストだけを
// 残す**（壊れたリンクを公開しないため）。落ちた事実はすべて警告で利用者へ返す。
//
// 参照先pathの収集はここでは行わない（正規化後の本文からまとめて集める）。
import type { IssueCollector } from "../content/issues";
import { getTranslations } from "../i18n";
import {
  baseNameOf,
  encodePathForMarkdownUrl,
  isArticlePath,
  isCanonicalPath,
  relativePathFrom,
  toContentRootRelative,
} from "../vault/paths";
import { classifyAssetPath, isMarkdownPath, isTransferableAsset } from "./assets";
import type { NormalizeContext } from "./context";
import { headingAnchorId } from "./heading-anchor";
import { replaceOutsideCode } from "./segments";
import { escapeBracketLabel, escapeInlineText } from "./text";

/** 中身は最初の`]]`まで（Obsidianの読み方に合わせる） */
const WIKILINK_PATTERN = /(!?)\[\[(.*?)\]\]/g;

/** `![[image.png|300]]`・`![[image.png|300x200]]`の表示サイズ */
const SIZE_DISPLAY_PATTERN = /^\d+(x\d+)?$/;

interface WikilinkParts {
  /** `|`より前の原文。ラベルの既定値に使うのでtrimしない */
  target: string;
  /** 最初の`|`より後ろ全部。指定なしはnull */
  display: string | null;
  /** `#`・`|`を落としたlinkpath。空文字＝同じノートの中への参照 */
  linkpath: string;
  /** 最初の`#`から後ろ全部。指定なしはnull */
  subpath: string | null;
  /** subpathの最後の`#`より後ろ。`#A#B`のような多段は最後の見出しだけを使う */
  subpathText: string;
  /** ブロック参照（`#^…`）か */
  block: boolean;
}

/** Obsidianのwikilink・embedを標準Markdownへ正規化する */
export function normalizeWikilinks(
  body: string,
  context: NormalizeContext,
  issues: IssueCollector,
): string {
  return replaceOutsideCode(body, (text) =>
    text.replace(WIKILINK_PATTERN, (_match: string, bang: string, inner: string) =>
      convertWikilink(parseWikilink(inner), bang === "!", context, issues),
    ),
  );
}

function parseWikilink(inner: string): WikilinkParts {
  const bar = inner.indexOf("|");
  const target = bar === -1 ? inner : inner.slice(0, bar);
  const display = bar === -1 ? null : inner.slice(bar + 1);
  const hash = target.indexOf("#");
  const subpath = hash === -1 ? null : target.slice(hash);

  return {
    target,
    // 空の表示名はラベルにできないので、指定なしと同じ扱いにする
    display: display === null || display === "" ? null : display,
    linkpath: (hash === -1 ? target : target.slice(0, hash)).trim(),
    subpath,
    subpathText: subpath === null ? "" : subpath.slice(subpath.lastIndexOf("#") + 1),
    block: subpath !== null && subpath.startsWith("#^"),
  };
}

/** リンクを落とすときに本文へ残す文字 */
function displayTextOf(parts: WikilinkParts): string {
  return escapeInlineText(parts.display ?? parts.target);
}

function markdownLink(label: string, url: string): string {
  return `[${escapeBracketLabel(label)}](${url})`;
}

function convertWikilink(
  parts: WikilinkParts,
  embed: boolean,
  context: NormalizeContext,
  issues: IssueCollector,
): string {
  // 空のlinkpathはObsidianでは自分自身を指す。解決へ回すと自ノートへのリンクに
  // なってしまうので、ここで同じノートの中への参照として処理する
  if (parts.linkpath === "") return convertSelfLink(parts, embed, issues);

  const t = getTranslations().normalize;
  const file = context.resolveLinkpath(parts.linkpath);
  if (file === null) {
    issues.warning(t.unresolvedLink(parts.linkpath));
    return displayTextOf(parts);
  }
  if (!isCanonicalPath(file.path)) {
    issues.warning(t.unusablePathCharacters(file.path));
    return displayTextOf(parts);
  }

  const url = encodePathForMarkdownUrl(relativePathFrom(context.articleVaultPath, file.path));
  return isMarkdownPath(file.path)
    ? convertNoteLink(parts, embed, file.path, url, context, issues)
    : convertAssetLink(parts, embed, file.path, url, issues);
}

/** `[[#見出し]]`・`[[#^ブロック]]`（同じノートの中への参照） */
function convertSelfLink(parts: WikilinkParts, embed: boolean, issues: IssueCollector): string {
  const t = getTranslations().normalize;
  if (embed) issues.warning(t.noteEmbed);
  const label = parts.display ?? parts.subpathText;

  if (parts.block) {
    issues.warning(t.blockReferenceTextOnly);
    return escapeInlineText(label);
  }
  const anchor = headingAnchorId(parts.subpathText);
  if (anchor === null) {
    issues.warning(t.unresolvedHeading(parts.subpathText));
    return escapeInlineText(label);
  }
  return markdownLink(label, `#${anchor}`);
}

function convertNoteLink(
  parts: WikilinkParts,
  embed: boolean,
  filePath: string,
  url: string,
  context: NormalizeContext,
  issues: IssueCollector,
): string {
  const t = getTranslations().normalize;
  const articlePath = toContentRootRelative(filePath, context.contentRoot);
  if (articlePath === null || !isArticlePath(articlePath)) {
    issues.warning(t.unpublishedNoteLink(filePath));
    return displayTextOf(parts);
  }

  if (embed) issues.warning(t.noteEmbed);
  return markdownLink(parts.display ?? parts.target, `${url}${noteFragment(parts, issues)}`);
}

/** 記事へのリンクに付けるフラグメント。付けられないときは空文字 */
function noteFragment(parts: WikilinkParts, issues: IssueCollector): string {
  if (parts.subpath === null) return "";
  const t = getTranslations().normalize;
  if (parts.block) {
    issues.warning(t.blockReferenceToTop);
    return "";
  }
  const anchor = headingAnchorId(parts.subpathText);
  if (anchor === null) {
    issues.warning(t.unresolvedHeading(parts.subpathText));
    return "";
  }
  return `#${anchor}`;
}

function convertAssetLink(
  parts: WikilinkParts,
  embed: boolean,
  filePath: string,
  url: string,
  issues: IssueCollector,
): string {
  const t = getTranslations().normalize;
  const kind = classifyAssetPath(filePath);
  if (kind === "svg") {
    issues.warning(t.svgTextOnly(filePath));
    return displayTextOf(parts);
  }
  if (!isTransferableAsset(kind)) {
    issues.warning(t.unsupportedFormatTextOnly(filePath));
    return displayTextOf(parts);
  }

  // アセットのURLにフラグメントは付けない（PDFのページ指定等に対応する表現がない）
  if (parts.subpath !== null) {
    issues.warning(t.ignoredOption(parts.subpath));
  }
  if (!embed) return markdownLink(parts.display ?? parts.target, url);
  return `!${markdownLink(embedAssetLabel(parts, filePath, issues), url)}`;
}

function embedAssetLabel(parts: WikilinkParts, filePath: string, issues: IssueCollector): string {
  if (parts.display === null) return baseNameOf(filePath);
  if (SIZE_DISPLAY_PATTERN.test(parts.display)) {
    issues.warning(getTranslations().normalize.imageSizeIgnored);
    return baseNameOf(filePath);
  }
  return parts.display;
}
