import { describe, expect, it, vi } from "vitest";
import type { Menu, MenuItem } from "obsidian";
import { addPublishItems, type PublishMenuState } from "../src/ui/publish-menu";

type RecordedItem = { title: string; isLabel: boolean; onClick: (() => void) | null };

/** 項目の組み立てだけを記録する。描画は要らない */
function createMenu(): { menu: Menu; items: RecordedItem[] } {
  const items: RecordedItem[] = [];
  const menu = {
    addItem(build: (item: MenuItem) => void) {
      const recorded: RecordedItem = { title: "", isLabel: false, onClick: null };
      const item = {
        setTitle(title: string) {
          recorded.title = title;
          return item;
        },
        setIcon() {
          return item;
        },
        setIsLabel(isLabel: boolean) {
          recorded.isLabel = isLabel;
          return item;
        },
        onClick(callback: () => void) {
          recorded.onClick = callback;
          return item;
        },
      };
      build(item as unknown as MenuItem);
      items.push(recorded);
      return menu;
    },
  };
  return { menu: menu as unknown as Menu, items };
}

function summarize(items: RecordedItem[]): Array<[string, boolean]> {
  return items.map((item) => [item.title, item.isLabel]);
}

const labels = { notConnected: "未接続", contentRootNotSelected: "コンテンツルート未設定" };

function addItems(state: PublishMenuState, options: { withNote?: boolean } = {}) {
  const { menu, items } = createMenu();
  const publishNote = vi.fn();
  const publishAll = vi.fn();
  addPublishItems(menu, {
    state,
    labels,
    note:
      options.withNote === true ? { title: "このノートだけ反映", onClick: publishNote } : undefined,
    all: { title: "Nekote Blogへ反映", onClick: publishAll },
  });
  return { items, publishNote, publishAll };
}

describe("addPublishItems()", () => {
  it("未接続なら反映項目を出さず、未接続ラベルだけを出す", () => {
    const { items, publishNote, publishAll } = addItems(
      { connected: false, contentRoot: "blog" },
      { withNote: true },
    );

    expect(summarize(items)).toEqual([[labels.notConnected, true]]);
    expect(items[0]?.onClick).toBeNull();
    expect(publishNote).not.toHaveBeenCalled();
    expect(publishAll).not.toHaveBeenCalled();
  });

  it("接続済みでもコンテンツルート未設定なら未設定ラベルだけを出す", () => {
    const { items } = addItems({ connected: true, contentRoot: null }, { withNote: true });

    expect(summarize(items)).toEqual([[labels.contentRootNotSelected, true]]);
    expect(items[0]?.onClick).toBeNull();
  });

  it("未接続かつコンテンツルート未設定なら、publish()と同じ順で未接続を先に出す", () => {
    const { items } = addItems({ connected: false, contentRoot: null });

    expect(summarize(items)).toEqual([[labels.notConnected, true]]);
  });

  it.each([
    { label: "フォルダ", contentRoot: "blog" },
    { label: "vaultルート（空文字）", contentRoot: "" },
  ])(
    "接続済みでコンテンツルートが$labelなら、ノート単位と全体の反映項目を順に出す",
    ({ contentRoot }) => {
      const { items, publishNote, publishAll } = addItems(
        { connected: true, contentRoot },
        { withNote: true },
      );

      expect(summarize(items)).toEqual([
        ["このノートだけ反映", false],
        ["Nekote Blogへ反映", false],
      ]);
      items[0]?.onClick?.();
      expect(publishNote).toHaveBeenCalledOnce();
      expect(publishAll).not.toHaveBeenCalled();
      items[1]?.onClick?.();
      expect(publishAll).toHaveBeenCalledOnce();
    },
  );

  it("ノート単位の項目を渡さなければ全体の反映項目だけを出す", () => {
    const { items, publishAll } = addItems({ connected: true, contentRoot: "blog" });

    expect(summarize(items)).toEqual([["Nekote Blogへ反映", false]]);
    items[0]?.onClick?.();
    expect(publishAll).toHaveBeenCalledOnce();
  });
});
