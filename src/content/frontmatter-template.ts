// 公開対象ノートへ最初から入れるfrontmatterのひな形。
//
// キーの意味はサーバー仕様（`nekote-blog/docs/spec/github.md`「frontmatter」）と同じ。
// `title`は入れない（Obsidianソースはファイル名で補完される）。
// **`date`だけ当日を入れる**。サーバーは空文字・nullの`date`を同期エラーにするため、
// 空のまま置くと未記入のPushで即エラーになる。他のキーは空＝未指定として扱われる。

/** ひな形のキー。挿入順がそのままプロパティ表示の並びになる */
const TEMPLATE_KEYS = [
  "draft",
  "date",
  "tags",
  "category",
  "slug",
  "emoji",
  "thumbnail",
  "cover",
] as const;

function templateValue(key: (typeof TEMPLATE_KEYS)[number], today: string): unknown {
  if (key === "draft") return true;
  if (key === "date") return today;
  if (key === "tags") return [];
  return "";
}

/**
 * ひな形の挿入が必要か。`processFrontMatter()`はYAMLを再整形するため、
 * 全キーが揃っているならファイルへ触れない判断に使う
 */
export function needsFrontmatterTemplate(frontmatter: unknown): boolean {
  if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) {
    return true;
  }
  const data = frontmatter as Record<string, unknown>;
  return TEMPLATE_KEYS.some((key) => !(key in data));
}

/**
 * 欠けているキーだけをひな形で埋める。既存の値（nullや空文字も）は上書きしない。
 * 1つでも足したらtrue
 */
export function applyFrontmatterTemplate(
  frontmatter: Record<string, unknown>,
  today: string,
): boolean {
  let changed = false;
  for (const key of TEMPLATE_KEYS) {
    if (key in frontmatter) continue;
    frontmatter[key] = templateValue(key, today);
    changed = true;
  }
  return changed;
}

/** ローカル時刻での当日（`YYYY-MM-DD`）。UTCへずらすと深夜の作成で日付が前日になる */
export function localIsoDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
