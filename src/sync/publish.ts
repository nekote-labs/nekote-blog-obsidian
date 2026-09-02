// 「Nekote Blogへ反映」の手順全体。
//
// 接続確認 → vault ID・コンテンツルートの突き合わせ → ローカル走査 → Push。
// UIはポート（`PublishUi`）越しに呼ぶので、この手順はObsidianに依存せずテストできる。
//
// 守っている契約（spec/obsidian.md）:
//
// - 正はサーバーの`GET /connection`。plugin dataのrevisionは表示と競合検出のhint
// - 同じvault IDを別ブログへ接続しない。違うvault IDのPushは初回接続として扱われるので、
//   置き換えは利用者の明示的な確認なしに行わない
// - `baseRevision`不一致は自動で上書きしない
import type { NekoteApiClient } from "../api/client";
import type { YamlParser } from "../content/frontmatter";
import { getTranslations } from "../i18n";
import { NekoteApiError } from "../protocol/errors";
import type {
  AppliedManifestResponse,
  ConnectionBlog,
  ConnectionSource,
  PushBeginResponse,
  PushStatusResponse,
} from "../protocol/types";
import type { PluginSettings } from "../storage/plugin-data";
import type { SecretStore } from "../storage/secrets";
import type { VaultGateway } from "../vault/gateway";
import { buildSyncManifest, diffAgainstApplied } from "./manifest";
import { runPush, resumePush, type PushDeps, type PushOutcome } from "./push";
import {
  formatBytes,
  ScanAbortedError,
  ScanCancelledError,
  scanVault,
  type ScanAmount,
  type ScannedArticle,
  type ScanResult,
} from "./scan";

export interface ConfirmSection {
  title: string;
  items: string[];
}

export interface ConfirmRequest {
  title: string;
  paragraphs: string[];
  sections?: ConfirmSection[];
  confirmLabel: string;
  /** 取り返しがつきにくい操作。ボタンを警告色にする */
  danger?: boolean;
}

export interface PublishReport {
  outcome: PushOutcome["status"];
  headline: string;
  paragraphs: string[];
  articles: ScannedArticle[];
  /** サーバーが返した代表エラー・警告 */
  samples: PushStatusResponse["samples"];
}

/** 画面側との境界。実装は`src/ui/` */
export interface PublishUi {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  progress: (message: string, detail?: string) => void;
  notice: (message: string, durationMs?: number) => void;
  report: (report: PublishReport) => void;
}

export interface PublishDeps {
  client: NekoteApiClient;
  secrets: SecretStore;
  vault: VaultGateway;
  parseYaml: YamlParser;
  ui: PublishUi;
  settings: () => PluginSettings;
  updateSettings: (patch: Partial<PluginSettings>) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
  /** 新しいvault IDを作る（`^[A-Za-z0-9_-]{8,64}$`） */
  newVaultId: () => string;
  signal: AbortSignal;
}

export async function publish(deps: PublishDeps): Promise<void> {
  const t = getTranslations().publish;
  const contentRoot = deps.settings().contentRoot;
  if (contentRoot === null) {
    deps.ui.notice(t.selectContentRootFirst, 8000);
    return;
  }

  try {
    if (await reportResumedPush(deps)) return;

    deps.ui.progress(t.checkingConnection);
    const connection = await deps.client.getConnection();
    const vaultId = await resolveVaultId(deps, connection.source);
    if (vaultId === null) return;

    // コンテンツルートの変更は走査の結果に依らないので、走査を待たせる前に確認する
    if (!(await confirmContentRootChange(deps, connection.source, contentRoot))) return;

    const scan = await scan_(deps, contentRoot);
    if (scan === null) return;

    if (!(await confirmServerRevision(deps, connection.source, scan))) return;

    // どの導線（設定画面・コマンド・リボン・ノート上のボタン）から来ても、
    // 送信の直前に必ず1回確認する。1クリックでPushまで進ませない
    if (!(await deps.ui.confirm(publishConfirmRequest(contentRoot, scan, connection.blog)))) return;

    const baseRevision =
      connection.source.kind === "obsidian" ? connection.source.appliedRevision : 0;
    const outcome = await push(deps, scan, vaultId, baseRevision, connection.blog);
    await reportOutcome(deps, scan, outcome);
  } catch (error) {
    reportFailure(deps, error);
  }
}

