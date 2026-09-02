import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { NekoteApiClient } from "../src/api/client";
import type {
  AppliedManifestResponse,
  BlobUploadResponse,
  ConnectionResponse,
  ConnectionSource,
  PushBeginResponse,
  PushConfirmResponse,
  PushFinalizeResponse,
  PushState,
  PushStatusResponse,
  SyncManifest,
} from "../src/protocol/types";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/storage/plugin-data";
import { SecretStore } from "../src/storage/secrets";
import {
  publish,
  quoteContentRoot,
  type ConfirmRequest,
  type PublishDeps,
  type PublishReport,
} from "../src/sync/publish";
import type { VaultFileRef, VaultGateway } from "../src/vault/gateway";
import { extensionOf } from "../src/vault/paths";
import { FakeSecretStorage } from "./support/fake-secret-storage";
import {
  apiError,
  beginResponse as pushBeginResponse,
  enqueued,
  statusResponse as pushStatusResponse,
  take,
  MANIFEST_HASH,
  PUSH_ID,
  type BeginOverrides,
} from "./support/push-fixtures";

const VAULT_ID = "vault-8f3a2b1c9d0e";
const CREATED_VAULT_ID = "vault-created-0001";
/** `deps.now()`が返す固定時刻。`lastPush.syncedAt`の確認に使う */
const NOW = 1_700_000_000_000;

const OBSIDIAN_SOURCE: ConnectionSource = {
  kind: "obsidian",
  contentSourceId: "9a8b7c6d-5e4f-3021-8877-665544332211",
  vaultId: VAULT_ID,
  contentRoot: "blog",
  appliedRevision: 12,
  manifestHash: "8b1a9953c4611296a827abf8c47804d7f0d2e6a0f0b4c9d3e2f1a0b9c8d7e6f5",
};

// --- 偽のvault ---------------------------------------------------------------

interface FakeFile {
  path: string;
  /** 省略すると読み取り失敗（クラウド同期が終わっていないファイルの再現） */
  text?: string;
}

/** 部分反映用。対象ノートは参照アセットを1件持ち、もう1件のノートは載らない */
function notesWithAsset(): FakeFile[] {
  return [
    {
      path: "blog/posts/hello.md",
      text: "---\ntitle: こんにちは\nthumbnail: ../assets/cat.png\n---\n\n本文です。\n",
    },
    {
      path: "blog/posts/draft.md",
      text: "---\ntitle: 下書き\ndraft: true\n---\n\nまだ書きかけです。\n",
    },
    { path: "blog/assets/cat.png", text: "cat" },
  ];
}

/** コンテンツルート配下に公開対象のノートを2件だけ置いた小さなvault */
function notesUnder(contentRoot: string): FakeFile[] {
  const prefix = contentRoot === "" ? "" : `${contentRoot}/`;
  return [
    { path: `${prefix}posts/hello.md`, text: "---\ntitle: こんにちは\n---\n\n本文です。\n" },
    {
      path: `${prefix}posts/draft.md`,
      text: "---\ntitle: 下書き\ndraft: true\n---\n\nまだ書きかけです。\n",
    },
  ];
}

function createVault(files: readonly FakeFile[], calls: string[]): VaultGateway {
  const encoder = new TextEncoder();
  const byPath = new Map(files.map((file) => [file.path, file]));
  const refs: VaultFileRef[] = files.map((file) => ({
    path: file.path,
    vaultPath: file.path,
    extension: extensionOf(file.path),
    size: file.text === undefined ? 128 : encoder.encode(file.text).byteLength,
  }));

  return {
    listFiles: () => {
      calls.push("listFiles");
      return refs;
    },
    listFolderPaths: () => [],
    readText: async (file) => {
      calls.push(`readText:${file.path}`);
      const text = byPath.get(file.path)?.text;
      if (text === undefined) throw new Error(`読み取りに失敗しました: ${file.path}`);
      return text;
    },
    readBinary: async (file) => {
      calls.push(`readBinary:${file.path}`);
      const text = byPath.get(file.path)?.text;
      if (text === undefined) throw new Error(`読み取りに失敗しました: ${file.path}`);
      return encoder.encode(text).slice().buffer;
    },
    resolveLinkpath: () => null,
  };
}

