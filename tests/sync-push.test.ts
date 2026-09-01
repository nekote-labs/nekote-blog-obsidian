import { afterEach, describe, expect, it, vi } from "vitest";
import type { NekoteApiClient } from "../src/api/client";
import { API_ERROR_STATUS, NekoteApiError, type ApiErrorCode } from "../src/protocol/errors";
import type {
  BlobUploadResponse,
  MissingBlob,
  PushBeginResponse,
  PushConfirmResponse,
  PushFinalizeResponse,
  PushState,
  PushStatusResponse,
  SyncManifest,
} from "../src/protocol/types";
import { buildSyncManifest } from "../src/sync/manifest";
import {
  resumePush,
  runPush,
  type PushDeps,
  type PushInput,
  type PushProgress,
} from "../src/sync/push";

const PUSH_ID = "018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f";
const MANIFEST_HASH = "5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90";

function apiError(code: ApiErrorCode, retryAfterSeconds?: number): NekoteApiError {
  return new NekoteApiError({
    code,
    status: API_ERROR_STATUS[code],
    message: `サーバーが${code}を返しました。`,
    retryAfterSeconds,
  });
}

function missingBlob(sha256: string, bytes = 1024): MissingBlob {
  return { sha256, kind: "markdown", bytes };
}

function beginResponse(overrides: Partial<PushBeginResponse> = {}): PushBeginResponse {
  return {
    protocolVersion: 1,
    pushId: PUSH_ID,
    state: "preflight",
    baseRevision: 12,
    appliedRevision: 12,
    manifestHash: MANIFEST_HASH,
    preflight: {
      addedCount: 1,
      updatedCount: 0,
      deletedCount: 0,
      unchangedCount: 3,
      missingBlobCount: 0,
      missingBlobBytes: 0,
      initialConnect: false,
      confirmationReasons: [],
    },
    missingBlobs: [],
    confirmationRequired: false,
    expiresAt: "2026-09-01T00:30:00.000Z",
    ...overrides,
  };
}

function enqueued(): PushFinalizeResponse {
  return { pushId: PUSH_ID, state: "enqueued", jobId: "job-1", targetRevision: 13 };
}

function verifying(retryAfter = 30): PushFinalizeResponse {
  return {
    pushId: PUSH_ID,
    state: "verifying",
    verification: { cursor: 500, verifiedEntryCount: 500, entryCount: 1200, retryAfter },
  };
}

function statusResponse(
  state: PushState,
  overrides: Partial<PushStatusResponse> = {},
): PushStatusResponse {
  return {
    pushId: PUSH_ID,
    state,
    baseRevision: 12,
    targetRevision: state === "succeeded" ? 13 : null,
    appliedRevision: state === "succeeded" ? 13 : 12,
    manifestHash: MANIFEST_HASH,
    expiresAt: "2026-09-01T00:30:00.000Z",
    ...overrides,
  };
}

function pushInput(): PushInput {
  return {
    manifest: buildSyncManifest({
      vaultId: "vault-8f3a2b1c9d0e",
      contentRoot: "blog",
      baseRevision: 12,
      entries: [],
    }),
    manifestHash: MANIFEST_HASH,
  };
}

/** キューから1件取り出す。Errorが入っていればそれを投げる（サーバーの失敗の再現） */
function take<T>(queue: (T | Error)[], name: string): T {
  const next = queue.shift();
  if (next === undefined) throw new Error(`${name}が想定より多く呼ばれました。`);
  if (next instanceof Error) throw next;
  return next;
}

interface FinalizeInput {
  pushId: string;
  manifestHash: string;
  baseRevision: number;
}

interface HarnessOptions {
  begin?: (PushBeginResponse | Error)[];
  finalize?: (PushFinalizeResponse | Error)[];
  status?: (PushStatusResponse | Error)[];
  confirm?: (begin: PushBeginResponse) => boolean;
  signal?: AbortSignal;
  /** upload 1件ごとに呼ぶhook（送信の途中で中断させるのに使う） */
  onUpload?: (sha256: string) => void;
  /** sleepの直前に呼ぶhook（待機中の中断を再現する） */
  onSleep?: () => void;
  /** sleep 1回で進める仮想時間（ミリ秒）。既定は要求された時間そのもの */
  advanceMsPerSleep?: number;
}