/** 中断していたPushの続きを見る。結果が出ていれば表示して終わる */
async function reportResumedPush(deps: PublishDeps): Promise<boolean> {
  const pushId = deps.secrets.getPendingPushId();
  if (pushId === null) return false;

  deps.ui.progress(getTranslations().publish.checkingPreviousPublish);
  // 再開経路は`GET /connection`を呼んでいないので、反映先のブログは示せない
  const outcome = await resumePush(pushDeps(deps, null, null), pushId);
  if (outcome === null) {
    // まだ原本を送っている途中か、期限切れ。走査からやり直せば同じPushへ合流する
    deps.secrets.clearPendingPushId();
    return false;
  }
  await reportOutcome(deps, null, outcome);
  return true;
}

async function scan_(deps: PublishDeps, contentRoot: string): Promise<ScanResult | null> {
  const t = getTranslations().publish;
  try {
    return await scanVault(
      {
        vault: deps.vault,
        parseYaml: deps.parseYaml,
        confirmNotes: (amount) => deps.ui.confirm(scanConfirmRequest("note", contentRoot, amount)),
        confirmAssets: (amount) =>
          deps.ui.confirm(scanConfirmRequest("asset", contentRoot, amount)),
        onProgress: (progress) =>
          deps.ui.progress(
            progress.phase === "notes" ? t.readingNotes : t.readingAssets,
            `${progress.done} / ${progress.total}`,
          ),
      },
      contentRoot,
    );
  } catch (error) {
    if (error instanceof ScanCancelledError) return null;
    throw error;
  }
}

function scanConfirmRequest(
  kind: "note" | "asset",
  contentRoot: string,
  amount: ScanAmount,
): ConfirmRequest {
  const t = getTranslations().publish.scanConfirm;
  const isNote = kind === "note";
  return {
    title: isNote ? t.noteTitle : t.assetTitle,
    paragraphs: [
      isNote
        ? t.noteAmount(quoteContentRoot(contentRoot), amount.count, formatBytes(amount.bytes))
        : t.assetAmount(quoteContentRoot(contentRoot), amount.count, formatBytes(amount.bytes)),
      isNote ? t.noteWarning : t.assetWarning,
    ],
    confirmLabel: t.confirmLabel,
  };
}

function publishConfirmRequest(
  contentRoot: string,
  scan: ScanResult,
  blog: ConnectionBlog,
): ConfirmRequest {
  const t = getTranslations().publish.confirmPublish;
  const { summary } = scan;
  return {
    title: t.title,
    paragraphs: [
      describeBlog(blog),
      t.summary(
        summary.markdown.count,
        summary.publishedCount,
        summary.draftCount,
        summary.asset.count,
        quoteContentRoot(contentRoot),
      ),
      t.note,
    ],
    confirmLabel: t.confirmLabel,
  };
}

/**
 * サーバーに既にObsidian sourceがあるときのvault IDの突き合わせ。
 *
 * 別のvault IDでPushすると、サーバーは初回接続として扱い、既存記事をpurgeしてから
 * ソースを切り替える。**自動で置き換えず**、影響を伝えてから確認する
 */
async function resolveVaultId(deps: PublishDeps, source: ConnectionSource): Promise<string | null> {
  const t = getTranslations().publish;
  const local = deps.settings().vaultId;

  if (source.kind !== "obsidian") {
    if (local !== null) return local;
    const created = deps.newVaultId();
    await deps.updateSettings({ vaultId: created });
    return created;
  }

  if (local === source.vaultId) return local;

  if (local === null) {
    const ok = await deps.ui.confirm({
      title: t.sameVault.title,
      paragraphs: [t.sameVault.intro, t.sameVault.detail(source.appliedRevision)],
      sections: [
        {
          title: t.sameVault.serverContentRoot,
          items: [describeContentRoot(source.contentRoot)],
        },
      ],
      confirmLabel: t.sameVault.confirmLabel,
    });
    if (!ok) return null;
    await deps.updateSettings({ vaultId: source.vaultId });
    return source.vaultId;
  }

  const ok = await deps.ui.confirm({
    title: t.differentVault.title,
    paragraphs: [t.differentVault.intro, t.differentVault.warning],
    confirmLabel: t.differentVault.confirmLabel,
    danger: true,
  });
  return ok ? local : null;
}

