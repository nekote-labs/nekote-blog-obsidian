// Push世代の状態機械（begin → confirm → 不足blobのupload → finalize → status）。
//
// 契約はspec/obsidian.md「Pushライフサイクルの契約」。ここで守るのは次の3つ。
//
// - `confirm`を通るまで原本を1件も送らない
// - `finalize`の202（完備確認の継続中）は失敗ではない。`retryAfter`のあと同じpushIdで再送する
// - 中断しても同じmanifestならbeginが処理中のPushへ合流し、不足blobだけを送り直せる
//
// `baseRevision`不一致（409）はここでは自動で上書きしない。呼び出し側が利用者へ
// 差分を見せて確認を取り、新しいbaseで作り直す。
import type { NekoteApiClient } from "../api/client";
import { NekoteApiError } from "../protocol/errors";
import type {
  MissingBlob,
  PushBeginResponse,
  PushStatusResponse,
  SyncManifest,
} from "../protocol/types";

/** 適用中のstatus pollの間隔（ミリ秒）。待つほど伸ばす */
const POLL_MIN_INTERVAL_MS = 3_000;
const POLL_MAX_INTERVAL_MS = 15_000;

/** statusを待つ上限。超えたら「処理中」で返し、次回の実行で続きを見る */
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** `sync_run_active`（他の同期Runと衝突）でfinalizeを待ち直す回数 */
const FINALIZE_RETRY_LIMIT = 5;
const FINALIZE_RETRY_INTERVAL_MS = 10_000;

/** 1件のuploadを待ち直す回数。初回同期は数百〜数千件を連続で送るのでrate limitに当たる */
const UPLOAD_RETRY_LIMIT = 5;
const UPLOAD_RETRY_INTERVAL_MS = 5_000;

export interface PushProgress {
  phase: "begin" | "upload" | "finalize" | "apply";
  message: string;
  done?: number;
  total?: number;
}

export type PushOutcome =
  | { status: "applied"; revision: number; result: PushStatusResponse }
  | { status: "failed"; result: PushStatusResponse }
  | { status: "applying"; result: PushStatusResponse }
  | { status: "cancelled" };

export interface PushDeps {
  client: NekoteApiClient;
  /** sha256から原本を作り直す（`ScanResult.loadBlob`） */
  loadBlob: (sha256: string) => Promise<ArrayBuffer>;
  /** 追加確認。`false`なら原本を送らずに終わる */
  confirm: (begin: PushBeginResponse) => Promise<boolean>;
  report: (progress: PushProgress) => void;
  sleep: (milliseconds: number) => Promise<void>;
  /** Push世代が始まった時点で1回呼ぶ。中断後の再開に使う */
  onPushStarted: (pushId: string) => void;
  signal: AbortSignal;
}

export interface PushInput {
  manifest: SyncManifest;
  manifestHash: string;
}

export async function runPush(deps: PushDeps, input: PushInput): Promise<PushOutcome> {
  deps.report({ phase: "begin", message: "Checking what to publish…" });
  let begin = await deps.client.beginPush(input.manifest);
  deps.onPushStarted(begin.pushId);
  if (deps.signal.aborted) return { status: "cancelled" };

  if (begin.confirmationRequired && !(await deps.confirm(begin))) {
    return { status: "cancelled" };
  }
  if (!(await stageBlobs(deps, begin))) return { status: "cancelled" };

  // 完備確認が欠落を見つけたら、beginで不足を取り直して送り直す。取り直しても
  // 埋まらない場合はそこで諦める（同じ往復を繰り返さない）
  let finalized: boolean;
  try {
    finalized = await finalize(deps, begin, input.manifestHash);
  } catch (error) {
    if (!(error instanceof NekoteApiError) || error.code !== "blobs_incomplete") throw error;
    // 同じmanifestのbeginは処理中のPushへ合流するが、期限切れなら**新しいPush世代**に
    // なる。pushIdの記録と`confirm`もやり直さないと、確認前のuploadとして拒否される
    begin = await deps.client.beginPush(input.manifest);
    deps.onPushStarted(begin.pushId);
    if (deps.signal.aborted) return { status: "cancelled" };
    if (!(await stageBlobs(deps, begin))) return { status: "cancelled" };
    finalized = await finalize(deps, begin, input.manifestHash);
  }
  if (!finalized) return { status: "cancelled" };

  return pollUntilApplied(deps, begin.pushId);
}

/**
 * `confirm`を通してから不足blobを送る。
 *
 * **confirm前のuploadは`not_confirmed`で拒否される**ので、この順序は入れ替えられない。
 * 確定済みPushへの`confirm`は冪等成功なので、再開時にそのまま呼び直してよい
 */
async function stageBlobs(deps: PushDeps, begin: PushBeginResponse): Promise<boolean> {
  await deps.client.confirmPush({ pushId: begin.pushId, manifestHash: begin.manifestHash });
  return uploadBlobs(deps, begin.pushId, begin.missingBlobs);
}

