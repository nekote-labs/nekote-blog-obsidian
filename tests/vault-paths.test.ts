import { describe, expect, it } from "vitest";
import {
  baseNameOf,
  contentKindFromPath,
  directoryOf,
  encodePathForMarkdownUrl,
  extensionOf,
  fileNameOf,
  isArticlePath,
  isCanonicalContentRoot,
  isCanonicalPath,
  normalizeVaultPath,
  relativePathFrom,
  resolveRelativePath,
  toContentRootRelative,
} from "../src/vault/paths";

/** 「が」の分解形（NFD）。NFC済みなら1文字の「が」になる */
const NFD_GA = "\u304B\u3099";

describe("isCanonicalPath()", () => {
  it.each([
    "a.md",
    "posts/hello.md",
    "posts/2026/01/hello.md",
    "assets/画像.png",
    "posts/🐱.md",
    "posts/hello world.md",
    "posts/a b (1).md",
  ])("正規形のpath（%o）は真", (path) => {
    expect(isCanonicalPath(path)).toBe(true);
  });

  it.each([
    { label: "空文字", path: "" },
    { label: "/始まり", path: "/posts/a.md" },
    { label: "/終わり", path: "posts/" },
    { label: "空segment", path: "posts//a.md" },
    { label: "カレントディレクトリ", path: "posts/./a.md" },
    { label: "親ディレクトリ", path: "posts/../a.md" },
    { label: "先頭の..", path: "../a.md" },
    { label: "バックスラッシュ", path: "posts\\a.md" },
    { label: "NUL文字", path: "posts/a\u0000.md" },
    { label: "タブ", path: "posts/a\tb.md" },
    { label: "DEL", path: "posts/a\u007F.md" },
    { label: "NFD", path: `posts/${NFD_GA}.md` },
  ])("正規形でないpath（$label）は偽", ({ path }) => {
    expect(isCanonicalPath(path)).toBe(false);
  });
});

describe("isCanonicalContentRoot()", () => {
  it("空文字（vaultルート）は真", () => {
    expect(isCanonicalContentRoot("")).toBe(true);
  });

  it.each(["blog", "blog/公開", "a/b/c"])("正規形のフォルダpath（%o）は真", (path) => {
    expect(isCanonicalContentRoot(path)).toBe(true);
  });

  it.each(["/blog", "blog/", "blog//x", "../blog", "blog\\x", `blog/${NFD_GA}`])(
    "正規形でない値（%o）は偽",
    (path) => {
      expect(isCanonicalContentRoot(path)).toBe(false);
    },
  );
});

describe("normalizeVaultPath()", () => {
  it("NFDの文字はNFCへ寄る", () => {
    expect(normalizeVaultPath(`posts/${NFD_GA}.md`)).toBe("posts/が.md");
  });

  it("前後の/が落ちる", () => {
    expect(normalizeVaultPath("//posts/a.md//")).toBe("posts/a.md");
  });

  it("正規形のpathはそのまま", () => {
    expect(normalizeVaultPath("posts/a.md")).toBe("posts/a.md");
  });

  it("バックスラッシュは書き換えない（判定側で弾く）", () => {
    expect(normalizeVaultPath("posts\\a.md")).toBe("posts\\a.md");
  });
});

describe("toContentRootRelative()", () => {
  it("ルートが空文字ならvaultルート相対のまま", () => {
    expect(toContentRootRelative("posts/a.md", "")).toBe("posts/a.md");
  });

  it("ルート配下ならルート相対になる", () => {
    expect(toContentRootRelative("blog/posts/a.md", "blog")).toBe("posts/a.md");
  });

  it("ルート外はnull", () => {
    expect(toContentRootRelative("docs/a.md", "blog")).toBeNull();
  });

  // 前方一致だけで判定すると`blog2/…`をルート配下と誤認する
  it("名前の先頭が同じだけの別フォルダはnull", () => {
    expect(toContentRootRelative("blog2/posts/a.md", "blog")).toBeNull();
  });

  it("ルート自身のpathはnull", () => {
    expect(toContentRootRelative("blog", "blog")).toBeNull();
  });
});

describe("contentKindFromPath()", () => {
  it.each(["posts/a.md", "posts/2026/a.md"])("posts配下（%o）はpost", (path) => {
    expect(contentKindFromPath(path)).toBe("post");
  });

  it.each(["pages/a.md", "pages/about/a.md"])("pages配下（%o）はpage", (path) => {
    expect(contentKindFromPath(path)).toBe("page");
  });

  it("ディレクトリ名の大文字小文字は区別しない", () => {
    expect(contentKindFromPath("Posts/a.MD")).toBe("post");
  });

  it.each([
    { label: "ルート直下", path: "a.md" },
    { label: "別ディレクトリ", path: "docs/a.md" },
    { label: "postsという名前のファイル", path: "posts.md" },
    { label: "直下でないposts", path: "x/posts/a.md" },
  ])("公開対象外（$label）はnull", ({ path }) => {
    expect(contentKindFromPath(path)).toBeNull();
  });
});

describe("isArticlePath()", () => {
  it.each(["posts/a.md", "pages/a.md", "posts/2026/a.md", "Posts/a.MD"])(
    "記事のpath（%o）は真",
    (path) => {
      expect(isArticlePath(path)).toBe(true);
    },
  );

  it.each([
    { label: "md以外の拡張子", path: "posts/a.txt" },
    { label: "拡張子なし", path: "posts/a" },
    { label: "ルート直下", path: "a.md" },
    { label: "別ディレクトリ", path: "docs/a.md" },
    { label: "正規形でない", path: "posts//a.md" },
  ])("記事でないpath（$label）は偽", ({ path }) => {
    expect(isArticlePath(path)).toBe(false);
  });
});