// --- 応答の見本 ---------------------------------------------------------------

/** このvaultのノート2件が追加になる想定 */
function beginResponse(overrides: Partial<PushBeginResponse> = {}): PushBeginResponse {
  return pushBeginResponse({ preflight: { addedCount: 2, unchangedCount: 0 }, ...overrides });
}

/** 反映後の件数はpublishの結果表示に使うので常に載せる */
function statusResponse(
  state: PushState,
  overrides: Partial<PushStatusResponse> = {},
): PushStatusResponse {
  return pushStatusResponse(state, { counts: { published: 1, draft: 1 }, ...overrides });
}

/** 部分反映の応答。`mode`が送ったものと違うとプラグインは原本を送らずに中止する */
function partialBeginResponse(overrides: BeginOverrides = {}): PushBeginResponse {
  const { preflight, ...rest } = overrides;
  return pushBeginResponse({
    mode: "partial",
    preflight: {
      addedCount: 0,
      updatedCount: 1,
      deletedCount: 0,
      unchangedCount: 0,
      untouchedCount: 3,
      ...preflight,
    },
    ...rest,
  });
}

function partialStatusResponse(
  state: PushState,
  overrides: Partial<PushStatusResponse> = {},
): PushStatusResponse {
  return statusResponse(state, { mode: "partial", ...overrides });
}

function appliedManifest(
  overrides: Partial<AppliedManifestResponse> = {},
): AppliedManifestResponse {
  return {
    protocolVersion: 1,
    appliedRevision: 20,
    manifestHash: "0a1b2c3d4e5f60718293a4b5c6d7e8f900a1b2c3d4e5f60718293a4b5c6d7e8f",
    contentRoot: "blog",
    entries: [
      { path: "posts/hello.md", sha256: "server-side-hash-1", state: "published" },
      { path: "posts/gone.md", sha256: "server-side-hash-2", state: "published" },
    ],
    ...overrides,
  };
}

// --- ハーネス -----------------------------------------------------------------

interface PublishOptions {
  contentRoot?: string | null;
  vaultId?: string | null;
  lastPush?: PluginSettings["lastPush"];
  pendingPushId?: string;
  source?: ConnectionSource;
  applied?: AppliedManifestResponse;
  begin?: (PushBeginResponse | Error)[];
  finalize?: (PushFinalizeResponse | Error)[];
  status?: (PushStatusResponse | Error)[];
  files?: FakeFile[];
  /** 確認ダイアログの答え。既定はすべて承諾 */
  answer?: (request: ConfirmRequest) => boolean;
}

interface Harness {
  deps: PublishDeps;
  settings: PluginSettings;
  storage: FakeSecretStorage;
  secrets: SecretStore;
  /** APIクライアントの呼び出し順 */
  calls: string[];
  vaultCalls: string[];
  confirms: ConfirmRequest[];
  notices: string[];
  reports: PublishReport[];
  begins: SyncManifest[];
  patches: Partial<PluginSettings>[];
}

