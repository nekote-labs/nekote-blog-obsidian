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
  const contentRoot = deps.settings().contentRoot;
  if (contentRoot === null) {
    deps.ui.notice("Select a content root in the plugin settings first.", 8000);
    return;
  }

  try {
    if (await reportResumedPush(deps)) return;

    deps.ui.progress("Checking connection…");
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

  deps.ui.progress("Checking the status of the previous publish…");
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
            progress.phase === "notes" ? "Reading notes…" : "Reading referenced assets…",
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
  const target = kind === "note" ? "notes" : "referenced assets";
  return {
    title: `There are a lot of ${target}`,
    paragraphs: [
      `The content root "${describeContentRoot(contentRoot)}" contains ` +
        `${amount.count} ${target} (${formatBytes(amount.bytes)}).`,
      kind === "note"
        ? "Continuing will read all of these notes. Make sure the content root is correct."
        : "Continuing will read all of these assets.",
    ],
    confirmLabel: "Continue",
  };
}

function publishConfirmRequest(
  contentRoot: string,
  scan: ScanResult,
  blog: ConnectionBlog,
): ConfirmRequest {
  const { summary } = scan;
  return {
    title: "Publish to Nekote Blog",
    paragraphs: [
      describeBlog(blog),
      `Publishing ${summary.markdown.count} notes ` +
        `(${summary.publishedCount} published, ${summary.draftCount} draft) and ` +
        `${summary.asset.count} referenced assets from the content root ` +
        `"${describeContentRoot(contentRoot)}".`,
      "Unchanged files are not sent. Notes removed since the previous publish are also " +
        "deleted from the blog.",
    ],
    confirmLabel: "Publish",
  };
}

/**
 * サーバーに既にObsidian sourceがあるときのvault IDの突き合わせ。
 *
 * 別のvault IDでPushすると、サーバーは初回接続として扱い、既存記事をpurgeしてから
 * ソースを切り替える。**自動で置き換えず**、影響を伝えてから確認する
 */
