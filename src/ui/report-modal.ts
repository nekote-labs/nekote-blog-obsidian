// 反映の結果。記事別のエラー・警告をここでまとめて見せる。
//
// Noticeは数秒で消えるので、直すべき記事が複数あるときに読み切れない。
// 記事エラーがある結果はモーダルで残す。
import { Modal, type App } from "obsidian";
import { getTranslations } from "../i18n";
import type { PublishReport } from "../sync/publish";
import type { ScannedArticle } from "../sync/scan";
import { appendTruncatedItems } from "./truncated-list";

/** 一覧に並べる記事の最大数。多いときは件数だけ見せる（モーダルが読めなくなるため） */
const MAX_LISTED_ARTICLES = 30;

class ReportModal extends Modal {
  private readonly report: PublishReport;

  constructor(app: App, report: PublishReport) {
    super(app);
    this.report = report;
  }

  onOpen(): void {
    const t = getTranslations().reportModal;
    this.setTitle(this.report.headline);
    const { contentEl } = this;

    for (const paragraph of this.report.paragraphs) {
      contentEl.createEl("p", { text: paragraph });
    }

    const flagged = this.report.articles.filter((article) => article.issues.length > 0);
    if (flagged.length > 0) {
      contentEl.createEl("h4", { text: t.needAttention(flagged.length) });
      const list = contentEl.createEl("ul", { cls: "nekote-blog-list" });
      appendTruncatedItems(list, flagged, MAX_LISTED_ARTICLES, (article) =>
        appendArticle(list, article),
      );
    }

    const samples = this.report.samples ?? [];
    if (samples.length > 0) {
      contentEl.createEl("h4", { text: t.messages });
      const list = contentEl.createEl("ul", { cls: "nekote-blog-list" });
      for (const sample of samples) {
        const label = sample.kind === "error" ? t.error : t.warning;
        list.createEl("li", {
          text: `${label}: ${sample.path === undefined ? "" : `${sample.path} — `}${sample.message}`,
        });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function appendArticle(list: HTMLElement, article: ScannedArticle): void {
  const item = list.createEl("li");
  item.createDiv({ text: getTranslations().reportModal.article(article.title, article.path) });
  const issues = item.createEl("ul", { cls: "nekote-blog-list" });
  for (const issue of article.issues) {
    issues.createEl("li", {
      cls: issue.level === "error" ? "nekote-blog-issue-error" : "nekote-blog-description",
      text: issue.message,
    });
  }
}

export function showReportModal(app: App, report: PublishReport): void {
  new ReportModal(app, report).open();
}