interface Harness {
  deps: PushDeps;
  /** 呼ばれた順序。`runPush`の契約はこの並びで確かめる */
  calls: string[];
  sleeps: number[];
  progress: PushProgress[];
  startedPushIds: string[];
  manifests: SyncManifest[];
  finalizeInputs: FinalizeInput[];
  uploaded: string[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const progress: PushProgress[] = [];
  const startedPushIds: string[] = [];
  const manifests: SyncManifest[] = [];
  const finalizeInputs: FinalizeInput[] = [];
  const uploaded: string[] = [];

  const beginQueue = [...(options.begin ?? [])];
  const finalizeQueue = [...(options.finalize ?? [])];
  const statusQueue = [...(options.status ?? [])];

  // 待ち時間の実測はしない。sleepが仮想時計を進め、pollの上限判定だけを再現する
  const clock = { now: 1_700_000_000_000 };
  vi.spyOn(Date, "now").mockImplementation(() => clock.now);

  const client = {
    beginPush: async (manifest: SyncManifest): Promise<PushBeginResponse> => {
      calls.push("beginPush");
      manifests.push(manifest);
      return take(beginQueue, "beginPush");
    },
    confirmPush: async (input: {
      pushId: string;
      manifestHash: string;
    }): Promise<PushConfirmResponse> => {
      calls.push(`confirmPush:${input.pushId}`);
      return {
        pushId: input.pushId,
        state: "confirmed",
        reservedBlobCount: 0,
        reservedBlobBytes: 0,
        expiresAt: "2026-09-01T00:30:00.000Z",
      };
    },
    uploadBlob: async (input: {
      pushId: string;
      sha256: string;
      bytes: ArrayBuffer;
    }): Promise<BlobUploadResponse> => {
      calls.push(`uploadBlob:${input.sha256}`);
      uploaded.push(input.sha256);
      options.onUpload?.(input.sha256);
      return { sha256: input.sha256, bytes: input.bytes.byteLength, blobGen: 1, state: "live" };
    },
    finalizePush: async (input: FinalizeInput): Promise<PushFinalizeResponse> => {
      calls.push(`finalizePush:${input.pushId}`);
      finalizeInputs.push(input);
      return take(finalizeQueue, "finalizePush");
    },
    getPushStatus: async (pushId: string): Promise<PushStatusResponse> => {
      calls.push(`getPushStatus:${pushId}`);
      return take(statusQueue, "getPushStatus");
    },
  };

  const deps: PushDeps = {
    client: client as unknown as NekoteApiClient,
    loadBlob: async (sha256) => {
      calls.push(`loadBlob:${sha256}`);
      return new ArrayBuffer(4);
    },
    confirm: async (begin) => {
      calls.push("confirm");
      return options.confirm?.(begin) ?? true;
    },
    report: (value) => progress.push(value),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      options.onSleep?.();
      clock.now += options.advanceMsPerSleep ?? milliseconds;
    },
    onPushStarted: (pushId) => {
      calls.push(`onPushStarted:${pushId}`);
      startedPushIds.push(pushId);
    },
    signal: options.signal ?? new AbortController().signal,
  };

  return { deps, calls, sleeps, progress, startedPushIds, manifests, finalizeInputs, uploaded };
}

