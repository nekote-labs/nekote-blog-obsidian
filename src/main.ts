// プラグインのエントリ。Obsidian APIに触れるのはこのファイルと設定画面・UI・
// vault gatewayだけで、API・端末認可・保存・走査・正規化はObsidianに依存しない
// モジュールへ閉じてある（デスクトップ・モバイルで同じ`main.js`・同じ状態機械を使う）。
import { Notice, Platform, Plugin, parseYaml, requestUrl } from "obsidian";
import { NekoteApiClient } from "./api/client";
import { apiBaseUrl } from "./api/endpoints";
import type { HttpFetch } from "./api/http";
import { createSleep } from "./auth/device-authorization";
import { ConnectionService } from "./connection/connection-service";
import { randomBase64Url } from "./crypto/hash";
import { NekoteBlogSettingTab } from "./settings/settings-tab";
import {
  DEFAULT_SETTINGS,
  parsePluginSettings,
  serializePluginSettings,
  type ConnectionHint,
  type PluginSettings,
} from "./storage/plugin-data";
import { SecretStore } from "./storage/secrets";
import { publish } from "./sync/publish";
import { createPublishUi } from "./ui/publish-ui";
import { ObsidianVaultGateway } from "./vault/obsidian-gateway";

export default class NekoteBlogPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  secrets!: SecretStore;
  connection!: ConnectionService;
  private client!: NekoteApiClient;
  private vault!: ObsidianVaultGateway;
  /** 反映の実行中だけ立つ。二重実行を防ぎ、プラグイン無効化で中断する */
  private publishing: AbortController | null = null;

  async onload(): Promise<void> {
    this.settings = parsePluginSettings(await this.loadData());
    this.secrets = new SecretStore(this.app.secretStorage);
    // 前回の認可が中断されたまま残ることがある。次の認可は必ず作り直すので消してよい
    this.secrets.clearPendingAuthorization();

    this.client = new NekoteApiClient({
      fetch: obsidianFetch,
      getBaseUrl: () => apiBaseUrl(this.settings.apiEnvironment),
      getToken: () => this.secrets.getPushToken(),
    });
    this.vault = new ObsidianVaultGateway(this.app);
    this.connection = new ConnectionService({
      client: this.client,
      secrets: this.secrets,
      now: () => Date.now(),
      sleep: createSleep(),
      saveConnectionHint: (hint: ConnectionHint | null) =>
        this.updateSettings({ connection: hint }),
    });

    this.addSettingTab(new NekoteBlogSettingTab(this.app, this));
    this.addCommand({
      id: "publish",
      name: "Nekote Blogへ反映",
      callback: () => {
        void this.publish();
      },
    });
  }

  onunload(): void {
    this.publishing?.abort();
  }

  /**
   * vaultを走査してPushする。**同時に1つだけ**（走査中に別の走査が始まると、
   * 同じPush世代へ違うmanifestを送ることになる）
   */
  async publish(): Promise<void> {
    if (this.publishing !== null) {
      new Notice("Nekote Blog: すでに反映を実行しています。");
      return;
    }
    if (!this.connection.isConnected()) {
      new Notice("Nekote Blog: 先に設定画面からブログと接続してください。", 8000);
      return;
    }

    const controller = new AbortController();
    this.publishing = controller;
    const ui = createPublishUi(this.app);
    const sleep = createSleep();
    try {
      await publish({
        client: this.client,
        secrets: this.secrets,
        vault: this.vault,
        parseYaml,
        ui,
        settings: () => this.settings,
        updateSettings: (patch) => this.updateSettings(patch),
        sleep: (milliseconds) => sleep(milliseconds, controller.signal),
        now: () => Date.now(),
        newVaultId: () => randomBase64Url(16),
        signal: controller.signal,
      });
    } finally {
      ui.dispose();
      this.publishing = null;
    }
  }

  async updateSettings(patch: Partial<PluginSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.saveData(serializePluginSettings(this.settings));
  }

  /** 承認画面と端末一覧に出す既定の端末名 */
  defaultDeviceName(): string {
    if (Platform.isIosApp) return "Obsidian (iOS)";
    if (Platform.isAndroidApp) return "Obsidian (Android)";
    if (Platform.isMobile) return "Obsidian (Mobile)";
    return "Obsidian (Desktop)";
  }

  /** vault内のフォルダ一覧（コンテンツルートの選択肢） */
  folderPaths(): string[] {
    return this.vault.listFolderPaths();
  }

  /** 承認ページを既定のブラウザで開く。Electronのshellは使わない（モバイル非対応） */
  openExternal(url: string): void {
    window.open(url, "_blank");
  }
}

/**
 * `requestUrl()`はCORS制約を受けず、モバイルでも動く唯一のHTTP経路。
 * `throw: false`にして、statusの解釈はAPIクライアント側へ寄せる。
 */
const obsidianFetch: HttpFetch = async (request) => {
  const response = await requestUrl({
    url: request.url,
    method: request.method,
    headers: request.headers,
    ...(request.contentType === undefined ? {} : { contentType: request.contentType }),
    ...(request.body === undefined ? {} : { body: request.body }),
    throw: false,
  });
  return { status: response.status, headers: response.headers, text: response.text };
};
