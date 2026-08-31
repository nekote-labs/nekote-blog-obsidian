// 設定画面。接続・接続状態の確認・接続解除と、公開の設定（コンテンツルート）を扱う。
import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { API_BASE_URLS, type ApiEnvironment } from "../api/endpoints";
import type { DeviceAuthorizationPrompt } from "../auth/device-authorization";
import { NekoteApiError } from "../protocol/errors";
import type { ConnectionResponse } from "../protocol/types";
import { describeContentRoot } from "../sync/publish";
import type NekoteBlogPlugin from "../main";

/** コンテンツルートのdropdownで「未選択」「vaultのルート」を表す値 */
const CONTENT_ROOT_NONE = "__none__";
const CONTENT_ROOT_VAULT = "__vault__";

export class NekoteBlogSettingTab extends PluginSettingTab {
  private readonly plugin: NekoteBlogPlugin;
  /** 認可の進行中だけ立つ。UIの再描画で作り直す */
  private authorizationController: AbortController | null = null;
  private prompt: DeviceAuthorizationPrompt | null = null;
  private connection: ConnectionResponse | null = null;
  private deviceName: string;

  constructor(app: App, plugin: NekoteBlogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.deviceName = plugin.defaultDeviceName();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    if (this.prompt !== null) {
      this.renderAuthorizationPrompt(containerEl);
      return;
    }

    // 認可開始直後。user codeが来るまで接続ボタンを出さない
    if (this.authorizationController !== null) {
      this.renderAuthorizationStarting(containerEl);
      return;
    }

    if (this.plugin.connection.isConnected()) {
      this.renderConnected(containerEl);
    } else {
      this.renderDisconnected(containerEl);
    }

    this.renderPublishing(containerEl);
    this.renderAdvanced(containerEl);
  }

  hide(): void {
    // 設定画面を閉じたらpollを止める（開き直せばやり直せる）
    this.cancelAuthorization();
  }

  // --- 未接続 ---------------------------------------------------------------

  private renderDisconnected(container: HTMLElement): void {
    new Setting(container).setName("接続").setHeading();

    container.createEl("p", {
      cls: "nekote-blog-description",
      text: "Nekote Blogのアカウントとブログが必要です。接続するとブラウザで承認画面が開きます。",
    });

    new Setting(container)
      .setName("端末名")
      .setDesc("承認画面とダッシュボードの端末一覧に表示されます。")
      .addText((text) =>
        text
          .setPlaceholder("Obsidian")
          .setValue(this.deviceName)
          .onChange((value) => {
            this.deviceName = value;
          }),
      );

    new Setting(container)
      .setName("Nekote Blogと接続")
      .setDesc("この端末だけの接続です。別の端末では改めて接続します。")
      .addButton((button) =>
        button
          .setButtonText("接続")
          .setCta()
          .onClick(() => {
            void this.startAuthorization();
          }),
      );
  }

  // --- 認可開始直後 -----------------------------------------------------------

  private renderAuthorizationStarting(container: HTMLElement): void {
    new Setting(container).setName("承認を待っています").setHeading();

    container.createEl("p", {
      cls: "nekote-blog-description",
      text: "接続を開始しています…",
    });

    new Setting(container).addButton((button) =>
      button.setButtonText("中止").onClick(() => {
        this.cancelAuthorization();
        this.display();
      }),
    );
  }

  // --- 承認待ち -------------------------------------------------------------

  private renderAuthorizationPrompt(container: HTMLElement): void {
    const prompt = this.prompt;
    if (prompt === null) return;

    new Setting(container).setName("承認を待っています").setHeading();

    container.createEl("p", {
      cls: "nekote-blog-description",
      text: "ブラウザで開いたページに次のコードが表示されていることを確認して、承認してください。",
    });
    container.createEl("div", { cls: "nekote-blog-user-code", text: prompt.userCode });

    new Setting(container)
      .setName("承認ページ")
      .setDesc(prompt.verificationUri)
      .addButton((button) =>
        button.setButtonText("もう一度開く").onClick(() => {
          this.plugin.openExternal(prompt.verificationUriComplete);
        }),
      );

    new Setting(container).addButton((button) =>
      button.setButtonText("中止").onClick(() => {
        this.cancelAuthorization();
        this.display();
      }),
    );
  }

