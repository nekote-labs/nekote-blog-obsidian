// vendorした契約（`protocol/v1/`）とTypeScript実装の食い違いを落とす契約テスト。
//
// 契約の正本は非公開リポジトリ`nekote-labs/nekote-blog`の`protocol/obsidian/v1/`で、
// このリポジトリはそのコピーを持つ。コピーがずれてもコードは動いてしまうため、
// ここで内容hashと構造を突き合わせる。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

import { computeProtocolContentHash } from "../src/protocol/content-hash";
import {
  API_ERROR_STATUS,
  NekoteApiError,
  isApiErrorCode,
  parseApiErrorBody,
} from "../src/protocol/errors";
import type { ApiErrorCode } from "../src/protocol/errors";
import { PROTOCOL_MAJOR } from "../src/protocol/limits";
import { isSupportedProtocolMajor } from "../src/protocol/version";
import type {
  AppliedManifestResponse,
  BlobUploadResponse,
  ConnectionResponse,
  DeviceAuthorizationRequest,
  DeviceAuthorizationResponse,
  DeviceTokenRequest,
  DeviceTokenResponse,
  PushBeginResponse,
  PushConfirmRequest,
  PushConfirmResponse,
  PushFinalizeRequest,
  PushFinalizeResponse,
  PushStatusResponse,
  SyncManifest,
} from "../src/protocol/types";

/** cwdに依存させないため、このテストファイルの位置から契約ディレクトリを解決する */
const protocolDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../protocol/v1");

/** 再vendorを促すための共通の後置き。テスト名に付けて失敗時の手当てを示す */
const REVENDOR_HINT =
  "ずれたら正本 nekote-blog の protocol/obsidian/v1/ から protocol/v1/ へ再vendorすること";

interface ProtocolManifest {
  protocolVersion: number;
  contentHash: string;
  files: string[];
}

interface OpenApiDocument {
  info: { "x-protocol-version": number };
  components: {
    schemas: {
      ErrorCode: {
        enum: string[];
        "x-http-status": Record<string, number>;
      };
    };
  };
}

function readContractFile(name: string): string {
  return readFileSync(path.join(protocolDir, name), "utf8");
}

function readFixture<T>(name: string): T {
  return JSON.parse(readContractFile(`fixtures/${name}`)) as T;
}

