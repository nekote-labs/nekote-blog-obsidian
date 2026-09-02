// 設定画面。接続・接続状態の確認・接続解除と、記事を置く場所（コンテンツルート）・公開の設定を扱う。
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
/** 画像の取り込み先dropdownで「既定（コンテンツルート直下のassets）」を表す値 */
const IMPORT_FOLDER_DEFAULT = "__default__";

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

    this.renderContentLocation(containerEl);
    this.renderPublishing(containerEl);
    this.renderAdvanced(containerEl);
  }

  hide(): void {
    // 設定画面を閉じたらpollを止める（開き直せばやり直せる）
    this.cancelAuthorization();
  }

  // --- 未接続 ---------------------------------------------------------------

  private renderDisconnected(container: HTMLElement): void {
    new Setting(container).setName("Connection").setHeading();

    container.createEl("p", {
      cls: "nekote-blog-description",
      text: "You need a Nekote Blog account and a blog. Connecting opens an approval page in your browser.",
    });

    new Setting(container)
      .setName("Device name")
      .setDesc("Shown on the approval page and in the device list on your dashboard.")
      .addText((text) =>
        text
          .setPlaceholder("Obsidian")
          .setValue(this.deviceName)
          .onChange((value) => {
            this.deviceName = value;
          }),
      );

    new Setting(container)
      .setName("Connect to Nekote Blog")
      .setDesc("This connects only this device. Connect again on each other device.")
      .addButton((button) =>
        button
          .setButtonText("Connect")
          .setCta()
          .onClick(() => {
            void this.startAuthorization();
          }),
      );
  }

  // --- 認可開始直後 -----------------------------------------------------------

  private renderAuthorizationStarting(container: HTMLElement): void {
    new Setting(container).setName("Waiting for approval").setHeading();

    container.createEl("p", {
      cls: "nekote-blog-description",
      text: "Starting the connection…",
    });

    new Setting(container).addButton((button) =>
      button.setButtonText("Cancel").onClick(() => {
        this.cancelAuthorization();
        this.display();
      }),
    );
  }

  // --- 承認待ち -------------------------------------------------------------

  private renderAuthorizationPrompt(container: HTMLElement): void {
    const prompt = this.prompt;
    if (prompt === null) return;

    new Setting(container).setName("Waiting for approval").setHeading();

    container.createEl("p", {
      cls: "nekote-blog-description",
      text: "Check that the page opened in your browser shows the code below, then approve it.",
    });
    container.createEl("div", { cls: "nekote-blog-user-code", text: prompt.userCode });

    new Setting(container)
      .setName("Approval page")
      .setDesc(prompt.verificationUri)
      .addButton((button) =>
        button.setButtonText("Open again").onClick(() => {
          this.plugin.openExternal(prompt.verificationUriComplete);
        }),
      );

    new Setting(container).addButton((button) =>
      button.setButtonText("Cancel").onClick(() => {
        this.cancelAuthorization();
        this.display();
      }),
    );
  }

  // --- 接続済み -------------------------------------------------------------

  private renderConnected(container: HTMLElement): void {
    new Setting(container).setName("Connection").setHeading();

    const hint = this.plugin.settings.connection;
    new Setting(container)
      .setName("Connected blog")
      .setDesc(
        hint === null
          ? "Connection details are not available."
          : `${hint.blog.title} (${hint.blog.subdomain}.nekote.blog)`,
      );

    new Setting(container)
      .setName("This device")
      .setDesc(hint === null ? "Unknown" : hint.device.name);

    new Setting(container)
      .setName("Status")
      .setDesc(describeConnection(this.connection))
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(() => {
          void this.refreshConnection();
        }),
      );

    new Setting(container)
      .setName("Disconnect")
      .setDesc(
        "Revokes the token for this device. Published posts stay online. To publish again, connect once more.",
      )
      .addButton((button) =>
        button
          .setButtonText("Disconnect")
          .setWarning()
          .onClick(() => {
            void this.disconnect();
          }),
      );
  }

  // --- 記事を置く場所 -------------------------------------------------------

  private renderContentLocation(container: HTMLElement): void {
    new Setting(container).setName("Content location").setHeading();

    new Setting(container)
      .setName("Content root")
      .setDesc(
        "The folder publishing starts from. Directly inside it, posts/ holds posts and pages/ holds pages. You cannot publish until you choose one.",
      )
      .addDropdown((dropdown) => {
        dropdown.addOption(CONTENT_ROOT_NONE, "(not selected)");
        dropdown.addOption(CONTENT_ROOT_VAULT, describeContentRoot(""));
        const folders = this.plugin.folderPaths().filter((path) => path !== "");
        // 選択済みのフォルダが消えた・名前が変わった場合も、いま何が設定されているかは見せる
        const current = this.plugin.settings.contentRoot;
        if (current !== null && current !== "" && !folders.includes(current)) {
          dropdown.addOption(current, `${current} (not found)`);
        }
        for (const path of folders) dropdown.addOption(path, path);
        dropdown.setValue(toDropdownValue(current));
        dropdown.onChange((value) => {
          void this.changeContentRoot(value);
        });
      });

    new Setting(container)
      .setName("Image import folder")
      .setDesc(
        'The folder where "Import an image file…" saves images for thumbnails and cover images.',
      )
      .addDropdown((dropdown) => {
        dropdown.addOption(IMPORT_FOLDER_DEFAULT, "assets under the content root (default)");
        const folders = this.plugin.folderPaths().filter((path) => path !== "");
        // 選択済みのフォルダが消えた・名前が変わった場合も、いま何が設定されているかは見せる
        const current = this.plugin.settings.imageImportFolder;
        if (current !== null && !folders.includes(current)) {
          dropdown.addOption(current, `${current} (not found)`);
        }
        for (const path of folders) dropdown.addOption(path, path);
        dropdown.setValue(current ?? IMPORT_FOLDER_DEFAULT);
        dropdown.onChange((value) => {
          void this.plugin.updateSettings({
            imageImportFolder: value === IMPORT_FOLDER_DEFAULT ? null : value,
          });
        });
      });
  }

  // --- 公開 -----------------------------------------------------------------

  private renderPublishing(container: HTMLElement): void {
    new Setting(container).setName("Publishing").setHeading();

    new Setting(container)
      .setName("Insert frontmatter into new notes automatically")
      .setDesc(
        "Adds publishing frontmatter such as draft: true to empty notes created under posts or pages.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoInsertFrontmatter).onChange((value) => {
          void this.plugin.updateSettings({ autoInsertFrontmatter: value });
        }),
      );

    const lastPush = this.plugin.settings.lastPush;
    new Setting(container)
      .setName("Last publish")
      .setDesc(
        lastPush === null
          ? "Not published yet."
          : `${formatDateTime(lastPush.syncedAt)} (revision ${lastPush.revision})`,
      );

    new Setting(container)
      .setName("Publish to Nekote Blog")
      .setDesc("Sends the current contents of your vault. You can review them before sending.")
      .addButton((button) =>
        button
          .setButtonText("Publish")
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
    // 開発者専用（`data.json`へ`"devMode": true`を手書きした端末だけ）。
    // 配布ユーザーにstagingの選択肢を見せない。詳細セクションは今これしか無いので丸ごと消す
    if (!this.plugin.settings.devMode) return;

    new Setting(container).setName("Advanced").setHeading();

    new Setting(container)
      .setName("Server")
      .setDesc(
        this.plugin.connection.isConnected()
          ? "Cannot be changed while connected. Disconnect first to change it."
          : API_BASE_URLS[this.plugin.settings.apiEnvironment],
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("production", "Production")
          .addOption("staging", "Staging")
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
          new Notice(`Nekote Blog: Connected to ${result.blog.title}.`);
          break;
        case "denied":
          new Notice("Nekote Blog: The approval was denied.");
          break;
        case "expired":
          new Notice("Nekote Blog: The approval expired. Please try again.");
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
      new Notice("Nekote Blog: Connection status updated.");
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
      new Notice("Nekote Blog: Disconnected.");
    } else {
      new Notice(
        "Nekote Blog: This device was removed here, but revoking it on the server failed" +
          ` (${result.reason ?? "unknown reason"}). Revoke it from the device list on your dashboard.`,
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
  if (connection === null) return "Not checked yet";
  switch (connection.source.kind) {
    case "none":
      return "No content source set (your first publish will connect it)";
    case "other":
      return `Another source (${connection.source.type}) is connected. Your first publish will switch it over.`;
    case "obsidian":
      return (
        `Obsidian source connected / revision ${connection.source.appliedRevision}` +
        ` / content root "${connection.source.contentRoot === "" ? "(vault root)" : connection.source.contentRoot}"`
      );
  }
}

function notifyError(error: unknown): void {
  const message =
    error instanceof NekoteApiError
      ? error.message
      : "Something went wrong. Please wait a moment and try again.";
  new Notice(`Nekote Blog: ${message}`, 10000);
}
