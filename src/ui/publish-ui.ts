// `PublishUi`のObsidian実装。進捗は1つのNoticeを書き換えて使い回す。
//
// 走査は1件ごとに進捗を出すので、そのたびにNoticeを作ると通知が積み上がって
// 画面を覆う。**同じNoticeのメッセージを差し替える**。
import { Notice, type App } from "obsidian";
import type { ConfirmRequest, PublishReport, PublishUi } from "../sync/publish";
import { confirmWithModal } from "./confirm-modal";
import { showReportModal } from "./report-modal";

export interface DisposablePublishUi extends PublishUi {
  /** 反映が終わったら必ず呼ぶ。残っている進捗Noticeを閉じる */
  dispose: () => void;
}

function progressMessage(message: string, detail?: string): string | DocumentFragment {
  const headline = `Nekote Blog: ${message}`;
  if (detail === undefined) return headline;

  return createFragment((fragment) => {
    fragment.append(headline, createEl("br"), detail);
  });
}

export function createPublishUi(app: App): DisposablePublishUi {
  let progressNotice: Notice | null = null;

  const hideProgress = (): void => {
    progressNotice?.hide();
    progressNotice = null;
  };

  return {
    confirm: (request: ConfirmRequest) => {
      // 確認を出すあいだは進捗を消す（モーダルの上に残ると読みにくい）
      hideProgress();
      return confirmWithModal(app, request);
    },
    progress: (message: string, detail?: string) => {
      const text = progressMessage(message, detail);
      if (progressNotice === null) progressNotice = new Notice(text, 3000);
      else progressNotice.setMessage(text);
    },
    notice: (message: string, durationMs?: number) => {
      hideProgress();
      new Notice(message, durationMs);
    },
    report: (report: PublishReport) => {
      hideProgress();
      const quiet =
        report.outcome === "applied" &&
        report.articles.every((article) => article.issues.length === 0) &&
        (report.samples ?? []).length === 0;
      if (quiet) {
        new Notice(`Nekote Blog: ${report.headline}`, 8000);
        return;
      }
      showReportModal(app, report);
    },
    dispose: hideProgress,
  };
}
