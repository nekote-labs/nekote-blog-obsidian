import { beforeEach, describe, expect, it, vi } from "vitest";

/** mockのSettingが受け取ったsetName()を記録する（描画の有無の検証用） */
const renderedNames = vi.hoisted(() => ({ list: [] as string[] }));

vi.mock("obsidian", () => {
  class PluginSettingTab {
    containerEl = {
      empty() {},
      createEl() {
        return {};
      },
    };
    constructor(
      public app: unknown,
      public plugin: unknown,
    ) {}
  }

  class Setting {
    setName(name: string) {
      renderedNames.list.push(name);
      return this;
    }
    setHeading() {
      return this;
    }
    setDesc() {
      return this;
    }
    addText() {
      return this;
    }
    addButton() {
      return this;
    }
    addDropdown() {
      return this;
    }
    addToggle() {
      return this;
    }
  }

  class Notice {}

  return { PluginSettingTab, Setting, Notice };
});

import type {
  DeviceAuthorizationPrompt,
  DeviceAuthorizationResult,
} from "../src/auth/device-authorization";
import { NekoteBlogSettingTab } from "../src/settings/settings-tab";

const prompt: DeviceAuthorizationPrompt = {
  userCode: "K7QX-3M9T",
  verificationUri: "https://dash.example.test/obsidian/authorize",
  verificationUriComplete: "https://dash.example.test/obsidian/authorize?code=K7QX-3M9T",
  expiresAt: 600_000,
};

type ConnectInput = {
  deviceName: string;
  onPrompt: (next: DeviceAuthorizationPrompt) => void;
  signal: AbortSignal;
};

type ConnectFn = (input: ConnectInput) => Promise<DeviceAuthorizationResult>;

function createTab(connect: ConnectFn, settings: { devMode?: boolean } = {}): NekoteBlogSettingTab {
  const plugin = {
    defaultDeviceName: () => "Obsidian (Desktop)",
    openExternal: vi.fn(),
    connection: {
      isConnected: () => false,
      connect,
    },
    settings: {
      apiEnvironment: "production",
      devMode: false,
      connection: null,
      vaultId: null,
      contentRoot: null,
      autoInsertFrontmatter: true,
      imageImportFolder: null,
      lastPush: null,
      ...settings,
    },
    folderPaths: () => [],
    publish: vi.fn(),
  };
  return new NekoteBlogSettingTab({} as never, plugin as never);
}

function startAuthorization(tab: NekoteBlogSettingTab): Promise<void> {
  return (tab as unknown as { startAuthorization: () => Promise<void> }).startAuthorization();
}

function renderAdvanced(tab: NekoteBlogSettingTab): void {
  (tab as unknown as { renderAdvanced: (container: HTMLElement) => void }).renderAdvanced(
    {} as HTMLElement,
  );
}

function renderContentLocation(tab: NekoteBlogSettingTab): void {
  (
    tab as unknown as { renderContentLocation: (container: HTMLElement) => void }
  ).renderContentLocation({} as unknown as HTMLElement);
}

function renderPublishing(tab: NekoteBlogSettingTab): void {
  (tab as unknown as { renderPublishing: (container: HTMLElement) => void }).renderPublishing(
    {} as unknown as HTMLElement,
  );
}

describe("NekoteBlogSettingTabの詳細設定", () => {
  beforeEach(() => {
    renderedNames.list.length = 0;
  });

  it("devModeが無いと詳細セクションを丸ごと描画しない", () => {
    renderAdvanced(createTab(vi.fn<ConnectFn>()));

    expect(renderedNames.list).toEqual([]);
  });

  it("devModeが有効なときだけ接続先を描画する", () => {
    renderAdvanced(createTab(vi.fn<ConnectFn>(), { devMode: true }));

    expect(renderedNames.list).toEqual(["詳細", "接続先"]);
  });
});

describe("NekoteBlogSettingTabの記事を置く場所セクション", () => {
  beforeEach(() => {
    renderedNames.list.length = 0;
  });

  it("コンテンツルートと画像の取り込み先を描画する", () => {
    renderContentLocation(createTab(vi.fn<ConnectFn>()));

    expect(renderedNames.list).toEqual(["記事を置く場所", "コンテンツルート", "画像の取り込み先"]);
  });
});

describe("NekoteBlogSettingTabの公開セクション", () => {
  beforeEach(() => {
    renderedNames.list.length = 0;
  });

  it("フロントマター自動挿入のトグルを描画する", () => {
    renderPublishing(createTab(vi.fn<ConnectFn>()));

    expect(renderedNames.list).toEqual([
      "公開",
      "新規ノートにフロントマターを自動挿入",
      "最終反映",
      "Nekote Blogへ反映",
    ]);
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
