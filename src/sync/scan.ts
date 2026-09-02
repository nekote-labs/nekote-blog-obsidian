// vaultの走査。コンテンツルート配下のMarkdownと、そこから参照されたアセットだけを
// 読み、決定的な同期manifestを作る。
//
// 順序には理由がある（spec/obsidian.md「ローカル走査と早期確認」）。
//
// 1. pathと`stat`だけでMarkdownの件数と原本bytesを数える（本文はまだ読まない）
// 2. しきい値を超えたら続行を確認する
// 3. Markdownを1件ずつ読み、正規化し、hashして**すぐ捨てる**（全文を持ち続けない）
// 4. 参照アセットの件数と原本bytesを`stat`から出し、しきい値を超えたら再確認する
// 5. 参照アセットだけを1件ずつ読んでhashする
//
// **1件でも読めなければ走査全体を失敗させる**。読めなかったファイルをmanifestから
// 黙って落とすと、サーバーはそれを「削除」として適用してしまう。
import type { YamlParser } from "../content/frontmatter";
import type { ArticleIssue } from "../content/issues";
import { sha256Hex } from "../crypto/hash";
import { getTranslations } from "../i18n";
import { classifyAssetPath } from "../normalize/assets";
import type { NormalizeContext } from "../normalize/context";
import { normalizeNote, type NormalizedNote } from "../normalize/note";
import {
  CONFIRM_SCAN_ASSET_BYTES,
  CONFIRM_SCAN_ASSET_COUNT,
  CONFIRM_SCAN_MARKDOWN_BYTES,
  CONFIRM_SCAN_MARKDOWN_COUNT,
  MAX_IMAGE_FILE_BYTES,
  MAX_MANIFEST_ASSET_ENTRIES,
  MAX_MANIFEST_MARKDOWN_ENTRIES,
  MAX_MARKDOWN_FILE_BYTES,
  MAX_OTHER_ASSET_FILE_BYTES,
} from "../protocol/limits";
import type { SyncManifestEntry } from "../protocol/types";
import type { VaultFileRef, VaultGateway } from "../vault/gateway";
import { contentKindFromPath, isCanonicalPath, toContentRootRelative } from "../vault/paths";
import { findCaseCollision, manifestHash, sortManifestEntries } from "./manifest";

/** 走査を止めた。**この状態でmanifestを送ってはいけない**（削除の誤適用になる） */
export class ScanAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanAbortedError";
  }
}

/** 利用者が続行確認で取り消した */
export class ScanCancelledError extends Error {
  constructor() {
    super(getTranslations().publish.cancelled);
    this.name = "ScanCancelledError";
  }
}

export interface ScanAmount {
  count: number;
  bytes: number;
}

export interface ScanSummary {
  markdown: ScanAmount;
  asset: ScanAmount;
  publishedCount: number;
  draftCount: number;
  errorCount: number;
  warningCount: number;
}

export interface ScannedArticle {
  /** コンテンツルート相対path */
  path: string;
  title: string;
  draft: boolean;
  issues: ArticleIssue[];
}

export interface ScanResult {
  contentRoot: string;
  entries: SyncManifestEntry[];
  manifestHash: string;
  articles: ScannedArticle[];
  summary: ScanSummary;
  /** sha256から原本のバイト列を作り直す。uploadするときにだけ読む */
  loadBlob: (sha256: string) => Promise<ArrayBuffer>;
}

export interface ScanProgress {
  phase: "notes" | "assets";
  done: number;
  total: number;
}

export interface ScanDeps {
  vault: VaultGateway;
  parseYaml: YamlParser;
  /** 本文を読む前の続行確認。`false`なら走査を取り消す */
  confirmNotes: (amount: ScanAmount) => Promise<boolean>;
  /** アセット本体を読む前の続行確認 */
  confirmAssets: (amount: ScanAmount) => Promise<boolean>;
  onProgress?: (progress: ScanProgress) => void;
}

interface NoteTarget {
  file: VaultFileRef;
  /** コンテンツルート相対path（manifest key） */
  articlePath: string;
}

