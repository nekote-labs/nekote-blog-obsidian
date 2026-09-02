// モーダルの一覧描画で共通の「limit件まで表示し、超過分は件数だけ見せる」処理。

export function appendTruncatedItems<T>(
  list: HTMLElement,
  items: readonly T[],
  limit: number,
  renderItem: (item: T) => void,
): void {
  for (const item of items.slice(0, limit)) renderItem(item);
  if (items.length > limit) {
    list.createEl("li", {
      cls: "nekote-blog-description",
      text: `and ${items.length - limit} more`,
    });
  }
}
