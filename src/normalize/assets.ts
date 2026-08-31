// アセットの種別判定。
//
// **拡張子の集合はサーバー（`classifyMarkdownAssetPath`）の写し**。Obsidianが
// 埋め込み表示できる形式（`.svg`・`.flac`・`.mkv`・`.3gp`等）のほうが広いので、
// Nekoteが受け付けない形式はここで落として警告にする。SVGはスクリプトを持てるため
// 自ドメインからは配信しない（サーバー側でも拒否される）。
import { extensionOf } from "../vault/paths";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "ogg"]);

export type AssetKind = "image" | "video" | "audio" | "pdf" | "svg" | "unsupported";

export function classifyAssetPath(path: string): AssetKind {
  const extension = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (extension === "pdf") return "pdf";
  if (extension === "svg") return "svg";
  return "unsupported";
}

/** Nekoteが取り込む（原本を送る）種別か */
export function isTransferableAsset(kind: AssetKind): boolean {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "pdf";
}

/** Markdownのpathか（サーバーの`isMarkdownPath`と同じ判定） */
export function isMarkdownPath(path: string): boolean {
  return /\.md$/i.test(path);
}
