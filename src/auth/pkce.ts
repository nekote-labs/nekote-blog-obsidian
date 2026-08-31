// 端末認可で使うPKCE相当のverifier/challenge。
//
// プラグインは公開リポジトリで配布されるため、クライアントsecretを埋め込めない。
// 代わりに端末が毎回作る使い捨てのverifierで、承認と引き換えのtoken取得を結び付ける。
import { randomBase64Url, sha256, toBase64Url } from "../crypto/hash";

/**
 * code verifier。base64urlの文字はすべて契約の`^[A-Za-z0-9\-._~]{43,128}$`に収まる。
 * 32バイト（256bit）→ 43文字
 */
export function createCodeVerifier(): string {
  return randomBase64Url(32);
}

/** challenge = base64url(sha256(verifier))。契約の`^[A-Za-z0-9_-]{43}$`と一致する */
export async function createCodeChallenge(codeVerifier: string): Promise<string> {
  return toBase64Url(await sha256(new TextEncoder().encode(codeVerifier)));
}
