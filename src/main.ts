// プラグインのエントリ。Obsidian APIに触れるのはこのファイルと設定画面・UI・
// vault gatewayだけで、API・端末認可・保存・走査・正規化はObsidianに依存しない
// モジュールへ閉じてある（デスクトップ・モバイルで同じ`main.js`・同じ状態機械を使う）。
import {
  MarkdownView,
  Menu,
  Notice,
  Platform,
  Plugin,
  TFile,
  parseYaml,
  requestUrl,
  type TAbstractFile,
} from "obsidian";
import { NekoteApiClient } from "./api/client";
import { apiBaseUrl } from "./api/endpoints";
import type { HttpFetch } from "./api/http";
import { createSleep } from "./auth/device-authorization";
import { ConnectionService } from "./connection/connection-service";
import { splitNote } from "./content/frontmatter";
import {
  applyFrontmatterTemplate,
  localIsoDate,
  needsFrontmatterTemplate,
} from "./content/frontmatter-template";
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
import { FrontmatterImageModal, type FrontmatterImageKey } from "./ui/frontmatter-image-modal";
import { PropertiesActions } from "./ui/properties-actions";
import { createPublishUi } from "./ui/publish-ui";
import { ObsidianVaultGateway } from "./vault/obsidian-gateway";
import { isPublishTargetVaultPath } from "./vault/paths";