  // --- 接続済み -------------------------------------------------------------

  private renderConnected(container: HTMLElement): void {
    new Setting(container).setName("接続").setHeading();

    const hint = this.plugin.settings.connection;
    new Setting(container)
      .setName("接続先のブログ")
      .setDesc(
        hint === null
          ? "接続情報を取得できていません。"
          : `${hint.blog.title}（${hint.blog.subdomain}.nekote.blog）`,
      );

    new Setting(container).setName("この端末").setDesc(hint === null ? "不明" : hint.device.name);

    new Setting(container)
      .setName("接続状態")
      .setDesc(describeConnection(this.connection))
      .addButton((button) =>
        button.setButtonText("最新の状態を確認").onClick(() => {
          void this.refreshConnection();
        }),
      );

    new Setting(container)
      .setName("接続を解除")
      .setDesc(
        "この端末のトークンを失効させます。公開中の記事はそのまま残ります。再び反映するには接続し直します。",
      )
      .addButton((button) =>
        button
          .setButtonText("解除")
          .setWarning()
          .onClick(() => {
            void this.disconnect();
          }),
      );
  }

  // --- 公開 -----------------------------------------------------------------

  private renderPublishing(container: HTMLElement): void {
    new Setting(container).setName("公開").setHeading();

    container.createEl("p", {
      cls: "nekote-blog-description",
      text:
        "コンテンツルート直下の posts/ が記事、pages/ が固定ページになります。" +
        "本文とfrontmatterから参照している画像などは、コンテンツルートの外にあっても一緒に送ります。",
    });

    new Setting(container)
      .setName("コンテンツルート")
      .setDesc("公開の起点にするフォルダです。選ぶまで反映できません。")
      .addDropdown((dropdown) => {
        dropdown.addOption(CONTENT_ROOT_NONE, "（未選択）");
        dropdown.addOption(CONTENT_ROOT_VAULT, describeContentRoot(""));
        const folders = this.plugin.folderPaths().filter((path) => path !== "");
        // 選択済みのフォルダが消えた・名前が変わった場合も、いま何が設定されているかは見せる
        const current = this.plugin.settings.contentRoot;
        if (current !== null && current !== "" && !folders.includes(current)) {
          dropdown.addOption(current, `${current}（見つかりません）`);
        }
        for (const path of folders) dropdown.addOption(path, path);
        dropdown.setValue(toDropdownValue(current));
        dropdown.onChange((value) => {
          void this.changeContentRoot(value);
        });
      });

    const lastPush = this.plugin.settings.lastPush;
    new Setting(container)
      .setName("最終反映")
      .setDesc(
        lastPush === null
          ? "まだ反映していません。"
          : `${formatDateTime(lastPush.syncedAt)}（revision ${lastPush.revision}）`,
      );

    new Setting(container)
      .setName("Nekote Blogへ反映")
      .setDesc("いまのvaultの内容を送ります。送る前に内容を確認できます。")
      .addButton((button) =>
        button
          .setButtonText("反映")
          .setCta()
          .setDisabled(
            !this.plugin.connection.isConnected() || this.plugin.settings.contentRoot === null,
          )
          .onClick(() => {
            void this.plugin.publish();
          }),
      );
  }

  // --- 詳細設定 -------------------------------------------------------------

  private renderAdvanced(container: HTMLElement): void {
    new Setting(container).setName("詳細").setHeading();

    new Setting(container)
      .setName("接続先")
      .setDesc(
        this.plugin.connection.isConnected()
          ? "接続中は変更できません。変更するには一度接続を解除してください。"
          : API_BASE_URLS[this.plugin.settings.apiEnvironment],
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("production", "本番")
          .addOption("staging", "staging（検証用）")
          .setValue(this.plugin.settings.apiEnvironment)
          .setDisabled(this.plugin.connection.isConnected())
          .onChange((value) => {
            void this.changeEnvironment(value as ApiEnvironment);
          }),
      );
  }

