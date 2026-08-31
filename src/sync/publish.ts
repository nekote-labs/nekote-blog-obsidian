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
    deps.ui.notice("先に設定画面でコンテンツルートを選んでください。", 8000);
    return;
  }

  try {
    if (await reportResumedPush(deps)) return;

    deps.ui.progress("接続を確認しています…");
    const connection = await deps.client.getConnection();
    const vaultId = await resolveVaultId(deps, connection.source);
    if (vaultId === null) return;

    // コンテンツルートの変更は走査の結果に依らないので、走査を待たせる前に確認する
    if (!(await confirmContentRootChange(deps, connection.source, contentRoot))) return;

    const scan = await scan_(deps, contentRoot);
    if (scan === null) return;

    if (!(await confirmServerRevision(deps, connection.source, scan))) return;

    const baseRevision =
      connection.source.kind === "obsidian" ? connection.source.appliedRevision : 0;
    const outcome = await push(deps, scan, vaultId, baseRevision);
    await reportOutcome(deps, scan, outcome);
  } catch (error) {
    reportFailure(deps, error);
  }
}

/** 中断していたPushの続きを見る。結果が出ていれば表示して終わる */
async function reportResumedPush(deps: PublishDeps): Promise<boolean> {
  const pushId = deps.secrets.getPendingPushId();
  if (pushId === null) return false;

  deps.ui.progress("前回の反映の状況を確認しています…");
  const outcome = await resumePush(pushDeps(deps, null), pushId);
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
            progress.phase === "notes" ? "ノートを読んでいます…" : "参照アセットを読んでいます…",
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
  const target = kind === "note" ? "ノート" : "参照アセット";
  return {
    title: `${target}が多いので確認します`,
    paragraphs: [
      `コンテンツルート「${describeContentRoot(contentRoot)}」の${target}は` +
        `${amount.count}件・${formatBytes(amount.bytes)}です。`,
      kind === "note"
        ? "このまま続けると、これらのノートを読み取ります。コンテンツルートの指定が正しいか確認してください。"
        : "このまま続けると、これらのアセットを読み取ります。",
    ],
    confirmLabel: "続ける",
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
      title: "接続済みのvaultとして扱いますか？",
      paragraphs: [
        "このブログにはすでにObsidianのvaultが接続されています。",
        `この端末のvaultを同じvaultとして扱うと、続きのrevision（現在 ${source.appliedRevision}）から反映します。` +
          "別のvaultなら、ここで中止してください。",
      ],
      sections: [
        {
          title: "サーバーのコンテンツルート",
          items: [describeContentRoot(source.contentRoot)],
        },
      ],
      confirmLabel: "同じvaultとして続ける",
    });
    if (!ok) return null;
    await deps.updateSettings({ vaultId: source.vaultId });
    return source.vaultId;
  }

  const ok = await deps.ui.confirm({
    title: "接続されているvaultと違います",
    paragraphs: [
      "このブログには別のvaultが接続されています。この端末のvaultで反映すると、" +
        "既存の記事をすべて削除してから、このvaultの内容で作り直します。",
      "作り直しの途中で失敗すると、記事が一時的に空になります。",
    ],
    confirmLabel: "このvaultで置き換える",
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
    title: "コンテンツルートを変更します",
    paragraphs: [
      `公開の起点を「${describeContentRoot(source.contentRoot)}」から` +
        `「${describeContentRoot(contentRoot)}」へ変えます。`,
      "新しい起点にないノートは、公開中の記事から削除されます。",
    ],
    confirmLabel: "変更して続ける",
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
  return deps.ui.confirm(overwriteRequest(scan, applied, "他の端末から反映されています"));
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
      `Nekote Blogの現在のrevisionは ${applied.appliedRevision} で、この端末の記録と違います。`,
      "このまま続けると、いまのvaultの内容で公開中の記事を置き換えます。" +
        "他の端末の変更を残したい場合は、先にvaultを同期してからやり直してください。",
    ],
    sections: [
      { title: `追加 ${diff.added.length}件`, items: diff.added },
      { title: `更新 ${diff.updated.length}件`, items: diff.updated },
      { title: `削除 ${diff.deleted.length}件`, items: diff.deleted },
    ],
    confirmLabel: "このvaultの内容で上書きする",
    danger: true,
  };
}