function createHarness(options: PublishOptions = {}): Harness {
  const settings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    contentRoot: options.contentRoot === undefined ? "blog" : options.contentRoot,
    vaultId: options.vaultId === undefined ? VAULT_ID : options.vaultId,
    lastPush: options.lastPush ?? null,
  };

  const storage = new FakeSecretStorage();
  const secrets = new SecretStore(storage);
  if (options.pendingPushId !== undefined) secrets.setPendingPushId(options.pendingPushId);
  // 事前に置いたpendingPushIdは前提であって、publishが書いたものではない
  storage.writes.length = 0;

  const calls: string[] = [];
  const vaultCalls: string[] = [];
  const confirms: ConfirmRequest[] = [];
  const notices: string[] = [];
  const reports: PublishReport[] = [];
  const begins: SyncManifest[] = [];
  const patches: Partial<PluginSettings>[] = [];

  const beginQueue = [...(options.begin ?? [beginResponse()])];
  const finalizeQueue = [...(options.finalize ?? [enqueued()])];
  const statusQueue = [...(options.status ?? [statusResponse("succeeded")])];

  const client = {
    getConnection: async (): Promise<ConnectionResponse> => {
      calls.push("getConnection");
      return {
        protocolVersion: 1,
        blog: { id: "blog-1", title: "ねこのブログ", subdomain: "neko" },
        device: { id: "device-1", name: "MacBook Pro" },
        source: options.source ?? OBSIDIAN_SOURCE,
      };
    },
    getAppliedManifest: async (): Promise<AppliedManifestResponse> => {
      calls.push("getAppliedManifest");
      return options.applied ?? appliedManifest();
    },
    beginPush: async (manifest: SyncManifest): Promise<PushBeginResponse> => {
      calls.push("beginPush");
      begins.push(manifest);
      return take(beginQueue, "beginPush");
    },
    confirmPush: async (input: {
      pushId: string;
      manifestHash: string;
    }): Promise<PushConfirmResponse> => {
      calls.push("confirmPush");
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
      return { sha256: input.sha256, bytes: input.bytes.byteLength, blobGen: 1, state: "live" };
    },
    finalizePush: async (): Promise<PushFinalizeResponse> => {
      calls.push("finalizePush");
      return take(finalizeQueue, "finalizePush");
    },
    getPushStatus: async (pushId: string): Promise<PushStatusResponse> => {
      calls.push(`getPushStatus:${pushId}`);
      return take(statusQueue, "getPushStatus");
    },
  };

  const deps: PublishDeps = {
    client: client as unknown as NekoteApiClient,
    secrets,
    vault: createVault(options.files ?? notesUnder("blog"), vaultCalls),
    parseYaml,
    ui: {
      confirm: async (request) => {
        confirms.push(request);
        return options.answer?.(request) ?? true;
      },
      progress: () => {},
      notice: (message) => notices.push(message),
      report: (report) => reports.push(report),
    },
    settings: () => settings,
    updateSettings: async (patch) => {
      patches.push(patch);
      Object.assign(settings, patch);
    },
    sleep: async () => {},
    now: () => NOW,
    newVaultId: () => CREATED_VAULT_ID,
    signal: new AbortController().signal,
  };

  return {
    deps,
    settings,
    storage,
    secrets,
    calls,
    vaultCalls,
    confirms,
    notices,
    reports,
    begins,
    patches,
  };
}

function titles(harness: Harness): string[] {
  return harness.confirms.map((request) => request.title);
}

/** 部分反映の記録済みrevision。サーバーの`appliedRevision`と一致している状態 */
const LAST_PUSH_AT_12: PluginSettings["lastPush"] = {
  revision: 12,
  manifestHash: "local-hash",
  syncedAt: "2026-08-31T00:00:00.000Z",
};

/** 部分反映の前提（vault ID一致・`appliedRevision >= 1`・`lastPush`あり）が揃ったvault */
function createPartialHarness(options: PublishOptions = {}): Harness {
  return createHarness({
    lastPush: LAST_PUSH_AT_12,
    files: notesWithAsset(),
    begin: [partialBeginResponse()],
    status: [partialStatusResponse("succeeded")],
    ...options,
  });
}

function publishNote(harness: Harness, vaultPath = "blog/posts/hello.md"): Promise<void> {
  return publish(harness.deps, { kind: "note", vaultPath });
}

describe("publish: 前提の確認", () => {
  it("コンテンツルートが未選択なら通知だけで何も送らない", async () => {
    const harness = createHarness({ contentRoot: null });

    await publish(harness.deps, { kind: "all" });

    expect(harness.notices).toEqual(["Select a content root in the plugin settings first."]);
    expect(harness.calls).toEqual([]);
    expect(harness.vaultCalls).toEqual([]);
  });
});

