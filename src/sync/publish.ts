// 「Nekote Blogへ反映」の手順全体。
//
// 接続確認 → vault ID・コンテンツルートの突き合わせ → ローカル走査 → Push。
// 「このノートだけ反映」（`scope.kind === "note"`）はvaultの全量ではなく1ノートと
// その参照アセットだけを送る部分反映で、他の記事を削除・変更しない。
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
  ConnectionResponse,
  ConnectionSource,
  PushBeginResponse,
  PushMode,
  PushStatusResponse,
} from "../protocol/types";
import type { PluginSettings } from "../storage/plugin-data";
import type { SecretStore } from "../storage/secrets";
import type { VaultGateway } from "../vault/gateway";
import { buildSyncManifest, diffAgainstApplied } from "./manifest";
import {
  PushModeMismatchError,
  runPush,
  resumePush,
  type PushDeps,
  type PushOutcome,
} from "./push";
import {
  formatBytes,
  ScanAbortedError,
  ScanCancelledError,
  scanVault,
  type ScanAmount,
  type ScannedArticle,
  type ScanResult,
  type ScanScope,
} from "./scan";

/**
 * 反映の対象。**省略できない**（部分反映の導線で渡し忘れると全量反映になり、
 * 他の記事を削除・変更してしまうため、型エラーで止める）
 */
export type PublishScope = { kind: "all" } | { kind: "note"; vaultPath: string };

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

export async function publish(deps: PublishDeps, scope: PublishScope): Promise<void> {
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
    if (scope.kind === "note") {
      await publishNote(deps, contentRoot, connection, scope.vaultPath);
      return;
    }
    await publishAll(deps, contentRoot, connection);
  } catch (error) {
    reportFailure(deps, error);
  }
}

/** vaultの全量を反映する（`mode: "full"`）。載っていない記事はブログから削除される */
async function publishAll(
  deps: PublishDeps,
  contentRoot: string,
  connection: ConnectionResponse,
): Promise<void> {
  const vaultId = await resolveVaultId(deps, connection.source);
  if (vaultId === null) return;

  // コンテンツルートの変更は走査の結果に依らないので、走査を待たせる前に確認する
  if (!(await confirmContentRootChange(deps, connection.source, contentRoot))) return;

  const scan = await scan_(deps, contentRoot);
  if (scan === null) return;

  if (!(await confirmServerRevision(deps, connection.source, scan))) return;

  // サーバーにこのvaultの確定済みsourceが無い（初回接続・別ソースからの切替・
  // 別vaultとして接続中）なら、beginのpreflightが必ず追加確認を返す。ここでも
  // 確認すると同じ内容を2回聞くことになるので、件数の正確なサーバー側の1回に寄せる
  const initialConnect =
    connection.source.kind !== "obsidian" || connection.source.vaultId !== vaultId;
  // どの導線（設定画面・コマンド・リボン・ノート上のボタン）から来ても、
  // 送信の直前に必ず1回確認する。1クリックでPushまで進ませない
  if (
    !initialConnect &&
    !(await deps.ui.confirm(publishConfirmRequest(contentRoot, scan, connection.blog)))
  ) {
    return;
  }

  const baseRevision =
    connection.source.kind === "obsidian" ? connection.source.appliedRevision : 0;
  const run = await push(deps, scan, {
    vaultId,
    baseRevision,
    blog: connection.blog,
    mode: "full",
    // 送信前の確認を省いたぶん、サーバーが求めなくてもpreflightの確認を1回出す
    requireConfirmation: initialConnect,
    confirmConflict: (applied) =>
      deps.ui.confirm(
        overwriteRequest(scan, applied, getTranslations().publish.overwrite.anotherPublishApplied),
      ),
  });
  await reportOutcome(deps, scan, run.outcome, { untouchedCount: null, recordLastPush: true });
}

/**
 * 開いているノート1件だけを反映する（`mode: "partial"`）。
 *
 * 受け付け条件はサーバーの`partial_push_not_allowed`と同じものに加えて、plugin dataに
 * 全量反映の成功記録（`lastPush`）があること。**走査より前に見て、外れていたら通知だけ
 * で終わる**（vault IDの作成・置き換えとコンテンツルート変更の確認は全量反映の操作で、
 * 部分反映を入口に端末を紐付けたりコンテンツルートを変えたりはしない）
 */
