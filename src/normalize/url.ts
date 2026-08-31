// 本文・frontmatterに書かれた参照URLの読み取り。
//
// **判定はサーバーの`classifyMarkdownUrl`・`splitMarkdownUrl`の写し**。ここで
// 「相対path」と読んだものだけがvault内のファイル参照になり、サーバー側でも同じ判定を
// 通る。ブラウザが先頭の空白やbackslashを補正して外部URLとして解釈する表記
// （`java\nscript:`・`\\example.com`）を相対pathと読み違えないための正規化も同じ。

const ALLOWED_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// 制御文字・空白の混入でscheme判定をすり抜けさせないための除去。サーバーの
// `compactForSchemeCheck`と同じ文字集合を落とす
// eslint-disable-next-line no-control-regex
const CONTROL_AND_SPACE_PATTERN = /[\u0000-\u0020\u007F]+/g;
const SCHEME_PATTERN = /^([a-z][a-z\d+.-]*:)/i;
const NUL = "\u0000";

export type ReferenceUrlKind = "relative" | "absolute" | "fragment" | "disallowed";

function compactForSchemeCheck(value: string): string {
  return value.replace(CONTROL_AND_SPACE_PATTERN, "");
}

function isSchemeRelative(value: string): boolean {
  return value.replaceAll("\\", "/").startsWith("//");
}

export function classifyReferenceUrl(url: string): ReferenceUrlKind {
  const compact = compactForSchemeCheck(url);
  if (compact.startsWith("#")) return "fragment";
  if (isSchemeRelative(compact)) return "disallowed";

  const scheme = SCHEME_PATTERN.exec(compact)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    return ALLOWED_LINK_SCHEMES.has(scheme) ? "absolute" : "disallowed";
  }
  return "relative";
}

/** 外部画像として許すURLか（frontmatterの`thumbnail`・`cover`はhttpsだけ） */
export function isHttpsUrl(url: string): boolean {
  const compact = compactForSchemeCheck(url);
  if (isSchemeRelative(compact)) return false;
  return /^https:/i.test(compact);
}

/**
 * `?`・`#`より前をpathとして取り出し、percent-encodeを戻す。
 * 壊れたencodeやNUL混入はnull（サーバーも同じ条件で参照を落とす）
 */
export function decodeReferencePath(url: string): string | null {
  const hash = url.indexOf("#");
  const beforeFragment = hash === -1 ? url : url.slice(0, hash);
  const query = beforeFragment.indexOf("?");
  const path = query === -1 ? beforeFragment : beforeFragment.slice(0, query);

  try {
    const decoded = decodeURIComponent(path);
    return decoded.includes(NUL) ? null : decoded;
  } catch {
    return null;
  }
}
