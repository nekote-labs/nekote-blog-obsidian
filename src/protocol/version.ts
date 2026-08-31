import { PROTOCOL_MAJOR } from "./limits";

/**
 * サーバーが返した`protocolVersion`をこのプラグインが解釈できるか。
 *
 * majorだけを持つ契約なので、現在major以外はすべて非対応として扱う。
 * 実際の拒否はサーバーが426（`protocol_version_unsupported`）で行い、
 * ここは応答の取り違えを検出するための保険。
 */
export function isSupportedProtocolMajor(value: unknown): boolean {
  return value === PROTOCOL_MAJOR;
}
