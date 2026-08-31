// vendorした契約ファイル（`protocol/v1/`）の内容hash。
//
// 契約の正本は非公開リポジトリ`nekote-blog`にあり、このリポジトリはコピーを持つ。
// **コピーがずれてもコードは動いてしまう**ため、同じ規則で計算したhashを
// `protocol/v1/protocol.json`の`contentHash`と突き合わせて片方だけの変更を落とす。
//
// ファイル読み込みは呼び出し側（契約テスト）で行う。この関数はNodeに依存しない。
import { sha256HexOfText } from "../crypto/hash";

export interface ProtocolFile {
  /** 契約ディレクトリ起点の相対path（`/`区切り） */
  name: string;
  text: string;
}

/**
 * name順に並べ、name・バイト長・本文を区切って連結してから1回hashする
 * （長さを挟むことで、本文に区切り文字が現れても別の並びと衝突しない）
 */
export function computeProtocolContentHash(files: readonly ProtocolFile[]): Promise<string> {
  const encoder = new TextEncoder();
  const canonical = [...files]
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((file) => `${file.name}\n${encoder.encode(file.text).byteLength}\n${file.text}\n`)
    .join("");
  return sha256HexOfText(canonical);
}
