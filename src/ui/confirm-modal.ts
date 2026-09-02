// 反映の前に出す確認ダイアログ。
//
// 「取り消し」で閉じたのか確定したのかを取り違えると、確認なしにPushが進んでしまう。
// **閉じ方によらず既定は`false`**にしてある（×やEscで閉じたら取り消し）。
import { Modal, Setting, type App } from "obsidian";
import { getTranslations } from "../i18n";
import type { ConfirmRequest } from "../sync/publish";
import { appendTruncatedItems } from "./truncated-list";

/** 1セクションに並べるpathの最大数。多いときは件数だけ見せる */
const MAX_LISTED_ITEMS = 20;

class ConfirmModal extends Modal {
  private readonly request: ConfirmRequest;
  private readonly resolve: (confirmed: boolean) => void;
  private confirmed = false;

  constructor(app: App, request: ConfirmRequest, resolve: (confirmed: boolean) => void) {
    super(app);
    this.request = request;
    this.resolve = resolve;
  }

  onOpen(): void {
    this.setTitle(this.request.title);
    const { contentEl } = this;

    for (const paragraph of this.request.paragraphs) {
      contentEl.createEl("p", { text: paragraph });
    }

    for (const section of this.request.sections ?? []) {
      if (section.items.length === 0) continue;
      const details = contentEl.createEl("details", { cls: "nekote-blog-section" });
      details.createEl("summary", { text: section.title });
      const list = details.createEl("ul", { cls: "nekote-blog-list" });
      appendTruncatedItems(list, section.items, MAX_LISTED_ITEMS, (item) => {
        list.createEl("li", { text: item });
      });
    }

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText(getTranslations().confirmModal.cancel).onClick(() => {
          this.close();
        }),
      )
      .addButton((button) => {
        button.setButtonText(this.request.confirmLabel).onClick(() => {
          this.confirmed = true;
          this.close();
        });
        if (this.request.danger === true) button.setDestructive();
        else button.setCta();
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.resolve(this.confirmed);
  }
}

export function confirmWithModal(app: App, request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, request, resolve).open();
  });
}
