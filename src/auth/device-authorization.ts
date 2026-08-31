// 端末認可（OAuth 2.0 Device Authorization Grantに近い短命コード方式）の状態機械。
//
// 1. verifier/challengeを作って`POST /device-authorizations`
// 2. user codeを表示し、`verificationUriComplete`をブラウザで開く
// 3. ダッシュボードで承認されるまでpollする（未承認・拒否・期限切れは200のstatus）
// 4. 承認されたら端末トークンを一度だけ受け取る
//
// Obsidianに依存しないので、テストでは擬似clientと擬似sleepで動かせる。
import type { NekoteApiClient } from "../api/client";
import {
  DEVICE_POLL_MAX_INTERVAL_SECONDS,
  DEVICE_POLL_MIN_INTERVAL_SECONDS,
  DEVICE_POLL_SLOW_DOWN_STEP_SECONDS,
} from "../protocol/limits";
import type { ConnectionBlog, ConnectionDevice } from "../protocol/types";
import type { SecretStore } from "../storage/secrets";
import { createCodeChallenge, createCodeVerifier } from "./pkce";

/** user codeを表示してブラウザを開くためにUIへ渡す情報（秘密ではない） */
export interface DeviceAuthorizationPrompt {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** 認可の期限（epoch ms） */
  expiresAt: number;
}

export type DeviceAuthorizationResult =
  | { status: "approved"; token: string; blog: ConnectionBlog; device: ConnectionDevice }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "cancelled" };

export interface DeviceAuthorizationDeps {
  client: NekoteApiClient;
  secrets: SecretStore;
  /** epoch ms */
  now: () => number;
  /** signalがabortされたら早く戻る待機 */
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export interface DeviceAuthorizationInput {
  /** 承認画面と端末一覧に出す端末名 */
  deviceName: string;
  /** user codeが決まった時点で1回呼ぶ */
  onPrompt: (prompt: DeviceAuthorizationPrompt) => void;
  signal: AbortSignal;
}

/**
 * 認可の開始からトークン受け取りまでを1回実行する。
 *
 * **どの終わり方でも処理中のsecret（verifier・device code）を消す。**
 * 失敗（通信・サーバーエラー）は例外として呼び出し側へ投げる。
 */
export async function runDeviceAuthorization(
  deps: DeviceAuthorizationDeps,
  input: DeviceAuthorizationInput,
): Promise<DeviceAuthorizationResult> {
  const { client, secrets, now, sleep } = deps;

  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);

  try {
    const authorization = await client.startDeviceAuthorization({
      deviceName: input.deviceName,
      codeChallenge,
    });
    secrets.setPendingAuthorization({ codeVerifier, deviceCode: authorization.deviceCode });

    const expiresAt = now() + authorization.expiresIn * 1000;
    input.onPrompt({
      userCode: authorization.userCode,
      verificationUri: authorization.verificationUri,
      verificationUriComplete: authorization.verificationUriComplete,
      expiresAt,
    });

    let intervalSeconds = clampInterval(authorization.interval);

    for (;;) {
      await sleep(intervalSeconds * 1000, input.signal);
      if (input.signal.aborted) return { status: "cancelled" };
      // 期限切れはサーバーも`expired`で返すが、通信できないまま延々pollしない
      if (now() >= expiresAt) return { status: "expired" };

      const response = await client.pollDeviceToken({
        deviceCode: authorization.deviceCode,
        codeVerifier,
      });

      switch (response.status) {
        case "approved":
          return {
            status: "approved",
            token: response.token,
            blog: response.blog,
            device: response.device,
          };
        case "denied":
          return { status: "denied" };
        case "expired":
          return { status: "expired" };
        case "slow_down":
          intervalSeconds = clampInterval(
            Math.max(response.interval, intervalSeconds + DEVICE_POLL_SLOW_DOWN_STEP_SECONDS),
          );
          break;
        case "pending":
          intervalSeconds = clampInterval(response.interval);
          break;
      }
    }
  } finally {
    secrets.clearPendingAuthorization();
  }
}

function clampInterval(seconds: unknown): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return DEVICE_POLL_MIN_INTERVAL_SECONDS;
  }
  return Math.min(
    DEVICE_POLL_MAX_INTERVAL_SECONDS,
    Math.max(DEVICE_POLL_MIN_INTERVAL_SECONDS, Math.floor(seconds)),
  );
}

/** 既定の待機。`signal`がabortされた時点で戻る */
export function createSleep(): (milliseconds: number, signal: AbortSignal) => Promise<void> {
  return (milliseconds, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      function onAbort(): void {
        clearTimeout(timer);
        resolve();
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
}
