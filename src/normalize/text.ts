// 正規化で組み立てるMarkdownの断片づくり。
//
// wikilinkの表示名やCalloutのタイトルは利用者が書いた任意の文字列で、そのまま
// `[…]`へ入れると括弧の対応が崩れて別の記法になり得る。**意味を変えずに
// エスケープするだけ**にして、内容は推測しない。

/** `[…]`（リンクのテキスト・directiveのラベル）へ入れるためのエスケープ */
export function escapeBracketLabel(text: string): string {
  return text.replace(/([\\[\]])/g, "\\$1");
}

/**
 * リンクを落として表示テキストだけを残すときの本文。
 *
 * `[[…]]`は消えるので、残るテキストが新しい記法にならないよう`[`・`]`だけを
 * エスケープする（強調やコードは利用者が書いた意図として残す）
 */
export function escapeInlineText(text: string): string {
  return text.replace(/([[\]])/g, "\\$1");
}

/**
 * 行頭に置く`:::`の長さ。中身に`:::`以上の並びがあれば1本長くする
 * （Calloutの入れ子や、本文中の`:::`で早く閉じないようにするため）
 */
export function containerFenceFor(content: string): string {
  let longest = 2;
  for (const line of content.split("\n")) {
    const match = /^ {0,3}(:{3,})/.exec(line);
    if (match !== null) longest = Math.max(longest, (match[1] as string).length);
  }
  return ":".repeat(longest + 1);
}