async function publishNote(
  deps: PublishDeps,
  contentRoot: string,
  connection: ConnectionResponse,
  vaultPath: string,
): Promise<void> {
  const t = getTranslations().publish;
  const settings = deps.settings();
  const { source } = connection;
  const lastPush = settings.lastPush;
  if (
    source.kind !== "obsidian" ||
    settings.vaultId !== source.vaultId ||
    source.appliedRevision < 1 ||
    lastPush === null
  ) {
    deps.ui.notice(t.partial.needsFullPublish, 10000);
    return;
  }
  if (source.contentRoot !== contentRoot) {
    deps.ui.notice(t.partial.contentRootChanged, 10000);
    return;
  }

  const scan = await scan_(deps, contentRoot, { vaultPath });
  if (scan === null) return;
  const [article] = scan.articles;
  // `scope`付きの走査は対象1件かScanAbortedErrorのどちらかになる（型のためのガード）
  if (article === undefined) {
    throw new ScanAbortedError(getTranslations().scan.notPublishTarget(vaultPath));
  }

  // 他端末の反映を検出したら、承諾しても`lastPush`は据え置く（次の全体反映で
  // 差分確認が出る状態を保つ）
  let revisionMatched = source.appliedRevision === lastPush.revision;
  if (!revisionMatched) {
    const ok = await deps.ui.confirm(
      anotherDeviceRequest(t.overwrite.publishedFromAnotherDevice, source.appliedRevision),
    );
    if (!ok) return;
  }

  if (!(await deps.ui.confirm(publishNoteConfirmRequest(scan, article, connection.blog)))) return;

  const run = await push(deps, scan, {
    vaultId: source.vaultId,
    baseRevision: source.appliedRevision,
    blog: connection.blog,
    mode: "partial",
    confirmConflict: (applied) => {
      revisionMatched = false;
      return deps.ui.confirm(
        anotherDeviceRequest(t.overwrite.anotherPublishApplied, applied.appliedRevision),
      );
    },
  });
  await reportOutcome(deps, scan, run.outcome, {
    untouchedCount: run.begin?.preflight.untouchedCount ?? null,
    recordLastPush: revisionMatched,
  });
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
  await reportOutcome(deps, null, outcome, {
    untouchedCount: null,
    // 再開した部分反映は事前のrevision確認の結果が残っていないので`lastPush`を
    // 更新しない（次の全体反映で他端末の確認が1回余分に出るだけで済ませる）
    recordLastPush: outcome.status === "applied" && outcome.result.mode !== "partial",
  });
  return true;
}

