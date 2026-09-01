import { describe, expect, it } from "vitest";
import { NekoteApiClient } from "../src/api/client";
import type { HttpFetch, HttpRequest, HttpResponse } from "../src/api/http";
import { createCodeChallenge, createCodeVerifier } from "../src/auth/pkce";
import { runDeviceAuthorization } from "../src/auth/device-authorization";
import type { DeviceAuthorizationPrompt } from "../src/auth/device-authorization";
import { SecretStore } from "../src/storage/secrets";
import { jsonResponse } from "./support/api";
import { FakeSecretStorage } from "./support/fake-secret-storage";

interface Scenario {
  responses: HttpResponse[];
  requests: HttpRequest[];
  sleeps: number[];
}

function createScenario(responses: HttpResponse[]): Scenario {
  return { responses, requests: [], sleeps: [] };
}

function createClient(scenario: Scenario): NekoteApiClient {
  const fetch: HttpFetch = async (request) => {
    scenario.requests.push(request);
    const response = scenario.responses.shift();
    if (response === undefined) throw new Error("想定より多くリクエストが飛んだ");
    return response;
  };
  return new NekoteApiClient({
    fetch,
    getBaseUrl: () => "https://api.example.test/v1/obsidian",
    getToken: () => null,
  });
}

const authorizationResponse = {
  deviceCode: "device-code-value",
  userCode: "K7QX-3M9T",
  verificationUri: "https://dash.example.test/obsidian/authorize",
  verificationUriComplete: "https://dash.example.test/obsidian/authorize?code=K7QX-3M9T",
  expiresIn: 600,
  interval: 5,
};

interface RunOptions {
  responses: HttpResponse[];
  /** now()が返す値。呼ばれるたびに次の値へ進み、尽きたら最後の値を返し続ける */
  times?: number[];
  signal?: AbortSignal;
}

async function run(options: RunOptions) {
  const scenario = createScenario(options.responses);
  const storage = new FakeSecretStorage();
  const secrets = new SecretStore(storage);
  const prompts: DeviceAuthorizationPrompt[] = [];
  const times = options.times ?? [0];
  let timeIndex = 0;
  /** poll直前のsecretStorageの中身。承認前にverifierが載っていることの確認に使う */
  const observed: { pendingDuringPoll: { codeVerifier: string; deviceCode: string } | null } = {
    pendingDuringPoll: null,
  };

  const result = await runDeviceAuthorization(
    {
      client: createClient(scenario),
      secrets,
      now: () => times[Math.min(timeIndex++, times.length - 1)] as number,
      sleep: async (milliseconds) => {
        scenario.sleeps.push(milliseconds);
        observed.pendingDuringPoll ??= secrets.getPendingAuthorization();
      },
    },
    {
      deviceName: "MacBook Pro",
      onPrompt: (prompt) => prompts.push(prompt),
      signal: options.signal ?? new AbortController().signal,
    },
  );

  return {
    result,
    scenario,
    secrets,
    storage,
    prompts,
    pendingDuringPoll: observed.pendingDuringPoll,
  };
}