/** 例外のcodeまで見たいので捕まえて返す */
async function catchApiError(run: () => Promise<unknown>): Promise<NekoteApiError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(NekoteApiError);
    return error as NekoteApiError;
  }
  throw new Error("NekoteApiErrorが投げられませんでした。");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runPush: 正常系", () => {
  it("begin → confirm → 1件ずつupload → finalize → statusの順に進み、appliedを返す", async () => {
    const harness = createHarness({
      begin: [
        beginResponse({
          confirmationRequired: true,
          missingBlobs: [missingBlob("sha-a"), missingBlob("sha-b")],
        }),
      ],
      finalize: [enqueued()],
      status: [statusResponse("succeeded")],
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "applied", revision: 13 });
    expect(harness.calls).toEqual([
      "beginPush",
      `onPushStarted:${PUSH_ID}`,
      "confirm",
      `confirmPush:${PUSH_ID}`,
      "loadBlob:sha-a",
      "uploadBlob:sha-a",
      "loadBlob:sha-b",
      "uploadBlob:sha-b",
      `finalizePush:${PUSH_ID}`,
      `getPushStatus:${PUSH_ID}`,
    ]);
  });

  it("finalizeにはbeginのbaseRevisionと走査したmanifestHashを渡す", async () => {
    const harness = createHarness({
      begin: [beginResponse({ baseRevision: 7 })],
      finalize: [enqueued()],
      status: [statusResponse("succeeded")],
    });

    await runPush(harness.deps, pushInput());

    expect(harness.finalizeInputs).toEqual([
      { pushId: PUSH_ID, manifestHash: MANIFEST_HASH, baseRevision: 7 },
    ]);
  });

  it("onPushStartedはbeginの直後に1回だけ呼ばれ、原本を送る前にpushIdを渡す", async () => {
    const harness = createHarness({
      begin: [beginResponse({ missingBlobs: [missingBlob("sha-a")] })],
      finalize: [enqueued()],
      status: [statusResponse("succeeded")],
    });

    await runPush(harness.deps, pushInput());

    expect(harness.startedPushIds).toEqual([PUSH_ID]);
    expect(harness.calls.indexOf(`onPushStarted:${PUSH_ID}`)).toBe(1);
    expect(harness.calls.indexOf(`onPushStarted:${PUSH_ID}`)).toBeLessThan(
      harness.calls.indexOf("uploadBlob:sha-a"),
    );
  });
});

