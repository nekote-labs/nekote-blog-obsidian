import { describe, expect, it } from "vitest";
import { NekoteApiClient } from "../src/api/client";
import type { HttpFetch, HttpRequest, HttpResponse } from "../src/api/http";
import { ConnectionService } from "../src/connection/connection-service";
import { parsePluginSettings, type ConnectionHint } from "../src/storage/plugin-data";
import { SecretStore, type SecretStorageLike } from "../src/storage/secrets";

class FakeSecretStorage implements SecretStorageLike {
  readonly values = new Map<string, string>();

  getSecret(id: string): string | null {
    return this.values.get(id) ?? null;
  }

  setSecret(id: string, secret: string): void {
    this.values.set(id, secret);
  }
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, headers: {}, text: JSON.stringify(body) };
}

interface Harness {
  service: ConnectionService;
  secrets: SecretStore;
  requests: HttpRequest[];
  savedHints: (ConnectionHint | null)[];
}

function createHarness(options: { responses: (HttpResponse | Error)[]; token?: string }): Harness {
  const storage = new FakeSecretStorage();
  const secrets = new SecretStore(storage);
  if (options.token !== undefined) secrets.setPushToken(options.token);

  const requests: HttpRequest[] = [];
  const savedHints: (ConnectionHint | null)[] = [];
  const responses = [...options.responses];

  const fetch: HttpFetch = async (request) => {
    requests.push(request);
    const next = responses.shift();
    if (next === undefined) throw new Error("想定より多くリクエストが飛んだ");
    if (next instanceof Error) throw next;
    return next;
  };

  const client = new NekoteApiClient({
    fetch,
    getBaseUrl: () => "https://api.example.test/v1/obsidian",
    getToken: () => secrets.getPushToken(),
  });

  const service = new ConnectionService({
    client,
    secrets,
    now: () => 0,
    sleep: async () => {},
    saveConnectionHint: async (hint) => {
      savedHints.push(hint);
    },
  });

  return { service, secrets, requests, savedHints };
}

const authorizationResponse = {
  deviceCode: "device-code-value",
  userCode: "K7QX-3M9T",
  verificationUri: "https://dash.example.test/obsidian/authorize",
  verificationUriComplete: "https://dash.example.test/obsidian/authorize?code=K7QX-3M9T",
  expiresIn: 600,
  interval: 5,
};

const approved = {
  status: "approved",
  token: "device-token-value",
  blog: { id: "blog-1", title: "ねこのブログ", subdomain: "neko" },
  device: { id: "device-1", name: "MacBook Pro" },
};

async function connect(harness: Harness) {
  return harness.service.connect({
    deviceName: "MacBook Pro",
    onPrompt: () => {},
    signal: new AbortController().signal,
  });
}

describe("ConnectionService", () => {
  it("承認されたらトークンを保存し、接続先を表示用に記録する", async () => {
    const harness = createHarness({
      responses: [jsonResponse(201, authorizationResponse), jsonResponse(200, approved)],
    });

    const result = await connect(harness);

    expect(result.status).toBe("approved");
    expect(harness.secrets.getPushToken()).toBe("device-token-value");
    expect(harness.savedHints).toEqual([{ blog: approved.blog, device: approved.device }]);
    expect(harness.service.isConnected()).toBe(true);
  });

  it("承認されなければトークンも接続先も書かない", async () => {
    const harness = createHarness({
      responses: [
        jsonResponse(201, authorizationResponse),
        jsonResponse(200, { status: "denied" }),
      ],
    });

    const result = await connect(harness);

    expect(result.status).toBe("denied");
    expect(harness.secrets.getPushToken()).toBeNull();
    expect(harness.savedHints).toEqual([]);
    expect(harness.service.isConnected()).toBe(false);
  });

  it("接続状態の取得で表示用の接続先を更新する", async () => {
    const connection = {
      protocolVersion: 1,
      blog: approved.blog,
      device: approved.device,
      source: { kind: "other", type: "notion" },
    };
    const harness = createHarness({
      responses: [jsonResponse(200, connection)],
      token: "device-token-value",
    });

    const result = await harness.service.fetchConnection();

    expect(result.source).toEqual({ kind: "other", type: "notion" });
    expect(harness.requests[0]?.headers?.Authorization).toBe("Bearer device-token-value");
    expect(harness.savedHints).toEqual([{ blog: approved.blog, device: approved.device }]);
  });

  it("接続解除はサーバー失効に成功したらローカルの秘密を全部消す", async () => {
    const harness = createHarness({
      responses: [{ status: 204, headers: {}, text: "" }],
      token: "device-token-value",
    });
    harness.secrets.setPendingPushId("push-1");

    const result = await harness.service.disconnect();

    expect(result).toEqual({ revokedOnServer: true, reason: null });
    expect(harness.requests[0]?.method).toBe("DELETE");
    expect(harness.secrets.getPushToken()).toBeNull();
    expect(harness.secrets.getPendingPushId()).toBeNull();
    expect(harness.savedHints).toEqual([null]);
  });

  it("すでに失効済み（401）なら失効成功として扱う", async () => {
    const harness = createHarness({
      responses: [
        jsonResponse(401, { error: { code: "unauthorized", message: "接続が無効です。" } }),
      ],
      token: "device-token-value",
    });

    const result = await harness.service.disconnect();

    expect(result.revokedOnServer).toBe(true);
    expect(harness.secrets.getPushToken()).toBeNull();
  });

  it("サーバー失効に失敗してもローカルは消し、ダッシュボードでの失効が必要だと返す", async () => {
    const harness = createHarness({
      responses: [new Error("network down")],
      token: "device-token-value",
    });

    const result = await harness.service.disconnect();

    expect(result.revokedOnServer).toBe(false);
    expect(result.reason).not.toBeNull();
    // 失効できなかった理由に、通信先URLや例外の生メッセージを混ぜない
    expect(result.reason).not.toContain("network down");
    expect(result.reason).not.toContain("api.example.test");
    expect(harness.secrets.getPushToken()).toBeNull();
    expect(harness.savedHints).toEqual([null]);
  });

  it("plugin dataが別端末へ同期されても、接続済みにはならず端末認可を要求する", async () => {
    // 別端末で保存された`data.json`相当。secretStorageは同期されないので秘密は入らない
    const synced = parsePluginSettings({
      apiEnvironment: "production",
      connection: { blog: approved.blog, device: approved.device },
    });
    expect(synced.connection).not.toBeNull();

    const harness = createHarness({ responses: [] });

    expect(harness.service.isConnected()).toBe(false);
    expect(harness.secrets.getPendingPushId()).toBeNull();
    // トークンが無いのでサーバーへ問い合わせる前にunauthorizedになる
    await expect(harness.service.fetchConnection()).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    expect(harness.requests).toEqual([]);
  });
});
