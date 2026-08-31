import { describe, expect, it } from "vitest";
import { IssueCollector, type ArticleIssue } from "../src/content/issues";
import type { NormalizeContext } from "../src/normalize/context";
import { collectReferences, type CollectedReferences } from "../src/normalize/references";
import type { VaultFileRef } from "../src/vault/gateway";
import { extensionOf, toContentRootRelative } from "../src/vault/paths";

function fileRef(path: string): VaultFileRef {
  return { path, vaultPath: path, extension: extensionOf(path), size: 0 };
}

interface SetupOptions {
  /** 正規化する記事のvaultルート相対path */
  articleVaultPath?: string;
  contentRoot?: string;
  /** vault内のファイル（vaultルート相対path） */
  files?: string[];
}

function setup(options: SetupOptions = {}) {
  const contentRoot = options.contentRoot ?? "blog";
  const articleVaultPath = options.articleVaultPath ?? "blog/posts/hello.md";
  const files = new Map((options.files ?? []).map((path) => [path, fileRef(path)]));
  const issues = new IssueCollector();

  const context: NormalizeContext = {
    articleVaultPath,
    articlePath: toContentRootRelative(articleVaultPath, contentRoot) ?? articleVaultPath,
    contentRoot,
    // 収集はwikilink変換後の本文だけを見るので、この関数は呼ばれない
    resolveLinkpath: () => null,
    findByPath: (vaultPath) => files.get(vaultPath) ?? null,
  };

  return {
    issues: (): ArticleIssue[] => issues.list(),
    run: (body: string): CollectedReferences => collectReferences(body, context, issues),
  };
}

describe("collectReferences(): アセットのpath解決", () => {
  it("記事の置き場所からの相対pathをvaultルート相対pathにする", () => {
    const { run } = setup({ files: ["blog/posts/img/cat.png"] });

    expect(run("![猫](./img/cat.png)").assetPaths).toEqual(["blog/posts/img/cat.png"]);
  });

  it("コンテンツルートの外にあるアセットも`..`で解決できる", () => {
    const { run } = setup({ files: ["assets/cat.png"] });

    expect(run("![猫](../../assets/cat.png)").assetPaths).toEqual(["assets/cat.png"]);
  });

  it("vaultの外へ出る参照は警告になり、収集されない", () => {
    const { run, issues } = setup({ articleVaultPath: "posts/hello.md", contentRoot: "" });

    expect(run("![猫](../../x.png)").assetPaths).toEqual([]);
    expect(issues()).toEqual([
      { level: "warning", message: "vaultの外を指す参照は取り込めません: ../../x.png" },
    ]);
  });

  it("同じアセットを何度参照しても1件になり、出現順は保たれる", () => {
    const { run } = setup({ files: ["blog/posts/img/cat.png", "blog/posts/img/dog.png"] });

    const body = ["![猫](./img/cat.png)", "![犬](./img/dog.png)", "![猫](./img/cat.png)"].join(
      "\n",
    );

    expect(run(body).assetPaths).toEqual(["blog/posts/img/cat.png", "blog/posts/img/dog.png"]);
  });

  it("空白や括弧を含むファイル名がpercent-encodeされていても解決できる", () => {
    const { run } = setup({ files: ["blog/posts/img/my cat (1).png"] });

    expect(run("![猫](./img/my%20cat%20%281%29.png)").assetPaths).toEqual([
      "blog/posts/img/my cat (1).png",
    ]);
  });
});