describe("publish: vault IDの突き合わせ", () => {
  it("サーバーが未接続でローカルにvault IDが無ければ新しく作って保存する", async () => {
    const harness = createHarness({ source: { kind: "none" }, vaultId: null });

    await publish(harness.deps, { kind: "all" });

    expect(harness.settings.vaultId).toBe(CREATED_VAULT_ID);
    expect(titles(harness)).toEqual(["Publish to Nekote Blog"]);
    expect(harness.begins[0]?.vaultId).toBe(CREATED_VAULT_ID);
    // 初回接続なのでbaseRevisionは0から始まる
    expect(harness.begins[0]?.baseRevision).toBe(0);
  });

  it("サーバーがObsidian接続済みでローカルにvault IDが無ければ、確認してから保存する", async () => {
    const harness = createHarness({ vaultId: null });

    await publish(harness.deps, { kind: "all" });

    expect(titles(harness)).toEqual([
      "Treat this as the connected vault?",
      "Publish to Nekote Blog",
    ]);
    expect(harness.settings.vaultId).toBe(VAULT_ID);
    expect(harness.begins[0]?.vaultId).toBe(VAULT_ID);
  });

  it("その確認を断ると何も送らず、vault IDも保存しない", async () => {
    const harness = createHarness({ vaultId: null, answer: () => false });

    await publish(harness.deps, { kind: "all" });

    expect(harness.settings.vaultId).toBeNull();
    expect(harness.calls).toEqual(["getConnection"]);
    expect(harness.vaultCalls).toEqual([]);
  });

  it("サーバーと違うvault IDを持っているときは、置き換えの確認を出す", async () => {
    const harness = createHarness({ vaultId: "vault-local-0001" });

    await publish(harness.deps, { kind: "all" });

    expect(titles(harness)).toEqual(["This is not the connected vault", "Publish to Nekote Blog"]);
    expect(harness.confirms[0]?.danger).toBe(true);
    // 承諾してもローカルのvault IDのまま送る（サーバー側が初回接続として作り直す）
    expect(harness.settings.vaultId).toBe("vault-local-0001");
    expect(harness.begins[0]?.vaultId).toBe("vault-local-0001");
  });

  it("置き換えの確認を断ると何も送らない", async () => {
    const harness = createHarness({ vaultId: "vault-local-0001", answer: () => false });

    await publish(harness.deps, { kind: "all" });

    expect(harness.settings.vaultId).toBe("vault-local-0001");
    expect(harness.calls).toEqual(["getConnection"]);
    expect(harness.vaultCalls).toEqual([]);
  });
});

describe("publish: コンテンツルートとrevisionの確認", () => {
  it("サーバーのコンテンツルートと違うときは確認を出し、断ると何も送らない", async () => {
    const harness = createHarness({
      contentRoot: "notes",
      files: notesUnder("notes"),
      answer: () => false,
    });

    await publish(harness.deps, { kind: "all" });

    expect(titles(harness)).toEqual(["Change the content root"]);
    expect(harness.calls).toEqual(["getConnection"]);
    expect(harness.reports).toEqual([]);
  });

  it("ローカルの記録とサーバーのrevisionが違うときは、差分を見せて確認する", async () => {
    const harness = createHarness({
      lastPush: { revision: 11, manifestHash: "local-hash", syncedAt: "2026-08-31T00:00:00.000Z" },
      answer: () => false,
    });

    await publish(harness.deps, { kind: "all" });

    expect(harness.calls).toEqual(["getConnection", "getAppliedManifest"]);
    expect(titles(harness)).toEqual(["Published from another device"]);
    expect(harness.confirms[0]?.sections).toEqual([
      { title: "Added 1 file", items: ["posts/draft.md"] },
      { title: "Updated 1 file", items: ["posts/hello.md"] },
      { title: "Deleted 1 file", items: ["posts/gone.md"] },
    ]);
  });

  it("revisionが一致していれば確認せずに送る", async () => {
    const harness = createHarness({
      lastPush: { revision: 12, manifestHash: "local-hash", syncedAt: "2026-08-31T00:00:00.000Z" },
    });

    await publish(harness.deps, { kind: "all" });

    expect(titles(harness)).toEqual(["Publish to Nekote Blog"]);
    expect(harness.calls).not.toContain("getAppliedManifest");
  });
});

