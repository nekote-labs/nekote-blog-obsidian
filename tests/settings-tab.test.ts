import { describe, expect, it, vi } from "vitest";

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
    setName() {
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

function createTab(connect: ConnectFn): NekoteBlogSettingTab {
  const plugin = {
    defaultDeviceName: () => "Obsidian (Desktop)",
    openExternal: vi.fn(),
    connection: {
      isConnected: () => false,
      connect,
    },
    settings: { apiEnvironment: "production", connection: null },
  };
  return new NekoteBlogSettingTab({} as never, plugin as never);
}

function startAuthorization(tab: NekoteBlogSettingTab): Promise<void> {
  return (tab as unknown as { startAuthorization: () => Promise<void> }).startAuthorization();
}

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
