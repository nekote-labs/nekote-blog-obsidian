import { describe, expect, it } from "vitest";
import { IssueCollector } from "../src/content/issues";
import type { NormalizeContext } from "../src/normalize/context";
import { normalizeWikilinks } from "../src/normalize/wikilink";
import type { VaultFileRef } from "../src/vault/gateway";
import { baseNameOf, fileNameOf, toContentRootRelative } from "../src/vault/paths";
import { fileRef } from "./support/vault-file-ref";

/** `getFirstLinkpathDest`の代役。path・ファイル名・拡張子なしのどれでも引ける */
function resolveFrom(files: readonly string[], linkpath: string): VaultFileRef | null {
  const found =
    files.find((path) => path === linkpath || path === `${linkpath}.md`) ??
    files.find((path) => fileNameOf(path) === linkpath || baseNameOf(path) === linkpath);
  return found === undefined ? null : fileRef(found);
}

interface SetupOptions {
  /** 正規化する記事のvaultルート相対path */
  articleVaultPath?: string;
  contentRoot?: string;
  /** vault内のファイル（vaultルート相対path） */
  files?: string[];
  /** 解決結果を固定したいときの差し替え */
  resolve?: (linkpath: string) => VaultFileRef | null;
}

function setup(options: SetupOptions = {}) {
  const contentRoot = options.contentRoot ?? "";
  const articleVaultPath = options.articleVaultPath ?? "posts/hello.md";
  const files = options.files ?? [];
  const requested: string[] = [];
  const issues = new IssueCollector();

  const context: NormalizeContext = {
    articleVaultPath,
    articlePath: toContentRootRelative(articleVaultPath, contentRoot) ?? articleVaultPath,
    contentRoot,
    resolveLinkpath(linkpath) {
      requested.push(linkpath);
      return options.resolve === undefined
        ? resolveFrom(files, linkpath)
        : options.resolve(linkpath);
    },
    findByPath(vaultPath) {
      return files.includes(vaultPath) ? fileRef(vaultPath) : null;
    },
  };

  return {
    /** `resolveLinkpath()`へ渡ったlinkpath */
    requested,
    warnings: (): string[] =>
      issues
        .list()
        .filter((issue) => issue.level === "warning")
        .map((issue) => issue.message),
    run: (body: string): string => normalizeWikilinks(body, context, issues),
  };
}

const NOTE_FILES = ["posts/hello.md", "posts/note.md"];

describe("normalizeWikilinks(): ノートへのリンク", () => {
  it("公開対象のノートへは相対pathのリンクになる", () => {
    const { run, warnings } = setup({ files: NOTE_FILES });

    expect(run("続きは[[note]]にある。")).toBe("続きは[note](note.md)にある。");
    expect(warnings()).toEqual([]);
  });

  it("表示名があればラベルに使う", () => {
    const { run } = setup({ files: NOTE_FILES });

    expect(run("[[note|表示名]]")).toBe("[表示名](note.md)");
  });

  it("見出し参照は見出しのアンカーidになる", () => {
    const { run, warnings } = setup({ files: NOTE_FILES });

    expect(run("[[note#Hello World]]")).toBe("[note#Hello World](note.md#hello-world)");
    expect(warnings()).toEqual([]);
  });

  it("同名ノートがあってもresolveLinkpathが返したファイルを使い、linkpathだけを渡す", () => {
    const { run, requested } = setup({
      files: ["posts/hello.md", "posts/a/note.md", "posts/b/note.md"],
      resolve: () => fileRef("posts/b/note.md"),
    });

    expect(run("[[note#見出し|別名]]")).toBe("[別名](b/note.md#見出し)");
    expect(requested).toEqual(["note"]);
  });

  it("公開対象外のノートへのリンクは文字だけになる", () => {
    const { run, warnings } = setup({ files: ["posts/hello.md", "drafts/note.md"] });

    expect(run("[[note]]を見る")).toBe("noteを見る");
    expect(warnings()).toEqual([
      "公開対象外のノートへのリンクは文字だけを残しました: drafts/note.md",
    ]);
  });

  it("解決できないwikilinkは文字だけになる", () => {
    const { run, warnings } = setup({ files: ["posts/hello.md"] });

    expect(run("[[missing|表示名]]")).toBe("表示名");
    expect(warnings()).toEqual(["リンク先を解決できませんでした: missing"]);
  });

  it("解決先のpathが正規形でなければ参照を落とす", () => {
    const { run, warnings } = setup({ resolve: () => fileRef("posts/no\\te.md") });

    expect(run("[[note]]")).toBe("note");
    expect(warnings()).toEqual([
      "pathに使えない文字が含まれるため参照を落としました: posts/no\\te.md",
    ]);
  });
});

