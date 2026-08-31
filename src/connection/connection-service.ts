// 接続（端末認可）・接続確認・接続解除。
//
// - 承認時点ではサーバーはObsidian sourceを作らない。公開中の記事も変わらない
// - plugin dataへ入れるのは表示用のhintだけ。正は`GET /connection`
// - 接続解除はサーバー側の失効（`DELETE /connection/device`）を伴う。通信できない
//   場合はローカルのtokenだけ消し、ダッシュボードでの失効が必要だと呼び出し側へ返す
import type { NekoteApiClient } from "../api/client";
import {
  runDeviceAuthorization,
  type DeviceAuthorizationDeps,
  type DeviceAuthorizationPrompt,
  type DeviceAuthorizationResult,
} from "../auth/device-authorization";
import { NekoteApiError } from "../protocol/errors";
import type { ConnectionResponse } from "../protocol/types";
import type { ConnectionHint } from "../storage/plugin-data";
import type { SecretStore } from "../storage/secrets";

export interface ConnectionServiceDeps {
  client: NekoteApiClient;
  secrets: SecretStore;
  now: () => number;
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** 接続先hintの保存。秘密は渡さない */
  saveConnectionHint: (hint: ConnectionHint | null) => Promise<void>;
}

/** 接続解除の結果。`revokedOnServer`がfalseならダッシュボードでの失効が必要 */
export interface DisconnectResult {
  revokedOnServer: boolean;
  /** サーバー失効に失敗した理由（利用者向け文言）。成功時はnull */
  reason: string | null;
}

export class ConnectionService {
  private readonly deps: ConnectionServiceDeps;

  constructor(deps: ConnectionServiceDeps) {
    this.deps = deps;
  }

  isConnected(): boolean {
    return this.deps.secrets.getPushToken() !== null;
  }

  /**
   * 端末認可を実行し、承認されたらトークンを`secretStorage`へ、接続先の表示情報を
   * plugin dataへ保存する。承認以外の結果ではどちらも書かない。
   */
  async connect(input: {
    deviceName: string;
    onPrompt: (prompt: DeviceAuthorizationPrompt) => void;
    signal: AbortSignal;
  }): Promise<DeviceAuthorizationResult> {
    const authDeps: DeviceAuthorizationDeps = {
      client: this.deps.client,
      secrets: this.deps.secrets,
      now: this.deps.now,
      sleep: this.deps.sleep,
    };
    const result = await runDeviceAuthorization(authDeps, input);
    if (result.status !== "approved") return result;

    this.deps.secrets.setPushToken(result.token);
    await this.deps.saveConnectionHint({ blog: result.blog, device: result.device });
    return result;
  }

  /** サーバーの接続状態。トークンが失効していれば401が投げられる */
  async fetchConnection(): Promise<ConnectionResponse> {
    const connection = await this.deps.client.getConnection();
    await this.deps.saveConnectionHint({
      blog: connection.blog,
      device: connection.device,
    });
    return connection;
  }

  /**
   * この端末の接続を解除する。
   *
   * サーバー失効に成功しても失敗しても、ローカルの秘密は必ず消す（利用者の
   * 「解除した」という期待を裏切らないため）。ただし失効できなかった場合は、
   * トークンがサーバー側で有効なままであることを呼び出し側へ返す。
   */
  async disconnect(): Promise<DisconnectResult> {
    let revokedOnServer = true;
    let reason: string | null = null;
    try {
      await this.deps.client.revokeDevice();
    } catch (error) {
      if (error instanceof NekoteApiError && error.isUnauthorized) {
        // すでに失効済み。サーバー側に有効なトークンは残らない
        revokedOnServer = true;
      } else {
        revokedOnServer = false;
        reason =
          error instanceof NekoteApiError ? error.message : "サーバーへ接続できませんでした。";
      }
    }

    this.deps.secrets.clearPushToken();
    this.deps.secrets.clearPendingAuthorization();
    this.deps.secrets.clearPendingPushId();
    await this.deps.saveConnectionHint(null);
    return { revokedOnServer, reason };
  }
}
