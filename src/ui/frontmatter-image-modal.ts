// frontmatterの`thumbnail`・`cover`へ入れる画像を選ぶモーダル。
//
// vault内のラスタ画像から選ぶか、端末のファイルを選んでvaultへ取り込む。
// 書き込む値はノート起点の相対path。サーバーは本文画像と同じく
// `decodeURIComponent()`で解決するため、`encodePathForMarkdownUrl()`で符号化する。
import { FuzzySuggestModal, Notice, TFile, type App, type Vault } from "obsidian";
import { classifyAssetPath } from "../normalize/assets";
import { encodePathForMarkdownUrl, normalizeVaultPath, relativePathFrom } from "../vault/paths";

export type FrontmatterImageKey = "thumbnail" | "cover";

const KEY_LABELS: Record<FrontmatterImageKey, string> = {
  thumbnail: "thumbnail",
  cover: "cover image",
};

type PickerItem = { kind: "import" } | { kind: "asset"; file: TFile };

export class FrontmatterImageModal extends FuzzySuggestModal<PickerItem> {
  private readonly note: TFile;
  private readonly key: FrontmatterImageKey;
  /** 取り込んだ画像の保存先フォルダ（vaultルート相対。既定はコンテンツルート直下の`assets`） */
  private readonly importFolder: string;

  constructor(app: App, note: TFile, key: FrontmatterImageKey, importFolder: string) {
    super(app);
    this.note = note;
    this.key = key;
    this.importFolder = importFolder;
    this.setPlaceholder(`Select an image for the ${KEY_LABELS[key]}…`);
  }

  getItems(): PickerItem[] {
    const images = this.app.vault
      .getFiles()
      .filter((file) => classifyAssetPath(file.path) === "image")
      .sort((a, b) => a.path.localeCompare(b.path));
    return [{ kind: "import" }, ...images.map((file): PickerItem => ({ kind: "asset", file }))];
  }

  getItemText(item: PickerItem): string {
    return item.kind === "import" ? "Import an image file…" : item.file.path;
  }

  onChooseItem(item: PickerItem): void {
    if (item.kind === "import") {
      void this.importThenApply();
    } else {
      void this.applyAsset(item.file);
    }
  }

  /** 選んだ画像をノート起点の相対pathとしてfrontmatterへ書き込む */
  private async applyAsset(asset: TFile): Promise<void> {
    const value = encodePathForMarkdownUrl(
      relativePathFrom(normalizeVaultPath(this.note.path), normalizeVaultPath(asset.path)),
    );
    try {
      await this.app.fileManager.processFrontMatter(this.note, (frontmatter) => {
        frontmatter[this.key] = value;
      });
    } catch {
      new Notice(`Nekote Blog: Could not set the ${KEY_LABELS[this.key]}.`);
      return;
    }
    new Notice(`Nekote Blog: Set the ${KEY_LABELS[this.key]}.`);
  }

  private async importThenApply(): Promise<void> {
    const picked = await pickLocalImage();
    if (picked === null) return;
    if (classifyAssetPath(picked.name) !== "image") {
      new Notice("Nekote Blog: Supported formats are png, jpg, jpeg, gif, webp and avif.");
      return;
    }
    try {
      await ensureFolder(this.app.vault, this.importFolder);
      const path = availableAssetPath(this.app.vault, this.importFolder, picked.name);
      const created = await this.app.vault.createBinary(path, picked.data);
      await this.applyAsset(created);
    } catch {
      new Notice("Nekote Blog: Could not import the image.");
    }
  }
}

/** 保存先フォルダを親から順に作る（`createFolder()`が親を作るかは保証されていない） */
async function ensureFolder(vault: Vault, folder: string): Promise<void> {
  if (folder === "") return;
  let current = "";
  for (const segment of folder.split("/")) {
    current = current === "" ? segment : `${current}/${segment}`;
    if (vault.getFolderByPath(current) === null) {
      await vault.createFolder(current);
    }
  }
}

/** フォルダ内で衝突しないpathを返す。同名があればObsidian風に「名前 1.png」と連番を振る */
function availableAssetPath(vault: Vault, folder: string, rawName: string): string {
  const name = rawName.normalize("NFC");
  const dot = name.lastIndexOf(".");
  const base = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot);
  for (let sequence = 0; ; sequence++) {
    const candidate = sequence === 0 ? name : `${base} ${sequence}${extension}`;
    const path = folder === "" ? candidate : `${folder}/${candidate}`;
    if (vault.getAbstractFileByPath(path) === null) return path;
  }
}

function pickLocalImage(): Promise<{ name: string; data: ArrayBuffer } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      ".png,.jpg,.jpeg,.gif,.webp,.avif,image/png,image/jpeg,image/gif,image/webp,image/avif";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) {
        resolve(null);
        return;
      }
      void file.arrayBuffer().then((data) => resolve({ name: file.name, data }));
    });
    // 選択の取り消しはchangeが発火しない。cancelが来る環境だけでも明示的に閉じる
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
