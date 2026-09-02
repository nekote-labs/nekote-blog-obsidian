import { beforeEach, describe, expect, it, vi } from "vitest";

/** `Notice`に渡された文言。`vi.mock`は巻き上げられるので`vi.hoisted`で先に作る */
const notices = vi.hoisted(() => [] as string[]);

vi.mock("obsidian", () => {
  // 宣言的設定APIの基底。定義の組み立てだけを検証するので、描画も保存も要らない
  class PluginSettingTab {
    constructor(
      public app: unknown,
      public plugin: unknown,
    ) {}
    update(): void {}
    getControlValue(): unknown {
      return undefined;
    }
    setControlValue(): void {}
  }

  class Notice {
    constructor(message: string) {
      notices.push(message);
    }
  }

  return { PluginSettingTab, Notice };
});

import type { SettingDefinitionGroup, SettingDefinitionItem, SettingGroupItem } from "obsidian";
import type {
  DeviceAuthorizationPrompt,
  DeviceAuthorizationResult,
} from "../src/auth/device-authorization";
import { NekoteApiError } from "../src/protocol/errors";
import type { ConnectionResponse } from "../src/protocol/types";
import type { PluginSettings } from "../src/storage/plugin-data";
import { NekoteBlogSettingTab } from "../src/settings/settings-tab";

beforeEach(() => {
  notices.length = 0;
});

const prompt: DeviceAuthorizationPrompt = {
  userCode: "K7QX-3M9T",
  verificationUri: "https://dash.example.test/obsidian/authorize",
  verificationUriComplete: "https://dash.example.test/obsidian/authorize?code=K7QX-3M9T",
  expiresAt: 600_000,
};

const connectionResponse: ConnectionResponse = {
  protocolVersion: 1,
  blog: { id: "blog_1", title: "obsidian", subdomain: "staging-obsidian" },
  device: { id: "dev_1", name: "Obsidian (Desktop)" },
  source: {
    kind: "obsidian",
    contentSourceId: "src_1",
    vaultId: "vault_1",
    contentRoot: "blog",
    appliedRevision: 3,
    manifestHash: null,
  },
};

type ConnectInput = {
  deviceName: string;
  onPrompt: (next: DeviceAuthorizationPrompt) => void;
  signal: AbortSignal;
};

type ConnectFn = (input: ConnectInput) => Promise<DeviceAuthorizationResult>;

type TabOptions = {
  settings?: Partial<PluginSettings>;
  connected?: boolean;
  folderPaths?: string[];
  fetchConnection?: () => Promise<ConnectionResponse>;
};

function createTab(
  connect: ConnectFn = vi.fn<ConnectFn>(),
  options: TabOptions = {},
): NekoteBlogSettingTab {
  const settings: PluginSettings = {
    apiEnvironment: "production",
    devMode: false,
    connection: null,
    vaultId: null,
    contentRoot: null,
    autoInsertFrontmatter: true,
    imageImportFolder: null,
    lastPush: null,
    ...options.settings,
  };
  const plugin = {
    defaultDeviceName: () => "Obsidian (Desktop)",
    openExternal: vi.fn(),
    connection: {
      isConnected: () => options.connected === true,
      connect,
      fetchConnection: options.fetchConnection ?? vi.fn(async () => connectionResponse),
    },
    settings,
    folderPaths: () => options.folderPaths ?? [],
    updateSettings: vi.fn(async (patch: Partial<PluginSettings>) => {
      Object.assign(settings, patch);
    }),
    publish: vi.fn(),
  };
  return new NekoteBlogSettingTab({} as never, plugin as never);
}

function pluginOf(tab: NekoteBlogSettingTab): {
  updateSettings: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
  settings: PluginSettings;
} {
  return (tab as unknown as { plugin: never }).plugin;
}

function startAuthorization(tab: NekoteBlogSettingTab): Promise<void> {
  return (tab as unknown as { startAuthorization: () => Promise<void> }).startAuthorization();
}

// --- 定義の読み取り ---------------------------------------------------------

function isGroup(item: SettingDefinitionItem): item is SettingDefinitionGroup {
  return "type" in item && (item.type === "group" || item.type === "list");
}

function isVisible(item: { visible?: boolean | (() => boolean) }): boolean {
  const { visible } = item;
  if (visible === undefined) return true;
  return typeof visible === "function" ? visible() : visible;
}

/** 表示されているグループを見出しで引く。同じ見出しのグループが状態で入れ替わるため`visible`で絞る */
function group(tab: NekoteBlogSettingTab, heading: string): SettingDefinitionGroup {
  const found = tab
    .getSettingDefinitions()
    .filter(isGroup)
    .filter(isVisible)
    .find((g) => g.heading === heading);
  if (found === undefined) throw new Error(`グループが無い: ${heading}`);
  return found;
}

