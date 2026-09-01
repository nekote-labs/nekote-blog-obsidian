import { API_ERROR_STATUS, NekoteApiError, type ApiErrorCode } from "../../src/protocol/errors";
import type {
  PushBeginResponse,
  PushFinalizeResponse,
  PushPreflight,
  PushState,
  PushStatusResponse,
} from "../../src/protocol/types";

export const PUSH_ID = "018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f";
export const MANIFEST_HASH = "5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90";

export function apiError(code: ApiErrorCode, retryAfterSeconds?: number): NekoteApiError {
  return new NekoteApiError({
    code,
    status: API_ERROR_STATUS[code],
    message: `サーバーが${code}を返しました。`,
    retryAfterSeconds,
  });
}

export interface BeginOverrides extends Partial<Omit<PushBeginResponse, "preflight">> {
  preflight?: Partial<PushPreflight>;
}

export function beginResponse(overrides: BeginOverrides = {}): PushBeginResponse {
  const { preflight, ...rest } = overrides;
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
      ...preflight,
    },
    missingBlobs: [],
    confirmationRequired: false,
    expiresAt: "2026-09-01T00:30:00.000Z",
    ...rest,
  };
}

export function enqueued(): PushFinalizeResponse {
  return { pushId: PUSH_ID, state: "enqueued", jobId: "job-1", targetRevision: 13 };
}

export function statusResponse(
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

/** キューから1件取り出す。Errorが入っていればそれを投げる（サーバーの失敗の再現） */
export function take<T>(queue: (T | Error)[], name: string): T {
  const next = queue.shift();
  if (next === undefined) throw new Error(`${name}が想定より多く呼ばれました。`);
  if (next instanceof Error) throw next;
  return next;
}
