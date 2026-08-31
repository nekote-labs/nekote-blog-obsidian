// Web Cryptoだけを使うhashとエンコード。Node/Electronに依存しない
// （iOS実機で`crypto.subtle.digest`が20MiB×100件の逐次hash化まで動くことは確認済み）。

export async function sha256(bytes: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", bytes);
}

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  return toHex(await sha256(bytes));
}

export async function sha256HexOfText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

export function toHex(buffer: ArrayBuffer): string {
  let hex = "";
  for (const byte of new Uint8Array(buffer)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** base64url（パディングなし）。PKCE相当のchallengeとverifierに使う */
export function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 暗号学的に安全な乱数からbase64urlの文字列を作る */
export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes.buffer);
}