export async function scanVault(deps: ScanDeps, contentRoot: string): Promise<ScanResult> {
  const t = getTranslations().scan;
  const { vault } = deps;
  const byPath = indexFiles(vault.listFiles());
  const targets = collectNoteTargets(byPath, contentRoot);

  if (targets.length > MAX_MANIFEST_MARKDOWN_ENTRIES) {
    throw new ScanAbortedError(t.tooManyMarkdown(targets.length, MAX_MANIFEST_MARKDOWN_ENTRIES));
  }

  const markdownAmount: ScanAmount = {
    count: targets.length,
    bytes: targets.reduce((total, target) => total + target.file.size, 0),
  };
  if (
    markdownAmount.count > CONFIRM_SCAN_MARKDOWN_COUNT ||
    markdownAmount.bytes > CONFIRM_SCAN_MARKDOWN_BYTES
  ) {
    if (!(await deps.confirmNotes(markdownAmount))) throw new ScanCancelledError();
  }

  const entries: SyncManifestEntry[] = [];
  const articles: ScannedArticle[] = [];
  const referencedAssets = new Set<string>();
  const noteBySha = new Map<string, NoteTarget>();
  let markdownBytes = 0;

  for (const [index, target] of targets.entries()) {
    const note = await readNote(deps, byPath, contentRoot, target);
    const bytes = new TextEncoder().encode(note.markdown);
    if (bytes.byteLength > MAX_MARKDOWN_FILE_BYTES) {
      throw new ScanAbortedError(
        t.markdownTooLarge(formatBytes(MAX_MARKDOWN_FILE_BYTES), target.articlePath),
      );
    }

    const sha256 = await sha256Hex(bytes);
    entries.push({
      path: target.articlePath,
      kind: "markdown",
      sha256,
      bytes: bytes.byteLength,
      ...(note.declaredAssetPaths.length > 0 ? { assetPaths: note.declaredAssetPaths } : {}),
      ...(note.linkedArticlePaths.length > 0
        ? { linkedArticlePaths: note.linkedArticlePaths }
        : {}),
    });
    articles.push({
      path: target.articlePath,
      title: note.title,
      draft: note.draft,
      issues: note.issues,
    });
    for (const path of note.assetPaths) referencedAssets.add(path);
    noteBySha.set(sha256, target);
    markdownBytes += bytes.byteLength;

    deps.onProgress?.({ phase: "notes", done: index + 1, total: targets.length });
  }

  const assetFiles = resolveAssets(referencedAssets, byPath);
  if (assetFiles.length > MAX_MANIFEST_ASSET_ENTRIES) {
    throw new ScanAbortedError(t.tooManyAssets(assetFiles.length, MAX_MANIFEST_ASSET_ENTRIES));
  }
  for (const file of assetFiles) assertAssetSize(file, file.size);

  const assetAmount: ScanAmount = {
    count: assetFiles.length,
    bytes: assetFiles.reduce((total, file) => total + file.size, 0),
  };
  if (
    assetAmount.count > CONFIRM_SCAN_ASSET_COUNT ||
    assetAmount.bytes > CONFIRM_SCAN_ASSET_BYTES
  ) {
    if (!(await deps.confirmAssets(assetAmount))) throw new ScanCancelledError();
  }

  const assetBySha = new Map<string, VaultFileRef>();
  let assetBytes = 0;
  for (const [index, file] of assetFiles.entries()) {
    const buffer = await readAssetBytes(vault, file);
    assertAssetSize(file, buffer.byteLength);
    const sha256 = await sha256Hex(buffer);
    entries.push({ path: file.path, kind: "asset", sha256, bytes: buffer.byteLength });
    assetBySha.set(sha256, file);
    assetBytes += buffer.byteLength;

    deps.onProgress?.({ phase: "assets", done: index + 1, total: assetFiles.length });
  }

  const sorted = sortManifestEntries(entries);
  const collision = findCaseCollision(sorted);
  if (collision !== null) {
    throw new ScanAbortedError(t.caseCollision(collision.first, collision.second));
  }

  return {
    contentRoot,
    entries: sorted,
    manifestHash: await manifestHash(contentRoot, sorted),
    articles,
    summary: summarize(
      articles,
      { count: targets.length, bytes: markdownBytes },
      {
        count: assetFiles.length,
        bytes: assetBytes,
      },
    ),
    loadBlob: (sha256) => loadBlob(deps, byPath, contentRoot, { noteBySha, assetBySha }, sha256),
  };
}

/**
 * vaultの全ファイルをmanifest keyで引けるようにする。
 *
 * NFC正規化の結果が同じになる2ファイルは、どちらを送ってもOS間で取り違えるので
 * ここで止める（`é`の合成済みと分解済みが同じフォルダにある場合など）
 */
function indexFiles(files: readonly VaultFileRef[]): Map<string, VaultFileRef> {
  const byPath = new Map<string, VaultFileRef>();
  for (const file of files) {
    const existing = byPath.get(file.path);
    if (existing !== undefined) {
      throw new ScanAbortedError(
        getTranslations().scan.normalizationCollision(existing.vaultPath, file.vaultPath),
      );
    }
    byPath.set(file.path, file);
  }
  return byPath;
}

function collectNoteTargets(
  byPath: ReadonlyMap<string, VaultFileRef>,
  contentRoot: string,
): NoteTarget[] {
  const targets: NoteTarget[] = [];
  for (const file of byPath.values()) {
    if (file.extension !== "md") continue;
    const articlePath = toContentRootRelative(file.path, contentRoot);
    if (articlePath === null || contentKindFromPath(articlePath) === null) continue;

    // 公開対象と分かったあとにpathを検査する。ここで黙って除外すると削除になる
    if (!isCanonicalPath(articlePath)) {
      throw new ScanAbortedError(getTranslations().scan.unsupportedPathCharacters(file.vaultPath));
    }
    targets.push({ file, articlePath });
  }
  return targets.sort((left, right) => (left.articlePath < right.articlePath ? -1 : 1));
}