describe("runPush: 追加確認", () => {
  it("confirmationRequiredで断ると、confirmPushもuploadBlobも呼ばずにcancelledになる", async () => {
    const harness = createHarness({
      begin: [beginResponse({ confirmationRequired: true, missingBlobs: [missingBlob("sha-a")] })],
      confirm: () => false,
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toEqual({ status: "cancelled" });
    expect(harness.calls).toEqual(["beginPush", `onPushStarted:${PUSH_ID}`, "confirm"]);
  });

  it("confirmationRequiredでなければconfirmを呼ばずに進む", async () => {
    const harness = createHarness({
      begin: [beginResponse({ confirmationRequired: false })],
      finalize: [enqueued()],
      status: [statusResponse("succeeded")],
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "applied" });
    expect(harness.calls).not.toContain("confirm");
  });
});

describe("runPush: 原本の送信", () => {
  it("不足blobが0件ならuploadBlobを呼ばない", async () => {
    const harness = createHarness({
      begin: [beginResponse({ missingBlobs: [] })],
      finalize: [enqueued()],
      status: [statusResponse("succeeded")],
    });

    await runPush(harness.deps, pushInput());

    expect(harness.uploaded).toEqual([]);
    expect(harness.progress.some((progress) => progress.phase === "upload")).toBe(false);
  });

  it("送信の途中でabortされると残りを送らずcancelledになる", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      begin: [beginResponse({ missingBlobs: [missingBlob("sha-a"), missingBlob("sha-b")] })],
      signal: controller.signal,
      onUpload: () => controller.abort(),
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toEqual({ status: "cancelled" });
    expect(harness.uploaded).toEqual(["sha-a"]);
    expect(harness.calls).not.toContain(`finalizePush:${PUSH_ID}`);
  });
});

describe("runPush: finalize", () => {
  it("202（verifying）の間はretryAfterだけ待って同じpushIdで再送する", async () => {
    const harness = createHarness({
      begin: [beginResponse()],
      finalize: [verifying(30), enqueued()],
      status: [statusResponse("succeeded")],
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "applied" });
    expect(harness.finalizeInputs.map((input) => input.pushId)).toEqual([PUSH_ID, PUSH_ID]);
    expect(harness.sleeps).toEqual([30_000]);
    expect(harness.progress).toContainEqual({
      phase: "finalize",
      message: "送信内容を確認しています…",
      done: 500,
      total: 1200,
    });
  });

  it("blobs_incompleteならbeginをやり直して不足blobを送り直す", async () => {
    const harness = createHarness({
      begin: [
        beginResponse({ missingBlobs: [missingBlob("sha-a")] }),
        beginResponse({ missingBlobs: [missingBlob("sha-b")] }),
      ],
      finalize: [apiError("blobs_incomplete"), enqueued()],
      status: [statusResponse("succeeded")],
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "applied" });
    expect(harness.calls).toEqual([
      "beginPush",
      `onPushStarted:${PUSH_ID}`,
      `confirmPush:${PUSH_ID}`,
      "loadBlob:sha-a",
      "uploadBlob:sha-a",
      `finalizePush:${PUSH_ID}`,
      "beginPush",
      // やり直したbeginが新しいPush世代を返すことがあるので、pushIdの記録と
      // confirmもやり直す（確認前のuploadは拒否されるため）
      `onPushStarted:${PUSH_ID}`,
      `confirmPush:${PUSH_ID}`,
      "loadBlob:sha-b",
      "uploadBlob:sha-b",
      `finalizePush:${PUSH_ID}`,
      `getPushStatus:${PUSH_ID}`,
    ]);
    expect(harness.startedPushIds).toEqual([PUSH_ID, PUSH_ID]);
  });

  it("送り直してもblobs_incompleteならエラーにする", async () => {
    const harness = createHarness({
      begin: [
        beginResponse({ missingBlobs: [missingBlob("sha-a")] }),
        beginResponse({ missingBlobs: [missingBlob("sha-a")] }),
      ],
      finalize: [apiError("blobs_incomplete"), apiError("blobs_incomplete")],
    });

    const error = await catchApiError(() => runPush(harness.deps, pushInput()));

    expect(error.code).toBe("blobs_incomplete");
    expect(harness.calls.filter((call) => call === "beginPush")).toHaveLength(2);
  });

  it("sync_run_activeならretryAfter秒だけ待って再送する", async () => {
    const harness = createHarness({
      begin: [beginResponse()],
      finalize: [apiError("sync_run_active", 3), enqueued()],
      status: [statusResponse("succeeded")],
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "applied" });
    expect(harness.sleeps).toEqual([3000]);
  });

  it("sync_run_activeが続いて上限回数を超えたらエラーを投げる", async () => {
    const harness = createHarness({
      begin: [beginResponse()],
      finalize: Array.from({ length: 6 }, () => apiError("sync_run_active")),
    });

    const error = await catchApiError(() => runPush(harness.deps, pushInput()));

    expect(error.code).toBe("sync_run_active");
    // 5回だけ待ち直し、6回目の失敗で諦める。retryAfterが無いときは既定の10秒
    expect(harness.sleeps).toEqual([10_000, 10_000, 10_000, 10_000, 10_000]);
    expect(harness.calls.filter((call) => call === `finalizePush:${PUSH_ID}`)).toHaveLength(6);
  });

  it("完備確認の待機中にabortされるとcancelledになり、再送しない", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      begin: [beginResponse()],
      finalize: [verifying(30), enqueued()],
      signal: controller.signal,
      onSleep: () => controller.abort(),
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toEqual({ status: "cancelled" });
    expect(harness.calls.filter((call) => call === `finalizePush:${PUSH_ID}`)).toHaveLength(1);
    expect(harness.calls).not.toContain(`getPushStatus:${PUSH_ID}`);
  });
});