async function confirmContentRootChange(
  deps: PublishDeps,
  source: ConnectionSource,
  contentRoot: string,
): Promise<boolean> {
  if (source.kind !== "obsidian" || source.contentRoot === contentRoot) return true;
  const t = getTranslations().publish.contentRootChange;
  return deps.ui.confirm({
    title: t.title,
    paragraphs: [
      t.detail(quoteContentRoot(source.contentRoot), quoteContentRoot(contentRoot)),
      t.warning,
    ],
    confirmLabel: t.confirmLabel,
    danger: true,
  });
}

/**
 * サーバーのrevisionがローカルの記録と違う（他の端末が反映した）ときの確認。
 *
 * ここで止めないと、別端末の変更を知らないまま古いvaultの内容で上書きしてしまう
 */
async function confirmServerRevision(
  deps: PublishDeps,
  source: ConnectionSource,
  scan: ScanResult,
): Promise<boolean> {
  const lastPush = deps.settings().lastPush;
  if (lastPush === null || source.kind !== "obsidian") return true;
  if (source.appliedRevision === lastPush.revision) return true;

  const applied = await deps.client.getAppliedManifest();
  const t = getTranslations().publish;
  return deps.ui.confirm(overwriteRequest(scan, applied, t.overwrite.publishedFromAnotherDevice));
}

function overwriteRequest(
  scan: ScanResult,
  applied: AppliedManifestResponse,
  title: string,
): ConfirmRequest {
  const t = getTranslations().publish.overwrite;
  const diff = diffAgainstApplied(scan.entries, applied.entries);
  return {
    title,
    paragraphs: [t.revisionMismatch(applied.appliedRevision), t.warning],
    sections: [
      { title: t.added(diff.added.length), items: diff.added },
      { title: t.updated(diff.updated.length), items: diff.updated },
      { title: t.deleted(diff.deleted.length), items: diff.deleted },
    ],
    confirmLabel: t.confirmLabel,
    danger: true,
  };
}

async function push(
  deps: PublishDeps,
  scan: ScanResult,
  vaultId: string,
  baseRevision: number,
  blog: ConnectionBlog,
): Promise<PushOutcome> {
  const manifestHash = scan.manifestHash;
  const start = (base: number): Promise<PushOutcome> =>
    runPush(pushDeps(deps, scan, blog), {
      manifest: buildSyncManifest({
        vaultId,
        contentRoot: scan.contentRoot,
        baseRevision: base,
        entries: scan.entries,
      }),
      manifestHash,
    });

  try {
    return await start(baseRevision);
  } catch (error) {
    if (!(error instanceof NekoteApiError) || error.code !== "revision_conflict") throw error;
    // 409。**自動でやり直さない**。差分を見せて、利用者が決めたときだけ最新baseで送る
    const applied = await deps.client.getAppliedManifest();
    const t = getTranslations().publish;
    const ok = await deps.ui.confirm(
      overwriteRequest(scan, applied, t.overwrite.anotherPublishApplied),
    );
    if (!ok) return { status: "cancelled" };
    return start(applied.appliedRevision);
  }
}

function pushDeps(
  deps: PublishDeps,
  scan: ScanResult | null,
  blog: ConnectionBlog | null,
): PushDeps {
  return {
    client: deps.client,
    loadBlob: (sha256) => {
      if (scan === null) throw new Error("Nothing to send.");
      return scan.loadBlob(sha256);
    },
    confirm: (begin) => deps.ui.confirm(preflightRequest(begin, scan, blog)),
    report: (progress) =>
      deps.ui.progress(
        progress.message,
        progress.total === undefined ? undefined : `${progress.done ?? 0} / ${progress.total}`,
      ),
    sleep: deps.sleep,
    onPushStarted: (pushId) => deps.secrets.setPendingPushId(pushId),
    signal: deps.signal,
  };
}

/** サーバーが返す`confirmationReasons`のコードを説明文にする */
function describeConfirmationReason(reason: string): string {
  const t = getTranslations().publish.reasons;
  switch (reason) {
    case "initial_connect":
      return t.initialConnect;
    case "source_switch":
      return t.sourceSwitch;
    case "content_root_changed":
      return t.contentRootChanged;
    case "large_delete":
      return t.largeDelete;
    case "large_change":
      return t.largeChange;
    case "large_upload":
      return t.largeUpload;
    default:
      return t.unknown;
  }
}

