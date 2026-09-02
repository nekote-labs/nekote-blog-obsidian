// Push同期API v1のクライアント。契約は`protocol/v1/openapi.yaml`。
//
// トークンは`Authorization: Bearer`にだけ載せ、**URL・ログ・エラー文言へ出さない**。
import { headerValue, type HttpFetch, type HttpRequest, type HttpResponse } from "./http";
import { getTranslations } from "../i18n";
import { NekoteApiError, networkError, parseApiErrorBody } from "../protocol/errors";
import { PROTOCOL_MAJOR } from "../protocol/limits";
import { isSupportedProtocolMajor } from "../protocol/version";
import type {
  AppliedManifestResponse,
  BlobUploadResponse,
  ConnectionResponse,
  DeviceAuthorizationResponse,
  DeviceTokenResponse,
  PushBeginResponse,
  PushConfirmResponse,
  PushFinalizeResponse,
  PushStatusResponse,
  SyncManifest,
} from "../protocol/types";

export interface NekoteApiClientOptions {
  fetch: HttpFetch;
  /**
   * `https://api.nekote.blog/v1/obsidian` のような、パス末尾に`/`を含まないURL。
   * 設定で接続先を切り替えられるよう、都度読む
   */
  getBaseUrl: () => string;
  /** 端末トークンの取得。未接続ならnull */
  getToken: () => string | null;
}

type Auth = "bearer" | "none";

export class NekoteApiClient {
  private readonly options: NekoteApiClientOptions;

  constructor(options: NekoteApiClientOptions) {
    this.options = options;
  }

  // --- 端末認可（未認証） ---------------------------------------------------

  async startDeviceAuthorization(input: {
    deviceName: string;
    codeChallenge: string;
  }): Promise<DeviceAuthorizationResponse> {
    return this.requestJson<DeviceAuthorizationResponse>({
      method: "POST",
      path: "/device-authorizations",
      auth: "none",
      json: {
        protocolVersion: PROTOCOL_MAJOR,
        deviceName: input.deviceName,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: "S256",
      },
    });
  }

  /**
   * 承認状態のpoll。**未承認・拒否・期限切れは200のstatusで返る**ので、
   * ここで例外にするのは通信・形式の失敗だけ。
   */
  async pollDeviceToken(input: {
    deviceCode: string;
    codeVerifier: string;
  }): Promise<DeviceTokenResponse> {
    const response = await this.requestJson<DeviceTokenResponse>({
      method: "POST",
      path: "/device-authorizations/token",
      auth: "none",
      json: {
        protocolVersion: PROTOCOL_MAJOR,
        deviceCode: input.deviceCode,
        codeVerifier: input.codeVerifier,
      },
    });
    const status = (response as { status?: unknown }).status;
    if (
      status !== "pending" &&
      status !== "slow_down" &&
      status !== "denied" &&
      status !== "expired" &&
      status !== "approved"
    ) {
      throw networkError(getTranslations().api.unreadableResponse);
    }
    return response;
  }

  // --- 接続情報 -------------------------------------------------------------

  async getConnection(): Promise<ConnectionResponse> {
    const response = await this.requestJson<ConnectionResponse>({
      method: "GET",
      path: "/connection",
      auth: "bearer",
    });
    this.assertProtocolMajor(response.protocolVersion);
    return response;
  }

  /** 現在の端末credentialをサーバー側で失効させる。失効済みでも204（冪等） */
  async revokeDevice(): Promise<void> {
    await this.request({ method: "DELETE", path: "/connection/device", auth: "bearer" });
  }

  // --- Push世代 -------------------------------------------------------------

  async beginPush(manifest: SyncManifest): Promise<PushBeginResponse> {
    const response = await this.requestJson<PushBeginResponse>({
      method: "POST",
      path: "/pushes",
      auth: "bearer",
      json: manifest,
    });
    this.assertProtocolMajor(response.protocolVersion);
    return response;
  }

  async confirmPush(input: { pushId: string; manifestHash: string }): Promise<PushConfirmResponse> {
    return this.requestJson<PushConfirmResponse>({
      method: "POST",
      path: `/pushes/${encodeURIComponent(input.pushId)}/confirm`,
      auth: "bearer",
      json: { protocolVersion: PROTOCOL_MAJOR, manifestHash: input.manifestHash },
    });
  }