describe("runPush: 適用の待ち", () => {
  it("終わるまでpollし、間隔を伸ばしながら待つ", async () => {
    const harness = createHarness({
      begin: [beginResponse()],
      finalize: [enqueued()],
      status: [
        statusResponse("transforming"),
        statusResponse("published"),
        statusResponse("succeeded"),
      ],
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "applied", revision: 13 });
    expect(harness.sleeps).toEqual([3000, 4500]);
  });

  it.each(["failed", "expired"] as const)("statusが%sならfailedを返す", async (state) => {
    const harness = createHarness({
      begin: [beginResponse()],
      finalize: [enqueued()],
      status: [statusResponse(state)],
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "failed" });
  });

  it("上限時間まで終端しなければapplyingを返す", async () => {
    const harness = createHarness({
      begin: [beginResponse()],
      finalize: [enqueued()],
      status: [statusResponse("transforming"), statusResponse("transforming")],
      // 1回のsleepでpollの上限（10分）を超える仮想時間を進める
      advanceMsPerSleep: 20 * 60 * 1000,
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "applying" });
    expect(harness.sleeps).toEqual([3000]);
  });

  it("status待機中にabortされるとcancelledになり、pollを止める", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      begin: [beginResponse()],
      finalize: [enqueued()],
      status: [statusResponse("transforming"), statusResponse("succeeded")],
      signal: controller.signal,
      onSleep: () => controller.abort(),
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toEqual({ status: "cancelled" });
    expect(harness.calls.filter((call) => call === `getPushStatus:${PUSH_ID}`)).toHaveLength(1);
  });
});

describe("runPush: uploadの再試行", () => {
  it("rate_limitedはRetry-Afterだけ待って同じblobを送り直す", async () => {
    let attempts = 0;
    const harness = createHarness({
      begin: [beginResponse({ missingBlobs: [missingBlob("sha-a")] })],
      finalize: [enqueued()],
      status: [statusResponse("succeeded")],
      onUpload: () => {
        attempts += 1;
        if (attempts <= 2) throw apiError("rate_limited", 7);
      },
    });

    const outcome = await runPush(harness.deps, pushInput());

    expect(outcome).toMatchObject({ status: "applied" });
    expect(attempts).toBe(3);
    expect(harness.sleeps).toEqual([7000, 7000]);
  });

  it("待っても直らない失敗はそのまま投げる", async () => {
    const harness = createHarness({
      begin: [beginResponse({ missingBlobs: [missingBlob("sha-a")] })],
      onUpload: () => {
        throw apiError("hash_mismatch");
      },
    });

    const error = await catchApiError(() => runPush(harness.deps, pushInput()));

    expect(error.code).toBe("hash_mismatch");
    expect(harness.sleeps).toEqual([]);
  });

  it("再試行の上限を超えたら投げる", async () => {
    let attempts = 0;
    const harness = createHarness({
      begin: [beginResponse({ missingBlobs: [missingBlob("sha-a")] })],
      onUpload: () => {
        attempts += 1;
        throw apiError("rate_limited");
      },
    });

    const error = await catchApiError(() => runPush(harness.deps, pushInput()));

    expect(error.code).toBe("rate_limited");
    expect(attempts).toBe(6);
  });
});

describe("resumePush", () => {
  it("succeededならappliedを返す", async () => {
    const harness = createHarness({ status: [statusResponse("succeeded")] });

    const outcome = await resumePush(harness.deps, PUSH_ID);

    expect(outcome).toMatchObject({ status: "applied", revision: 13 });
  });

  it.each(["failed", "expired"] as const)("%sならfailedを返す", async (state) => {
    const harness = createHarness({ status: [statusResponse(state)] });

    const outcome = await resumePush(harness.deps, PUSH_ID);

    expect(outcome).toMatchObject({ status: "failed" });
  });

  it.each(["preflight", "confirmed", "verifying", "verified"] as const)(
    "%sならnullを返す（走査からやり直して同じPushへ合流する）",
    async (state) => {
      const harness = createHarness({ status: [statusResponse(state)] });

      expect(await resumePush(harness.deps, PUSH_ID)).toBeNull();
    },
  );

  it("push_not_foundならnullを返す", async () => {
    const harness = createHarness({ status: [apiError("push_not_found")] });

    expect(await resumePush(harness.deps, PUSH_ID)).toBeNull();
  });

  it("適用中の段階ならpollして結果を返す", async () => {
    const harness = createHarness({
      status: [statusResponse("transforming"), statusResponse("succeeded")],
    });

    const outcome = await resumePush(harness.deps, PUSH_ID);

    expect(outcome).toMatchObject({ status: "applied", revision: 13 });
    expect(harness.calls).toEqual([`getPushStatus:${PUSH_ID}`, `getPushStatus:${PUSH_ID}`]);
  });
});