async function uploadBlobs(
  deps: PushDeps,
  pushId: string,
  missing: readonly MissingBlob[],
): Promise<boolean> {
  for (const [index, blob] of missing.entries()) {
    if (deps.signal.aborted) return false;
    deps.report({
      phase: "upload",
      message: "Sending files…",
      done: index,
      total: missing.length,
    });
    await uploadOne(deps, pushId, blob);
  }
  if (missing.length > 0) {
    deps.report({
      phase: "upload",
      message: "Sending files…",
      done: missing.length,
      total: missing.length,
    });
  }
  return true;
}

/**
 * 原本1件を送る。**待てば通る失敗だけ**を再試行する。
 *
 * 初回同期は数百〜数千件を連続で送るのでrate limitに当たりやすく、1件の429で
 * Push全体を落とすと最初からやり直しになる（送信済みのblobは再利用されるが、
 * 利用者から見れば失敗にしか見えない）
 */
async function uploadOne(deps: PushDeps, pushId: string, blob: MissingBlob): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // 1件ずつ読んで送り、次へ行く前に捨てる（大きなvaultでも同時に持つのは1件だけ）
      const bytes = await deps.loadBlob(blob.sha256);
      await deps.client.uploadBlob({ pushId, sha256: blob.sha256, bytes });
      return;
    } catch (error) {
      const retryable = error instanceof NekoteApiError && error.isRetryable;
      if (!retryable || attempt >= UPLOAD_RETRY_LIMIT || deps.signal.aborted) throw error;
      const retryAfter = (error as NekoteApiError).retryAfterSeconds;
      await deps.sleep(retryAfter === undefined ? UPLOAD_RETRY_INTERVAL_MS : retryAfter * 1000);
    }
  }
}

/** `true`なら完備確認が終わりenqueued。`false`なら利用者が中断した */
async function finalize(
  deps: PushDeps,
  begin: PushBeginResponse,
  manifestHash: string,
): Promise<boolean> {
  let retries = 0;
  for (;;) {
    if (deps.signal.aborted) return false;
    deps.report({ phase: "finalize", message: "Verifying files…" });

    let response;
    try {
      response = await deps.client.finalizePush({
        pushId: begin.pushId,
        manifestHash,
        baseRevision: begin.baseRevision,
      });
    } catch (error) {
      // 別の同期が動いている間は受け付けられない。終わるのを待って同じpushIdで再送する
      if (
        error instanceof NekoteApiError &&
        error.code === "sync_run_active" &&
        retries < FINALIZE_RETRY_LIMIT
      ) {
        retries += 1;
        const waitMs = (error.retryAfterSeconds ?? 0) * 1000 || FINALIZE_RETRY_INTERVAL_MS;
        if (!(await sleepUnlessAborted(deps, waitMs))) return false;
        continue;
      }
      throw error;
    }

    if (response.state === "enqueued") return true;

    deps.report({
      phase: "finalize",
      message: "Verifying files…",
      done: response.verification.verifiedEntryCount,
      total: response.verification.entryCount,
    });
    if (!(await sleepUnlessAborted(deps, response.verification.retryAfter * 1000))) return false;
  }
}

/** 変換・公開が終わるまでstatusを見る。上限まで待っても終わらなければ「処理中」で返す */
async function pollUntilApplied(deps: PushDeps, pushId: string): Promise<PushOutcome> {
  if (deps.signal.aborted) return { status: "cancelled" };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let interval = POLL_MIN_INTERVAL_MS;
  let result = await deps.client.getPushStatus(pushId);

  for (;;) {
    if (result.state === "succeeded") {
      return { status: "applied", revision: result.appliedRevision, result };
    }
    if (result.state === "failed" || result.state === "expired") {
      return { status: "failed", result };
    }
    if (Date.now() >= deadline) return { status: "applying", result };
    if (deps.signal.aborted) return { status: "cancelled" };

    deps.report({ phase: "apply", message: "Publishing on Nekote Blog…" });
    if (!(await sleepUnlessAborted(deps, interval))) return { status: "cancelled" };
    interval = Math.min(POLL_MAX_INTERVAL_MS, Math.round(interval * 1.5));
    result = await deps.client.getPushStatus(pushId);
  }
}

/** 待ったあとに中断されていれば`false` */
async function sleepUnlessAborted(deps: PushDeps, milliseconds: number): Promise<boolean> {
  await deps.sleep(milliseconds);
  return !deps.signal.aborted;
}

/** 中断した反映の続きを見る。終端していれば結果を、まだ動いていれば`applying`を返す */
export async function resumePush(deps: PushDeps, pushId: string): Promise<PushOutcome | null> {
  let result: PushStatusResponse;
  try {
    result = await deps.client.getPushStatus(pushId);
  } catch (error) {
    // 期限切れ・削除済みのPushはもう追えない。次のPushを普通に始めればよい
    if (error instanceof NekoteApiError && error.code === "push_not_found") return null;
    throw error;
  }

  switch (result.state) {
    case "succeeded":
      return { status: "applied", revision: result.appliedRevision, result };
    case "failed":
    case "expired":
      return { status: "failed", result };
    case "preflight":
    case "confirmed":
    case "verifying":
    case "verified":
      // まだ原本を送っている途中。走査からやり直して同じmanifestならbeginが合流する
      return null;
    default:
      return pollUntilApplied(deps, pushId);
  }
}