async function push(
  deps: PublishDeps,
  scan: ScanResult,
  vaultId: string,
  baseRevision: number,
): Promise<PushOutcome> {
  const manifestHash = scan.manifestHash;
  const start = (base: number): Promise<PushOutcome> =>
    runPush(pushDeps(deps, scan), {
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
      overwriteRequest(scan, applied, "他の反映が先に適用されています"),
    );
    if (!ok) return { status: "cancelled" };
    return start(applied.appliedRevision);
  }
}

function pushDeps(deps: PublishDeps, scan: ScanResult | null): PushDeps {
  return {
    client: deps.client,
    loadBlob: (sha256) => {
      if (scan === null) throw new Error("送信対象がありません。");
      return scan.loadBlob(sha256);
    },
    confirm: (begin) => deps.ui.confirm(preflightRequest(begin, scan)),
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
  initial_connect: "このブログへの初めての反映です。",
  source_switch: "別のコンテンツソースからObsidianへ切り替えます。既存の記事は作り直されます。",
  content_root_changed: "コンテンツルートが変わります。",
  large_delete: "削除される記事が多くあります。",
  large_change: "追加・更新される記事が多くあります。",
  large_upload: "送信するファイルの量が多くなります。",
};

function preflightRequest(begin: PushBeginResponse, scan: ScanResult | null): ConfirmRequest {
  const { preflight } = begin;
  const sections: ConfirmSection[] = [];
  if (scan !== null) {
    sections.push({
      title: `公開 ${scan.summary.publishedCount}件 / 下書き ${scan.summary.draftCount}件`,
      items: scan.articles.map(
        (article) => `${article.draft ? "［下書き］" : ""}${article.title}（${article.path}）`,
      ),
    });
  }

  return {
    title: preflight.initialConnect ? "初めての反映を確定します" : "反映の内容を確認してください",
    paragraphs: [
      ...preflight.confirmationReasons.map(
        (reason) => CONFIRMATION_REASONS[reason] ?? "内容の確認が必要です。",
      ),
      `記事: 追加 ${preflight.addedCount}件 / 更新 ${preflight.updatedCount}件 / ` +
        `削除 ${preflight.deletedCount}件 / 変更なし ${preflight.unchangedCount}件`,
      `送信するファイル: ${preflight.missingBlobCount}件・${formatBytes(preflight.missingBlobBytes)}`,
    ],
    sections,
    confirmLabel: "反映する",
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
        headline: `反映しました（revision ${outcome.revision}）`,
        paragraphs: describeCounts(outcome.result),
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "failed":
      deps.secrets.clearPendingPushId();
      deps.ui.report({
        outcome: "failed",
        headline: "反映できませんでした",
        paragraphs: [
          "公開中の記事はそのまま残っています。原因を直して、もう一度実行してください。",
          ...describeCounts(outcome.result),
        ],
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "applying":
      deps.ui.report({
        outcome: "applying",
        headline: "Nekote Blogで反映しています",
        paragraphs: [
          "送信は終わりました。反映の完了はもう一度「Nekote Blogへ反映」を実行すると確認できます。",
        ],
        articles,
        samples: outcome.result.samples,
      });
      return;
    case "cancelled":
      deps.ui.notice("反映を取り消しました。");
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
      headline: "反映を中止しました",
      paragraphs: [error.message, "公開中の記事は変わっていません。"],
      articles: [],
      samples: undefined,
    });
    return;
  }

  if (error instanceof NekoteApiError) {
    deps.ui.notice(
      error.code === "push_in_progress"
        ? "前の反映がサーバー側で処理中です。取り消した直後の場合も少しのあいだ残るので、" +
            "しばらく待ってからもう一度実行してください。"
        : `Nekote Blog: ${error.message}`,
      10000,
    );
    return;
  }

  deps.ui.notice("Nekote Blog: 予期しないエラーが発生しました。", 10000);
}

export function describeContentRoot(contentRoot: string): string {
  return contentRoot === "" ? "（vaultのルート）" : contentRoot;
}
