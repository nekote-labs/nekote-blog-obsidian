// プロパティ欄（フロントマター入力UI）の直下へ、サムネイル・カバー画像の
// 選択ボタン行をDOM注入する。
//
// プロパティ欄には公開APIの拡張点が無いため、内部DOMの`.metadata-container`へ
// 差し込む。内部構造は無保証で、Obsidianの更新で壊れたらボタンが出なくなるだけ
// （同期機能には影響しない）。
//
// プロパティ欄は再描画で差し込みが消え、モード切替では後から現れるため、viewごとに
// MutationObserverで見張って入れ直す。本文編集のたびに発火するので、CodeMirrorの
// 本文DOM（`.cm-content`）内だけの変化は無視し、残りはframeあたり1回に間引く。
import { setIcon, type MarkdownView, type TFile } from "obsidian";
import { getTranslations } from "../i18n";
import type { FrontmatterImageKey } from "./frontmatter-image-modal";

const ROW_CLASS = "nekote-blog-property-actions";

const BUTTON_KEYS: readonly FrontmatterImageKey[] = ["thumbnail", "cover"];

/** コマンド名と同じ文を使う。表示時に引いて、起動時の言語で固定しない */
function buttonLabel(key: FrontmatterImageKey): string {
  const t = getTranslations().commands;
  return key === "thumbnail" ? t.pickThumbnail : t.pickCover;
}

export class PropertiesActions {
  private readonly openImagePicker: (file: TFile, key: FrontmatterImageKey) => void;
  private readonly observers = new Map<MarkdownView, MutationObserver>();
  private readonly scheduled = new Set<MarkdownView>();

  constructor(openImagePicker: (file: TFile, key: FrontmatterImageKey) => void) {
    this.openImagePicker = openImagePicker;
  }

  /** viewを同期する。公開対象ノートならボタン行を注入し、そうでなければ外す */
  sync(view: MarkdownView, isPublishTarget: boolean): void {
    if (!isPublishTarget) {
      this.detach(view);
      return;
    }
    if (!this.observers.has(view)) {
      const observer = new MutationObserver((mutations) => {
        if (mutations.every(isInsideEditorContent)) return;
        this.schedule(view);
      });
      observer.observe(view.containerEl, { childList: true, subtree: true });
      this.observers.set(view, observer);
    }
    this.inject(view);
  }

  /** viewから注入と監視を外す（view閉鎖・公開対象外への変化時） */
  detach(view: MarkdownView): void {
    this.observers.get(view)?.disconnect();
    this.observers.delete(view);
    this.scheduled.delete(view);
    for (const row of view.containerEl.findAll(`.${ROW_CLASS}`)) row.remove();
  }

  /** プラグイン無効化時の後始末。全viewから注入と監視を外す */
  dispose(): void {
    for (const view of [...this.observers.keys()]) this.detach(view);
  }

  private schedule(view: MarkdownView): void {
    if (this.scheduled.has(view)) return;
    this.scheduled.add(view);
    // popoutウィンドウ内のviewでも確実に動くよう、view自身のwindowで待つ
    view.containerEl.win.requestAnimationFrame(() => {
      this.scheduled.delete(view);
      if (this.observers.has(view)) this.inject(view);
    });
  }

  private inject(view: MarkdownView): void {
    // 編集ビューとリーディングビューが別々にプロパティ欄を持つので、両方へ入れる
    for (const container of view.containerEl.findAll(".metadata-container")) {
      if (container.find(`.${ROW_CLASS}`) !== null) continue;
      this.buildRow(container.createDiv({ cls: ROW_CLASS }), view);
    }
  }

  private buildRow(row: HTMLElement, view: MarkdownView): void {
    for (const key of BUTTON_KEYS) {
      const button = row.createEl("button", { cls: "nekote-blog-property-action", type: "button" });
      setIcon(button.createSpan(), "image");
      button.appendText(buttonLabel(key));
      button.addEventListener("click", () => {
        // ファイルはクリック時点で取る（同じviewが別ノートへ切り替わるため）
        const file = view.file;
        if (file !== null) this.openImagePicker(file, key);
      });
    }
  }
}

/** CodeMirror本文内だけの変化か（1キー入力ごとの再注入チェックを避ける） */
function isInsideEditorContent(mutation: MutationRecord): boolean {
  const target = mutation.target;
  return target.instanceOf(Element) && target.closest(".cm-content") !== null;
}