  // --- 操作 -----------------------------------------------------------------

  private async startAuthorization(): Promise<void> {
    // 進行中なら重ねて開始しない（連打で古いpollが残るのを防ぐ）
    if (this.authorizationController !== null) return;

    const deviceName = this.deviceName.trim() || this.plugin.defaultDeviceName();
    const controller = new AbortController();
    this.authorizationController = controller;
    this.display(); // 接続ボタンを消して開始中表示にする

    try {
      const result = await this.plugin.connection.connect({
        deviceName,
        signal: controller.signal,
        onPrompt: (prompt) => {
          this.prompt = prompt;
          this.plugin.openExternal(prompt.verificationUriComplete);
          this.display();
        },
      });

      switch (result.status) {
        case "approved":
          new Notice(`Nekote Blog: ${result.blog.title} と接続しました。`);
          break;
        case "denied":
          new Notice("Nekote Blog: 承認が拒否されました。");
          break;
        case "expired":
          new Notice("Nekote Blog: 承認の有効期限が切れました。もう一度お試しください。");
          break;
        case "cancelled":
          break;
      }
    } catch (error) {
      notifyError(error);
    } finally {
      if (this.authorizationController === controller) {
        this.authorizationController = null;
      }
      this.prompt = null;
      this.display();
    }
  }

  private cancelAuthorization(): void {
    this.authorizationController?.abort();
    this.authorizationController = null;
    this.prompt = null;
  }

  private async refreshConnection(): Promise<void> {
    try {
      this.connection = await this.plugin.connection.fetchConnection();
      new Notice("Nekote Blog: 接続状態を更新しました。");
    } catch (error) {
      this.connection = null;
      notifyError(error);
    }
    this.display();
  }

  private async disconnect(): Promise<void> {
    const result = await this.plugin.connection.disconnect();
    this.connection = null;
    if (result.revokedOnServer) {
      new Notice("Nekote Blog: 接続を解除しました。");
    } else {
      new Notice(
        "Nekote Blog: この端末の情報は削除しましたが、サーバー側の失効に失敗しました" +
          `（${result.reason ?? "原因不明"}）。ダッシュボードの端末一覧から失効させてください。`,
        10000,
      );
    }
    this.display();
  }

  private async changeEnvironment(environment: ApiEnvironment): Promise<void> {
    await this.plugin.updateSettings({ apiEnvironment: environment });
    this.display();
  }

  private async changeContentRoot(value: string): Promise<void> {
    await this.plugin.updateSettings({ contentRoot: fromDropdownValue(value) });
    this.display();
  }
}

function toDropdownValue(contentRoot: string | null): string {
  if (contentRoot === null) return CONTENT_ROOT_NONE;
  return contentRoot === "" ? CONTENT_ROOT_VAULT : contentRoot;
}

function fromDropdownValue(value: string): string | null {
  if (value === CONTENT_ROOT_NONE) return null;
  return value === CONTENT_ROOT_VAULT ? "" : value;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function describeConnection(connection: ConnectionResponse | null): string {
  if (connection === null) return "未確認";
  switch (connection.source.kind) {
    case "none":
      return "コンテンツソース未設定（初回の反映で接続されます）";
    case "other":
      return `別のソース（${connection.source.type}）が接続中です。初回の反映で切り替わります。`;
    case "obsidian":
      return (
        `Obsidianソース接続中 / revision ${connection.source.appliedRevision}` +
        ` / コンテンツルート「${connection.source.contentRoot === "" ? "（vaultルート）" : connection.source.contentRoot}」`
      );
  }
}

function notifyError(error: unknown): void {
  const message =
    error instanceof NekoteApiError
      ? error.message
      : "予期しないエラーが発生しました。しばらく待ってからお試しください。";
  new Notice(`Nekote Blog: ${message}`, 10000);
}
