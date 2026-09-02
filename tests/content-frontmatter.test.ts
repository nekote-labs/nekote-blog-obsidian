import { describe, expect, it } from "vitest";
import { parse as parseYamlText } from "yaml";
import {
  FrontmatterError,
  readFrontmatter,
  splitNote,
  type YamlParser,
} from "../src/content/frontmatter";

/** 実際のYAMLを通したいときのparser（Obsidianの`parseYaml()`の代役） */
const parseYaml: YamlParser = (yaml) => parseYamlText(yaml);

/** 解釈結果を固定したいときのparser */
function fixedParser(value: unknown): YamlParser {
  return () => value;
}

describe("splitNote()", () => {
  it("frontmatterを持つ原稿を分けられる", () => {
    const markdown = "---\ntitle: ねこ\n---\n本文\n";

    expect(splitNote(markdown)).toEqual({
      head: "---\ntitle: ねこ\n---\n",
      yaml: "title: ねこ\n",
      body: "本文\n",
    });
  });

  it("frontmatterが無ければyamlはnullでheadは空文字", () => {
    const markdown = "本文だけ\n";

    expect(splitNote(markdown)).toEqual({ head: "", yaml: null, body: markdown });
  });

  it("1行目が---でも途中の---は先頭扱いにならない", () => {
    const markdown = "本文\n---\nあと\n";

    expect(splitNote(markdown).yaml).toBeNull();
  });

  it("BOMは落とす", () => {
    const split = splitNote("\uFEFF---\ntitle: ねこ\n---\n本文");

    expect(split.yaml).toBe("title: ねこ\n");
    expect(split.body).toBe("本文");
  });

  it("CRLFの原稿でも分けられる", () => {
    const split = splitNote("---\r\ntitle: ねこ\r\n---\r\n本文\r\n");

    expect(split.yaml).toBe("title: ねこ\r\n");
    expect(split.body).toBe("本文\r\n");
  });

  it("空のfrontmatterはyamlが空文字", () => {
    expect(splitNote("---\n---\n本文").yaml).toBe("");
  });

  it("本文中の---は最初の1つが終端になり、残りは本文に入る", () => {
    const split = splitNote("---\ntitle: ねこ\n---\n本文\n---\n区切り\n");

    expect(split.yaml).toBe("title: ねこ\n");
    expect(split.body).toBe("本文\n---\n区切り\n");
  });

  it.each([
    { label: "終端が無い", markdown: "---\ntitle: ねこ\n本文\n" },
    { label: "---だけ", markdown: "---" },
    { label: "改行だけ続く", markdown: "---\n\n\n" },
  ])("閉じられていないfrontmatter（$label）はFrontmatterError", ({ markdown }) => {
    expect(() => splitNote(markdown)).toThrow(FrontmatterError);
  });

  it.each([
    { label: "frontmatterあり", markdown: "---\ntitle: ねこ\n---\n本文\n" },
    { label: "frontmatterなし", markdown: "本文\n" },
    { label: "CRLF", markdown: "---\r\ntitle: ねこ\r\n---\r\n本文\r\n" },
    { label: "本文が空", markdown: "---\ntitle: ねこ\n---\n" },
    { label: "空のfrontmatter", markdown: "---\n---\n本文" },
  ])("head + bodyで原稿へ戻る（$label）", ({ markdown }) => {
    const split = splitNote(markdown);

    expect(split.head + split.body).toBe(markdown);
  });

  it("BOM付きでもhead + bodyはBOMを除いた原稿と一致する", () => {
    const markdown = "---\ntitle: ねこ\n---\n本文";
    const split = splitNote(`\uFEFF${markdown}`);

    expect(split.head + split.body).toBe(markdown);
  });
});

const DEFAULTS = {
  title: undefined,
  draft: false,
  slug: undefined,
  thumbnail: undefined,
  cover: undefined,
};

describe("readFrontmatter(): frontmatterが無い扱い", () => {
  it.each([
    { label: "null", yaml: null },
    { label: "空文字", yaml: "" },
    { label: "空白だけ", yaml: "  \n\n" },
  ])("$label は既定値", ({ yaml }) => {
    expect(readFrontmatter(yaml, parseYaml)).toEqual(DEFAULTS);
  });

  it("YAMLがnullなら既定値", () => {
    expect(readFrontmatter("# コメントだけ\n", parseYaml)).toEqual(DEFAULTS);
  });

  it("戻り値の参照は毎回別", () => {
    expect(readFrontmatter(null, parseYaml)).not.toBe(readFrontmatter(null, parseYaml));
  });
});

