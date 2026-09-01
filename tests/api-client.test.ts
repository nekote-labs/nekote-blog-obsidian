import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NekoteApiClient } from "../src/api/client";
import { API_BASE_URLS, apiBaseUrl, isApiEnvironment } from "../src/api/endpoints";
import { headerValue, type HttpFetch, type HttpRequest, type HttpResponse } from "../src/api/http";
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
} from "../src/protocol/types";
import { catchApiError } from "./support/api";

const BASE_URL = "https://api.example.test/v1/obsidian";
const TOKEN = "device-token-Zq3Yh1pR8vN0sKcW";

/** vendorした契約のfixtureを応答の見本に使う（実サーバーの形と揃える） */
function fixture<T>(name: string): T {
  const file = fileURLToPath(new URL(`../protocol/v1/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

interface StubResponse {
  status: number;
  headers?: Record<string, string>;
  text?: string;
}

function ok(body: unknown, headers?: Record<string, string>): StubResponse {
  return { status: 200, headers, text: JSON.stringify(body) };
}

interface Harness {
  client: NekoteApiClient;
  requests: HttpRequest[];
}

function setup(
  responses: StubResponse[],
  options: { token?: string | null; baseUrl?: () => string } = {},
): Harness {
  const queue = [...responses];
  const requests: HttpRequest[] = [];
  const fetch: HttpFetch = async (request) => {
    requests.push(request);
    const next = queue.shift();
    if (next === undefined) throw new Error("想定していないリクエストが発行されました。");
    const response: HttpResponse = {
      status: next.status,
      headers: next.headers ?? {},
      text: next.text ?? "",
    };
    return response;
  };
  const token = options.token === undefined ? TOKEN : options.token;
  const client = new NekoteApiClient({
    fetch,
    getBaseUrl: options.baseUrl ?? (() => BASE_URL),
    getToken: () => token,
  });
  return { client, requests };
}

function setupThrowingFetch(error: unknown): Harness {
  const requests: HttpRequest[] = [];
  const fetch: HttpFetch = async (request) => {
    requests.push(request);
    throw error;
  };
  const client = new NekoteApiClient({
    fetch,
    getBaseUrl: () => BASE_URL,
    getToken: () => TOKEN,
  });
  return { client, requests };
}

function bodyText(request: HttpRequest): string {
  if (request.body === undefined) return "";
  if (typeof request.body === "string") return request.body;
  return new TextDecoder().decode(request.body);
}

function requestOf(harness: Harness): HttpRequest {
  const request = harness.requests[0];
  if (request === undefined) throw new Error("リクエストが発行されていません。");
  return request;
}

function bytesOf(values: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(values.length);
  new Uint8Array(buffer).set(values);
  return buffer;
}

const connectionResponse = fixture<ConnectionResponse>("connection-response.obsidian.json");
const deviceAuthorizationResponse = fixture<DeviceAuthorizationResponse>(
  "device-authorization-response.json",
);
const approvedTokenResponse = fixture<DeviceTokenResponse>("device-token-response.approved.json");
const syncManifest = fixture<SyncManifest>("sync-manifest.valid.json");
const pushBeginResponse = fixture<PushBeginResponse>("push-begin-response.json");
const pushConfirmResponse = fixture<PushConfirmResponse>("push-confirm-response.json");
const blobUploadResponse = fixture<BlobUploadResponse>("blob-upload-response.json");
const finalizeAcceptedResponse = fixture<PushFinalizeResponse>(
  "push-finalize-response.accepted.json",
);
const finalizeVerifyingResponse = fixture<PushFinalizeResponse>(
  "push-finalize-response.verifying.json",
);
const pushStatusResponse = fixture<PushStatusResponse>("push-status-response.json");
const appliedManifestResponse = fixture<AppliedManifestResponse>("applied-manifest-response.json");

/** bearerが要る経路を同じ形で回すための一覧 */
const bearerCalls: {
  name: string;
  response: StubResponse;
  run: (c: NekoteApiClient) => Promise<unknown>;
}[] = [
  {
    name: "getConnection",
    response: ok(connectionResponse),
    run: (c) => c.getConnection(),
  },
  { name: "revokeDevice", response: { status: 204 }, run: (c) => c.revokeDevice() },
  { name: "beginPush", response: ok(pushBeginResponse), run: (c) => c.beginPush(syncManifest) },
  {
    name: "confirmPush",
    response: ok(pushConfirmResponse),
    run: (c) => c.confirmPush({ pushId: "p1", manifestHash: "h1" }),
  },
  {
    name: "uploadBlob",
    response: ok(blobUploadResponse),
    run: (c) => c.uploadBlob({ pushId: "p1", sha256: "s1", bytes: bytesOf([1, 2]) }),
  },
  {
    name: "finalizePush",
    response: ok(finalizeAcceptedResponse),
    run: (c) => c.finalizePush({ pushId: "p1", manifestHash: "h1", baseRevision: 12 }),
  },
  {
    name: "getPushStatus",
    response: ok(pushStatusResponse),
    run: (c) => c.getPushStatus("p1"),
  },
  {
    name: "getAppliedManifest",
    response: ok(appliedManifestResponse),
    run: (c) => c.getAppliedManifest(),
  },
];

describe("NekoteApiClient: URLとメソッド", () => {
  it("各メソッドが契約どおりのpath・HTTP methodを叩く", async () => {
    const { client, requests } = setup([
      ok(deviceAuthorizationResponse),
      ok({ status: "pending", interval: 5 }),
      ok(connectionResponse),
      { status: 204 },
      ok(pushBeginResponse),
      ok(pushConfirmResponse),
      ok(blobUploadResponse),
      ok(finalizeAcceptedResponse),
      ok(pushStatusResponse),
      ok(appliedManifestResponse),
    ]);

    await client.startDeviceAuthorization({ deviceName: "MacBook Pro", codeChallenge: "chal" });
    await client.pollDeviceToken({ deviceCode: "dev", codeVerifier: "ver" });
    await client.getConnection();
    await client.revokeDevice();
    await client.beginPush(syncManifest);
    await client.confirmPush({ pushId: "push-1", manifestHash: "hash-1" });
    await client.uploadBlob({ pushId: "push-1", sha256: "abc", bytes: bytesOf([1]) });
    await client.finalizePush({ pushId: "push-1", manifestHash: "hash-1", baseRevision: 12 });
    await client.getPushStatus("push-1");
    await client.getAppliedManifest();

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST ${BASE_URL}/device-authorizations`,
      `POST ${BASE_URL}/device-authorizations/token`,
      `GET ${BASE_URL}/connection`,
      `DELETE ${BASE_URL}/connection/device`,
      `POST ${BASE_URL}/pushes`,
      `POST ${BASE_URL}/pushes/push-1/confirm`,
      `PUT ${BASE_URL}/pushes/push-1/blobs/abc`,
      `POST ${BASE_URL}/pushes/push-1/finalize`,
      `GET ${BASE_URL}/pushes/push-1`,
      `GET ${BASE_URL}/manifest`,
    ]);
  });

  it("getBaseUrl()の戻り値がリクエストごとに前置される", async () => {
    let base: string = API_BASE_URLS.production;
    const { client, requests } = setup([ok(connectionResponse), ok(connectionResponse)], {
      baseUrl: () => base,
    });

    await client.getConnection();
    base = API_BASE_URLS.staging;
    await client.getConnection();

    expect(requests.map((request) => request.url)).toEqual([
      `${API_BASE_URLS.production}/connection`,
      `${API_BASE_URLS.staging}/connection`,
    ]);
  });

  it("pushIdとsha256はencodeURIComponentしてpathへ入れる", async () => {
    const { client, requests } = setup([
      ok(pushConfirmResponse),
      ok(blobUploadResponse),
      ok(finalizeAcceptedResponse),
      ok(pushStatusResponse),
    ]);
    const pushId = "a/b 猫";

    await client.confirmPush({ pushId, manifestHash: "hash-1" });
    await client.uploadBlob({ pushId, sha256: "../secret", bytes: bytesOf([1]) });
    await client.finalizePush({ pushId, manifestHash: "hash-1", baseRevision: 1 });
    await client.getPushStatus(pushId);

    expect(requests.map((request) => request.url)).toEqual([
      `${BASE_URL}/pushes/a%2Fb%20%E7%8C%AB/confirm`,
      `${BASE_URL}/pushes/a%2Fb%20%E7%8C%AB/blobs/..%2Fsecret`,
      `${BASE_URL}/pushes/a%2Fb%20%E7%8C%AB/finalize`,
      `${BASE_URL}/pushes/a%2Fb%20%E7%8C%AB`,
    ]);
  });
});

