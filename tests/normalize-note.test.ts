import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { NormalizeContext } from "../src/normalize/context";
import { normalizeNote, type NormalizedNote } from "../src/normalize/note";
import { MAX_ARTICLE_ASSET_PATHS } from "../src/protocol/limits";
import type { VaultFileRef } from "../src/vault/gateway";
import { extensionOf, toContentRootRelative } from "../src/vault/paths";

function fileRef(path: string): VaultFileRef {
  return { path, vaultPath: path, extension: extensionOf(path), size: 0 };
}

/** 行を並べて原稿を作る。テスト側のインデントが原稿へ混ざらないように */
function md(...lines: string[]): string {
  return lines.join("\n");
}

interface SetupOptions {
  /** 正規化する記事のvaultルート相対path */
  articleVaultPath?: string;
  contentRoot?: string;
  /** vault内のファイル（vaultルート相対path） */
  files?: string[];
}

function setup(options: SetupOptions = {}): (markdown: string) => NormalizedNote {
  const contentRoot = options.contentRoot ?? "blog";
  const articleVaultPath = options.articleVaultPath ?? "blog/posts/hello.md";
  const files = new Set(options.files ?? []);

  const context: NormalizeContext = {
    articleVaultPath,
    articlePath: toContentRootRelative(articleVaultPath, contentRoot) ?? articleVaultPath,
    contentRoot,
    // wikilinkを含む原稿は使わないので呼ばれない
    resolveLinkpath: () => null,
    findByPath: (vaultPath) => (files.has(vaultPath) ? fileRef(vaultPath) : null),
  };

  return (markdown) => normalizeNote({ markdown, context, parseYaml: parse });
}

describe("normalizeNote(): frontmatterと本文", () => {
  it("frontmatterはそのままで、本文だけを正規化する", () => {
    const run = setup();

    const note = run(md("---", "title: こんにちは", "---", "> [!warning] 注意", "> 本文"));

    expect(note.markdown).toBe(
      md("---", "title: こんにちは", "---", ":::warning[注意]", "本文", ":::"),
    );
  });

  it("titleはfrontmatterを優先する", () => {
    const run = setup();

    expect(run(md("---", "title: 記事のタイトル", "---", "本文")).title).toBe("記事のタイトル");
  });

  it("titleが無ければ拡張子を除いたファイル名を使う", () => {
    const run = setup({ articleVaultPath: "blog/posts/2026/はじめての記事.md" });

    expect(run("本文").title).toBe("はじめての記事");
  });

  it("draft: trueを読み取る", () => {
    const run = setup();

    expect(run(md("---", "draft: true", "---", "本文")).draft).toBe(true);
  });

  it("frontmatterのYAMLが壊れていても、指摘を付けて原稿を返す", () => {
    const run = setup();

    const note = run(md("---", "title: [閉じていない", "---", "本文"));

    expect(note.issues).toEqual([
      { level: "error", message: "frontmatterのYAMLを解釈できませんでした。" },
    ]);
    expect(note.markdown).toBe(md("---", "title: [閉じていない", "---", "本文"));
  });

  it("frontmatterの区切りが閉じていない原稿は、指摘を付けてそのまま返す", () => {
    const run = setup();
    const source = md("---", "title: こんにちは", "本文");

    const note = run(source);

    expect(note.issues).toEqual([
      { level: "error", message: "frontmatterを閉じる区切り（---）がありません。" },
    ]);
    expect(note.markdown).toBe(source);
  });
});