/** 文字列として読む項目 */
const STRING_KEYS = ["title", "slug", "thumbnail", "cover"] as const;

describe("readFrontmatter(): 値の読み取り", () => {
  it("項目をそのまま読める", () => {
    const yaml = "title: ねこの記事\nslug: neko\nthumbnail: a.png\ncover: b.png\ndraft: true\n";

    expect(readFrontmatter(yaml, parseYaml)).toEqual({
      title: "ねこの記事",
      draft: true,
      slug: "neko",
      thumbnail: "a.png",
      cover: "b.png",
    });
  });

  it.each(STRING_KEYS)("%s の前後の空白は落とす", (key) => {
    expect(readFrontmatter(`${key}: "  値  "\n`, parseYaml)[key]).toBe("値");
  });

  it.each(STRING_KEYS)("%s の空文字はundefined", (key) => {
    expect(readFrontmatter(`${key}: "   "\n`, parseYaml)[key]).toBeUndefined();
  });

  it.each(STRING_KEYS)("%s のnullはundefined", (key) => {
    expect(readFrontmatter(`${key}:\n`, parseYaml)[key]).toBeUndefined();
  });

  it.each(STRING_KEYS)("%s が文字列でなければFrontmatterError", (key) => {
    expect(() => readFrontmatter(`${key}: 123\n`, parseYaml)).toThrow(FrontmatterError);
  });

  it("draftが未指定なら公開扱い", () => {
    expect(readFrontmatter("title: ねこ\n", parseYaml).draft).toBe(false);
  });

  it("draft: false は公開扱い", () => {
    expect(readFrontmatter("draft: false\n", parseYaml).draft).toBe(false);
  });

  it("draft: true は下書き扱い", () => {
    expect(readFrontmatter("draft: true\n", parseYaml).draft).toBe(true);
  });

  it("draftがnullなら公開扱い", () => {
    expect(readFrontmatter("draft:\n", parseYaml).draft).toBe(false);
  });

  it.each(['draft: "true"\n', "draft: 1\n", "draft: [true]\n"])(
    "draftがbooleanでなければFrontmatterError（%o）",
    (yaml) => {
      expect(() => readFrontmatter(yaml, parseYaml)).toThrow(FrontmatterError);
    },
  );

  it.each([
    { label: "tagsが文字列", yaml: "tags: ねこ\n" },
    { label: "tagsが数値", yaml: "tags: 123\n" },
    { label: "dateが日付でない", yaml: "date: きょう\n" },
    { label: "emojiが配列", yaml: "emoji: [1, 2]\n" },
  ])("プラグインが使わないキーが壊れていても例外にならない（$label）", ({ yaml }) => {
    expect(readFrontmatter(yaml, parseYaml)).toEqual(DEFAULTS);
  });
});

describe("readFrontmatter(): 解釈できないYAML", () => {
  it.each([
    { label: "文字列", value: "ねこ" },
    { label: "数値", value: 1 },
    { label: "真偽値", value: true },
    { label: "配列", value: ["a"] },
  ])("スカラーや配列（$label）はFrontmatterError", ({ value }) => {
    expect(() => readFrontmatter("x", fixedParser(value))).toThrow(FrontmatterError);
  });

  it.each([
    { label: "null", value: null },
    { label: "undefined", value: undefined },
  ])("解釈結果が$labelなら既定値", ({ value }) => {
    expect(readFrontmatter("x", fixedParser(value))).toEqual(DEFAULTS);
  });

  it("parseYamlが投げたらFrontmatterError", () => {
    const parser: YamlParser = () => {
      throw new Error("boom");
    };

    expect(() => readFrontmatter("x: [", parser)).toThrow(FrontmatterError);
  });

  // 例外のメッセージにはYAMLの断片が混じり得るので、そのまま見せない
  it("parseYamlの例外の中身は文言へ出ない", () => {
    const parser: YamlParser = () => {
      throw new Error("bad token at token: SECRET_VALUE");
    };

    expect(() => readFrontmatter("token: SECRET_VALUE\n", parser)).toThrow(
      /^Could not parse the frontmatter YAML\.$/,
    );
  });

  it("実際に壊れたYAMLもFrontmatterErrorになる", () => {
    expect(() => readFrontmatter("title: [壊れた\n", parseYaml)).toThrow(FrontmatterError);
  });
});