describe("normalizeWikilinks(): アセットの埋め込み", () => {
  it("画像の埋め込みはbasenameをラベルにした画像参照になる", () => {
    const { run, warnings } = setup({ files: ["posts/hello.md", "posts/image.png"] });

    expect(run("![[image.png]]")).toBe("![image](image.png)");
    expect(warnings()).toEqual([]);
  });

  it.each(["300", "300x200"])("サイズ指定（%s）は無視して警告する", (size) => {
    const { run, warnings } = setup({ files: ["posts/hello.md", "posts/image.png"] });

    expect(run(`![[image.png|${size}]]`)).toBe("![image](image.png)");
    expect(warnings()).toEqual(["画像のサイズ指定は反映されません。"]);
  });

  it("サイズでない表示名はラベルとして残す", () => {
    const { run, warnings } = setup({ files: ["posts/hello.md", "posts/image.png"] });

    expect(run("![[image.png|ねこの写真]]")).toBe("![ねこの写真](image.png)");
    expect(warnings()).toEqual([]);
  });

  it.each([
    { file: "posts/video.mp4", notation: "![[video.mp4]]", expected: "![video](video.mp4)" },
    { file: "posts/doc.pdf", notation: "![[doc.pdf]]", expected: "![doc](doc.pdf)" },
    { file: "posts/sound.mp3", notation: "![[sound.mp3]]", expected: "![sound](sound.mp3)" },
  ])("$notation は標準Markdownの参照になる", ({ file, notation, expected }) => {
    const { run, warnings } = setup({ files: ["posts/hello.md", file] });

    expect(run(notation)).toBe(expected);
    expect(warnings()).toEqual([]);
  });

  it("アセットへのwikilinkは通常のリンクになる", () => {
    const { run } = setup({ files: ["posts/hello.md", "posts/doc.pdf"] });

    expect(run("[[doc.pdf|資料]]")).toBe("[資料](doc.pdf)");
  });

  it("アセットへの`#`指定は無視して警告する", () => {
    const { run, warnings } = setup({ files: ["posts/hello.md", "posts/doc.pdf"] });

    expect(run("![[doc.pdf#page=2]]")).toBe("![doc](doc.pdf)");
    expect(warnings()).toEqual(["Nekoteに対応する表現がない指定は無視しました: #page=2"]);
  });

  it("SVGは文字だけになる", () => {
    const { run, warnings } = setup({ files: ["posts/hello.md", "posts/drawing.svg"] });

    expect(run("![[drawing.svg]]")).toBe("drawing.svg");
    expect(warnings()).toEqual(["SVGは公開できないため文字だけを残しました: posts/drawing.svg"]);
  });

  it("対応していない形式は文字だけになる", () => {
    const { run, warnings } = setup({ files: ["posts/hello.md", "posts/archive.zip"] });

    expect(run("![[archive.zip]]")).toBe("archive.zip");
    expect(warnings()).toEqual([
      "対応していない形式のファイルは文字だけを残しました: posts/archive.zip",
    ]);
  });
});

describe("normalizeWikilinks(): ノートの埋め込み", () => {
  it("展開せずリンクにして警告する", () => {
    const { run, warnings } = setup({ files: NOTE_FILES });

    expect(run("![[note]]")).toBe("[note](note.md)");
    expect(warnings()).toEqual(["ノートの埋め込みは展開せず、リンクにしました。"]);
  });
});

describe("normalizeWikilinks(): URLの組み立て", () => {
  it("空白や括弧を含むファイル名はpercent-encodeする", () => {
    const { run } = setup({ files: ["posts/hello.md", "posts/my note (1).png"] });

    expect(run("![[my note (1).png]]")).toBe("![my note (1)](my%20note%20%281%29.png)");
  });

  it("コンテンツルート外のアセットは`..`を含む相対pathになる", () => {
    const { run, warnings } = setup({
      articleVaultPath: "content/posts/hello.md",
      contentRoot: "content",
      files: ["content/posts/hello.md", "assets/photo.png"],
    });

    expect(run("![[photo.png]]")).toBe("![photo](../../assets/photo.png)");
    expect(warnings()).toEqual([]);
  });
});

describe("normalizeWikilinks(): 同じノートの中への参照", () => {
  it("`[[#見出し]]`はアンカーへのリンクになる", () => {
    const { run, warnings } = setup();

    expect(run("[[#見出し]]")).toBe("[見出し](#見出し)");
    expect(warnings()).toEqual([]);
  });

  it("解決へ回さない", () => {
    const { run, requested } = setup();

    run("[[#見出し]]");

    expect(requested).toEqual([]);
  });
});

describe("normalizeWikilinks(): ブロック参照", () => {
  it("記事の先頭へのリンクになり警告が出る", () => {
    const { run, warnings } = setup({ files: NOTE_FILES });

    expect(run("[[note#^abc123]]")).toBe("[note#^abc123](note.md)");
    expect(warnings()).toEqual(["ブロック参照は記事の先頭へのリンクになりました。"]);
  });

  it("同じノートの中へのブロック参照は文字だけになる", () => {
    const { run, warnings } = setup();

    expect(run("[[#^abc123|ここ]]")).toBe("ここ");
    expect(warnings()).toEqual(["ブロック参照は表示できないため文字だけを残しました。"]);
  });
});

describe("normalizeWikilinks(): コードの中", () => {
  it("インラインコードは変換しない", () => {
    const { run, warnings } = setup({ files: NOTE_FILES });

    expect(run("`[[note]]`と書く")).toBe("`[[note]]`と書く");
    expect(warnings()).toEqual([]);
  });

  it("フェンス付きコードブロックは変換しない", () => {
    const { run, warnings } = setup({ files: NOTE_FILES });
    const body = ["```md", "[[note]]", "![[image.png]]", "```"].join("\n");

    expect(run(body)).toBe(body);
    expect(warnings()).toEqual([]);
  });
});