describe("runDeviceAuthorization", () => {
  it("承認されたらトークンとブログ情報を返す", async () => {
    const { result, scenario, prompts } = await run({
      responses: [
        jsonResponse(201, authorizationResponse),
        jsonResponse(200, { status: "pending", interval: 5 }),
        jsonResponse(200, {
          status: "approved",
          token: "device-token-value",
          blog: { id: "blog-1", title: "ねこのブログ", subdomain: "neko" },
          device: { id: "device-1", name: "MacBook Pro" },
        }),
      ],
    });

    expect(result).toEqual({
      status: "approved",
      token: "device-token-value",
      blog: { id: "blog-1", title: "ねこのブログ", subdomain: "neko" },
      device: { id: "device-1", name: "MacBook Pro" },
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.userCode).toBe("K7QX-3M9T");
    expect(prompts[0]?.verificationUriComplete).toBe(authorizationResponse.verificationUriComplete);
    expect(prompts[0]?.expiresAt).toBe(600_000);
    expect(scenario.requests.map((request) => request.url)).toEqual([
      "https://api.example.test/v1/obsidian/device-authorizations",
      "https://api.example.test/v1/obsidian/device-authorizations/token",
      "https://api.example.test/v1/obsidian/device-authorizations/token",
    ]);
  });

  it("承認前はverifierとdevice codeをsecretStorageへ置き、終わったら消す", async () => {
    const { pendingDuringPoll, secrets, storage } = await run({
      responses: [
        jsonResponse(201, authorizationResponse),
        jsonResponse(200, {
          status: "approved",
          token: "device-token-value",
          blog: { id: "blog-1", title: "b", subdomain: "s" },
          device: { id: "device-1", name: "d" },
        }),
      ],
    });

    expect(pendingDuringPoll?.deviceCode).toBe("device-code-value");
    expect(pendingDuringPoll?.codeVerifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(secrets.getPendingAuthorization()).toBeNull();
    // 削除APIが無いので、消えた状態は「空文字が書かれている」で表される
    expect(storage.values.get("nekote-blog-code-verifier")).toBe("");
    expect(storage.values.get("nekote-blog-device-code")).toBe("");
    // 端末トークンの保存は呼び出し側（ConnectionService）の責務
    expect(secrets.getPushToken()).toBeNull();
  });

  it("slow_downで待ち時間を伸ばす", async () => {
    const { scenario } = await run({
      responses: [
        jsonResponse(201, authorizationResponse),
        jsonResponse(200, { status: "slow_down", interval: 5 }),
        jsonResponse(200, { status: "slow_down", interval: 5 }),
        jsonResponse(200, { status: "denied" }),
      ],
    });

    expect(scenario.sleeps).toEqual([5_000, 10_000, 15_000]);
  });

  it("pendingのintervalはサーバーの値に従い、壊れた値は下限へ倒す", async () => {
    const { scenario } = await run({
      responses: [
        jsonResponse(201, { ...authorizationResponse, interval: 9 }),
        jsonResponse(200, { status: "pending", interval: 3 }),
        jsonResponse(200, { status: "pending", interval: -1 }),
        jsonResponse(200, { status: "pending", interval: 9999 }),
        jsonResponse(200, { status: "denied" }),
      ],
    });

    expect(scenario.sleeps).toEqual([9_000, 3_000, 1_000, 60_000]);
  });

  it("拒否・期限切れをそのまま返す", async () => {
    const denied = await run({
      responses: [
        jsonResponse(201, authorizationResponse),
        jsonResponse(200, { status: "denied" }),
      ],
    });
    expect(denied.result).toEqual({ status: "denied" });
    expect(denied.secrets.getPendingAuthorization()).toBeNull();

    const expired = await run({
      responses: [
        jsonResponse(201, authorizationResponse),
        jsonResponse(200, { status: "expired" }),
      ],
    });
    expect(expired.result).toEqual({ status: "expired" });
  });

  it("ローカル時計で期限を過ぎたらpollせずに終わる", async () => {
    // now(): 期限計算 → prompt後の判定で期限超過
    const { result, scenario } = await run({
      responses: [jsonResponse(201, authorizationResponse)],
      times: [0, 600_001],
    });

    expect(result).toEqual({ status: "expired" });
    expect(scenario.requests).toHaveLength(1);
  });

  it("中止されたらpollせずcancelledで終わり、処理中のsecretを消す", async () => {
    const controller = new AbortController();
    controller.abort();

    const { result, scenario, secrets } = await run({
      responses: [jsonResponse(201, authorizationResponse)],
      signal: controller.signal,
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(scenario.requests).toHaveLength(1);
    expect(secrets.getPendingAuthorization()).toBeNull();
  });

  it("開始APIの応答を待つ間に中止したら承認ページを開かない", async () => {
    const controller = new AbortController();
    const storage = new FakeSecretStorage();
    const secrets = new SecretStore(storage);
    const requests: HttpRequest[] = [];
    const prompts: DeviceAuthorizationPrompt[] = [];
    const client = new NekoteApiClient({
      fetch: async (request) => {
        requests.push(request);
        // 応答が返る前に「中止」を押した状況
        controller.abort();
        return jsonResponse(201, authorizationResponse);
      },
      getBaseUrl: () => "https://api.example.test/v1/obsidian",
      getToken: () => null,
    });

    const result = await runDeviceAuthorization(
      { client, secrets, now: () => 0, sleep: async () => {} },
      {
        deviceName: "MacBook Pro",
        onPrompt: (prompt) => prompts.push(prompt),
        signal: controller.signal,
      },
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(prompts).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(secrets.getPendingAuthorization()).toBeNull();
  });

  it("通信に失敗しても処理中のsecretを残さない", async () => {
    const storage = new FakeSecretStorage();
    const secrets = new SecretStore(storage);
    const scenario = createScenario([
      jsonResponse(201, authorizationResponse),
      jsonResponse(500, { error: { code: "internal_error", message: "失敗しました。" } }),
    ]);

    await expect(
      runDeviceAuthorization(
        {
          client: createClient(scenario),
          secrets,
          now: () => 0,
          sleep: async () => {},
        },
        {
          deviceName: "MacBook Pro",
          onPrompt: () => {},
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow();

    expect(secrets.getPendingAuthorization()).toBeNull();
  });
});

describe("PKCE", () => {
  it("verifierとchallengeが契約のパターンに収まる", async () => {
    const verifier = createCodeVerifier();
    const challenge = await createCodeChallenge(verifier);

    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("challengeはverifierのsha256をbase64urlにしたもの", async () => {
    // RFC 7636 Appendix Bの既知ベクタ
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await createCodeChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("毎回異なるverifierを作る", () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier());
  });
});