describe("directoryOf() / fileNameOf() / baseNameOf() / extensionOf()", () => {
  it.each([
    { path: "posts/a.md", directory: "posts", fileName: "a.md", base: "a", extension: "md" },
    { path: "a.md", directory: "", fileName: "a.md", base: "a", extension: "md" },
    {
      path: "posts/2026/a.b.md",
      directory: "posts/2026",
      fileName: "a.b.md",
      base: "a.b",
      extension: "md",
    },
    { path: "posts/README", directory: "posts", fileName: "README", base: "README", extension: "" },
    {
      path: ".gitignore",
      directory: "",
      fileName: ".gitignore",
      base: ".gitignore",
      extension: "",
    },
    {
      path: "assets/画像.PNG",
      directory: "assets",
      fileName: "画像.PNG",
      base: "画像",
      extension: "png",
    },
  ])("$path を各部分へ分解できる", ({ path, directory, fileName, base, extension }) => {
    expect(directoryOf(path)).toBe(directory);
    expect(fileNameOf(path)).toBe(fileName);
    expect(baseNameOf(path)).toBe(base);
    expect(extensionOf(path)).toBe(extension);
  });
});

describe("resolveRelativePath()", () => {
  it.each([
    { label: "同じディレクトリ", base: "posts", target: "b.md", expected: "posts/b.md" },
    { label: "./付き", base: "posts", target: "./b.md", expected: "posts/b.md" },
    { label: "下のディレクトリ", base: "posts", target: "img/x.png", expected: "posts/img/x.png" },
    { label: "../で上へ", base: "posts", target: "../assets/x.png", expected: "assets/x.png" },
    {
      label: "多段の..",
      base: "posts/2026/01",
      target: "../../../assets/x.png",
      expected: "assets/x.png",
    },
    { label: "vaultルート起点", base: "", target: "assets/x.png", expected: "assets/x.png" },
    { label: "途中の..", base: "posts", target: "img/../x.png", expected: "posts/x.png" },
  ])("$label は解決できる", ({ base, target, expected }) => {
    expect(resolveRelativePath(base, target)).toBe(expected);
  });

  it.each([
    { label: "vaultルートより上", base: "posts", target: "../../x.png" },
    { label: "ルート起点で..", base: "", target: "../x.png" },
    { label: "絶対path", base: "posts", target: "/x.png" },
    { label: "空文字", base: "posts", target: "" },
  ])("$label はnull", ({ base, target }) => {
    expect(resolveRelativePath(base, target)).toBeNull();
  });
});

describe("relativePathFrom()", () => {
  it.each([
    { label: "同じディレクトリ", from: "posts/a.md", to: "posts/b.png", expected: "b.png" },
    { label: "下のディレクトリ", from: "posts/a.md", to: "posts/img/b.png", expected: "img/b.png" },
    {
      label: "上のディレクトリ",
      from: "posts/a.md",
      to: "assets/b.png",
      expected: "../assets/b.png",
    },
    {
      label: "多段上のディレクトリ",
      from: "posts/2026/01/a.md",
      to: "assets/b.png",
      expected: "../../../assets/b.png",
    },
    { label: "vaultルート直下の記事", from: "a.md", to: "assets/b.png", expected: "assets/b.png" },
    {
      label: "vaultルート直下のアセット",
      from: "posts/2026/a.md",
      to: "b.png",
      expected: "../../b.png",
    },
    {
      label: "まったく別のツリー",
      from: "posts/2026/a.md",
      to: "pages/about/b.png",
      expected: "../../pages/about/b.png",
    },
  ])("$label への相対pathを作る", ({ from, to, expected }) => {
    expect(relativePathFrom(from, to)).toBe(expected);
  });

  // 書き出した相対pathをサーバーと同じ規則で解決すると元のpathへ戻る
  it.each([
    { from: "posts/a.md", to: "posts/b.png" },
    { from: "posts/a.md", to: "posts/img/b.png" },
    { from: "posts/a.md", to: "assets/b.png" },
    { from: "posts/2026/01/a.md", to: "assets/img/b.png" },
    { from: "a.md", to: "assets/b.png" },
    { from: "posts/2026/a.md", to: "b.png" },
    { from: "posts/2026/a.md", to: "pages/about/b.png" },
    { from: "posts/a.md", to: "posts/a.md" },
  ])("$from から $to への相対pathは解決すると元へ戻る", ({ from, to }) => {
    expect(resolveRelativePath(directoryOf(from), relativePathFrom(from, to))).toBe(to);
  });
});

describe("encodePathForMarkdownUrl()", () => {
  it.each([
    { label: "空白", path: "assets/a b.png", expected: "assets/a%20b.png" },
    { label: "括弧", path: "assets/a(1).png", expected: "assets/a%281%29.png" },
    { label: "シャープ", path: "assets/a#b.png", expected: "assets/a%23b.png" },
    { label: "クエスチョン", path: "assets/a?b.png", expected: "assets/a%3Fb.png" },
    { label: "パーセント", path: "assets/a%b.png", expected: "assets/a%25b.png" },
  ])("$label をencodeする", ({ path, expected }) => {
    expect(encodePathForMarkdownUrl(path)).toBe(expected);
  });

  it("日本語をencodeし、/は残す", () => {
    expect(encodePathForMarkdownUrl("画像/猫.png")).toBe("%E7%94%BB%E5%83%8F/%E7%8C%AB.png");
  });

  it.each(["assets/a b (1) #x ?y %z.png", "画像/猫 (2).png", "posts/2026/hello.md"])(
    "decodeURIComponentで元へ戻る（%o）",
    (path) => {
      expect(decodeURIComponent(encodePathForMarkdownUrl(path))).toBe(path);
    },
  );
});