describe("publish: 反映前の確認", () => {
  it("送信の直前に必ず確認を出し、断ると何も送らない", async () => {
    const harness = createHarness({
      answer: (request) => request.title !== "Publish to Nekote Blog",
    });

    await publish(harness.deps, { kind: "all" });

    expect(titles(harness)).toEqual(["Publish to Nekote Blog"]);
    expect(harness.calls).toEqual(["getConnection"]);
    expect(harness.reports).toEqual([]);
  });

  it("反映先のブログを最初に見せる", async () => {
    const harness = createHarness();

    await publish(harness.deps, { kind: "all" });

    expect(harness.confirms[0]?.paragraphs[0]).toBe(
      "Publishing to: ねこのブログ (neko.nekote.blog)",
    );
  });

  it("サーバーが確認を求めたときも反映先のブログを見せる", async () => {
    const harness = createHarness({ begin: [beginResponse({ confirmationRequired: true })] });

    await publish(harness.deps, { kind: "all" });

    const preflight = harness.confirms[1];
    expect(preflight?.title).toBe("Review what will be published");
    expect(preflight?.paragraphs[0]).toBe("Publishing to: ねこのブログ (neko.nekote.blog)");
  });
});

describe("publish: revision_conflict", () => {
  it("承諾したときだけサーバーの最新revisionをbaseにして送り直す", async () => {
    const harness = createHarness({ begin: [apiError("revision_conflict"), beginResponse()] });

    await publish(harness.deps, { kind: "all" });

    expect(titles(harness)).toEqual([
      "Publish to Nekote Blog",
      "Another publish was applied first",
    ]);
    expect(harness.begins.map((manifest) => manifest.baseRevision)).toEqual([12, 20]);
    expect(harness.reports[0]?.outcome).toBe("applied");
  });

  it("断ると何も適用せず、取り消しとして知らせる", async () => {
    const harness = createHarness({
      begin: [apiError("revision_conflict")],
      // 反映前の確認は通し、conflictの確認だけ断る
      answer: (request) => request.title === "Publish to Nekote Blog",
    });

    await publish(harness.deps, { kind: "all" });

    expect(harness.notices).toEqual(["Publish cancelled."]);
    expect(harness.calls).not.toContain("finalizePush");
    expect(harness.settings.lastPush).toBeNull();
  });
});

describe("publish: 反映の結果", () => {
  it("成功するとlastPushを保存し、pendingPushIdを消す", async () => {
    const harness = createHarness();

    await publish(harness.deps, { kind: "all" });

    expect(harness.settings.lastPush).toEqual({
      revision: 13,
      manifestHash: MANIFEST_HASH,
      syncedAt: new Date(NOW).toISOString(),
    });
    expect(harness.secrets.getPendingPushId()).toBeNull();
    // 送信前にpushIdを控え、適用が確定してから消す
    expect(harness.storage.writes.map((write) => write.secret)).toEqual([PUSH_ID, ""]);
    expect(harness.reports[0]).toMatchObject({
      outcome: "applied",
      headline: "Published (revision 13)",
    });
  });

  it("失敗するとlastPushを更新しない", async () => {
    const harness = createHarness({ status: [statusResponse("failed")] });

    await publish(harness.deps, { kind: "all" });

    expect(harness.settings.lastPush).toBeNull();
    expect(harness.patches.some((patch) => "lastPush" in patch)).toBe(false);
    expect(harness.reports[0]).toMatchObject({
      outcome: "failed",
      headline: "Could not publish",
    });
  });
});

