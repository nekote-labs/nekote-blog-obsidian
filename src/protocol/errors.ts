// エラー形式とエラーコード（`protocol/v1/openapi.yaml`の`ErrorCode`と1対1）。
//
// `code`が安定した識別子で、プラグインはこれで分岐する。`message`はサーバーが返す
// 利用者向けの日本語文言をそのまま出す（コードごとの既定文言はサーバー側にある）。

/** コードごとの既定HTTP status。契約テストがOpenAPIの`x-http-status`と突き合わせる */
export const API_ERROR_STATUS = {
  invalid_request: 400,
  invalid_manifest: 400,
  hash_mismatch: 400,
  size_mismatch: 400,
  unsupported_asset_format: 400,
  blobs_incomplete: 400,
  unauthorized: 401,
  blog_forbidden: 403,
  vault_in_use: 403,
  push_not_found: 404,
  revision_conflict: 409,
  push_in_progress: 409,
  sync_run_active: 409,
  source_switch_pending: 409,
  blog_deleting: 409,
  not_confirmed: 409,
  manifest_too_large: 413,
  payload_too_large: 413,
  push_quota_exceeded: 413,
  protocol_version_unsupported: 426,
  rate_limited: 429,
  daily_quota_exceeded: 429,
  internal_error: 500,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  // `in`ではObject.prototypeのキー（`toString`等）まで既知コード扱いになる
  return typeof value === "string" && Object.hasOwn(API_ERROR_STATUS, value);
}

/**
 * サーバーが返したエラー。`code`が既知でない場合（未知のコード・エラー形式でない
 * 応答・通信失敗）は`code`を`null`にして、statusと素の文言だけを持つ。
 */
export class NekoteApiError extends Error {
  readonly code: ApiErrorCode | null;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  /** 429・202で返る推奨待ち時間（秒）。無ければundefined */
  readonly retryAfterSeconds: number | undefined;

  constructor(options: {
    code: ApiErrorCode | null;
    status: number;
    message: string;
    details?: Record<string, unknown>;
    retryAfterSeconds?: number;
  }) {
    super(options.message);
    this.name = "NekoteApiError";
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  /** 端末トークンが無効。再接続へ誘導する（公開中の記事は維持される） */
  get isUnauthorized(): boolean {
    return this.code === "unauthorized";
  }

  /** プラグインが古い。更新導線を出す */
  get isProtocolUnsupported(): boolean {
    return this.code === "protocol_version_unsupported";
  }

  /** そのまま同じ操作を再試行してよいもの */
  get isRetryable(): boolean {
    return (
      this.code === "rate_limited" ||
      this.code === "sync_run_active" ||
      this.code === "internal_error" ||
      this.status === 0 ||
      this.status >= 500
    );
  }
}

/** ネットワーク到達不能・応答が壊れている等、statusを持たない失敗 */
export function networkError(message: string): NekoteApiError {
  return new NekoteApiError({ code: null, status: 0, message });
}

interface ParsedErrorBody {
  code: ApiErrorCode | null;
  message: string | null;
  details: Record<string, unknown> | undefined;
}

/** エラー応答bodyの解釈。壊れたbodyでも例外を投げず、分かった分だけ返す */
export function parseApiErrorBody(body: unknown): ParsedErrorBody {
  const empty: ParsedErrorBody = { code: null, message: null, details: undefined };
  if (typeof body !== "object" || body === null) return empty;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return empty;
  const { code, message, details } = error as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
  return {
    code: isApiErrorCode(code) ? code : null,
    message: typeof message === "string" && message !== "" ? message : null,
    details:
      typeof details === "object" && details !== null && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : undefined,
  };
}