  /**
   * 原本1件をstageする。bodyはバイト列そのもの（Content-Typeは判定に使われない）。
   *
   * 最大20MiBのArrayBufferを`requestUrl()`で送れるかはモバイル実機で未確認
   * （`docs/on-device-checks.md`）。厳しければ上限を下げるのではなくchunk uploadを足す。
   */
  async uploadBlob(input: {
    pushId: string;
    sha256: string;
    bytes: ArrayBuffer;
  }): Promise<BlobUploadResponse> {
    return this.requestJson<BlobUploadResponse>({
      method: "PUT",
      path: `/pushes/${encodeURIComponent(input.pushId)}/blobs/${encodeURIComponent(input.sha256)}`,
      auth: "bearer",
      body: input.bytes,
      contentType: "application/octet-stream",
    });
  }

  /**
   * 完備確認とQueue投入。**202は失敗ではない**（完備確認の継続中）。
   * 呼び出し側は`verification.retryAfter`のあと同じpushIdで再送する。
   */
  async finalizePush(input: {
    pushId: string;
    manifestHash: string;
    baseRevision: number;
  }): Promise<PushFinalizeResponse> {
    return this.requestJson<PushFinalizeResponse>({
      method: "POST",
      path: `/pushes/${encodeURIComponent(input.pushId)}/finalize`,
      auth: "bearer",
      json: {
        protocolVersion: PROTOCOL_MAJOR,
        manifestHash: input.manifestHash,
        baseRevision: input.baseRevision,
      },
    });
  }

  async getPushStatus(pushId: string): Promise<PushStatusResponse> {
    return this.requestJson<PushStatusResponse>({
      method: "GET",
      path: `/pushes/${encodeURIComponent(pushId)}`,
      auth: "bearer",
    });
  }

  async getAppliedManifest(): Promise<AppliedManifestResponse> {
    const response = await this.requestJson<AppliedManifestResponse>({
      method: "GET",
      path: "/manifest",
      auth: "bearer",
    });
    this.assertProtocolMajor(response.protocolVersion);
    return response;
  }

  // --- 内部 -----------------------------------------------------------------

  private assertProtocolMajor(value: unknown): void {
    if (isSupportedProtocolMajor(value)) return;
    throw new NekoteApiError({
      code: "protocol_version_unsupported",
      status: 426,
      message: getTranslations().api.unsupportedVersion,
    });
  }

  private async requestJson<T>(input: {
    method: string;
    path: string;
    auth: Auth;
    json?: unknown;
    body?: ArrayBuffer;
    contentType?: string;
  }): Promise<T> {
    const response = await this.request(input);
    if (response.text === "") {
      throw networkError(getTranslations().api.emptyResponse);
    }
    try {
      return JSON.parse(response.text) as T;
    } catch {
      throw networkError(getTranslations().api.unreadableResponse);
    }
  }

  private async request(input: {
    method: string;
    path: string;
    auth: Auth;
    json?: unknown;
    body?: ArrayBuffer;
    contentType?: string;
  }): Promise<HttpResponse> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.auth === "bearer") {
      const token = this.options.getToken();
      if (token === null || token === "") {
        throw new NekoteApiError({
          code: "unauthorized",
          status: 401,
          message: getTranslations().api.unauthorized,
        });
      }
      headers.Authorization = `Bearer ${token}`;
    }

    const request: HttpRequest = {
      url: `${this.options.getBaseUrl()}${input.path}`,
      method: input.method,
      headers,
    };
    if (input.json !== undefined) {
      request.contentType = "application/json";
      request.body = JSON.stringify(input.json);
    } else if (input.body !== undefined) {
      request.contentType = input.contentType ?? "application/octet-stream";
      request.body = input.body;
    }

    let response: HttpResponse;
    try {
      response = await this.options.fetch(request);
    } catch {
      // 例外の中身にはURL等が入り得るので、そのままは出さない
      throw networkError(getTranslations().api.unreachable);
    }

    if (response.status >= 400) throw toApiError(response);
    return response;
  }
}

function toApiError(response: HttpResponse): NekoteApiError {
  let body: unknown = null;
  try {
    body = response.text === "" ? null : JSON.parse(response.text);
  } catch {
    // エラー形式でない応答（HTMLのエラーページ等）はcodeなしとして扱う
  }
  const parsed = parseApiErrorBody(body);
  const retryAfter = Number.parseInt(headerValue(response.headers, "Retry-After") ?? "", 10);
  return new NekoteApiError({
    code: parsed.code,
    status: response.status,
    message: parsed.message ?? getTranslations().api.httpError(response.status),
    details: parsed.details,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : undefined,
  });
}