function preflightRequest(
  begin: PushBeginResponse,
  scan: ScanResult | null,
  blog: ConnectionBlog | null,
): ConfirmRequest {
  const t = getTranslations().publish.preflight;
  const { preflight } = begin;
  const sections: ConfirmSection[] = [];
  if (scan !== null) {
    sections.push({
      title: t.articles(scan.summary.publishedCount, scan.summary.draftCount),
      items: scan.articles.map(
        (article) =>
          `${article.draft ? t.draftPrefix : ""}${t.article(article.title, article.path)}`,
      ),
    });
  }

  return {
    title: preflight.initialConnect ? t.initialTitle : t.title,
    paragraphs: [
      ...(blog === null ? [] : [describeBlog(blog)]),
      ...preflight.confirmationReasons.map((reason) => describeConfirmationReason(reason)),
      t.counts(
        preflight.addedCount,
        preflight.updatedCount,
        preflight.deletedCount,
        preflight.unchangedCount,
      ),
      t.filesToSend(preflight.missingBlobCount, formatBytes(preflight.missingBlobBytes)),
    ],
    sections,
    confirmLabel: t.confirmLabel,
    danger: preflight.deletedCount > 0 || preflight.initialConnect,
  };
}

async function reportOutcome(
  deps: PublishDeps,
  scan: ScanResult | null,
  outcome: PushOutcome,
): Promise<void> {
  const t = getTranslations().publish;
  const articles = scan?.articles ?? [];

  switch (outcome.status) {
    case "applied":
      deps.secrets.clearPendingPushId();
      await deps.updateSettings({
        lastPush: {
          revision: outcome.revision,
          manifestHash: outcome.result.manifestHash,
          syncedAt: new Date(deps.now()).toISOString(),
        },
      });
      deps.ui.report({
        outcome: "applied",
        headline: t.report.applied(outcome.revision),
        paragraphs: describeCounts(outcome.result),
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "failed":
      deps.secrets.clearPendingPushId();
      deps.ui.report({
        outcome: "failed",
        headline: t.report.failed,
        paragraphs: [t.report.failedDetail, ...describeCounts(outcome.result)],
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "applying":
      deps.ui.report({
        outcome: "applying",
        headline: t.report.applying,
        paragraphs: [t.report.applyingDetail],
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "cancelled":
      deps.ui.notice(t.cancelled);
  }
}

function describeCounts(result: PushStatusResponse): string[] {
  const counts = result.counts;
  if (counts === undefined) return [];
  const entries = Object.entries(counts).filter(([, value]) => value > 0);
  return entries.length === 0
    ? []
    : [entries.map(([key, value]) => `${key}: ${value}`).join(" / ")];
}

function reportFailure(deps: PublishDeps, error: unknown): void {
  const t = getTranslations().publish;
  if (error instanceof ScanAbortedError) {
    deps.ui.report({
      outcome: "failed",
      headline: t.report.stopped,
      paragraphs: [error.message, t.report.stoppedDetail],
      articles: [],
      samples: undefined,
    });
    return;
  }

  if (error instanceof NekoteApiError) {
    deps.ui.notice(
      error.code === "push_in_progress" ? t.pushInProgress : `Nekote Blog: ${error.message}`,
      10000,
    );
    return;
  }

  deps.ui.notice(t.unexpectedError, 10000);
}

/** 間違ったブログへ反映しないよう、確認の先頭に出す */
function describeBlog(blog: ConnectionBlog): string {
  return getTranslations().publish.blog(blog.title, blog.subdomain);
}

export function describeContentRoot(contentRoot: string): string {
  return contentRoot === "" ? getTranslations().publish.vaultRoot : contentRoot;
}

/** 文中に差し込む形。実pathは引用符で囲み、vaultルートはラベルをそのまま出す（二重に括らない） */
export function quoteContentRoot(contentRoot: string): string {
  const t = getTranslations().publish;
  return contentRoot === "" ? t.vaultRoot : t.quotedPath(contentRoot);
}
