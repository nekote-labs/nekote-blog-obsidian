// 記事1件を正規化するあいだ変わらない周辺情報。
//
// vaultの引き当ては関数で受け取り、正規化モジュール自体はObsidianにも
// `VaultGateway`の実装にも依存しない（テストは素のオブジェクトを渡すだけ）。
import type { VaultFileRef } from "../vault/gateway";

export interface NormalizeContext {
  /** 正規化する記事のvaultルート相対path（正規形） */
  articleVaultPath: string;
  /** 記事のコンテンツルート相対path（`posts/…`・`pages/…`） */
  articlePath: string;
  /** コンテンツルート。vaultルート自体なら空文字 */
  contentRoot: string;
  /**
   * wikilinkの解決（`MetadataCache.getFirstLinkpathDest`）。
   * 渡すのは`#`・`|`を落としたlinkpathだけ
   */
  resolveLinkpath: (linkpath: string) => VaultFileRef | null;
  /** vaultルート相対pathでファイルを引く。無ければnull */
  findByPath: (vaultPath: string) => VaultFileRef | null;
}