/** 表示されるグループの見出し（`visible`を評価したあと） */
function visibleHeadings(tab: NekoteBlogSettingTab): (string | undefined)[] {
  return tab
    .getSettingDefinitions()
    .filter(isGroup)
    .filter(isVisible)
    .map((g) => g.heading);
}

/** 表示される項目（`visible`を評価したあと） */
function visibleItems(group: SettingDefinitionGroup): SettingGroupItem[] {
  return (group.items ?? []).filter(isVisible);
}

/** 表示される項目名（`visible`を評価したあと） */
function visibleNames(group: SettingDefinitionGroup): string[] {
  return visibleItems(group).map((item) => item.name);
}

function item(group: SettingDefinitionGroup, name: string): SettingGroupItem {
  const found = (group.items ?? []).find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`項目が無い: ${name}`);
  return found;
}

function dropdownOptions(item: SettingGroupItem): Record<string, string> {
  const control = "control" in item ? item.control : undefined;
  if (control === undefined || control.type !== "dropdown") throw new Error("dropdownではない");
  return control.options;
}

function isDisabled(item: SettingGroupItem): boolean {
  const control = "control" in item ? item.control : undefined;
  const disabled = control?.disabled;
  if (disabled === undefined) return false;
  return typeof disabled === "function" ? disabled() : disabled;
}

// --- renderの実行 -----------------------------------------------------------

type RenderedElement = { tag: string; cls?: string; text?: string };

type RenderedButton = {
  text: string | null;
  cta: boolean;
  destructive: boolean;
  disabled: boolean;
  click: () => void;
};

type RenderedRow = { elements: RenderedElement[]; buttons: RenderedButton[] };

/** `render`を偽のSettingで実行し、何を描いたかを取り出す */
function render(target: SettingGroupItem): RenderedRow {
  const row: RenderedRow = { elements: [], buttons: [] };
  const setting = {
    infoEl: {
      empty: () => {
        row.elements.length = 0;
      },
      createDiv: (options: { cls?: string; text?: string }) => {
        row.elements.push({ tag: "div", ...options });
      },
      createEl: (tag: string, options: { cls?: string; text?: string }) => {
        row.elements.push({ tag, ...options });
      },
    },
    addButton: (callback: (component: unknown) => void) => {
      const button: RenderedButton = {
        text: null,
        cta: false,
        destructive: false,
        disabled: false,
        click: () => {},
      };
      const component = {
        setButtonText: (text: string) => {
          button.text = text;
          return component;
        },
        setCta: () => {
          button.cta = true;
          return component;
        },
        setDestructive: () => {
          button.destructive = true;
          return component;
        },
        setDisabled: (value: boolean) => {
          button.disabled = value;
          return component;
        },
        onClick: (handler: () => void) => {
          button.click = handler;
          return component;
        },
      };
      callback(component);
      row.buttons.push(button);
      return setting;
    },
  };

  const run = "render" in target ? target.render : undefined;
  if (run === undefined) throw new Error(`renderが無い: ${target.name}`);
  run(setting as never, undefined as never);
  return row;
}

// --- テスト -----------------------------------------------------------------

describe("NekoteBlogSettingTabのセクション構成", () => {
  it("未接続では接続・記事・公開を出す", () => {
    expect(visibleHeadings(createTab())).toEqual(["Connection", "Content", "Publishing"]);
  });

  it("接続の項目は接続状態で入れ替わる", () => {
    expect(visibleNames(group(createTab(), "Connection"))).toEqual([
      "",
      "Device name",
      "Connect to Nekote Blog",
    ]);

    const connected = createTab(vi.fn<ConnectFn>(), { connected: true });
    expect(visibleNames(group(connected, "Connection"))).toEqual([
      "Connected blog",
      "This device",
      "Check connection status",
      "Disconnect",
    ]);
  });
});