async function resolveVaultId(deps: PublishDeps, source: ConnectionSource): Promise<string | null> {
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
      title: "Treat this as the connected vault?",
      paragraphs: [
        "An Obsidian vault is already connected to this blog.",
        "If you treat the vault on this device as the same vault, publishing continues from " +
          `the existing revision (currently ${source.appliedRevision}). ` +
          "If this is a different vault, cancel here.",
      ],
      sections: [
        {
          title: "Content root on the server",
          items: [describeContentRoot(source.contentRoot)],
        },
      ],
      confirmLabel: "Continue as the same vault",
    });
    if (!ok) return null;
    await deps.updateSettings({ vaultId: source.vaultId });
    return source.vaultId;
  }

  const ok = await deps.ui.confirm({
    title: "This is not the connected vault",
    paragraphs: [
      "A different vault is connected to this blog. Publishing from the vault on this device " +
        "deletes all existing posts first, then rebuilds them from the contents of this vault.",
      "If the rebuild fails partway through, your blog is temporarily left with no posts.",
    ],
    confirmLabel: "Replace with this vault",
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
  return deps.ui.confirm({
    title: "Change the content root",
    paragraphs: [
      "The starting point for publishing changes from " +
        `"${describeContentRoot(source.contentRoot)}" to "${describeContentRoot(contentRoot)}".`,
      "Notes outside the new starting point are deleted from the published posts.",
    ],
    confirmLabel: "Change and continue",
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
  return deps.ui.confirm(overwriteRequest(scan, applied, "Published from another device"));
}

function overwriteRequest(
  scan: ScanResult,
  applied: AppliedManifestResponse,
  title: string,
): ConfirmRequest {
  const diff = diffAgainstApplied(scan.entries, applied.entries);
  return {
    title,
    paragraphs: [
      `The current revision on Nekote Blog is ${applied.appliedRevision}, ` +
        "which does not match the record on this device.",
      "Continuing replaces the published posts with the current contents of this vault. " +
        "To keep the changes made on the other device, sync your vault first and try again.",
    ],
    sections: [
      { title: `Added ${countFiles(diff.added.length)}`, items: diff.added },
      { title: `Updated ${countFiles(diff.updated.length)}`, items: diff.updated },
      { title: `Deleted ${countFiles(diff.deleted.length)}`, items: diff.deleted },
    ],
    confirmLabel: "Overwrite with this vault",
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
    const ok = await deps.ui.confirm(
      overwriteRequest(scan, applied, "Another publish was applied first"),
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

const CONFIRMATION_REASONS: Record<string, string> = {
  initial_connect: "This is the first publish to this blog.",
  source_switch:
    "Switching from another content source to Obsidian. The existing posts are rebuilt.",
  content_root_changed: "The content root changes.",
  large_delete: "A large number of posts will be deleted.",
  large_change: "A large number of posts will be added or updated.",
  large_upload: "A large amount of file data will be sent.",
};

function preflightRequest(
  begin: PushBeginResponse,
  scan: ScanResult | null,
  blog: ConnectionBlog | null,
): ConfirmRequest {
  const { preflight } = begin;
  const sections: ConfirmSection[] = [];
  if (scan !== null) {
    sections.push({
      title: `${scan.summary.publishedCount} published / ${scan.summary.draftCount} draft`,
      items: scan.articles.map(
        (article) => `${article.draft ? "[Draft] " : ""}${article.title} (${article.path})`,
      ),
    });
  }

  return {
    title: preflight.initialConnect
      ? "Confirm your first publish"
      : "Review what will be published",
    paragraphs: [
      ...(blog === null ? [] : [describeBlog(blog)]),
      ...preflight.confirmationReasons.map(
        (reason) => CONFIRMATION_REASONS[reason] ?? "This publish needs your confirmation.",
      ),
      `Posts: ${preflight.addedCount} added / ${preflight.updatedCount} updated / ` +
        `${preflight.deletedCount} deleted / ${preflight.unchangedCount} unchanged`,
      `Files to send: ${preflight.missingBlobCount} ` +
        `(${formatBytes(preflight.missingBlobBytes)})`,
    ],
    sections,
    confirmLabel: "Publish",
    danger: preflight.deletedCount > 0 || preflight.initialConnect,
  };
}

async function reportOutcome(
  deps: PublishDeps,
  scan: ScanResult | null,
  outcome: PushOutcome,
): Promise<void> {
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
        headline: `Published (revision ${outcome.revision})`,
        paragraphs: describeCounts(outcome.result),
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "failed":
      deps.secrets.clearPendingPushId();
      deps.ui.report({
        outcome: "failed",
        headline: "Could not publish",
        paragraphs: [
          "The published posts are left as they were. Fix the problem and run it again.",
          ...describeCounts(outcome.result),
        ],
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "applying":
      deps.ui.report({
        outcome: "applying",
        headline: "Publishing on Nekote Blog",
        paragraphs: [
          'Sending finished. Run "Publish to Nekote Blog" again to check whether it completed.',
        ],
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "cancelled":
      deps.ui.notice("Publish cancelled.");
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
  if (error instanceof ScanAbortedError) {
    deps.ui.report({
      outcome: "failed",
      headline: "Publish stopped",
      paragraphs: [error.message, "The published posts are unchanged."],
      articles: [],
      samples: undefined,
    });
    return;
  }

  if (error instanceof NekoteApiError) {
    deps.ui.notice(
      error.code === "push_in_progress"
        ? "The previous publish is still being processed on the server. It stays for a short " +
            "while even right after you cancel it, so wait a moment and run it again."
        : `Nekote Blog: ${error.message}`,
      10000,
    );
    return;
  }

  deps.ui.notice("Nekote Blog: Something went wrong.", 10000);
}

/** 間違ったブログへ反映しないよう、確認の先頭に出す */
function describeBlog(blog: ConnectionBlog): string {
  return `Publishing to: ${blog.title} (${blog.subdomain}.nekote.blog)`;
}

function countFiles(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

export function describeContentRoot(contentRoot: string): string {
  return contentRoot === "" ? "(vault root)" : contentRoot;
}