describe("collectReferences(): 拾う記法", () => {
  it("`<…>`で囲んだdestとタイトル付きのdestを読める", () => {
    const { run } = setup({ files: ["blog/posts/img/cat.png", "blog/posts/img/dog.png"] });

    const body = ['![猫](<./img/cat.png> "ねこ")', "[犬](./img/dog.png 'いぬ')"].join("\n");

    expect(run(body).assetPaths).toEqual(["blog/posts/img/cat.png", "blog/posts/img/dog.png"]);
  });

  it("参照定義のdestを拾う", () => {
    const { run } = setup({ files: ["blog/posts/img/cat.png"] });

    expect(run('[img]: ./img/cat.png "ねこ"').assetPaths).toEqual(["blog/posts/img/cat.png"]);
  });

  it("HTMLの`src`・`href`を拾う", () => {
    const { run } = setup({ files: ["blog/posts/img/cat.png"] });

    const body = ['<img src="./img/cat.png" alt="猫">', "<a href='./other.md'>別の記事</a>"].join(
      "\n",
    );
    const result = run(body);

    expect(result.assetPaths).toEqual(["blog/posts/img/cat.png"]);
    expect(result.linkedArticlePaths).toEqual(["posts/other.md"]);
  });

  it("外部URL・フラグメント・絶対pathは収集しない", () => {
    const { run, issues } = setup();

    const body = "[外部](https://example.com/x.png) [印](#anchor) ![絶対](/root/abs.png)";

    expect(run(body)).toEqual({ assetPaths: [], linkedArticlePaths: [] });
    expect(issues()).toEqual([]);
  });

  it("インラインコードの中は拾わない", () => {
    const { run, issues } = setup({ files: ["blog/posts/img/cat.png"] });

    expect(run("`![猫](./img/cat.png)`は画像の書き方です。").assetPaths).toEqual([]);
    expect(issues()).toEqual([]);
  });

  it("フェンス付きコードブロックの中は拾わない", () => {
    const { run, issues } = setup({ files: ["blog/posts/img/cat.png"] });

    const body = ["```md", "![猫](./img/cat.png)", "```"].join("\n");

    expect(run(body).assetPaths).toEqual([]);
    expect(issues()).toEqual([]);
  });
});

describe("collectReferences(): 記事へのリンク", () => {
  it("公開対象の`.md`はコンテンツルート相対pathで集める", () => {
    const { run, issues } = setup({ files: ["blog/posts/other.md"] });

    expect(run("続きは[別の記事](./other.md)にある。").linkedArticlePaths).toEqual([
      "posts/other.md",
    ]);
    expect(issues()).toEqual([]);
  });

  it("実在しない`.md`へのリンクも集める", () => {
    const { run, issues } = setup();

    expect(run("[まだ無い記事](./draft.md)").linkedArticlePaths).toEqual(["posts/draft.md"]);
    expect(issues()).toEqual([]);
  });

  it("公開対象外の`.md`へのリンクは集めない", () => {
    const { run, issues } = setup({ files: ["blog/notes/memo.md"] });

    expect(run("[メモ](../notes/memo.md)").linkedArticlePaths).toEqual([]);
    expect(issues()).toEqual([]);
  });
});

describe("collectReferences(): 落とす参照", () => {
  it("実在しないアセットの参照はerrorの指摘になる", () => {
    const { run, issues } = setup();

    expect(run("![猫](./img/missing.png)").assetPaths).toEqual([]);
    expect(issues()).toEqual([
      {
        level: "error",
        message: "本文が参照するファイルが見つかりません: blog/posts/img/missing.png",
      },
    ]);
  });

  it("SVGは警告になり、収集されない", () => {
    const { run, issues } = setup({ files: ["blog/posts/img/logo.svg"] });

    expect(run("![ロゴ](./img/logo.svg)").assetPaths).toEqual([]);
    expect(issues()).toEqual([
      {
        level: "warning",
        message: "SVGは公開できないため参照を落としました: blog/posts/img/logo.svg",
      },
    ]);
  });

  it("対応していない形式は警告も収集もしない", () => {
    const { run, issues } = setup({ files: ["blog/posts/files/data.zip"] });

    expect(run("[データ](./files/data.zip)").assetPaths).toEqual([]);
    expect(issues()).toEqual([]);
  });

  it("manifest keyにできないpathのアセットは警告になり、収集されない", () => {
    const { run, issues } = setup({ files: ["blog/posts/img/a\\b.png"] });

    expect(run("![猫](./img/a%5Cb.png)").assetPaths).toEqual([]);
    expect(issues()).toEqual([
      {
        level: "warning",
        message: "pathに使えない文字が含まれるため参照を落としました: blog/posts/img/a\\b.png",
      },
    ]);
  });
});
