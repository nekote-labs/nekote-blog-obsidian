// vault内のpathと同期manifestのkeyの正規化・判定。
//
// **判定はサーバー側（`nekote-blog`の`packages/core/src/obsidian/path.ts`）と同じ規則**に
// 揃えてある。ここを通した値をサーバーが`invalid_manifest`で拒否すると、利用者には
// 何を直せばよいか分からないため、同じ規則を送信前に当てる。
//
// manifest keyの基準は種別で違う（spec/obsidian.md「コンテンツルートと公開対象」）。
//
// - Markdown: コンテンツルート相対（`posts/…`・`pages/…`）
// - アセット: vaultルート相対

// 制御文字はmanifest keyとして拒否する対象そのものなので、正規表現に入れる
// eslint-disable-next-line no-control-regex -- 制御文字そのものが検出対象なので必要
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

function isCanonicalSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("\\") &&
    !CONTROL_CHARACTER_PATTERN.test(segment)
  );
}

/** manifest keyとして送れる正規形か（相対・`/`区切り・Unicode NFC・空segmentなし） */
export function isCanonicalPath(path: string): boolean {
  if (path.startsWith("/") || path.endsWith("/")) return false;
  if (path.normalize("NFC") !== path) return false;
  return path.split("/").every(isCanonicalSegment);
}

/** コンテンツルートの正規形か。vaultルート自体を選んだ場合は空文字 */
export function isCanonicalContentRoot(path: string): boolean {
  return path === "" || isCanonicalPath(path);
}

/**
 * Vault APIが返したpathを正規形へ寄せる。
 *
 * 揃えるのは**Unicode正規化と余分な`/`だけ**。`\`や制御文字はここで消さず、
 * `isCanonicalPath()`で弾く（黙って別のファイルを指す形へ書き換えないため）
 */
export function normalizeVaultPath(path: string): string {
  return path.normalize("NFC").replace(/^\/+/, "").replace(/\/+$/, "");
}

/** vaultルート相対pathをコンテンツルート相対pathへ。ルート外はnull */
export function toContentRootRelative(vaultPath: string, contentRoot: string): string | null {
  if (contentRoot === "") return vaultPath;
  const prefix = `${contentRoot}/`;
  return vaultPath.startsWith(prefix) ? vaultPath.slice(prefix.length) : null;
}

/** コンテンツルート直下のディレクトリ名から決まる種別 */
export type ContentKind = "post" | "page";

/** 記事を置くディレクトリ名（コンテンツルート直下） */
export const POST_DIRECTORY = "posts";

/** 固定ページを置くディレクトリ名（コンテンツルート直下） */
export const PAGE_DIRECTORY = "pages";

/**
 * コンテンツルート相対pathの種別（`null`＝公開対象外）。
 * 配下のサブディレクトリは整理用なので`posts/2026/hello.md`も記事になる。
 * ディレクトリ名と拡張子の大文字小文字はサーバーと揃えて区別しない
 */
export function contentKindFromPath(articlePath: string): ContentKind | null {
  const separator = articlePath.indexOf("/");
  if (separator === -1) return null;
  const directory = articlePath.slice(0, separator).toLowerCase();
  if (directory === POST_DIRECTORY) return "post";
  if (directory === PAGE_DIRECTORY) return "page";
  return null;
}

/** 同期manifestのMarkdown keyとして送れるpathか（正規形・`.md`・`posts/`か`pages/`配下） */
export function isArticlePath(articlePath: string): boolean {
  return (
    isCanonicalPath(articlePath) &&
    /\.md$/i.test(articlePath) &&
    contentKindFromPath(articlePath) !== null
  );
}

/**
 * vaultルート相対pathが公開対象のノートか（コンテンツルート配下の`posts/`・`pages/`の`.md`）。
 * Push走査と同じ規則で判定する。コンテンツルート未選択（null）は常にfalse
 */
export function isPublishTargetVaultPath(vaultPath: string, contentRoot: string | null): boolean {
  if (contentRoot === null) return false;
  const relative = toContentRootRelative(normalizeVaultPath(vaultPath), contentRoot);
  return relative !== null && isArticlePath(relative);
}

/** pathのディレクトリ部分（vaultルート直下なら空文字） */
export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** pathのファイル名部分 */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** ファイル名から拡張子を除いた部分 */
export function baseNameOf(path: string): string {
  const fileName = fileNameOf(path);
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

/** 拡張子（小文字・ドットなし）。拡張子が無ければ空文字 */
export function extensionOf(path: string): string {
  const fileName = fileNameOf(path);
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/**
 * `..`を含み得る相対targetを`baseDirectory`起点で解決する。
 * vaultルートより上へ出る参照はnull（**サーバーの`resolvePosixPath`と同じ判定**）
 */
export function resolveRelativePath(baseDirectory: string, target: string): string | null {
  if (target === "" || target.startsWith("/")) return null;

  const resolved: string[] = [];
  for (const segment of `${baseDirectory}/${target}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.length === 0 ? null : resolved.join("/");
}

/**
 * `fromFilePath`（ファイル）から見た`toPath`への相対path。
 *
 * サーバーは本文中の相対URLを**mdファイルのディレクトリ起点**で解決する
 * （`resolveMarkdownAssetPath()`）ので、正規化後の本文へ書く参照はこの形にする
 */
export function relativePathFrom(fromFilePath: string, toPath: string): string {
  const fromSegments = directoryOf(fromFilePath)
    .split("/")
    .filter((segment) => segment !== "");
  const toSegments = toPath.split("/");

  let common = 0;
  while (
    common < fromSegments.length &&
    common < toSegments.length - 1 &&
    fromSegments[common] === toSegments[common]
  ) {
    common += 1;
  }

  const up = Array.from({ length: fromSegments.length - common }, () => "..");
  return [...up, ...toSegments.slice(common)].join("/");
}

/**
 * 相対pathをMarkdownのリンク先として書ける形へencodeする。
 *
 * サーバーは`?`・`#`より前だけをpathとして読み、`decodeURIComponent()`で戻す。
 * ファイル名にそれらや空白・括弧が入っていてもリンクが壊れないよう、segment単位で
 * encodeする（`(`・`)`は`encodeURIComponent`が残すのでここで追加する）
 */
export function encodePathForMarkdownUrl(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/\(/g, "%28").replace(/\)/g, "%29"))
    .join("/");
}