describe("normalizeNote(): frontmatterの画像", () => {
  it("thumbnailの相対pathを参照アセットにする", () => {
    const run = setup({ files: ["blog/posts/img/cat.png"] });

    const note = run(md("---", "thumbnail: ./img/cat.png", "---", "本文"));

    expect(note.assetPaths).toEqual(["blog/posts/img/cat.png"]);
    expect(note.issues).toEqual([]);
  });

  it("coverの相対pathも参照アセットにする", () => {
    const run = setup({ files: ["blog/posts/img/cat.png"] });

    const note = run(md("---", "cover: ./img/cat.png", "---", "本文"));

    expect(note.assetPaths).toEqual(["blog/posts/img/cat.png"]);
  });

  it("本文と同じpathを指すthumbnailは1件に畳む", () => {
    const run = setup({ files: ["blog/posts/img/cat.png"] });

    const note = run(md("---", "thumbnail: ./img/cat.png", "---", "![猫](./img/cat.png)"));

    expect(note.assetPaths).toEqual(["blog/posts/img/cat.png"]);
  });

  it("httpsの外部URLは参照アセットにも指摘にもしない", () => {
    const run = setup();

    const note = run(md("---", "thumbnail: https://example.com/cat.png", "---", "本文"));

    expect(note.assetPaths).toEqual([]);
    expect(note.issues).toEqual([]);
  });

  it.each([["http://example.com/cat.png"], ["//example.com/cat.png"]])(
    "https以外のURL（%s）は警告して省略する",
    (value) => {
      const run = setup();

      const note = run(md("---", `thumbnail: ${value}`, "---", "本文"));

      expect(note.assetPaths).toEqual([]);
      expect(note.issues).toEqual([
        {
          level: "warning",
          message: "frontmatterのthumbnailに指定できないURLです。省略しました。",
        },
      ]);
    },
  );

  it("pathに使えない文字を含む画像は参照を落とす", () => {
    // manifest全体が拒否されるので、1件の画像のために記事ごと送れなくしない
    const name = "cat\\bad.png";
    const run = setup({ files: [`blog/posts/img/${name}`] });

    const note = run(md("---", `thumbnail: ./img/${name}`, "---", "本文"));

    expect(note.assetPaths).toEqual([]);
    expect(note.issues).toEqual([
      {
        level: "warning",
        message: `pathに使えない文字が含まれるため参照を落としました: blog/posts/img/${name}`,
      },
    ]);
  });

  it("画像がvaultに無ければ警告して省略する", () => {
    const run = setup();

    const note = run(md("---", "thumbnail: ./img/cat.png", "---", "本文"));

    expect(note.assetPaths).toEqual([]);
    expect(note.issues).toEqual([
      {
        level: "warning",
        message:
          "frontmatterのthumbnailの画像が見つかりません。省略しました: blog/posts/img/cat.png",
      },
    ]);
  });

  it.each([["cat.svg"], ["cat.pdf"]])("ラスタ画像でない%sは警告して省略する", (name) => {
    const run = setup({ files: [`blog/posts/img/${name}`] });

    const note = run(md("---", `thumbnail: ./img/${name}`, "---", "本文"));

    expect(note.assetPaths).toEqual([]);
    expect(note.issues).toEqual([
      {
        level: "warning",
        message: `frontmatterのthumbnailにはラスタ画像を指定してください。省略しました: ./img/${name}`,
      },
    ]);
  });
});

describe("normalizeNote(): 参照アセットの申告", () => {
  it("本文由来が上限を超えると、指摘を付けてdeclaredAssetPathsだけを切り詰める", () => {
    const names = Array.from(
      { length: MAX_ARTICLE_ASSET_PATHS + 1 },
      (_, index) => `img/asset-${index}.png`,
    );
    const run = setup({ files: names.map((name) => `blog/posts/${name}`) });

    const note = run(names.map((name) => `![](./${name})`).join("\n"));

    expect(note.declaredAssetPaths).toHaveLength(MAX_ARTICLE_ASSET_PATHS);
    expect(note.assetPaths).toHaveLength(MAX_ARTICLE_ASSET_PATHS + 1);
    expect(note.issues).toEqual([
      {
        level: "error",
        message: `本文が参照するアセットが${MAX_ARTICLE_ASSET_PATHS}件を超えています。減らしてください。`,
      },
    ]);
  });

  it("declaredAssetPathsは本文由来のあとにfrontmatter由来を並べる", () => {
    const run = setup({ files: ["blog/posts/img/body.png", "blog/posts/img/thumb.png"] });

    const note = run(md("---", "thumbnail: ./img/thumb.png", "---", "![](./img/body.png)"));

    expect(note.declaredAssetPaths).toEqual([
      "blog/posts/img/body.png",
      "blog/posts/img/thumb.png",
    ]);
  });
});
