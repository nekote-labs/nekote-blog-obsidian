// vault走査が必要とするObsidian APIの最小面。
//
// 走査・正規化・manifest生成はこのインターフェースだけに依存させ、Obsidianの
// 実装（`src/vault/obsidian-gateway.ts`）を差し替えられるようにしてある。
// テストは偽のvaultを渡すだけで、対象path・読取失敗・case衝突・ルート外参照を
// 再現できる。

export interface VaultFileRef {
  /**
   * vaultルート相対path（Unicode NFC・`/`区切り）。manifest keyとして使う値で、
   * Vault APIが返した生のpathとは限らない
   */
  path: string;
  /** Vault APIへ渡し直すための、正規化前のpath */
  vaultPath: string;
  /** 拡張子（小文字・ドットなし）。拡張子が無ければ空文字 */
  extension: string;
  /** 原本bytes（`TFile.stat.size`）。読み取りを伴わない */
  size: number;
}

export interface VaultGateway {
  /** vault内の全ファイル。`.obsidian/`等の設定は含まない */
  listFiles(): VaultFileRef[];
  /** vault内の全フォルダのpath。vaultルートは空文字で表す */
  listFolderPaths(): string[];
  /** テキストとして読む。読めなければ例外を投げる */
  readText(file: VaultFileRef): Promise<string>;
  /** バイト列として読む。読めなければ例外を投げる */
  readBinary(file: VaultFileRef): Promise<ArrayBuffer>;
  /**
   * wikilinkの解決（`MetadataCache.getFirstLinkpathDest`）。
   * `linkpath`は`#`・`|`より前の部分だけを渡す
   */
  resolveLinkpath(linkpath: string, sourcePath: string): VaultFileRef | null;
}
