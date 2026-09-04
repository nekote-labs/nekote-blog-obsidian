import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

const state = vi.hoisted(() => {
  class Fragment {
    readonly children: unknown[] = [];

    append(...nodes: unknown[]): void {
      this.children.push(...nodes);
    }
  }

  class Break {}

  Object.defineProperty(globalThis, "createFragment", {
    configurable: true,
    value: (callback: (fragment: Fragment) => void) => {
      const fragment = new Fragment();
      callback(fragment);
      return fragment;
    },
  });
  Object.defineProperty(globalThis, "createEl", {
    configurable: true,
    value: (tag: string) => {
      if (tag !== "br") throw new Error(`想定外の要素: ${tag}`);
      return new Break();
    },
  });

  return {
    Break,
    Fragment,
    notices: [] as Array<{
      initial: string | DocumentFragment;
      updates: Array<string | DocumentFragment>;
    }>,
  };
});

vi.mock("obsidian", () => {
  class Notice {
    private readonly record: (typeof state.notices)[number];

    constructor(message: string | DocumentFragment) {
      this.record = { initial: message, updates: [] };
      state.notices.push(this.record);
    }

    setMessage(message: string | DocumentFragment): void {
      this.record.updates.push(message);
    }

    hide(): void {}
  }

  return { Notice };
});

vi.mock("../src/ui/confirm-modal", () => ({ confirmWithModal: vi.fn() }));
vi.mock("../src/ui/report-modal", () => ({ showReportModal: vi.fn() }));

import { createPublishUi } from "../src/ui/publish-ui";

beforeEach(() => {
  state.notices.length = 0;
});

describe("createPublishUi().progress()", () => {
  it("detailは強制改行して2行目に表示する", () => {
    const ui = createPublishUi({} as App);

    ui.progress("ファイルを送信しています…", "4 / 18");
    ui.progress("ファイルを送信しています…", "5 / 18");

    expect(state.notices).toHaveLength(1);
    expect(state.notices[0]?.initial).toBeInstanceOf(state.Fragment);
    expect(state.notices[0]?.updates[0]).toBeInstanceOf(state.Fragment);
    const update = state.notices[0]?.updates[0];
    if (!(update instanceof state.Fragment)) throw new Error("detail付き通知がFragmentではない");
    expect(update.children).toEqual([
      "Nekote Blog: ファイルを送信しています…",
      expect.any(state.Break),
      "5 / 18",
    ]);
  });

  it("detailがなければ従来どおり1行の文字列を表示する", () => {
    createPublishUi({} as App).progress("送信準備中");

    expect(state.notices[0]?.initial).toBe("Nekote Blog: 送信準備中");
  });
});