describe("publish: 中断したPushの再開", () => {
  it("終端していればその結果を見せて、走査しない", async () => {
    const harness = createHarness({
      pendingPushId: "push-previous",
      status: [statusResponse("succeeded")],
    });

    await publish(harness.deps, { kind: "all" });

    expect(harness.calls).toEqual(["getPushStatus:push-previous"]);
    expect(harness.vaultCalls).toEqual([]);
    expect(harness.reports[0]?.outcome).toBe("applied");
  });

  it("まだ終端していなければpendingPushIdを捨てて、走査からやり直す", async () => {
    const harness = createHarness({
      pendingPushId: "push-previous",
      status: [statusResponse("verifying"), statusResponse("succeeded")],
    });

    await publish(harness.deps, { kind: "all" });

    expect(harness.calls).toEqual([
      "getPushStatus:push-previous",
      "getConnection",
      "beginPush",
      "confirmPush",
      "finalizePush",
      `getPushStatus:${PUSH_ID}`,
    ]);
    expect(harness.vaultCalls).toContain("listFiles");
  });
});

describe("publish: 失敗の見せ方", () => {
  it("走査が中止されたら内容をreportで見せて、何も送らない", async () => {
    const harness = createHarness({
      files: [{ path: "blog/posts/hello.md" }, ...notesUnder("blog").slice(1)],
    });

    await publish(harness.deps, { kind: "all" });

    expect(harness.calls).toEqual(["getConnection"]);
    expect(harness.reports[0]).toMatchObject({
      outcome: "failed",
      headline: "Publish stopped",
    });
    expect(harness.reports[0]?.paragraphs[0]).toContain("Could not read this file");
  });

  it("push_in_progressは分かりやすい通知にする", async () => {
    const harness = createHarness({ begin: [apiError("push_in_progress")] });

    await publish(harness.deps, { kind: "all" });

    expect(harness.notices).toEqual([
      "The previous publish is still being processed on the server. Even right after you " +
        "cancel, it stays in progress for a short while. Wait a moment and run it again.",
    ]);
    expect(harness.reports).toEqual([]);
  });
});

describe("publish: このノートだけ反映（前提の確認）", () => {
  const cases: { name: string; options: PublishOptions }[] = [
    { name: "ソースが未接続", options: { source: { kind: "none" } } },
    { name: "別のソースが接続されている", options: { source: { kind: "other", type: "notion" } } },
    { name: "vault IDがローカルに無い", options: { vaultId: null } },
    { name: "vault IDがサーバーと違う", options: { vaultId: "vault-local-0001" } },
    {
      name: "サーバーがまだ1度も反映していない",
      options: { source: { ...OBSIDIAN_SOURCE, appliedRevision: 0 } },
    },
    { name: "plugin dataに全量反映の成功記録が無い", options: { lastPush: null } },
  ];

  for (const { name, options } of cases) {
    it(`${name}なら走査もbeginもせず、先に全体を反映するよう促す`, async () => {
      const harness = createPartialHarness(options);

      await publishNote(harness);

      expect(harness.notices).toEqual([
        "Nekote Blog: Publish the whole vault once before you publish a single note.",
      ]);
      expect(harness.calls).toEqual(["getConnection"]);
      expect(harness.vaultCalls).toEqual([]);
      // vault IDの作成・置き換えの確認は部分反映では出さない
      expect(harness.confirms).toEqual([]);
      expect(harness.patches).toEqual([]);
    });
  }

  it("コンテンツルートがサーバーと違うなら、確認を出さずに全体反映へ誘導する", async () => {
    const harness = createPartialHarness({ source: { ...OBSIDIAN_SOURCE, contentRoot: "notes" } });

    await publishNote(harness);

    expect(harness.notices).toEqual([
      "Nekote Blog: The content root has changed. Run Publish to publish everything first.",
    ]);
    expect(harness.calls).toEqual(["getConnection"]);
    expect(harness.vaultCalls).toEqual([]);
    expect(harness.confirms).toEqual([]);
  });
});

