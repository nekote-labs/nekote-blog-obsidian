// 設定画面。接続・接続状態の確認・接続解除と、記事を置く場所（コンテンツルート）・公開の設定を扱う。
//
// Obsidian 1.13の宣言的設定API（`getSettingDefinitions()`）で組む。状態ごとの出し分けは
// 定義の`visible`で表し、見出し・説明文が変わる操作のあとは`update()`で定義を作り直す。
import {
  Notice,
  PluginSettingTab,
  type App,
  type SettingDefinition,
  type SettingDefinitionGroup,
  type SettingDefinitionItem,
} from "obsidian";
import { API_BASE_URLS, isApiEnvironment } from "../api/endpoints";
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

/**
 * controlの`key`。値は`getControlValue()`/`setControlValue()`だけを通って出入りする。
 * `deviceName`以外は`PluginSettings`のキーと同名にしてある
 */
const KEY_DEVICE_NAME = "deviceName";
const KEY_CONTENT_ROOT = "contentRoot";
const KEY_IMAGE_IMPORT_FOLDER = "imageImportFolder";
const KEY_AUTO_INSERT_FRONTMATTER = "autoInsertFrontmatter";
const KEY_API_ENVIRONMENT = "apiEnvironment";

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

  getSettingDefinitions(): SettingDefinitionItem[] {
    // グループの並びは常に固定し、出し分けは`visible`で行う（再描画でDOMを使い回せる）
    return [
      this.authorizationGroup(),
      this.connectionGroup(),
      this.contentLocationGroup(),
      this.publishingGroup(),
      this.advancedGroup(),
    ];
  }

  /**
   * controlの現在値を返す。基底実装は`plugin.settings`を直接読むが、
   * dropdownの番兵値へ変換する必要があるものと、設定に持たない`deviceName`があるためoverrideする
   */
  getControlValue(key: string): unknown {
    switch (key) {
      case KEY_DEVICE_NAME:
        // 端末名は保存しない。承認画面へ渡すだけの、設定画面を開いている間の一時値
        return this.deviceName;
      case KEY_CONTENT_ROOT:
        return toDropdownValue(this.plugin.settings.contentRoot);
      case KEY_IMAGE_IMPORT_FOLDER:
        return this.plugin.settings.imageImportFolder ?? IMPORT_FOLDER_DEFAULT;
      case KEY_AUTO_INSERT_FRONTMATTER:
        return this.plugin.settings.autoInsertFrontmatter;
      case KEY_API_ENVIRONMENT:
        return this.plugin.settings.apiEnvironment;
      default:
        return super.getControlValue(key);
    }
  }

  /**
   * controlの変更を保存する。基底実装は`plugin.settings`を直接書き換えて`saveData()`するため、
   * 保存を`updateSettings()`へ集約しているこのプラグインでは使えない
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case KEY_DEVICE_NAME:
        this.deviceName = String(value);
        return;
      case KEY_CONTENT_ROOT:
        await this.plugin.updateSettings({ contentRoot: fromDropdownValue(String(value)) });
        // 「(not found)」の選択肢と公開ボタンの活性が変わるので定義から作り直す
        this.update();
        return;
      case KEY_IMAGE_IMPORT_FOLDER: {
        const folder = String(value);
        await this.plugin.updateSettings({
          imageImportFolder: folder === IMPORT_FOLDER_DEFAULT ? null : folder,
        });
        return;
      }
      case KEY_AUTO_INSERT_FRONTMATTER:
        await this.plugin.updateSettings({ autoInsertFrontmatter: value === true });
        return;
      case KEY_API_ENVIRONMENT:
        if (!isApiEnvironment(value)) return;
        await this.plugin.updateSettings({ apiEnvironment: value });
        // 説明文に出している接続先URLを差し替えるため作り直す
        this.update();
        return;
      default:
        await super.setControlValue(key, value);
    }
  }

  hide(): void {
    // 設定画面を閉じたらpollを止める（開き直せばやり直せる）
    this.cancelAuthorization();
  }

  // --- 承認待ち -------------------------------------------------------------

  /**
   * 認可の進行中に出すグループ。開始直後（user code待ち）と承認待ちを`visible`で出し分ける。
   * この間は接続以外のセクションを出さない
   */
  private authorizationGroup(): SettingDefinitionGroup {
    const starting = () => this.authorizationController !== null && this.prompt === null;
    const waiting = () => this.prompt !== null;
    return {
      type: "group",
      heading: "Waiting for approval",
      visible: () => this.isAuthorizing(),
      items: [
        descriptionItem("Starting the connection…", starting),
        descriptionItem(
          "Check that the page opened in your browser shows the code below, then approve it.",
          waiting,
        ),
        {
          name: "",
          visible: waiting,
          render: (setting) => {
            // 再描画で二重に生えないよう、行の中身ごと作り直す
            setting.infoEl.empty();
            setting.infoEl.createDiv({
              cls: "nekote-blog-user-code",
              text: this.prompt?.userCode ?? "",
            });
          },
        },
        {
          name: "Approval page",
          desc: this.prompt?.verificationUri ?? "",
          visible: waiting,
          render: (setting) => {
            setting.addButton((button) =>
              button.setButtonText("Open again").onClick(() => {
                const prompt = this.prompt;
                if (prompt !== null) this.plugin.openExternal(prompt.verificationUriComplete);
              }),
            );
          },
        },
        {
          name: "",
          render: (setting) => {
            setting.addButton((button) =>
              button.setButtonText("Cancel").onClick(() => {
                this.cancelAuthorization();
                this.update();
              }),
            );
          },
        },
      ],
    };
  }

  // --- 接続 -----------------------------------------------------------------

  private connectionGroup(): SettingDefinitionGroup {
    const connected = () => this.plugin.connection.isConnected();
    const disconnected = () => !connected();
    const hint = this.plugin.settings.connection;
    return {
      type: "group",
      heading: "Connection",
      visible: () => !this.isAuthorizing(),
      items: [
        descriptionItem(
          "You need a Nekote Blog account and a blog. Connecting opens an approval page in your browser.",
          disconnected,
        ),
        {
          name: "Device name",
          desc: "Shown on the approval page and in the device list on your dashboard.",
          visible: disconnected,
          control: { type: "text", key: KEY_DEVICE_NAME, placeholder: "Obsidian" },
        },
        {
          name: "Connect to Nekote Blog",
          desc: "This connects only this device. Connect again on each other device.",
          visible: disconnected,
          render: (setting) => {
            setting.addButton((button) =>
              button
                .setButtonText("Connect")
                .setCta()
                .onClick(() => {
                  void this.startAuthorization();
                }),
            );
          },
        },
        {
          name: "Connected blog",
          desc:
            hint === null
              ? "Connection details are not available."
              : `${hint.blog.title} (${hint.blog.subdomain}.nekote.blog)`,
          visible: connected,
        },
        {
          name: "This device",
          desc: hint === null ? "Unknown" : hint.device.name,
          visible: connected,
        },
        {
          name: "Status",
          desc: describeConnection(this.connection),
          visible: connected,
          render: (setting) => {
            setting.addButton((button) =>
              button.setButtonText("Refresh").onClick(() => {
                void this.refreshConnection();
              }),
            );
          },
        },
        {
          name: "Disconnect",
          desc: "Revokes the token for this device. Published posts stay online. To publish again, connect once more.",
          visible: connected,
          render: (setting) => {
            setting.addButton((button) =>
              button
                .setButtonText("Disconnect")
                .setDestructive()
                .onClick(() => {
                  void this.disconnect();
                }),
            );
          },
        },
      ],
    };
  }

  // --- 記事を置く場所 -------------------------------------------------------

  private contentLocationGroup(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: "Content location",
      visible: () => !this.isAuthorizing(),
      items: [
        {
          name: "Content root",
          desc: "The folder publishing starts from. Directly inside it, posts/ holds posts and pages/ holds pages. You cannot publish until you choose one.",
          control: {
            type: "dropdown",
            key: KEY_CONTENT_ROOT,
            options: this.contentRootOptions(),
          },
        },
        {
          name: "Image import folder",
          desc: 'The folder where "Import an image file…" saves images for thumbnails and cover images.',
          control: {
            type: "dropdown",
            key: KEY_IMAGE_IMPORT_FOLDER,
            options: this.imageImportFolderOptions(),
          },
        },
      ],
    };
  }

  /** コンテンツルートの選択肢 */
  private contentRootOptions(): Record<string, string> {
    const options: Record<string, string> = {
      [CONTENT_ROOT_NONE]: "(not selected)",
      [CONTENT_ROOT_VAULT]: describeContentRoot(""),
    };
    const folders = this.plugin.folderPaths().filter((path) => path !== "");
    // 選択済みのフォルダが消えた・名前が変わった場合も、いま何が設定されているかは見せる
    const current = this.plugin.settings.contentRoot;
    if (current !== null && current !== "" && !folders.includes(current)) {
      options[current] = `${current} (not found)`;
    }
    for (const path of folders) options[path] = path;
    return options;
  }

  /** 画像の取り込み先の選択肢 */
  private imageImportFolderOptions(): Record<string, string> {
    const options: Record<string, string> = {
      [IMPORT_FOLDER_DEFAULT]: "assets under the content root (default)",
    };
    const folders = this.plugin.folderPaths().filter((path) => path !== "");
    // 選択済みのフォルダが消えた・名前が変わった場合も、いま何が設定されているかは見せる
    const current = this.plugin.settings.imageImportFolder;
    if (current !== null && !folders.includes(current)) {
      options[current] = `${current} (not found)`;
    }
    for (const path of folders) options[path] = path;
    return options;
  }

  // --- 公開 -----------------------------------------------------------------

  private publishingGroup(): SettingDefinitionGroup {
    const lastPush = this.plugin.settings.lastPush;
    return {
      type: "group",
      heading: "Publishing",
      visible: () => !this.isAuthorizing(),
      items: [
        {
          name: "Insert frontmatter into new notes automatically",
          desc: "Adds publishing frontmatter such as draft: true to empty notes created under posts or pages.",
          control: { type: "toggle", key: KEY_AUTO_INSERT_FRONTMATTER },
        },
        {
          name: "Last publish",
          desc:
            lastPush === null
              ? "Not published yet."
              : `${formatDateTime(lastPush.syncedAt)} (revision ${lastPush.revision})`,
        },
        {
          name: "Publish to Nekote Blog",
          desc: "Sends the current contents of your vault. You can review them before sending.",
          render: (setting) => {
            setting.addButton((button) =>
              button
                .setButtonText("Publish")
                .setCta()
                .setDisabled(
                  !this.plugin.connection.isConnected() ||
                    this.plugin.settings.contentRoot === null,
                )
                .onClick(() => {
                  void this.plugin.publish();
                }),
            );
          },
        },
      ],
    };
  }

  // --- 詳細設定 -------------------------------------------------------------

  private advancedGroup(): SettingDefinitionGroup {
    return {
      type: "group",
      heading: "Advanced",
      // 開発者専用（`data.json`へ`"devMode": true`を手書きした端末だけ）。
      // 配布ユーザーにstagingの選択肢を見せない。詳細セクションは今これしか無いので丸ごと隠す
      visible: () => this.plugin.settings.devMode && !this.isAuthorizing(),
      items: [
        {
          name: "Server",
          desc: this.plugin.connection.isConnected()
            ? "Cannot be changed while connected. Disconnect first to change it."
            : API_BASE_URLS[this.plugin.settings.apiEnvironment],
          control: {
            type: "dropdown",
            key: KEY_API_ENVIRONMENT,
            options: { production: "Production", staging: "Staging" },
            disabled: () => this.plugin.connection.isConnected(),
          },
        },
      ],
    };
  }

  // --- 操作 -----------------------------------------------------------------

  /** 認可の進行中（開始直後・承認待ちのどちらか） */
  private isAuthorizing(): boolean {
    return this.authorizationController !== null || this.prompt !== null;
  }

  private async startAuthorization(): Promise<void> {
    // 進行中なら重ねて開始しない（連打で古いpollが残るのを防ぐ）
    if (this.authorizationController !== null) return;

    const deviceName = this.deviceName.trim() || this.plugin.defaultDeviceName();
    const controller = new AbortController();
    this.authorizationController = controller;
    this.update(); // 接続ボタンを消して開始中表示にする

    try {
      const result = await this.plugin.connection.connect({
        deviceName,
        signal: controller.signal,
        onPrompt: (prompt) => {
          this.prompt = prompt;
          this.plugin.openExternal(prompt.verificationUriComplete);
          this.update();
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
      this.update();
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
    this.update();
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
    this.update();
  }
}

/** 見出しの直下へ置く説明文。設定行ではなく段落として出す */
function descriptionItem(text: string, visible: () => boolean): SettingDefinition {
  return {
    name: "",
    visible,
    render: (setting) => {
      // 再描画で二重に生えないよう、行の中身ごと作り直す
      setting.infoEl.empty();
      setting.infoEl.createEl("p", { cls: "nekote-blog-description", text });
    },
  };
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