describe("NekoteBlogSettingTabの接続状態の確認", () => {
  function checkButton(tab: NekoteBlogSettingTab): RenderedButton {
    const [button] = render(item(group(tab, "Connection"), "Check connection status")).buttons;
    if (button === undefined) throw new Error("確認ボタンが無い");
    return button;
  }

  it("サーバーの接続状態をNoticeで出す", async () => {
    const fetchConnection = vi.fn(async () => connectionResponse);
    const tab = createTab(vi.fn<ConnectFn>(), { connected: true, fetchConnection });

    checkButton(tab).click();
    await vi.waitFor(() => expect(notices).toHaveLength(1));

    expect(fetchConnection).toHaveBeenCalledTimes(1);
    expect(notices[0]).toBe(
      'Nekote Blog: Connected. Obsidian source is active (revision 3, content root "blog").',
    );
  });

  it("トークンが失効していたら接続し直しを案内する", async () => {
    const tab = createTab(vi.fn<ConnectFn>(), {
      connected: true,
      fetchConnection: vi.fn(async () => {
        throw new NekoteApiError({
          code: "unauthorized",
          status: 401,
          message: "接続が無効です。",
        });
      }),
    });

    checkButton(tab).click();
    await vi.waitFor(() => expect(notices).toHaveLength(1));

    expect(notices[0]).toBe(
      "Nekote Blog: This device is no longer connected. Disconnect, then connect again.",
    );
  });
});

describe("NekoteBlogSettingTabの詳細設定", () => {
  it("devModeが無いと詳細セクションを出さない", () => {
    expect(visibleHeadings(createTab())).not.toContain("Advanced");
  });

  it("devModeが有効なときだけ接続先を出す", () => {
    const tab = createTab(vi.fn<ConnectFn>(), { settings: { devMode: true } });

    expect(visibleHeadings(tab)).toContain("Advanced");
    expect(visibleNames(group(tab, "Advanced"))).toEqual(["Server"]);
  });

  it("接続中は接続先を変えられない", () => {
    const disconnected = createTab(vi.fn<ConnectFn>(), { settings: { devMode: true } });
    expect(isDisabled(item(group(disconnected, "Advanced"), "Server"))).toBe(false);

    const connected = createTab(vi.fn<ConnectFn>(), {
      settings: { devMode: true },
      connected: true,
    });
    expect(isDisabled(item(group(connected, "Advanced"), "Server"))).toBe(true);
  });
});

describe("NekoteBlogSettingTabの記事セクション", () => {
  it("コンテンツルート・画像の取り込み先・Front Matter自動挿入を出す", () => {
    expect(visibleNames(group(createTab(), "Content"))).toEqual([
      "Content root",
      "Image import folder",
      "Insert frontmatter into new notes automatically",
    ]);
  });

  it("選択済みのフォルダが消えても現在値を選択肢に残す", () => {
    const tab = createTab(vi.fn<ConnectFn>(), {
      settings: { contentRoot: "gone", imageImportFolder: "gone/assets" },
      folderPaths: ["", "blog"],
    });
    const location = group(tab, "Content");

    expect(dropdownOptions(item(location, "Content root"))).toEqual({
      __none__: "(not selected)",
      __vault__: "(vault root)",
      gone: "gone (not found)",
      blog: "blog",
    });
    expect(dropdownOptions(item(location, "Image import folder"))).toEqual({
      __default__: "assets under the content root (default)",
      "gone/assets": "gone/assets (not found)",
      blog: "blog",
    });
  });
});

describe("NekoteBlogSettingTabの公開セクション", () => {
  it("最終反映と反映ボタンを出す", () => {
    expect(visibleNames(group(createTab(), "Publishing"))).toEqual([
      "Last publish",
      "Publish to Nekote Blog",
    ]);
  });

  it("未接続またはコンテンツルート未選択では公開ボタンを押せない", () => {
    const publishButton = (options: TabOptions): RenderedButton => {
      const publishing = group(createTab(vi.fn<ConnectFn>(), options), "Publishing");
      const [button] = render(item(publishing, "Publish to Nekote Blog")).buttons;
      if (button === undefined) throw new Error("公開ボタンが無い");
      return button;
    };

    expect(publishButton({ connected: true }).disabled).toBe(true);
    expect(publishButton({ settings: { contentRoot: "blog" } }).disabled).toBe(true);
    expect(publishButton({ connected: true, settings: { contentRoot: "blog" } }).disabled).toBe(
      false,
    );
  });
});

