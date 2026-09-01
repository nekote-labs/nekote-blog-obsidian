// ノート1件の正規化。Obsidian記法を標準Markdownへ直し、参照しているファイルを集める。
//
// frontmatterは**触らない**（vaultが正本で、Nekoteは書き戻さない）。`title`の補完も
// サーバーがpathからやり直すので、ここで原稿へ書き足すことはしない。
import {
  FrontmatterError,
  readFrontmatter,
  splitNote,
  type NoteFrontmatter,
  type SplitNote,
  type YamlParser,
} from "../content/frontmatter";
import { IssueCollector, type ArticleIssue } from "../content/issues";
import { MAX_ARTICLE_ASSET_PATHS } from "../protocol/limits";
import { baseNameOf, directoryOf, isCanonicalPath, resolveRelativePath } from "../vault/paths";
import { classifyAssetPath } from "./assets";
import { normalizeCallouts } from "./callout";
import type { NormalizeContext } from "./context";
import { collectReferences } from "./references";
import { classifyReferenceUrl, decodeReferencePath, isHttpsUrl } from "./url";
import { normalizeWikilinks } from "./wikilink";

export interface NormalizedNote {
  /** サーバーへ送るMarkdown（frontmatterはそのまま、本文だけ正規化済み） */
  markdown: string;
  /** 表示用のタイトル。frontmatterに無ければファイル名 */
  title: string;
  draft: boolean;
  /** 参照アセットのvaultルート相対path。**Pushする原本を決めるのはこれ** */
  assetPaths: string[];
  /** 記事entryへ申告する参照アセット（上限まで切り詰めたもの） */
  declaredAssetPaths: string[];
  /** リンクした公開対象記事のコンテンツルート相対path */
  linkedArticlePaths: string[];
  issues: ArticleIssue[];
}

export function normalizeNote(input: {
  markdown: string;
  context: NormalizeContext;
  parseYaml: YamlParser;
}): NormalizedNote {
  const { context } = input;
  const issues = new IssueCollector();
  const title = baseNameOf(context.articlePath);

  let split: SplitNote;
  try {
    split = splitNote(input.markdown);
  } catch (error) {
    // frontmatterの境界が読めない原稿は本文を切り出せない。正規化せずそのまま送り、
    // サーバーの記事エラーと同じ内容をローカルでも先に見せる
    issues.error(messageOf(error));
    return {
      markdown: input.markdown,
      title,
      draft: false,
      assetPaths: [],
      declaredAssetPaths: [],
      linkedArticlePaths: [],
      issues: issues.list(),
    };
  }

  let frontmatter: NoteFrontmatter;
  try {
    frontmatter = readFrontmatter(split.yaml, input.parseYaml);
  } catch (error) {
    issues.error(messageOf(error));
    frontmatter = {
      title: undefined,
      draft: false,
      slug: undefined,
      thumbnail: undefined,
      cover: undefined,
    };
  }

  const normalizedBody = normalizeWikilinks(normalizeCallouts(split.body, issues), context, issues);
  const references = collectReferences(normalizedBody, context, issues);

  const frontmatterAssets = [
    resolveFrontmatterImage(frontmatter.thumbnail, "thumbnail", context, issues),
    resolveFrontmatterImage(frontmatter.cover, "cover", context, issues),
  ].filter((path): path is string => path !== null);

  return {
    markdown: split.head + normalizedBody,
    title: frontmatter.title ?? title,
    draft: frontmatter.draft,
    assetPaths: unique([...references.assetPaths, ...frontmatterAssets]),
    declaredAssetPaths: declaredAssetPaths(references.assetPaths, frontmatterAssets, issues),
    linkedArticlePaths: references.linkedArticlePaths,
    issues: issues.list(),
  };
}

/**
 * 記事entryへ申告する参照アセット。
 *
 * 上限は**本文由来だけで判定**し、`thumbnail`→`cover`の順に残り枠へ入れる
 * （spec/obsidian.md「frontmatter」）。上限を超えた申告はmanifest全体が
 * `invalid_manifest`で拒否されるので、切り詰めてから送る
 */
function declaredAssetPaths(
  bodyAssetPaths: readonly string[],
  frontmatterAssets: readonly string[],
  issues: IssueCollector,
): string[] {
  const declared = unique(bodyAssetPaths).slice(0, MAX_ARTICLE_ASSET_PATHS);
  if (unique(bodyAssetPaths).length > MAX_ARTICLE_ASSET_PATHS) {
    issues.error(
      `本文が参照するアセットが${MAX_ARTICLE_ASSET_PATHS}件を超えています。減らしてください。`,
    );
  }

  for (const path of frontmatterAssets) {
    if (declared.includes(path)) continue;
    if (declared.length >= MAX_ARTICLE_ASSET_PATHS) {
      issues.warning("参照アセットが上限に達したため、frontmatterの画像を省略しました。");
      break;
    }
    declared.push(path);
  }
  return declared;
}

/**
 * frontmatterの`thumbnail`・`cover`を解決する。
 *
 * **本文HAST由来の参照とは別系統**で解決する契約（サーバーの
 * `resolveFrontmatterImageRef`と同じ規則）。相対pathはvault内のラスタ画像だけを
 * 取り込み、外部URLは`https`だけ許してリホストしない
 */
function resolveFrontmatterImage(
  value: string | undefined,
  key: "thumbnail" | "cover",
  context: NormalizeContext,
  issues: IssueCollector,
): string | null {
  if (value === undefined) return null;

  if (classifyReferenceUrl(value) !== "relative") {
    if (isHttpsUrl(value)) return null;
    issues.warning(`frontmatterの${key}に指定できないURLです。省略しました。`);
    return null;
  }

  const decoded = decodeReferencePath(value);
  const resolved =
    decoded === null ? null : resolveRelativePath(directoryOf(context.articleVaultPath), decoded);
  if (resolved === null) {
    issues.warning(`frontmatterの${key}の画像を解決できません。省略しました: ${value}`);
    return null;
  }
  if (classifyAssetPath(resolved) !== "image") {
    issues.warning(`frontmatterの${key}にはラスタ画像を指定してください。省略しました: ${value}`);
    return null;
  }
  if (context.findByPath(resolved) === null) {
    issues.warning(`frontmatterの${key}の画像が見つかりません。省略しました: ${resolved}`);
    return null;
  }
  // 正規形でないpathはmanifest**全体**が拒否される。1件の画像のために記事を送れなく
  // しないよう、ここで落とす（本文由来の参照も`collectReferences()`が同じ扱いにする）
  if (!isCanonicalPath(resolved)) {
    issues.warning(`pathに使えない文字が含まれるため参照を落としました: ${resolved}`);
    return null;
  }
  return resolved;
}

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function messageOf(error: unknown): string {
  return error instanceof FrontmatterError ? error.message : "frontmatterを読み取れませんでした。";
}