async function scan_(
  deps: PublishDeps,
  contentRoot: string,
  scope?: ScanScope,
): Promise<ScanResult | null> {
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
      scope,
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

/** 「このノートだけ反映」の送信前確認。反映先・対象ノート・他の記事への影響を示す */
function publishNoteConfirmRequest(
  scan: ScanResult,
  article: ScannedArticle,
  blog: ConnectionBlog,
): ConfirmRequest {
  const t = getTranslations().publish.partial.confirm;
  return {
    title: t.title,
    paragraphs: [
      describeBlog(blog),
      t.summary(article.title, article.path, scan.summary.asset.count),
      ...(article.draft ? [t.draftNote] : []),
      t.note,
    ],
    confirmLabel: t.confirmLabel,
  };
}

/**
 * 部分反映で他端末の反映に気づいたときの確認。
 *
 * **差分一覧を出さない**。`diffAgainstApplied()`は「載っていない記事＝削除」で数えるので、
 * 部分manifestに使うと他の全記事が削除扱いで並び、誤解を生む
 */
function anotherDeviceRequest(title: string, appliedRevision: number): ConfirmRequest {
  const t = getTranslations().publish;
  return {
    title,
    paragraphs: [t.overwrite.revisionMismatch(appliedRevision), t.partial.anotherDevice.detail],
    confirmLabel: t.partial.anotherDevice.confirmLabel,
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

interface PushRun {
  outcome: PushOutcome;
  /** 最後のbegin応答。`preflight.untouchedCount`を結果報告に使う */
  begin: PushBeginResponse | null;
}

async function push(
  deps: PublishDeps,
  scan: ScanResult,
  options: {
    vaultId: string;
    baseRevision: number;
    blog: ConnectionBlog;
    mode: PushMode;
    /** 409（送信中に他端末が反映）で最新baseへ送り直してよいかを聞く */
    confirmConflict: (applied: AppliedManifestResponse) => Promise<boolean>;
    /** サーバーが求めなくてもpreflightの確認を出す（`PushInput.requireConfirmation`） */
    requireConfirmation?: boolean;
  },
): Promise<PushRun> {
  // beginは`runPush()`の中で（`blobs_incomplete`後の再beginも含めて）返る
  const started: { begin: PushBeginResponse | null } = { begin: null };
  const start = (base: number): Promise<PushOutcome> =>
    runPush(
      pushDeps(deps, scan, options.blog, (begin) => {
        started.begin = begin;
      }),
      {
        manifest: buildSyncManifest({
          vaultId: options.vaultId,
          contentRoot: scan.contentRoot,
          baseRevision: base,
          mode: options.mode,
          entries: scan.entries,
        }),
        manifestHash: scan.manifestHash,
        requireConfirmation: options.requireConfirmation,
      },
    );

  try {
    return { outcome: await start(options.baseRevision), begin: started.begin };
  } catch (error) {
    if (!(error instanceof NekoteApiError) || error.code !== "revision_conflict") throw error;
    // 409。**自動でやり直さない**。利用者が決めたときだけ最新baseで送る
    const applied = await deps.client.getAppliedManifest();
    if (!(await options.confirmConflict(applied))) {
      return { outcome: { status: "cancelled" }, begin: started.begin };
    }
    return { outcome: await start(applied.appliedRevision), begin: started.begin };
  }
}

function pushDeps(
  deps: PublishDeps,
  scan: ScanResult | null,
  blog: ConnectionBlog | null,
  onStarted?: (begin: PushBeginResponse) => void,
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
    onPushStarted: (begin) => {
      deps.secrets.setPendingPushId(begin.pushId);
      onStarted?.(begin);
    },
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
  const partial = getTranslations().publish.partial;
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
      // 部分反映は削除が起きない（`deletedCount`は常に0）ので、削除の行を出さない
      begin.mode === "partial"
        ? partial.preflightCounts(
            preflight.addedCount,
            preflight.updatedCount,
            preflight.unchangedCount,
            preflight.untouchedCount,
          )
        : t.counts(
            preflight.addedCount,
            preflight.updatedCount,
            preflight.deletedCount,
            preflight.unchangedCount,
          ),
      t.filesToSend(preflight.missingBlobCount, formatBytes(preflight.missingBlobBytes)),
    ],
    sections,
    confirmLabel: t.confirmLabel,
    // 赤（破壊的操作）は記事が消えるときだけ。削除0件の初回接続は壊すものが無い。
    // 別ソースからの切替は既存記事を作り直すが削除件数に出ないので、理由で拾う
    danger: preflight.deletedCount > 0 || preflight.confirmationReasons.includes("source_switch"),
  };
}

interface OutcomeContext {
  /** 部分反映の「他N件はそのまま」に出す件数。begin応答を持たない再開経路ではnull */
  untouchedCount: number | null;
  /**
   * 成功時に`lastPush`を更新してよいか。
   *
   * 部分反映は**事前のrevision確認が一致していたときだけ**更新する。他端末の反映
   * （rev 13）を知らないまま部分反映（rev 14）した端末で更新すると、次の全体反映が
   * revision一致と判定され、他端末の変更を差分確認なしに消せてしまう
   */
  recordLastPush: boolean;
}

async function reportOutcome(
  deps: PublishDeps,
  scan: ScanResult | null,
  outcome: PushOutcome,
  context: OutcomeContext,
): Promise<void> {
  const t = getTranslations().publish;
  const articles = scan?.articles ?? [];

  switch (outcome.status) {
    case "applied": {
      deps.secrets.clearPendingPushId();
      if (context.recordLastPush) {
        await deps.updateSettings({
          lastPush: {
            revision: outcome.revision,
            manifestHash: outcome.result.manifestHash,
            syncedAt: new Date(deps.now()).toISOString(),
          },
        });
      }
      const partial = outcome.result.mode === "partial";
      deps.ui.report({
        outcome: "applied",
        headline: partial
          ? t.partial.reportApplied(outcome.revision)
          : t.report.applied(outcome.revision),
        paragraphs: [
          ...(partial && context.untouchedCount !== null
            ? [t.partial.untouched(context.untouchedCount)]
            : []),
          ...describeCounts(outcome.result),
        ],
        articles,
        samples: outcome.result.samples,
      });
      return;
    }
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
  // どちらも原本を1件も送っていない。公開中の記事は変わっていない
  if (error instanceof ScanAbortedError || error instanceof PushModeMismatchError) {
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
    deps.ui.notice(describeApiFailure(error), 10000);
    return;
  }

  deps.ui.notice(t.unexpectedError, 10000);
}

/** サーバーの`message`は日本語固定なので、分岐できるコードはプラグイン側の文言で出す */
function describeApiFailure(error: NekoteApiError): string {
  const t = getTranslations().publish;
  if (error.code === "push_in_progress") return t.pushInProgress;
  // `details.reason`別の文言は作らない（どの理由でも次の行動は全体反映で同じ）
  if (error.code === "partial_push_not_allowed") return t.partial.notAllowed;
  return `Nekote Blog: ${error.message}`;
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
