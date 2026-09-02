// frontmatterの切り出しと、プラグインが判断に使う項目の読み取り。
//
// **切り出しの規則はサーバー（`splitMarkdownFrontmatter`）と同じ**にしてある。
// 送るのは原稿そのままで、プラグインはfrontmatterを書き換えない（vaultが正本）。
//
// 値の検証はプラグインが使う項目（`title`・`draft`・`slug`・`thumbnail`・`cover`）
// だけに絞る。`tags`・`date`・`emoji`・`category`はサーバーが検証し、結果は
// `GET /pushes/{pushId}`の記事別エラーで返る。ここで二重に規則を持つと、
// 片方だけが古くなったときに利用者を迷わせる。
import { getTranslations } from "../i18n";

/** YAMLの解釈。実体はObsidianの`parseYaml()`（`src/main.ts`が渡す） */
export type YamlParser = (yaml: string) => unknown;

/** 利用者が直せる入力エラー。走査は止めず、その記事の`error`として表示する */
export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

export interface SplitNote {
  /** frontmatterブロック（`---`の行を含む）。`head + body`で原稿へ戻る */
  head: string;
  /** frontmatterのYAML本体。frontmatterを持たない原稿はnull */
  yaml: string | null;
  /** frontmatterを除いた本文 */
  body: string;
}

function findLineEnd(text: string, start: number): { value: string; next: number } {
  const newline = text.indexOf("\n", start);
  if (newline === -1) return { value: text.slice(start), next: text.length };

  const end = newline > start && text[newline - 1] === "\r" ? newline - 1 : newline;
  return { value: text.slice(start, end), next: newline + 1 };
}

/**
 * 原稿をfrontmatterブロックと本文へ分ける。**値の検証はしない。**
 *
 * 先頭のBOMは落とす（サーバーも同じ扱いで、残すと1文字目が`---`にならず
 * frontmatterを持たない原稿として扱われる）
 */
export function splitNote(markdown: string): SplitNote {
  const source = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;

  const firstLine = findLineEnd(source, 0);
  if (firstLine.value !== "---") return { head: "", yaml: null, body: source };

  let lineStart = firstLine.next;
  while (lineStart < source.length) {
    const line = findLineEnd(source, lineStart);
    if (line.value === "---") {
      return {
        head: source.slice(0, line.next),
        yaml: source.slice(firstLine.next, lineStart),
        body: source.slice(line.next),
      };
    }
    lineStart = line.next;
  }

  throw new FrontmatterError(getTranslations().frontmatter.missingClosingDelimiter);
}

/** プラグインが使うfrontmatterの項目 */
export interface NoteFrontmatter {
  /** frontmatterに書かれたtitle。未指定・空文字はundefined（ファイル名で補う） */
  title: string | undefined;
  /** 未指定は`false`（公開） */
  draft: boolean;
  slug: string | undefined;
  thumbnail: string | undefined;
  cover: string | undefined;
}

const EMPTY_FRONTMATTER: NoteFrontmatter = {
  title: undefined,
  draft: false,
  slug: undefined,
  thumbnail: undefined,
  cover: undefined,
};

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new FrontmatterError(getTranslations().frontmatter.mustBeString(key));
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** frontmatterのYAMLを読む。解釈できない値は`FrontmatterError` */
export function readFrontmatter(yaml: string | null, parseYaml: YamlParser): NoteFrontmatter {
  if (yaml === null || yaml.trim() === "") return { ...EMPTY_FRONTMATTER };

  const t = getTranslations().frontmatter;
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch {
    // 例外の中身にはYAMLの断片が入り得るので、そのままは出さない
    throw new FrontmatterError(t.invalidYaml);
  }

  if (parsed === null || parsed === undefined) return { ...EMPTY_FRONTMATTER };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FrontmatterError(t.mustBeMapping);
  }

  const data = parsed as Record<string, unknown>;
  if (data.draft !== undefined && data.draft !== null && typeof data.draft !== "boolean") {
    throw new FrontmatterError(t.draftMustBeBoolean);
  }

  return {
    title: optionalString(data, "title"),
    draft: data.draft === true,
    slug: optionalString(data, "slug"),
    thumbnail: optionalString(data, "thumbnail"),
    cover: optionalString(data, "cover"),
  };
}