describe("NekoteBlogSettingTabのcontrol値", () => {
  it("端末名は設定ではなくタブ側に持つ", async () => {
    const tab = createTab();

    expect(tab.getControlValue("deviceName")).toBe("Obsidian (Desktop)");
    await tab.setControlValue("deviceName", "MacBook");

    expect(tab.getControlValue("deviceName")).toBe("MacBook");
    expect(pluginOf(tab).updateSettings).not.toHaveBeenCalled();
  });

  it("コンテンツルートの番兵値を設定値へ入れ替える", async () => {
    const tab = createTab();
    expect(tab.getControlValue("contentRoot")).toBe("__none__");

    await tab.setControlValue("contentRoot", "__vault__");
    expect(pluginOf(tab).updateSettings).toHaveBeenLastCalledWith({ contentRoot: "" });
    expect(tab.getControlValue("contentRoot")).toBe("__vault__");

    await tab.setControlValue("contentRoot", "blog");
    expect(pluginOf(tab).updateSettings).toHaveBeenLastCalledWith({ contentRoot: "blog" });

    await tab.setControlValue("contentRoot", "__none__");
    expect(pluginOf(tab).updateSettings).toHaveBeenLastCalledWith({ contentRoot: null });
  });

  it("画像の取り込み先の既定はnullで保存する", async () => {
    const tab = createTab();
    expect(tab.getControlValue("imageImportFolder")).toBe("__default__");

    await tab.setControlValue("imageImportFolder", "blog/assets");
    expect(pluginOf(tab).updateSettings).toHaveBeenLastCalledWith({
      imageImportFolder: "blog/assets",
    });

    await tab.setControlValue("imageImportFolder", "__default__");
    expect(pluginOf(tab).updateSettings).toHaveBeenLastCalledWith({ imageImportFolder: null });
  });

  it("接続先は既知の値だけ保存する", async () => {
    const tab = createTab(vi.fn<ConnectFn>(), { settings: { devMode: true } });

    await tab.setControlValue("apiEnvironment", "staging");
    expect(pluginOf(tab).updateSettings).toHaveBeenLastCalledWith({ apiEnvironment: "staging" });

    await tab.setControlValue("apiEnvironment", "http://localhost:8787");
    expect(pluginOf(tab).updateSettings).toHaveBeenCalledTimes(1);
  });
});

describe("NekoteBlogSettingTabの承認待ち", () => {
  it("user code待ちの間は接続以外のセクションを出さない", async () => {
    let release!: (result: DeviceAuthorizationResult) => void;
    const connect = vi.fn<ConnectFn>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const tab = createTab(connect);

    const pending = startAuthorization(tab);
    expect(visibleHeadings(tab)).toEqual(["Waiting for approval"]);

    const waiting = group(tab, "Waiting for approval");
    const [description, cancel, ...rest] = visibleItems(waiting);
    expect(rest).toEqual([]);
    expect(render(description as SettingGroupItem).elements).toEqual([
      { tag: "p", cls: "nekote-blog-description", text: "Starting the connection…" },
    ]);
    expect(render(cancel as SettingGroupItem).buttons[0]?.text).toBe("Cancel");

    release({ status: "cancelled" });
    await pending;
  });

  it("承認待ちではuser codeと承認ページを出す", async () => {
    let release!: (result: DeviceAuthorizationResult) => void;
    const connect = vi.fn<ConnectFn>((input) => {
      input.onPrompt(prompt);
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const tab = createTab(connect);

    const pending = startAuthorization(tab);
    await Promise.resolve();

    expect(visibleHeadings(tab)).toEqual(["Waiting for approval"]);

    const waiting = group(tab, "Waiting for approval");
    const [description, userCode] = visibleItems(waiting);
    expect(render(description as SettingGroupItem).elements[0]?.text).toContain(
      "Check that the page opened in your browser",
    );
    expect(render(userCode as SettingGroupItem).elements).toEqual([
      { tag: "div", cls: "nekote-blog-user-code", text: prompt.userCode },
    ]);

    const approval = item(waiting, "Approval page");
    expect(approval.desc).toBe(prompt.verificationUri);
    const [openAgain] = render(approval).buttons;
    openAgain?.click();
    expect(pluginOf(tab).openExternal).toHaveBeenCalledWith(prompt.verificationUriComplete);

    release({ status: "cancelled" });
    await pending;
  });
});

describe("NekoteBlogSettingTabの認可開始", () => {
  it("連続で開始してもconnectは1回だけ走る", async () => {
    let release!: (result: DeviceAuthorizationResult) => void;
    const connect = vi.fn<ConnectFn>(async (input) => {
      input.onPrompt(prompt);
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const tab = createTab(connect);

    const first = startAuthorization(tab);
    const second = startAuthorization(tab);
    await Promise.resolve();

    expect(connect).toHaveBeenCalledTimes(1);
    release({ status: "cancelled" });
    await Promise.all([first, second]);
  });

  it("hideのあと残るpollはない", async () => {
    let started!: () => void;
    const sawStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const signals: AbortSignal[] = [];
    const connect = vi.fn<ConnectFn>(async (input) => {
      signals.push(input.signal);
      started();
      if (input.signal.aborted) return { status: "cancelled" };
      await new Promise<void>((resolve) => {
        input.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return { status: "cancelled" };
    });
    const tab = createTab(connect);

    const pending = startAuthorization(tab);
    await sawStart;
    expect(connect).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    tab.hide();
    expect(signals[0]?.aborted).toBe(true);
    await pending;
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