export default class NekoteBlogPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  secrets!: SecretStore;
  connection!: ConnectionService;
  private client!: NekoteApiClient;
  private vault!: ObsidianVaultGateway;
  /** 反映の実行中だけ立つ。二重実行を防ぎ、プラグイン無効化で中断する */
  private publishing: AbortController | null = null;
  /** ノートヘッダーへ足した反映ボタン。`addAction`に削除APIが無いので自分で持つ */
  private readonly noteActions = new Map<MarkdownView, HTMLElement>();
  /** プロパティ欄の直下へDOM注入する画像選択ボタン行 */
  private readonly propertiesActions = new PropertiesActions((file, key) => {
    this.openImagePicker(file, key);
  });

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
      id: "open-settings",
      name: "Open settings",
      callback: () => {
        this.openSettings();
      },
    });
    this.addCommand({
      id: "publish",
      name: "Publish",
      callback: () => {
        void this.publish();
      },
    });
    this.addCommand({
      id: "insert-frontmatter",
      name: "Insert frontmatter",
      checkCallback: (checking) =>
        this.runWithPublishTarget(checking, (file) => {
          void this.insertFrontmatter(file);
        }),
    });
    this.addCommand({
      id: "pick-thumbnail",
      name: "Select thumbnail image",
      checkCallback: (checking) =>
        this.runWithPublishTarget(checking, (file) => {
          this.openImagePicker(file, "thumbnail");
        }),
    });
    this.addCommand({
      id: "pick-cover",
      name: "Select cover image",
      checkCallback: (checking) =>
        this.runWithPublishTarget(checking, (file) => {
          this.openImagePicker(file, "cover");
        }),
    });

    this.addRibbonIcon("cat", "Nekote Blog", (evt) => {
      this.showRibbonMenu(evt);
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        this.extendFileMenu(menu, file);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.syncNoteActions();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.syncNoteActions();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.syncNoteActions();
        void this.insertFrontmatterForMovedNote(file, oldPath);
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      // 起動時はvault内の全ファイル分の`create`が発火するため、ここまで登録を遅らせる
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          void this.insertFrontmatterForNewNote(file);
        }),
      );
      this.syncNoteActions();
      this.registerTitlePropertyType();
    });
  }

  onunload(): void {
    this.publishing?.abort();
    for (const action of this.noteActions.values()) action.remove();
    this.noteActions.clear();
    this.propertiesActions.dispose();
  }

  /**
   * vaultを走査してPushする。**同時に1つだけ**（走査中に別の走査が始まると、
   * 同じPush世代へ違うmanifestを送ることになる）
   */
  async publish(): Promise<void> {
    if (this.publishing !== null) {
      new Notice("Nekote Blog: Already publishing.");
      return;
    }
    if (!this.connection.isConnected()) {
      new Notice("Nekote Blog: Connect to your blog from the settings first.", 8000);
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
    // コンテンツルートの変更で公開対象が変わる。反映ボタンの表示を追従させる
    this.syncNoteActions();
  }

  // --- エディタまわりの導線 ---------------------------------------------------

  /** アクティブファイルが公開対象ノートのときだけコマンドを有効にする */
  private runWithPublishTarget(checking: boolean, run: (file: TFile) => void): boolean {
    const file = this.app.workspace.getActiveFile();
    if (file === null || !isPublishTargetVaultPath(file.path, this.settings.contentRoot)) {
      return false;
    }
    if (!checking) run(file);
    return true;
  }

  /** 公開対象フォルダに作られた空の新規ノートへfrontmatterのひな形を入れる */
  private async insertFrontmatterForNewNote(file: TAbstractFile): Promise<void> {
    if (!this.settings.autoInsertFrontmatter) return;
    if (!(file instanceof TFile)) return;
    if (!isPublishTargetVaultPath(file.path, this.settings.contentRoot)) return;
    try {
      // 空のファイルだけ。端末間同期などで届いた既存原稿へは挿入しない
      if ((await this.app.vault.read(file)).trim() !== "") return;
      await this.insertTemplate(file);
    } catch (error) {
      console.error("Nekote Blog: could not insert frontmatter automatically", error);
    }
  }

  /**
   * 公開対象の外から中へ移動・改名されたノートへひな形を入れる。
   * Obsidianの新規ノートはルート直下に作られやすく、あとから公開フォルダへ
   * 移す流れが基本になるため、`create`だけでは取りこぼす
   */
  private async insertFrontmatterForMovedNote(file: TAbstractFile, oldPath: string): Promise<void> {
    if (!this.settings.autoInsertFrontmatter) return;
    if (!(file instanceof TFile)) return;
    if (!isPublishTargetVaultPath(file.path, this.settings.contentRoot)) return;
    // 公開対象の中での移動・改名では動かさない（入ってきたときだけ）
    if (isPublishTargetVaultPath(oldPath, this.settings.contentRoot)) return;
    try {
      await this.insertTemplateIfMissing(file);
    } catch (error) {
      console.error("Nekote Blog: could not insert frontmatter automatically", error);
    }
  }

  /** コマンドからの挿入。既存ノートにも使えるよう、欠けているキーだけ足す */
  private async insertFrontmatter(file: TFile): Promise<void> {
    try {
      const changed = await this.insertTemplateIfMissing(file);
      new Notice(
        changed
          ? "Nekote Blog: Frontmatter inserted."
          : "Nekote Blog: Frontmatter is already there.",
      );
    } catch {
      new Notice("Nekote Blog: Could not insert frontmatter.");
    }
  }

  /**
   * 追加が必要なときだけ書き込む。`processFrontMatter()`はYAMLを再整形するため、
   * 全キーが揃っているファイルへは触れない
   */
  private async insertTemplateIfMissing(file: TFile): Promise<boolean> {
    const { yaml } = splitNote(await this.app.vault.read(file));
    const existing: unknown = yaml === null ? {} : parseYaml(yaml);
    if (!needsFrontmatterTemplate(existing)) return false;
    return this.insertTemplate(file);
  }

  private async insertTemplate(file: TFile): Promise<boolean> {
    let changed = false;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      changed = applyFrontmatterTemplate(frontmatter, localIsoDate(new Date()));
    });
    return changed;
  }

  private openImagePicker(file: TFile, key: FrontmatterImageKey): void {
    new FrontmatterImageModal(this.app, file, key, this.imageImportFolder()).open();
  }

  /** 画像取り込みの保存先。未設定ならコンテンツルート直下の`assets` */
  private imageImportFolder(): string {
    const custom = this.settings.imageImportFolder;
    if (custom !== null) return custom;
    const root = this.settings.contentRoot;
    return root === null || root === "" ? "assets" : `${root}/assets`;
  }

  private showRibbonMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Publish to Nekote Blog")
        .setIcon("upload")
        .onClick(() => {
          void this.publish();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Open settings")
        .setIcon("settings")
        .onClick(() => {
          this.openSettings();
        }),
    );
    menu.showAtMouseEvent(evt);
  }

  private extendFileMenu(menu: Menu, file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (!isPublishTargetVaultPath(file.path, this.settings.contentRoot)) return;
    menu.addItem((item) =>
      item
        .setTitle("Publish to Nekote Blog")
        .setIcon("upload")
        .onClick(() => {
          void this.publish();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Nekote Blog: Select thumbnail image")
        .setIcon("image")
        .onClick(() => {
          this.openImagePicker(file, "thumbnail");
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Nekote Blog: Select cover image")
        .setIcon("image")
        .onClick(() => {
          this.openImagePicker(file, "cover");
        }),
    );
  }

  /**
   * 開いているMarkdown viewへ反映ボタンとプロパティ欄のボタン行を行き渡らせ、
   * 公開対象ノートのときだけ見せる。
   * 閉じたviewの分はここで外す（プラグイン無効化時の後始末は`onunload`）
   */
  private syncNoteActions(): void {
    const open = new Set<MarkdownView>();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      open.add(view);
      let action = this.noteActions.get(view);
      if (action === undefined) {
        // 1クリックで反映を始めない。このノートに効く操作を集めたメニューを開く
        action = view.addAction("cat", "Nekote Blog", (evt) => {
          this.showNoteMenu(evt, view);
        });
        this.noteActions.set(view, action);
      }
      const isTarget =
        view.file !== null && isPublishTargetVaultPath(view.file.path, this.settings.contentRoot);
      action.toggle(isTarget);
      this.propertiesActions.sync(view, isTarget);
    }
    for (const [view, action] of this.noteActions) {
      if (open.has(view)) continue;
      action.remove();
      this.noteActions.delete(view);
      this.propertiesActions.detach(view);
    }
  }

  /** ノートヘッダーのボタンから開くメニュー。開いているノートに効く操作を集める */
  private showNoteMenu(evt: MouseEvent, view: MarkdownView): void {
    const file = view.file;
    if (file === null) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Publish to Nekote Blog")
        .setIcon("upload")
        .onClick(() => {
          void this.publish();
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Select thumbnail image")
        .setIcon("image")
        .onClick(() => {
          this.openImagePicker(file, "thumbnail");
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Select cover image")
        .setIcon("image")
        .onClick(() => {
          this.openImagePicker(file, "cover");
        }),
    );
    menu.addItem((item) =>
      item
        .setTitle("Insert frontmatter")
        .setIcon("list-plus")
        .onClick(() => {
          void this.insertFrontmatter(file);
        }),
    );
    menu.showAtMouseEvent(evt);
  }

  /**
   * `title`へtext型を登録し、プロパティ名の入力候補へ常に出す。
   * frontmatterテンプレートへ`title`は入れない方針のため、登録しないと候補に一切出ない
   * （Obsidianは「vault内で使用中」か「型登録済み」のプロパティだけを候補にする）。
   * 公開APIが無く内部API（`app.metadataTypeManager`）頼みなので、形が変わったら何もしない。
   * ユーザーが型を割り当て済みなら上書きしない
   */
  private registerTitlePropertyType(): void {
    const internal = (
      this.app as unknown as {
        metadataTypeManager?: {
          getAssignedWidget(name: string): string | null;
          setType(name: string, widget: string): Promise<void>;
        };
      }
    ).metadataTypeManager;
    if (typeof internal?.getAssignedWidget !== "function" || typeof internal.setType !== "function")
      return;
    if (internal.getAssignedWidget("title") !== null) return;
    internal.setType("title", "text").catch((error: unknown) => {
      console.error("Nekote Blog: could not register the type for the title property", error);
    });
  }

  /**
   * 設定画面を開く。公開APIが無く内部API（`app.setting`）頼みなので、
   * 形が変わって取れなくなったら操作の案内だけ出す
   */
  private openSettings(): void {
    const internal = (
      this.app as unknown as {
        setting?: { open(): void; openTabById(id: string): void };
      }
    ).setting;
    if (typeof internal?.open !== "function" || typeof internal.openTabById !== "function") {
      new Notice(
        "Nekote Blog: Open settings > Community plugins > Nekote Blog to change the settings.",
      );
      return;
    }
    internal.open();
    internal.openTabById(this.manifest.id);
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
