// プラグインのエントリ。Obsidian APIに触れるのはこのファイルと設定画面だけで、
// API・端末認可・保存はObsidianに依存しないモジュールへ閉じてある
// （デスクトップ・モバイルで同じ`main.js`・同じ状態機械を使う）。
import { Plugin, Platform, requestUrl } from "obsidian";
import { NekoteApiClient } from "./api/client";
import { apiBaseUrl } from "./api/endpoints";
import type { HttpFetch } from "./api/http";
import { createSleep } from "./auth/device-authorization";
import { ConnectionService } from "./connection/connection-service";
import { NekoteBlogSettingTab } from "./settings/settings-tab";
import {
  DEFAULT_SETTINGS,
  parsePluginSettings,
  serializePluginSettings,
  type ConnectionHint,
  type PluginSettings,
} from "./storage/plugin-data";
import { SecretStore } from "./storage/secrets";

export default class NekoteBlogPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  secrets!: SecretStore;
  connection!: ConnectionService;

  async onload(): Promise<void> {
    this.settings = parsePluginSettings(await this.loadData());
    this.secrets = new SecretStore(this.app.secretStorage);
    // 前回の認可が中断されたまま残ることがある。次の認可は必ず作り直すので消してよい
    this.secrets.clearPendingAuthorization();

    const client = new NekoteApiClient({
      fetch: obsidianFetch,
      getBaseUrl: () => apiBaseUrl(this.settings.apiEnvironment),
      getToken: () => this.secrets.getPushToken(),
    });
    this.connection = new ConnectionService({
      client,
      secrets: this.secrets,
      now: () => Date.now(),
      sleep: createSleep(),
      saveConnectionHint: (hint: ConnectionHint | null) =>
        this.updateSettings({ connection: hint }),
    });

    this.addSettingTab(new NekoteBlogSettingTab(this.app, this));
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