describe("publish: このノートだけ反映", () => {
  it("対象ノートとその参照アセットだけをmode partialで送る", async () => {
    const harness = createPartialHarness();

    await publishNote(harness);

    expect(harness.begins[0]?.mode).toBe("partial");
    expect(harness.begins[0]?.entries.map((entry) => entry.path)).toEqual([
      "blog/assets/cat.png",
      "posts/hello.md",
    ]);
    expect(harness.begins[0]?.baseRevision).toBe(12);
    expect(harness.vaultCalls).not.toContain("readText:blog/posts/draft.md");
  });

  it("送信前の確認に反映先・対象ノート・他の記事への影響を出す", async () => {
    const harness = createPartialHarness();

    await publishNote(harness);

    expect(harness.confirms[0]).toMatchObject({
      title: "Publish this note",
      confirmLabel: "Publish this note",
    });
    expect(harness.confirms[0]?.paragraphs).toEqual([
      "Publishing to: ねこのブログ (neko.nekote.blog)",
      'Publishing only "こんにちは" (posts/hello.md) and 1 referenced asset.',
      "Other posts are left as they are. Moves, renames and deletions are not applied by this " +
        "action. Run Publish for those.",
    ]);
  });

  it("下書きのノートなら非公開になることを添える", async () => {
    const harness = createPartialHarness();

    await publishNote(harness, "blog/posts/draft.md");

    expect(harness.confirms[0]?.paragraphs[2]).toBe(
      "This note is a draft, so it stays unpublished on your blog.",
    );
  });

  it("送信前の確認を断ると何も送らない", async () => {
    const harness = createPartialHarness({ answer: () => false });

    await publishNote(harness);

    expect(titles(harness)).toEqual(["Publish this note"]);
    expect(harness.calls).toEqual(["getConnection"]);
    expect(harness.reports).toEqual([]);
  });

  it("公開対象でないノートを指すと走査で止まる", async () => {
    const harness = createPartialHarness();

    await publishNote(harness, "blog/assets/cat.png");

    expect(harness.calls).toEqual(["getConnection"]);
    expect(harness.reports[0]).toMatchObject({ outcome: "failed", headline: "Publish stopped" });
    expect(harness.reports[0]?.paragraphs[0]).toBe(
      "This note is not one of the notes that get published: blog/assets/cat.png",
    );
  });

  it("サーバーが確認を求めたら、削除を含まない件数を出す", async () => {
    const harness = createPartialHarness({
      begin: [partialBeginResponse({ confirmationRequired: true })],
    });

    await publishNote(harness);

    expect(harness.confirms[1]?.paragraphs).toContain(
      "Posts: 0 added / 1 updated / 0 unchanged / 3 untouched",
    );
  });

  it("成功すると部分反映の見出しと他の記事の件数を出し、lastPushを更新する", async () => {
    const harness = createPartialHarness();

    await publishNote(harness);

    expect(harness.reports[0]).toMatchObject({
      outcome: "applied",
      headline: "This note was published (revision 13)",
    });
    expect(harness.reports[0]?.paragraphs[0]).toBe("The other 3 posts are unchanged.");
    expect(harness.settings.lastPush).toEqual({
      revision: 13,
      manifestHash: MANIFEST_HASH,
      syncedAt: new Date(NOW).toISOString(),
    });
  });

  it("サーバーがmodeを返さなければ、原本を送らずpushIdも記録せずに中止する", async () => {
    const harness = createPartialHarness({ begin: [beginResponse()] });

    await publishNote(harness);

    expect(harness.calls).toEqual(["getConnection", "beginPush"]);
    expect(harness.secrets.getPendingPushId()).toBeNull();
    expect(harness.reports[0]).toMatchObject({ outcome: "failed", headline: "Publish stopped" });
    expect(harness.reports[0]?.paragraphs[0]).toBe(
      "The server could not confirm the publish mode, so nothing was sent. Update the plugin, " +
        "or run Publish to publish everything.",
    );
  });

  it("サーバーが部分反映を受け付けないときは専用の通知にする", async () => {
    const harness = createPartialHarness({ begin: [apiError("partial_push_not_allowed")] });

    await publishNote(harness);

    expect(harness.notices).toEqual([
      "Nekote Blog: You cannot publish a single note right now. Run Publish to publish everything.",
    ]);
    expect(harness.reports).toEqual([]);
  });
});

