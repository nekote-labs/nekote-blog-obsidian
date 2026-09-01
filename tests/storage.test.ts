import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  parsePluginSettings,
  serializePluginSettings,
  type PluginSettings,
} from "../src/storage/plugin-data";
import { SecretStore, type SecretStorageLike } from "../src/storage/secrets";

/** `App.secretStorage`の代役。削除APIが無い点まで合わせる（消すのは空文字の書き込み） */
class FakeSecretStorage implements SecretStorageLike {
  readonly entries = new Map<string, string>();

  getSecret(id: string): string | null {
    return this.entries.get(id) ?? null;
  }

  setSecret(id: string, secret: string): void {
    this.entries.set(id, secret);
  }
}

function setup(): { storage: FakeSecretStorage; store: SecretStore } {
  const storage = new FakeSecretStorage();
  return { storage, store: new SecretStore(storage) };
}

function keyOf(storage: FakeSecretStorage, value: string): string {
  for (const [key, stored] of storage.entries) {
    if (stored === value) return key;
  }
  throw new Error(`値 ${value} が書き込まれていません。`);
}

describe("SecretStore: 端末トークン", () => {
  it("書いた値をそのまま読める", () => {
    const { store } = setup();

    store.setPushToken("token-abc");

    expect(store.getPushToken()).toBe("token-abc");
  });

  it("未設定ならnull", () => {
    const { store } = setup();

    expect(store.getPushToken()).toBeNull();
  });

  it("clearPushToken()のあとはnullになり、ストレージには空文字が残る", () => {
    const { storage, store } = setup();
    store.setPushToken("token-abc");
    const id = keyOf(storage, "token-abc");

    store.clearPushToken();

    expect(store.getPushToken()).toBeNull();
    expect(storage.entries.get(id)).toBe("");
  });

  it("外部から空文字が入っていてもnullとして扱う", () => {
    const { storage, store } = setup();
    store.setPushToken("token-abc");
    storage.setSecret(keyOf(storage, "token-abc"), "");

    expect(store.getPushToken()).toBeNull();
  });
});

describe("SecretStore: 端末認可の途中経過", () => {
  it("codeVerifierとdeviceCodeを往復できる", () => {
    const { store } = setup();

    store.setPendingAuthorization({ codeVerifier: "verifier-1", deviceCode: "device-1" });

    expect(store.getPendingAuthorization()).toEqual({
      codeVerifier: "verifier-1",
      deviceCode: "device-1",
    });
  });

  it("未設定ならnull", () => {
    const { store } = setup();

    expect(store.getPendingAuthorization()).toBeNull();
  });

  it("clearPendingAuthorization()のあとはnullになり、両方が空文字になる", () => {
    const { storage, store } = setup();
    store.setPendingAuthorization({ codeVerifier: "verifier-1", deviceCode: "device-1" });
    const verifierId = keyOf(storage, "verifier-1");
    const deviceCodeId = keyOf(storage, "device-1");

    store.clearPendingAuthorization();

    expect(store.getPendingAuthorization()).toBeNull();
    expect(storage.entries.get(verifierId)).toBe("");
    expect(storage.entries.get(deviceCodeId)).toBe("");
  });

  it("codeVerifierだけ残っていてもnull", () => {
    const { storage, store } = setup();
    store.setPendingAuthorization({ codeVerifier: "verifier-1", deviceCode: "device-1" });
    storage.setSecret(keyOf(storage, "device-1"), "");

    expect(store.getPendingAuthorization()).toBeNull();
  });

  it("deviceCodeだけ残っていてもnull", () => {
    const { storage, store } = setup();
    store.setPendingAuthorization({ codeVerifier: "verifier-1", deviceCode: "device-1" });
    storage.setSecret(keyOf(storage, "verifier-1"), "");

    expect(store.getPendingAuthorization()).toBeNull();
  });
});