/** hash対象のファイル名一覧（`protocol.json`自身とREADMEは含まない） */
function listContractFileNames(): string[] {
  const fixtures = readdirSync(path.join(protocolDir, "fixtures"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => `fixtures/${name}`);
  return ["openapi.yaml", ...fixtures].sort();
}

const protocolManifest = JSON.parse(readContractFile("protocol.json")) as ProtocolManifest;
const openapi = parseYaml(readContractFile("openapi.yaml")) as OpenApiDocument;

describe("protocol majorの一致", () => {
  it("protocol.json・openapi.yaml・PROTOCOL_MAJORが同じmajorを指す", () => {
    expect(protocolManifest.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(openapi.info["x-protocol-version"]).toBe(PROTOCOL_MAJOR);
  });

  it("isSupportedProtocolMajorは現在majorだけを受け入れる", () => {
    expect(isSupportedProtocolMajor(PROTOCOL_MAJOR)).toBe(true);
    expect(isSupportedProtocolMajor(PROTOCOL_MAJOR + 1)).toBe(false);
    expect(isSupportedProtocolMajor(String(PROTOCOL_MAJOR))).toBe(false);
    expect(isSupportedProtocolMajor(undefined)).toBe(false);
  });
});

describe("vendorした契約の内容hash", () => {
  it(`protocol.jsonのfilesが実ファイルの一覧と一致する（${REVENDOR_HINT}）`, () => {
    // filesの並び順はhashに影響しない（computeProtocolContentHashがname順に整列する）
    expect([...protocolManifest.files].sort()).toEqual(listContractFileNames());
  });

  it(`protocol.jsonのcontentHashが実ファイルの内容と一致する（${REVENDOR_HINT}）`, async () => {
    const files = listContractFileNames().map((name) => ({ name, text: readContractFile(name) }));
    await expect(computeProtocolContentHash(files)).resolves.toBe(protocolManifest.contentHash);
  });
});

describe("エラーコード表の一致", () => {
  const errorCodeSchema = openapi.components.schemas.ErrorCode;

  it("openapi.yamlのErrorCode.enumとAPI_ERROR_STATUSのキーが一致する", () => {
    expect([...errorCodeSchema.enum].sort()).toEqual(Object.keys(API_ERROR_STATUS).sort());
  });

  it("openapi.yamlのx-http-statusとAPI_ERROR_STATUSが等しい", () => {
    expect(errorCodeSchema["x-http-status"]).toEqual({ ...API_ERROR_STATUS });
  });

  it("isApiErrorCodeは契約上の全コードを受け入れる", () => {
    for (const code of errorCodeSchema.enum) {
      expect(isApiErrorCode(code)).toBe(true);
    }
  });

  it("isApiErrorCodeは未知の文字列と非文字列を拒否する", () => {
    expect(isApiErrorCode("unknown_code")).toBe(false);
    expect(isApiErrorCode("")).toBe(false);
    expect(isApiErrorCode("push_completed")).toBe(false);
    // Object.prototypeのキーを既知コード扱いしない
    expect(isApiErrorCode("toString")).toBe(false);
    expect(isApiErrorCode("constructor")).toBe(false);
    expect(isApiErrorCode(undefined)).toBe(false);
    expect(isApiErrorCode(null)).toBe(false);
    expect(isApiErrorCode(401)).toBe(false);
    expect(isApiErrorCode({ code: "unauthorized" })).toBe(false);
  });
});

describe("fixtureがTypeScriptの型として解釈できる", () => {
  it("device-authorization-response.jsonがDeviceAuthorizationResponseとして読める", () => {
    const response = readFixture<DeviceAuthorizationResponse>("device-authorization-response.json");
    expect(response.deviceCode).toBe("d4M0Yb0Qw6a1c1n2Rf8sT0hJ7cWc9lQ2xYtG3mZaV1o");
    expect(response.userCode).toBe("K7QX-3M9T");
    expect(response.verificationUri).toBe("https://dash.nekote.blog/obsidian/authorize");
    expect(response.verificationUriComplete).toContain(response.userCode);
    expect(response.expiresIn).toBe(600);
    expect(response.interval).toBe(5);
  });

  it("device-token-response.pending.jsonがintervalを持つ", () => {
    const response = readFixture<DeviceTokenResponse>("device-token-response.pending.json");
    if (response.status !== "pending") throw new Error(`statusが${response.status}`);
    expect(response.interval).toBe(5);
  });

  it("device-token-response.expired.jsonはstatusだけを持つ", () => {
    const response = readFixture<DeviceTokenResponse>("device-token-response.expired.json");
    expect(response.status).toBe("expired");
    expect(Object.keys(response)).toEqual(["status"]);
  });

  it("device-token-response.approved.jsonだけがtoken・blog・deviceを持つ", () => {
    const response = readFixture<DeviceTokenResponse>("device-token-response.approved.json");
    if (response.status !== "approved") throw new Error(`statusが${response.status}`);
    expect(response.token).toBe("Zq3Yh1pR8vN0sKcW7mTfLxB2dGaJ6uE4oQiH5nVrPyU");
    expect(response.blog.id).toBe("7f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8");
    expect(response.blog.title).toBe("ねこのブログ");
    expect(response.blog.subdomain).toBe("neko");
    expect(response.device.id).toBe("1c2d3e4f-5061-7283-94a5-b6c7d8e9f001");
    expect(response.device.name).toBe("MacBook Pro");

    const pending = readFixture<DeviceTokenResponse>("device-token-response.pending.json");
    expect(pending).not.toHaveProperty("token");
  });

  it("connection-response.obsidian.jsonがobsidianソースとして読める", () => {
    const response = readFixture<ConnectionResponse>("connection-response.obsidian.json");
    expect(response.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(response.blog.subdomain).toBe("neko");
    expect(response.device.name).toBe("MacBook Pro");
    if (response.source.kind !== "obsidian") throw new Error(`kindが${response.source.kind}`);
    expect(response.source.contentSourceId).toBe("9a8b7c6d-5e4f-3021-8877-665544332211");
    expect(response.source.vaultId).toBe("vault-8f3a2b1c9d0e");
    expect(response.source.contentRoot).toBe("blog");
    expect(response.source.appliedRevision).toBe(12);
    expect(response.source.manifestHash).toBe(
      "8b1a9953c4611296a827abf8c47804d7f0d2e6a0f0b4c9d3e2f1a0b9c8d7e6f5",
    );
  });

  it("connection-response.other-source.jsonは種別だけで内容を返さない", () => {
    const response = readFixture<ConnectionResponse>("connection-response.other-source.json");
    if (response.source.kind !== "other") throw new Error(`kindが${response.source.kind}`);
    expect(response.source.type).toBe("notion");
    expect(response.source).not.toHaveProperty("vaultId");
    expect(response.source).not.toHaveProperty("contentRoot");
  });

  it("push-begin-response.jsonがPushBeginResponseとして読める", () => {
    const response = readFixture<PushBeginResponse>("push-begin-response.json");
    expect(response.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(response.pushId).toBe("018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f");
    expect(response.state).toBe("preflight");
    expect(response.baseRevision).toBe(12);
    expect(response.appliedRevision).toBe(12);
    expect(response.manifestHash).toBe(
      "5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
    expect(response.mode).toBe("full");
    expect(response.preflight).toEqual({
      addedCount: 1,
      updatedCount: 1,
      deletedCount: 0,
      unchangedCount: 8,
      untouchedCount: 0,
      missingBlobCount: 2,
      missingBlobBytes: 21504,
      initialConnect: false,
      confirmationReasons: [],
    });
    expect(response.missingBlobs).toHaveLength(2);
    expect(response.missingBlobs[0]?.kind).toBe("markdown");
    expect(response.missingBlobs[0]?.bytes).toBe(1024);
    expect(response.missingBlobs[1]?.kind).toBe("asset");
    expect(response.missingBlobs[1]?.sha256).toBe(
      "3b1f5c9d2e8a47c60b5d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d",
    );
    expect(response.confirmationRequired).toBe(false);
    expect(response.expiresAt).toBe("2026-08-31T00:30:00.000Z");
  });

  it("push-confirm-response.jsonがPushConfirmResponseとして読める", () => {
    const response = readFixture<PushConfirmResponse>("push-confirm-response.json");
    expect(response.pushId).toBe("018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f");
    expect(response.state).toBe("confirmed");
    expect(response.reservedBlobCount).toBe(2);
    expect(response.reservedBlobBytes).toBe(21504);
    expect(response.expiresAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("blob-upload-response.jsonがBlobUploadResponseとして読める", () => {
    const response = readFixture<BlobUploadResponse>("blob-upload-response.json");
    expect(response.sha256).toBe(
      "3b1f5c9d2e8a47c60b5d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d",
    );
    expect(response.bytes).toBe(20480);
    expect(response.blobGen).toBe(1);
    expect(response.state).toBe("live");
  });

  it("push-finalize-response.accepted.jsonがjobIdとtargetRevisionを持つ", () => {
    const response = readFixture<PushFinalizeResponse>("push-finalize-response.accepted.json");
    if (response.state !== "enqueued") throw new Error(`stateが${response.state}`);
    expect(response.pushId).toBe("018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f");
    expect(response.jobId).toBe("018f2c34-5a6b-7c8d-9e0f-2b3c4d5e6f70");
    expect(response.targetRevision).toBe(13);
  });

  it("push-finalize-response.verifying.jsonが完備確認の進捗を持つ", () => {
    const response = readFixture<PushFinalizeResponse>("push-finalize-response.verifying.json");
    if (response.state !== "verifying") throw new Error(`stateが${response.state}`);
    expect(response.pushId).toBe("018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f");
    expect(response.verification).toEqual({
      cursor: 500,
      verifiedEntryCount: 500,
      entryCount: 1200,
      retryAfter: 30,
    });
    expect(response).not.toHaveProperty("jobId");
  });

  it("push-status-response.jsonがPushStatusResponseとして読める", () => {
    const response = readFixture<PushStatusResponse>("push-status-response.json");
    expect(response.pushId).toBe("018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f");
    expect(response.state).toBe("verifying");
    expect(response.mode).toBe("full");
    expect(response.baseRevision).toBe(12);
    // 完了前はtargetRevisionがnullで返る
    expect(response.targetRevision).toBeNull();
    expect(response.appliedRevision).toBe(12);
    expect(response.manifestHash).toBe(
      "5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
    expect(response.verification?.entryCount).toBe(1200);
    expect(response.verification?.retryAfter).toBe(30);
    expect(response.expiresAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("applied-manifest-response.jsonがAppliedManifestResponseとして読める", () => {
    const response = readFixture<AppliedManifestResponse>("applied-manifest-response.json");
    expect(response.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(response.appliedRevision).toBe(12);
    expect(response.manifestHash).toBe(
      "5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
    expect(response.contentRoot).toBe("blog");
    expect(response.entries).toHaveLength(2);
    expect(response.entries[0]?.path).toBe("pages/about.md");
    expect(response.entries[0]?.state).toBe("published");
    expect(response.entries[1]?.path).toBe("posts/はじめての記事.md");
    expect(response.entries[1]?.state).toBe("unpublished");
  });

  it("sync-manifest.valid.jsonがSyncManifestとして読める", () => {
    const manifest = readFixture<SyncManifest>("sync-manifest.valid.json");
    expect(manifest.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(manifest.vaultId).toBe("vault-8f3a2b1c9d0e");
    expect(manifest.contentRoot).toBe("blog");
    expect(manifest.baseRevision).toBe(12);
    expect(manifest.entries.map((entry) => entry.path)).toEqual([
      "assets/images/cat.png",
      "pages/about.md",
      "posts/はじめての記事.md",
    ]);
    expect(manifest.entries.map((entry) => entry.kind)).toEqual(["asset", "markdown", "markdown"]);
    // アセットは参照情報を持たず、Markdownだけが持つ
    expect(manifest.entries[0]?.assetPaths).toBeUndefined();
    expect(manifest.entries[2]?.bytes).toBe(1024);
    expect(manifest.entries[2]?.assetPaths).toEqual(["assets/images/cat.png"]);
    expect(manifest.entries[2]?.linkedArticlePaths).toEqual(["pages/about.md"]);
    // 全量反映はmodeを省略する（省略時fullの契約）
    expect(manifest.mode).toBeUndefined();
  });

  it("sync-manifest.partial.jsonが部分反映のSyncManifestとして読める", () => {
    const manifest = readFixture<SyncManifest>("sync-manifest.partial.json");
    expect(manifest.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(manifest.vaultId).toBe("vault-8f3a2b1c9d0e");
    expect(manifest.contentRoot).toBe("blog");
    expect(manifest.baseRevision).toBe(12);
    expect(manifest.mode).toBe("partial");
    // 部分反映は対象ノートと参照アセットだけを載せる
    expect(manifest.entries.map((entry) => entry.path)).toEqual([
      "assets/images/cat.png",
      "posts/はじめての記事.md",
    ]);
    expect(manifest.entries[1]?.assetPaths).toEqual(["assets/images/cat.png"]);
    expect(manifest.entries[1]?.linkedArticlePaths).toEqual(["pages/about.md"]);
  });

  it("device-authorization-request.valid.jsonがDeviceAuthorizationRequestとして読める", () => {
    const request = readFixture<DeviceAuthorizationRequest>(
      "device-authorization-request.valid.json",
    );
    expect(request.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(request.deviceName).toBe("MacBook Pro");
    expect(request.codeChallenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(request.codeChallengeMethod).toBe("S256");
  });

  it("device-token-request.valid.jsonがDeviceTokenRequestとして読める", () => {
    const request = readFixture<DeviceTokenRequest>("device-token-request.valid.json");
    expect(request.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(request.deviceCode).toBe("d4M0Yb0Qw6a1c1n2Rf8sT0hJ7cWc9lQ2xYtG3mZaV1o");
    expect(request.codeVerifier).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  });

  it("push-confirm-request.jsonがPushConfirmRequestとして読める", () => {
    const request = readFixture<PushConfirmRequest>("push-confirm-request.json");
    expect(request.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(request.manifestHash).toBe(
      "5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
  });

  it("push-finalize-request.jsonがPushFinalizeRequestとして読める", () => {
    const request = readFixture<PushFinalizeRequest>("push-finalize-request.json");
    expect(request.protocolVersion).toBe(PROTOCOL_MAJOR);
    expect(request.manifestHash).toBe(
      "5d41402abc4b2a76b9719d911017c592a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
    expect(request.baseRevision).toBe(12);
  });
});

describe("エラーfixtureの解釈", () => {
  it("error.unauthorized.jsonからcodeとmessageが取れる", () => {
    const parsed = parseApiErrorBody(readFixture<unknown>("error.unauthorized.json"));
    expect(parsed.code).toBe("unauthorized");
    expect(parsed.message).toBe("接続が無効です。Obsidianの設定画面から接続し直してください。");
    expect(parsed.details).toBeUndefined();
  });

  it("error.protocol-version-unsupported.jsonからdetailsが取れる", () => {
    const parsed = parseApiErrorBody(
      readFixture<unknown>("error.protocol-version-unsupported.json"),
    );
    expect(parsed.code).toBe("protocol_version_unsupported");
    expect(parsed.message).toBe(
      "このバージョンのプラグインには対応していません。プラグインを更新してください。",
    );
    expect(parsed.details).toEqual({ supportedProtocolVersion: PROTOCOL_MAJOR });
  });

  it("error.blobs-incomplete.jsonから不足blobのsha256が取れる", () => {
    const parsed = parseApiErrorBody(readFixture<unknown>("error.blobs-incomplete.json"));
    expect(parsed.code).toBe("blobs_incomplete");
    expect(parsed.message).toBe("ファイルの送信が完了していません。不足分を送信し直してください。");
    expect(parsed.details).toEqual({
      missing: ["3b1f5c9d2e8a47c60b5d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d"],
    });
  });

  it("error.partial-push-not-allowed.jsonからcodeと理由が取れる", () => {
    const parsed = parseApiErrorBody(readFixture<unknown>("error.partial-push-not-allowed.json"));
    expect(parsed.code).toBe("partial_push_not_allowed");
    expect(parsed.message).toBe(
      "この状態では部分反映を実行できません。全体反映を実行してください。",
    );
    expect(parsed.details).toEqual({ reason: "no_applied_revision" });
  });

  it("壊れたbodyでも例外を投げずcodeがnullになる", () => {
    for (const body of [null, {}, { error: "x" }, { error: { code: "unknown_code" } }]) {
      const parsed = parseApiErrorBody(body);
      expect(parsed.code).toBeNull();
    }
    expect(parseApiErrorBody({ error: { code: "unknown_code", message: "" } }).message).toBeNull();
    expect(
      parseApiErrorBody({ error: { code: "unauthorized", details: [] } }).details,
    ).toBeUndefined();
  });
});

describe("NekoteApiErrorの判定", () => {
  function errorOf(code: ApiErrorCode): NekoteApiError {
    return new NekoteApiError({ code, status: API_ERROR_STATUS[code], message: "テスト" });
  }

  it("isUnauthorizedはunauthorizedだけで真になる", () => {
    expect(errorOf("unauthorized").isUnauthorized).toBe(true);
    expect(errorOf("blog_forbidden").isUnauthorized).toBe(false);
    expect(errorOf("internal_error").isUnauthorized).toBe(false);
  });

  it("isProtocolUnsupportedはprotocol_version_unsupportedだけで真になる", () => {
    expect(errorOf("protocol_version_unsupported").isProtocolUnsupported).toBe(true);
    expect(errorOf("invalid_request").isProtocolUnsupported).toBe(false);
  });

  it("再試行してよいコードだけがisRetryableになる", () => {
    const retryableCodes = new Set<ApiErrorCode>([
      "rate_limited",
      "sync_run_active",
      "internal_error",
    ]);
    for (const code of Object.keys(API_ERROR_STATUS) as ApiErrorCode[]) {
      expect([code, errorOf(code).isRetryable]).toEqual([code, retryableCodes.has(code)]);
    }
    expect(errorOf("revision_conflict").isRetryable).toBe(false);
    expect(errorOf("invalid_manifest").isRetryable).toBe(false);
    expect(errorOf("push_in_progress").isRetryable).toBe(false);
  });

  it("statusが0（通信失敗）と500以上はcodeが無くてもisRetryableになる", () => {
    const network = new NekoteApiError({ code: null, status: 0, message: "接続できない" });
    expect(network.isRetryable).toBe(true);
    const serverError = new NekoteApiError({ code: null, status: 503, message: "利用できない" });
    expect(serverError.isRetryable).toBe(true);
    const clientError = new NekoteApiError({ code: null, status: 400, message: "不正" });
    expect(clientError.isRetryable).toBe(false);
  });

  it("retryAfterSecondsとdetailsを保持する", () => {
    const error = new NekoteApiError({
      code: "rate_limited",
      status: API_ERROR_STATUS.rate_limited,
      message: "混み合っています",
      details: { scope: "push" },
      retryAfterSeconds: 30,
    });
    expect(error.name).toBe("NekoteApiError");
    expect(error.message).toBe("混み合っています");
    expect(error.status).toBe(429);
    expect(error.details).toEqual({ scope: "push" });
    expect(error.retryAfterSeconds).toBe(30);
  });
});
