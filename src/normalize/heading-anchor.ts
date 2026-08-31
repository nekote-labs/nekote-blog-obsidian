// 見出しへのアンカーidの組み立て。
//
// `[[note#見出し]]`をリンクへ変換するとき、フラグメントは公開後のHTMLの見出しidと
// 一致していないと効かない。**この関数はサーバーの`slugify()`の写し**で、同じ規則で
// idを作る。
//
// 一致しないことがある既知の場合: 同じ文字列の見出しが記事内に複数あると、サーバーは
// 2つ目以降へ`-2`・`-3`を付ける。この関数は常に最初の見出しのidを返すので、リンクは
// 最初の見出しへ着く。記事の先頭へ落とすより近いので、この挙動を採る。

/** 見出しテキストからアンカーid。空になる場合はnull（フラグメントを付けない） */
export function headingAnchorId(text: string): string | null {
  const id = text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id === "" ? null : id;
}