describe("SecretStore: 中断したPushのpushId", () => {
  it("書いた値をそのまま読め、clearのあとはnullで空文字が残る", () => {
    const { storage, store } = setup();

    store.setPendingPushId("018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f");
    expect(store.getPendingPushId()).toBe("018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f");
    const id = keyOf(storage, "018f2c34-5a6b-7c8d-9e0f-1a2b3c4d5e6f");

    store.clearPendingPushId();

    expect(store.getPendingPushId()).toBeNull();
    expect(storage.entries.get(id)).toBe("");
  });

  it("未設定ならnull", () => {
    const { store } = setup();

    expect(store.getPendingPushId()).toBeNull();
  });
});

describe("SecretStore: secret ID", () => {
  it("すべてnekote-blog-前置の小文字英数字とハイフンだけ", () => {
    const { storage, store } = setup();

    store.setPushToken("token-abc");
    store.setPendingAuthorization({ codeVerifier: "verifier-1", deviceCode: "device-1" });
    store.setPendingPushId("push-1");

    const ids = [...storage.entries.keys()];
    expect(ids).toHaveLength(4);
    for (const id of ids) {
      expect(id).toMatch(/^nekote-blog-[a-z0-9-]+$/);
    }
  });

  it("同じsecretへは常に同じIDを使う", () => {
    const first = setup();
    const second = setup();

    first.store.setPushToken("token-abc");
    second.store.setPushToken("token-xyz");

    expect([...first.storage.entries.keys()]).toEqual([...second.storage.entries.keys()]);
  });
});

const validConnection = {
  blog: { id: "blog-1", title: "ねこのブログ", subdomain: "neko" },
  device: { id: "device-1", name: "MacBook Pro" },
};

const KNOWN_SETTING_KEYS = ["apiEnvironment", "connection", "contentRoot", "lastPush", "vaultId"];