describe("NekoteApiClient: 認証", () => {
  it.each(bearerCalls)(
    "$name はAuthorizationヘッダーにトークンを載せる",
    async ({ response, run }) => {
      const harness = setup([response]);

      await run(harness.client);

      const request = requestOf(harness);
      expect(request.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    },
  );

  it.each(bearerCalls)("$name はトークンをURL・bodyへ入れない", async ({ response, run }) => {
    const harness = setup([response]);

    await run(harness.client);

    const request = requestOf(harness);
    expect(request.url).not.toContain(TOKEN);
    expect(bodyText(request)).not.toContain(TOKEN);
  });

  it.each(bearerCalls)(
    "$name はトークンがnullならfetchせずunauthorizedを投げる",
    async ({ run }) => {
      const harness = setup([], { token: null });

      const error = await catchApiError(() => run(harness.client));

      expect(error.code).toBe("unauthorized");
      expect(error.status).toBe(401);
      expect(error.isUnauthorized).toBe(true);
      expect(harness.requests).toEqual([]);
    },
  );

  it.each(bearerCalls)(
    "$name はトークンが空文字ならfetchせずunauthorizedを投げる",
    async ({ run }) => {
      const harness = setup([], { token: "" });

      const error = await catchApiError(() => run(harness.client));

      expect(error.code).toBe("unauthorized");
      expect(error.status).toBe(401);
      expect(harness.requests).toEqual([]);
    },
  );

  it("未認証経路はトークンがあってもAuthorizationヘッダーを付けない", async () => {
    const { client, requests } = setup([
      ok(deviceAuthorizationResponse),
      ok({ status: "pending", interval: 5 }),
    ]);

    await client.startDeviceAuthorization({ deviceName: "MacBook Pro", codeChallenge: "chal" });
    await client.pollDeviceToken({ deviceCode: "dev", codeVerifier: "ver" });

    for (const request of requests) {
      expect(request.headers?.Authorization).toBeUndefined();
      expect(Object.values(request.headers ?? {})).not.toContain(`Bearer ${TOKEN}`);
      expect(request.url).not.toContain(TOKEN);
      expect(bodyText(request)).not.toContain(TOKEN);
    }
  });
});

describe("NekoteApiClient: リクエストbody", () => {
  it("startDeviceAuthorizationは契約どおりのJSONを送る", async () => {
    const harness = setup([ok(deviceAuthorizationResponse)]);

    await harness.client.startDeviceAuthorization({
      deviceName: "MacBook Pro",
      codeChallenge: "0RRVNr7L2sxYIcXvJ7RZ1RhVMKxTn5t6q9uGZ6mPfXo",
    });

    const request = requestOf(harness);
    expect(request.contentType).toBe("application/json");
    expect(JSON.parse(bodyText(request))).toEqual({
      protocolVersion: 1,
      deviceName: "MacBook Pro",
      codeChallenge: "0RRVNr7L2sxYIcXvJ7RZ1RhVMKxTn5t6q9uGZ6mPfXo",
      codeChallengeMethod: "S256",
    });
  });

  it("uploadBlobはArrayBufferをそのままbodyに載せる", async () => {
    const harness = setup([ok(blobUploadResponse)]);
    const bytes = bytesOf([0, 1, 2, 250]);

    await harness.client.uploadBlob({ pushId: "push-1", sha256: "abc", bytes });

    const request = requestOf(harness);
    expect(request.contentType).toBe("application/octet-stream");
    expect(request.body).toBe(bytes);
  });
});

describe("NekoteApiClient: エラー応答", () => {
  it("エラーbodyからcode・status・message・detailsを取る", async () => {
    const body = fixture<unknown>("error.blobs-incomplete.json");
    const harness = setup([{ status: 400, text: JSON.stringify(body) }]);

    const error = await catchApiError(() =>
      harness.client.finalizePush({ pushId: "push-1", manifestHash: "h", baseRevision: 1 }),
    );

    expect(error.code).toBe("blobs_incomplete");
    expect(error.status).toBe(400);
    expect(error.message).toBe("ファイルの送信が完了していません。不足分を送信し直してください。");
    expect(error.details).toEqual({
      missing: ["3b1f5c9d2e8a47c60b5d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d"],
    });
  });

  it.each(["Retry-After", "retry-after", "RETRY-AFTER"])(
    "%s ヘッダーがretryAfterSecondsに入る",
    async (name) => {
      const harness = setup([
        {
          status: 429,
          headers: { [name]: "30" },
          text: JSON.stringify({ error: { code: "rate_limited", message: "混み合っています。" } }),
        },
      ]);

      const error = await catchApiError(() => harness.client.getConnection());

      expect(error.code).toBe("rate_limited");
      expect(error.retryAfterSeconds).toBe(30);
      expect(error.isRetryable).toBe(true);
    },
  );

  it("Retry-Afterが無ければretryAfterSecondsはundefined", async () => {
    const harness = setup([
      { status: 429, text: JSON.stringify({ error: { code: "rate_limited", message: "混雑" } }) },
    ]);

    const error = await catchApiError(() => harness.client.getConnection());

    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("エラー形式でないbody（HTML）でもNekoteApiErrorになる", async () => {
    const harness = setup([{ status: 502, text: "<html><body>Bad Gateway</body></html>" }]);

    const error = await catchApiError(() => harness.client.getConnection());

    expect(error.code).toBeNull();
    expect(error.status).toBe(502);
    expect(error.message).toContain("502");
  });

  it("空bodyのエラー応答でもNekoteApiErrorになる", async () => {
    const harness = setup([{ status: 500, text: "" }]);

    const error = await catchApiError(() => harness.client.getConnection());

    expect(error.code).toBeNull();
    expect(error.status).toBe(500);
    expect(error.message).toContain("500");
  });

  it("未知のエラーcodeはnullとして扱い、messageはサーバーの文言を使う", async () => {
    const harness = setup([
      {
        status: 400,
        text: JSON.stringify({ error: { code: "who_knows", message: "未知のエラーです。" } }),
      },
    ]);

    const error = await catchApiError(() => harness.client.getConnection());

    expect(error.code).toBeNull();
    expect(error.message).toBe("未知のエラーです。");
  });
});

describe("NekoteApiClient: 成功応答の異常", () => {
  it("200でbodyが空ならstatus 0のNekoteApiErrorになる", async () => {
    const harness = setup([{ status: 200, text: "" }]);

    const error = await catchApiError(() => harness.client.getConnection());

    expect(error.status).toBe(0);
    expect(error.code).toBeNull();
  });

  it("200でJSONが壊れていればstatus 0のNekoteApiErrorになる", async () => {
    const harness = setup([{ status: 200, text: '{"protocolVersion": 1,' }]);

    const error = await catchApiError(() => harness.client.getConnection());

    expect(error.status).toBe(0);
    expect(error.code).toBeNull();
  });
});

describe("NekoteApiClient: 通信失敗", () => {
  it("fetchがthrowしたらstatus 0になり、元の例外メッセージを出さない", async () => {
    const raw = `connect ECONNREFUSED ${BASE_URL}/connection?token=${TOKEN}`;
    const harness = setupThrowingFetch(new Error(raw));

    const error = await catchApiError(() => harness.client.getConnection());

    expect(error.status).toBe(0);
    expect(error.code).toBeNull();
    expect(error.message).not.toContain(raw);
    expect(error.message).not.toContain("ECONNREFUSED");
    expect(error.message).not.toContain(BASE_URL);
    expect(error.message).not.toContain(TOKEN);
    expect(error.isRetryable).toBe(true);
  });
});

describe("NekoteApiClient: protocol majorの検証", () => {
  const protocolCalls: {
    name: string;
    body: Record<string, unknown>;
    run: (c: NekoteApiClient) => Promise<unknown>;
  }[] = [
    {
      name: "getConnection",
      body: connectionResponse as unknown as Record<string, unknown>,
      run: (c) => c.getConnection(),
    },
    {
      name: "beginPush",
      body: pushBeginResponse as unknown as Record<string, unknown>,
      run: (c) => c.beginPush(syncManifest),
    },
    {
      name: "getAppliedManifest",
      body: appliedManifestResponse as unknown as Record<string, unknown>,
      run: (c) => c.getAppliedManifest(),
    },
  ];

  it.each(protocolCalls)("$name はprotocolVersion 2を426で拒否する", async ({ body, run }) => {
    const harness = setup([ok({ ...body, protocolVersion: 2 })]);

    const error = await catchApiError(() => run(harness.client));

    expect(error.code).toBe("protocol_version_unsupported");
    expect(error.status).toBe(426);
    expect(error.isProtocolUnsupported).toBe(true);
  });

  it.each(protocolCalls)("$name はprotocolVersion 1を受け入れる", async ({ body, run }) => {
    const harness = setup([ok({ ...body, protocolVersion: 1 })]);

    await expect(run(harness.client)).resolves.toBeDefined();
  });
});

describe("NekoteApiClient: finalizePush", () => {
  it("202は成功として扱い、verifyingの進捗をそのまま返す", async () => {
    const harness = setup([{ status: 202, text: JSON.stringify(finalizeVerifyingResponse) }]);

    const result = await harness.client.finalizePush({
      pushId: "push-1",
      manifestHash: "hash-1",
      baseRevision: 12,
    });

    expect(result).toEqual(finalizeVerifyingResponse);
    expect(result.state).toBe("verifying");
  });

  it("200のenqueuedをそのまま返す", async () => {
    const harness = setup([ok(finalizeAcceptedResponse)]);

    const result = await harness.client.finalizePush({
      pushId: "push-1",
      manifestHash: "hash-1",
      baseRevision: 12,
    });

    expect(result).toEqual(finalizeAcceptedResponse);
    expect(result.state).toBe("enqueued");
  });
});

describe("NekoteApiClient: pollDeviceToken", () => {
  const responses: DeviceTokenResponse[] = [
    { status: "pending", interval: 5 },
    { status: "slow_down", interval: 10 },
    { status: "denied" },
    { status: "expired" },
    approvedTokenResponse,
  ];

  it.each(responses)("status $status は例外にならず返る", async (response) => {
    const harness = setup([ok(response)]);

    await expect(
      harness.client.pollDeviceToken({ deviceCode: "d", codeVerifier: "v" }),
    ).resolves.toEqual(response);
  });

  it("未知のstatusはstatus 0のNekoteApiErrorになる", async () => {
    const harness = setup([ok({ status: "unknown_state" })]);

    const error = await catchApiError(() =>
      harness.client.pollDeviceToken({ deviceCode: "d", codeVerifier: "v" }),
    );

    expect(error.status).toBe(0);
    expect(error.code).toBeNull();
  });
});

describe("NekoteApiClient: revokeDevice", () => {
  it("204で空bodyでも例外にならない", async () => {
    const harness = setup([{ status: 204, text: "" }]);

    await expect(harness.client.revokeDevice()).resolves.toBeUndefined();
  });
});

describe("headerValue()", () => {
  it("大文字小文字を無視して取れる", () => {
    const headers = { "Retry-After": "30", "content-type": "application/json" };

    expect(headerValue(headers, "retry-after")).toBe("30");
    expect(headerValue(headers, "RETRY-AFTER")).toBe("30");
    expect(headerValue(headers, "Content-Type")).toBe("application/json");
  });

  it("無いヘッダーはundefined", () => {
    expect(headerValue({ "Retry-After": "30" }, "Location")).toBeUndefined();
    expect(headerValue({}, "Retry-After")).toBeUndefined();
  });
});

describe("isApiEnvironment() / apiBaseUrl()", () => {
  it("productionとstagingだけを通す", () => {
    expect(isApiEnvironment("production")).toBe(true);
    expect(isApiEnvironment("staging")).toBe(true);
  });

  it.each([
    "https://evil.example/v1/obsidian",
    API_BASE_URLS.production,
    "Production",
    "",
    "local",
    1,
    null,
    undefined,
    { environment: "production" },
  ])("任意の値 %o は通さない", (value) => {
    expect(isApiEnvironment(value)).toBe(false);
  });

  it("環境名から契約どおりのbase URLを返す", () => {
    expect(apiBaseUrl("production")).toBe("https://api.nekote.blog/v1/obsidian");
    expect(apiBaseUrl("staging")).toBe("https://staging-api.nekote.blog/v1/obsidian");
    expect(apiBaseUrl("production").endsWith("/")).toBe(false);
  });
});
