// Obsidianのコメント`%%…%%`を中身ごと取り除く。
//
// Obsidianの閲覧表示に出ない、自分用のメモの書き方なので、公開もしないし、中の参照も送らない。
// サーバーは`%%`をコメントとして扱わない（GitHubソースのMarkdownでは普通の文字）ため、
// プラグインの正規化で取り除く。どこまでをコメントと読むかは`segments.ts`。
//
// 取り除くのはコメントの部分だけで、行そのものは消さない（引用・リストの記号は残り、コメントだけの
// 行は中身の無い行になる）。Obsidianはブロックのコメントの前後を別のブロックとして読むので、
// 前後の段落をつなげない。
import { joinBodyLines, splitBodyLines } from "./segments";

/** Obsidianのコメントを取り除く。コードの中の`%%`は残す */
export function removeObsidianComments(body: string): string {
  return joinBodyLines(
    splitBodyLines(body).map(({ text, obsidianComments }) => {
      let result = "";
      let index = 0;
      for (const range of obsidianComments) {
        result += text.slice(index, range.start);
        index = range.end;
      }
      return result + text.slice(index);
    }),
  );
}
