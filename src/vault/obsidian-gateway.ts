// `VaultGateway`のObsidian実装。Obsidian APIに触れるのはこのファイルと
// 設定画面・UI・エントリだけに閉じてある。
import type { App, TFile } from "obsidian";
import { getTranslations } from "../i18n";
import { normalizeVaultPath } from "./paths";
import type { VaultFileRef, VaultGateway } from "./gateway";

function toRef(file: TFile): VaultFileRef {
  return {
    path: normalizeVaultPath(file.path),
    vaultPath: file.path,
    extension: file.extension.toLowerCase(),
    size: file.stat.size,
  };
}

export class ObsidianVaultGateway implements VaultGateway {
  private readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  listFiles(): VaultFileRef[] {
    return this.app.vault.getFiles().map(toRef);
  }

  listFolderPaths(): string[] {
    return this.app.vault.getAllFolders(true).map((folder) => normalizeVaultPath(folder.path));
  }

  /**
   * **`cachedRead()`は使わない。** 走査は全記事を1件ずつ読むだけで読み返さないため、
   * キャッシュへ載せるとvaultの大きさに比例してメモリを持ち続けることになる
   * （モバイルで大きなvaultを全件メモリへ載せない、が完了条件）
   */
  async readText(file: VaultFileRef): Promise<string> {
    return this.app.vault.read(this.resolve(file));
  }

  async readBinary(file: VaultFileRef): Promise<ArrayBuffer> {
    return this.app.vault.readBinary(this.resolve(file));
  }

  resolveLinkpath(linkpath: string, sourcePath: string): VaultFileRef | null {
    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    return file === null ? null : toRef(file);
  }

  /**
   * 走査の途中でファイルが消えた・リネームされた場合はここで例外になる。
   * 走査全体を失敗させ、消えたファイルを「削除」として送らないための境界
   */
  private resolve(file: VaultFileRef): TFile {
    const found = this.app.vault.getFileByPath(file.vaultPath);
    if (found === null) {
      throw new Error(getTranslations().vault.unreadableFile(file.path));
    }
    return found;
  }
}
