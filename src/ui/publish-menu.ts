import type { Menu } from "obsidian";

export interface PublishMenuState {
  connected: boolean;
  /** vaultルートを選んだ場合は空文字。未設定は`null` */
  contentRoot: string | null;
}

export interface PublishMenuItem {
  title: string;
  onClick: () => void;
}

export interface PublishMenuSection {
  state: PublishMenuState;
  /** 反映できない理由。押せないラベルとして出す */
  labels: { notConnected: string; contentRootNotSelected: string };
  /** ノート単位の反映。ノートに紐づくメニューだけ渡す */
  note?: PublishMenuItem;
  /** vault全体の反映 */
  all: PublishMenuItem;
}

/**
 * 反映の入口メニュー（リボン・ノートヘッダー・ファイル右クリック）へ反映項目を足す。
 * 反映できない状態では反映項目を出さず、ラベルで理由を示す。
 * 判定の順序は`publish()`が弾く順（接続 → コンテンツルート）に合わせる
 */
export function addPublishItems(menu: Menu, section: PublishMenuSection): void {
  const { state, labels, note, all } = section;
  if (!state.connected) {
    menu.addItem((item) => item.setTitle(labels.notConnected).setIsLabel(true));
    return;
  }
  if (state.contentRoot === null) {
    menu.addItem((item) => item.setTitle(labels.contentRootNotSelected).setIsLabel(true));
    return;
  }
  if (note !== undefined) {
    menu.addItem((item) =>
      item
        .setTitle(note.title)
        .setIcon("file-up")
        .onClick(() => {
          note.onClick();
        }),
    );
  }
  menu.addItem((item) =>
    item
      .setTitle(all.title)
      .setIcon("upload")
      .onClick(() => {
        all.onClick();
      }),
  );
}