function resolveAssets(
  paths: ReadonlySet<string>,
  byPath: ReadonlyMap<string, VaultFileRef>,
): VaultFileRef[] {
  const files: VaultFileRef[] = [];
  for (const path of [...paths].sort()) {
    const file = byPath.get(path);
    // 実在しない参照は記事側で指摘済み（`collectReferences`）
    if (file !== undefined) files.push(file);
  }
  return files;
}

async function readNote(
  deps: ScanDeps,
  byPath: ReadonlyMap<string, VaultFileRef>,
  contentRoot: string,
  target: NoteTarget,
): Promise<NormalizedNote> {
  const markdown = await readText(deps.vault, target.file);
  return normalizeNote({
    markdown,
    context: contextFor(deps.vault, byPath, contentRoot, target),
    parseYaml: deps.parseYaml,
  });
}

function contextFor(
  vault: VaultGateway,
  byPath: ReadonlyMap<string, VaultFileRef>,
  contentRoot: string,
  target: NoteTarget,
): NormalizeContext {
  return {
    articleVaultPath: target.file.path,
    articlePath: target.articlePath,
    contentRoot,
    // Obsidianの解決は正規化前のpathを起点にする（`TFile.path`をそのまま渡す契約）
    resolveLinkpath: (linkpath) => vault.resolveLinkpath(linkpath, target.file.vaultPath),
    findByPath: (path) => byPath.get(path) ?? null,
  };
}

/**
 * iCloud等でまだ端末へ降りていないファイルは、例外ではなく**空**を返すことがある
 * （`docs/on-device-checks.md`の未確定項目）。`stat`が0でないのに中身が空なら
 * 読めていないとみなす。実機で挙動が確定したらこの判定を見直す
 */
async function readText(vault: VaultGateway, file: VaultFileRef): Promise<string> {
  let text: string;
  try {
    text = await vault.readText(file);
  } catch {
    throw new ScanAbortedError(unreadable(file));
  }
  if (text === "" && file.size > 0) throw new ScanAbortedError(unreadable(file));
  return text;
}

async function readAssetBytes(vault: VaultGateway, file: VaultFileRef): Promise<ArrayBuffer> {
  let buffer: ArrayBuffer;
  try {
    buffer = await vault.readBinary(file);
  } catch {
    throw new ScanAbortedError(unreadable(file));
  }
  if (buffer.byteLength === 0 && file.size > 0) throw new ScanAbortedError(unreadable(file));
  return buffer;
}

function unreadable(file: VaultFileRef): string {
  return getTranslations().scan.unreadable(file.path);
}

function assertAssetSize(file: VaultFileRef, bytes: number): void {
  const limit =
    classifyAssetPath(file.path) === "image" ? MAX_IMAGE_FILE_BYTES : MAX_OTHER_ASSET_FILE_BYTES;
  if (bytes > limit) {
    throw new ScanAbortedError(getTranslations().scan.assetTooLarge(formatBytes(limit), file.path));
  }
}

/**
 * uploadの直前に原本を作り直す。
 *
 * 走査で作った本文をすべてメモリへ残さないための作り直しなので、**作り直した結果が
 * 走査時のhashと一致すること**を必ず確かめる。ずれていれば走査後にvaultが変わって
 * いるので、古い内容を送らずにやり直させる
 */
async function loadBlob(
  deps: ScanDeps,
  byPath: ReadonlyMap<string, VaultFileRef>,
  contentRoot: string,
  sources: {
    noteBySha: ReadonlyMap<string, NoteTarget>;
    assetBySha: ReadonlyMap<string, VaultFileRef>;
  },
  sha256: string,
): Promise<ArrayBuffer> {
  const target = sources.noteBySha.get(sha256);
  if (target !== undefined) {
    const note = await readNote(deps, byPath, contentRoot, target);
    return assertSameContent(new TextEncoder().encode(note.markdown), sha256);
  }

  const file = sources.assetBySha.get(sha256);
  if (file === undefined) throw new Error(`This file is not part of this publish: ${sha256}`);
  return assertSameContent(new Uint8Array(await readAssetBytes(deps.vault, file)), sha256);
}

async function assertSameContent(
  bytes: Uint8Array<ArrayBuffer>,
  sha256: string,
): Promise<ArrayBuffer> {
  if ((await sha256Hex(bytes)) !== sha256) {
    throw new ScanAbortedError(getTranslations().scan.vaultChanged);
  }
  // 呼び出し元はbuffer全体を占める新規のviewを渡す契約。部分viewを渡すと余分な内容まで返る
  return bytes.buffer;
}

function summarize(
  articles: readonly ScannedArticle[],
  markdown: ScanAmount,
  asset: ScanAmount,
): ScanSummary {
  let publishedCount = 0;
  let draftCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  for (const article of articles) {
    if (article.draft) draftCount += 1;
    else publishedCount += 1;
    if (article.issues.some((issue) => issue.level === "error")) errorCount += 1;
    else if (article.issues.length > 0) warningCount += 1;
  }
  return { markdown, asset, publishedCount, draftCount, errorCount, warningCount };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