describe("parsePluginSettings()", () => {
  // it.eachは配列のcaseをそのまま1引数として渡すが、テスト名の展開だけ中身を使うので
  // 配列を混ぜるcaseはlabelを付ける
  it.each([
    { label: "null", raw: null },
    { label: "undefined", raw: undefined },
    { label: "配列", raw: [] },
    { label: "文字列", raw: "settings" },
    { label: "数値", raw: 1 },
    { label: "真偽値", raw: true },
  ])("オブジェクトでない入力（$label）は既定値になる", ({ raw }) => {
    expect(parsePluginSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it("既定値はDEFAULT_SETTINGSと同じ内容で、参照は共有しない", () => {
    const settings = parsePluginSettings(null);

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings).not.toBe(DEFAULT_SETTINGS);
  });

  it("正しい設定はそのまま読める", () => {
    const settings = parsePluginSettings({
      apiEnvironment: "staging",
      connection: validConnection,
      vaultId: "vault-abcdefgh",
      contentRoot: "blog",
      lastPush: { revision: 3, manifestHash: "a".repeat(64), syncedAt: "2026-09-01T00:00:00.000Z" },
    });

    expect(settings).toEqual({
      apiEnvironment: "staging",
      connection: validConnection,
      vaultId: "vault-abcdefgh",
      contentRoot: "blog",
      lastPush: { revision: 3, manifestHash: "a".repeat(64), syncedAt: "2026-09-01T00:00:00.000Z" },
    });
  });

  it.each(["short", "vault id with space", "a".repeat(65), "vault/id", 1, null, {}])(
    "vault IDの形が違う値（%o）はnullになる",
    (vaultId) => {
      expect(parsePluginSettings({ vaultId }).vaultId).toBeNull();
    },
  );

  it("vaultルートを表す空文字のコンテンツルートは読める", () => {
    expect(parsePluginSettings({ contentRoot: "" }).contentRoot).toBe("");
  });

  it.each(["/blog", "blog/", "../blog", "blog/../posts", 1, null])(
    "正規形でないコンテンツルート（%o）はnull（未選択）になる",
    (contentRoot) => {
      expect(parsePluginSettings({ contentRoot }).contentRoot).toBeNull();
    },
  );

  it.each([
    { label: "revisionが負", lastPush: { revision: -1, manifestHash: "a", syncedAt: "x" } },
    { label: "revisionが小数", lastPush: { revision: 1.5, manifestHash: "a", syncedAt: "x" } },
    { label: "manifestHashが無い", lastPush: { revision: 1, syncedAt: "x" } },
    { label: "syncedAtが無い", lastPush: { revision: 1, manifestHash: "a" } },
    { label: "配列", lastPush: [] },
  ])("壊れたlastPush（$label）はnullになる", ({ lastPush }) => {
    expect(parsePluginSettings({ lastPush }).lastPush).toBeNull();
  });

  it.each(["local", "PRODUCTION", "", "https://api.nekote.blog/v1/obsidian", 1, null, {}])(
    "不正なapiEnvironment %o はproductionへ倒れる",
    (apiEnvironment) => {
      expect(parsePluginSettings({ apiEnvironment }).apiEnvironment).toBe("production");
    },
  );

  it.each([
    { label: "文字列", connection: "connection" },
    { label: "数値", connection: 123 },
    { label: "空配列", connection: [] },
    { label: "配列に入ったconnection", connection: [validConnection] },
    { label: "空オブジェクト", connection: {} },
    { label: "deviceが無い", connection: { blog: validConnection.blog } },
    { label: "blogが無い", connection: { device: validConnection.device } },
    {
      label: "blog.subdomainが無い",
      connection: { blog: { id: "blog-1", title: "ねこのブログ" }, device: validConnection.device },
    },
    {
      label: "blog.subdomainが文字列でない",
      connection: {
        blog: { ...validConnection.blog, subdomain: 1 },
        device: validConnection.device,
      },
    },
    {
      label: "device.nameが無い",
      connection: { blog: validConnection.blog, device: { id: "device-1" } },
    },
    { label: "blogとdeviceがnull", connection: { blog: null, device: null } },
  ])("壊れたconnection（$label）はnullになる", ({ connection }) => {
    expect(parsePluginSettings({ apiEnvironment: "production", connection }).connection).toBeNull();
  });

  it("未知のキーは落とす。秘密らしきキーは戻り値にも保存値にも残らない", () => {
    const raw = {
      apiEnvironment: "staging",
      connection: {
        ...validConnection,
        blog: { ...validConnection.blog, token: "LEAKED_SECRET" },
        token: "LEAKED_SECRET",
      },
      token: "LEAKED_SECRET",
      deviceCode: "LEAKED_SECRET",
      codeVerifier: "LEAKED_SECRET",
    };

    const settings = parsePluginSettings(raw);

    expect(Object.keys(settings).sort()).toEqual(KNOWN_SETTING_KEYS);
    expect(JSON.stringify(settings)).not.toContain("LEAKED_SECRET");
    expect(JSON.stringify(serializePluginSettings(settings))).not.toContain("LEAKED_SECRET");
  });
});

describe("serializePluginSettings()", () => {
  it("既知のキーだけを持つ", () => {
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      apiEnvironment: "staging",
      connection: validConnection,
    };

    const serialized = serializePluginSettings(settings);

    expect(Object.keys(serialized).sort()).toEqual(KNOWN_SETTING_KEYS);
    expect(Object.keys(serialized.connection ?? {}).sort()).toEqual(["blog", "device"]);
    expect(serialized).toEqual(settings);
  });

  it("connectionがnullでもそのまま保存できる", () => {
    expect(serializePluginSettings({ ...DEFAULT_SETTINGS })).toEqual(DEFAULT_SETTINGS);
  });

  it("ネストしたオブジェクトの参照を元と共有しない", () => {
    const settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      connection: {
        blog: { ...validConnection.blog },
        device: { ...validConnection.device },
      },
    };

    const serialized = serializePluginSettings(settings);
    const connection = serialized.connection;
    if (connection === null) throw new Error("connectionがnullになりました。");
    connection.blog.title = "書き換え後";
    connection.device.name = "書き換え後";

    expect(settings.connection?.blog.title).toBe("ねこのブログ");
    expect(settings.connection?.device.name).toBe("MacBook Pro");
    expect(serialized.connection).not.toBe(settings.connection);
    expect(connection.blog).not.toBe(settings.connection?.blog);
  });
});