describe("publish: このノートだけ反映と他端末の反映", () => {
  /** 他の端末がrev 13まで進めている（ローカルの記録は12） */
  const AHEAD_SOURCE: ConnectionSource = { ...OBSIDIAN_SOURCE, appliedRevision: 13 };

  it("削除の一覧を出さない確認をしてから送り、成功してもlastPushは据え置く", async () => {
    const harness = createPartialHarness({ source: AHEAD_SOURCE });

    await publishNote(harness);

    expect(titles(harness)).toEqual(["Published from another device", "Publish this note"]);
    expect(harness.confirms[0]?.sections).toBeUndefined();
    expect(harness.confirms[0]?.confirmLabel).toBe("Publish this note");
    // 差分一覧を作らないので適用済みmanifestは読まない
    expect(harness.calls).not.toContain("getAppliedManifest");
    expect(harness.begins[0]?.baseRevision).toBe(13);
    expect(harness.reports[0]?.outcome).toBe("applied");
    expect(harness.settings.lastPush).toEqual(LAST_PUSH_AT_12);
    expect(harness.patches.some((patch) => "lastPush" in patch)).toBe(false);
  });

  it("その確認を断ると何も送らない", async () => {
    const harness = createPartialHarness({ source: AHEAD_SOURCE, answer: () => false });

    await publishNote(harness);

    expect(titles(harness)).toEqual(["Published from another device"]);
    expect(harness.calls).toEqual(["getConnection"]);
  });

  it("送信中に他の反映が適用されたら、削除の一覧なしで再送を確認しlastPushを据え置く", async () => {
    const harness = createPartialHarness({
      begin: [apiError("revision_conflict"), partialBeginResponse()],
    });

    await publishNote(harness);

    expect(titles(harness)).toEqual(["Publish this note", "Another publish was applied first"]);
    expect(harness.confirms[1]?.sections).toBeUndefined();
    expect(harness.begins.map((manifest) => manifest.baseRevision)).toEqual([12, 20]);
    expect(harness.reports[0]?.outcome).toBe("applied");
    expect(harness.settings.lastPush).toEqual(LAST_PUSH_AT_12);
  });

  it("再開した部分反映は部分の見出しで見せ、lastPushを更新しない", async () => {
    const harness = createHarness({
      pendingPushId: "push-previous",
      lastPush: LAST_PUSH_AT_12,
      status: [partialStatusResponse("succeeded")],
    });

    await publish(harness.deps, { kind: "all" });

    expect(harness.calls).toEqual(["getPushStatus:push-previous"]);
    expect(harness.reports[0]?.headline).toBe("This note was published (revision 13)");
    // begin応答が無いので「他N件はそのまま」は出せない
    expect(harness.reports[0]?.paragraphs).toEqual(["published: 1 / draft: 1"]);
    expect(harness.settings.lastPush).toEqual(LAST_PUSH_AT_12);
  });
});

describe("quoteContentRoot()", () => {
  it("実pathは引用符で囲む", () => {
    expect(quoteContentRoot("blog")).toBe('"blog"');
  });

  it("vaultルートはラベルをそのまま出す（二重に括らない）", () => {
    expect(quoteContentRoot("")).toBe("(vault root)");
  });
});
