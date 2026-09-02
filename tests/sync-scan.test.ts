import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  CONFIRM_SCAN_ASSET_COUNT,
  CONFIRM_SCAN_MARKDOWN_COUNT,
  MAX_IMAGE_FILE_BYTES,
  MAX_MANIFEST_MARKDOWN_ENTRIES,
  MAX_MARKDOWN_FILE_BYTES,
  MAX_OTHER_ASSET_FILE_BYTES,
} from "../src/protocol/limits";
import {
  ScanAbortedError,
  ScanCancelledError,
  scanVault,
  type ScanAmount,
  type ScanProgress,
  type ScanResult,
  type ScanScope,
} from "../src/sync/scan";
import type { VaultFileRef, VaultGateway } from "../src/vault/gateway";
import { baseNameOf, directoryOf, extensionOf, fileNameOf } from "../src/vault/paths";

/** 偽vaultへ置くファイル1件 */
interface FakeFile {
  /** vaultルート相対path（NFC・manifest key） */
  path: string;
  /** Vault APIへ渡し直すpath。省略時は`path`と同じ */
  vaultPath?: string;
  /** `TFile.stat.size`。省略時は`content`のbytes */
  size?: number;
  /** 中身。省略すると「statは0でないのに中身が空」を作れる */
  content?: string | Uint8Array;
  /** 読み取りで例外を投げる */
  unreadable?: boolean;
}

function toBytes(content: string | Uint8Array | undefined): Uint8Array<ArrayBuffer> {
  if (content === undefined) return new Uint8Array(0);
  return typeof content === "string" ? new TextEncoder().encode(content) : content.slice();
}

class FakeVault implements VaultGateway {
  readTextCount = 0;
  readBinaryCount = 0;
  private readonly files: FakeFile[];

  constructor(files: readonly FakeFile[]) {
    this.files = files.map((file) => ({ ...file }));
  }

  listFiles(): VaultFileRef[] {
    return this.files.map((file) => ({
      path: file.path,
      vaultPath: file.vaultPath ?? file.path,
      extension: extensionOf(file.path),
      size: file.size ?? toBytes(file.content).byteLength,
    }));
  }

  listFolderPaths(): string[] {
    const folders = new Set<string>([""]);
    for (const file of this.files) {
      let directory = directoryOf(file.path);
      while (directory !== "") {
        folders.add(directory);
        directory = directoryOf(directory);
      }
    }
    return [...folders];
  }

  async readText(file: VaultFileRef): Promise<string> {
    this.readTextCount += 1;
    return new TextDecoder().decode(toBytes(this.contentOf(file)));
  }

  async readBinary(file: VaultFileRef): Promise<ArrayBuffer> {
    this.readBinaryCount += 1;
    return toBytes(this.contentOf(file)).buffer;
  }

  resolveLinkpath(linkpath: string, sourcePath: string): VaultFileRef | null {
    const candidates = this.listFiles().filter(
      (file) =>
        file.path === linkpath ||
        file.path === `${linkpath}.md` ||
        fileNameOf(file.path) === linkpath ||
        baseNameOf(file.path) === linkpath,
    );
    // Obsidianと同じく、リンク元と同じフォルダのファイルを優先する
    const directory = directoryOf(sourcePath);
    return candidates.find((file) => directoryOf(file.path) === directory) ?? candidates[0] ?? null;
  }

  /** 走査のあとにvaultが書き換わった状況を作る */
  setContent(vaultPath: string, content: string | Uint8Array): void {
    this.entryOf(vaultPath).content = content;
  }

  private contentOf(file: VaultFileRef): string | Uint8Array | undefined {
    const entry = this.entryOf(file.vaultPath);
    if (entry.unreadable === true) throw new Error(`読み取りに失敗しました: ${file.path}`);
    return entry.content;
  }

  private entryOf(vaultPath: string): FakeFile {
    const entry = this.files.find((file) => (file.vaultPath ?? file.path) === vaultPath);
    if (entry === undefined) throw new Error(`偽vaultに無いファイルです: ${vaultPath}`);
    return entry;
  }
}

interface SetupOptions {
  contentRoot?: string;
  /** 部分反映（`mode: "partial"`）の絞り込み */
  scope?: ScanScope;
  confirmNotes?: (amount: ScanAmount) => Promise<boolean>;
  confirmAssets?: (amount: ScanAmount) => Promise<boolean>;
  onProgress?: (progress: ScanProgress) => void;
}

function setup(files: readonly FakeFile[], options: SetupOptions = {}) {
  const vault = new FakeVault(files);
  return {
    vault,
    run: (): Promise<ScanResult> =>
      scanVault(
        {
          vault,
          parseYaml: parse,
          confirmNotes: options.confirmNotes ?? (async () => true),
          confirmAssets: options.confirmAssets ?? (async () => true),
          onProgress: options.onProgress,
        },
        options.contentRoot ?? "blog",
        options.scope,
      ),
  };
}

/** 例外の中身まで見るためにrejectionを取り出す */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("例外が投げられませんでした。");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pathsOf(result: ScanResult): string[] {
  return result.entries.map((entry) => entry.path);
}

function shaOf(result: ScanResult, path: string): string {
  const entry = result.entries.find((candidate) => candidate.path === path);
  if (entry === undefined) throw new Error(`manifestに無いpathです: ${path}`);
  return entry.sha256;
}

/** 何も参照しない本文 */
const NOTE = "# 見出し\n";

function notes(count: number): FakeFile[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `blog/posts/note-${index}.md`,
    content: NOTE,
  }));
}

/** `count`件のアセットを、1記事あたり50件までに分けて参照するvault */
function notesReferencing(count: number): FakeFile[] {
  const names = Array.from({ length: count }, (_, index) => `asset-${index}.png`);
  const files: FakeFile[] = names.map((name) => ({
    path: `blog/assets/${name}`,
    content: new Uint8Array([1]),
  }));
  for (let start = 0; start < count; start += 50) {
    files.push({
      path: `blog/posts/note-${start}.md`,
      content: names
        .slice(start, start + 50)
        .map((name) => `![](../assets/${name})`)
        .join("\n"),
    });
  }
  return files;
}

describe("scanVault(): 公開対象の選び方", () => {
  it("コンテンツルート直下のposts/・pages/のMarkdownだけを対象にする", async () => {
    const { run } = setup([
      { path: "blog/posts/a.md", content: NOTE },
      { path: "blog/pages/b.md", content: NOTE },
      { path: "blog/notes/c.md", content: NOTE },
      { path: "blog/d.md", content: NOTE },
      { path: "other/posts/e.md", content: NOTE },
    ]);

    expect(pathsOf(await run())).toEqual(["pages/b.md", "posts/a.md"]);
  });

  it("コンテンツルートが空文字（vaultルート）でも対象を選べる", async () => {
    const { run } = setup(
      [
        { path: "posts/a.md", content: NOTE },
        { path: "notes/b.md", content: NOTE },
      ],
      { contentRoot: "" },
    );

    expect(pathsOf(await run())).toEqual(["posts/a.md"]);
  });
});

describe("scanVault(): scopeで1件へ絞る", () => {
  const files: FakeFile[] = [
    {
      path: "blog/posts/target.md",
      content:
        "---\ntitle: 対象\nthumbnail: ../../assets/thumb.png\ncover: ../assets/cover.png\n---\n\n![猫](../assets/cat.png)\n",
    },
    { path: "blog/posts/other.md", content: "![犬](../assets/dog.png)\n" },
    { path: "blog/assets/cat.png", content: new Uint8Array([1]) },
    { path: "blog/assets/cover.png", content: new Uint8Array([2]) },
    { path: "blog/assets/dog.png", content: new Uint8Array([3]) },
    { path: "assets/thumb.png", content: new Uint8Array([4]) },
  ];
  const scope: ScanScope = { vaultPath: "blog/posts/target.md" };

  it("対象ノートと、それが参照するアセットだけをmanifestへ入れる", async () => {
    const { run } = setup(files, { scope });

    expect(pathsOf(await run())).toEqual([
      "assets/thumb.png",
      "blog/assets/cat.png",
      "blog/assets/cover.png",
      "posts/target.md",
    ]);
  });

  it("他のノートの本文は読まない", async () => {
    const scoped = setup(files, { scope });
    const whole = setup(files);

    await scoped.run();
    await whole.run();

    expect(scoped.vault.readTextCount).toBe(1);
    expect(whole.vault.readTextCount).toBe(2);
  });

  it("対象外のノートにpath不備があっても止まらない", async () => {
    const broken: FakeFile[] = [
      { path: "blog/posts/target.md", content: NOTE },
      { path: "blog/posts/back\\slash.md", content: NOTE },
    ];

    expect(pathsOf(await setup(broken, { scope }).run())).toEqual(["posts/target.md"]);

    // 同じvaultでも全量走査は止まる（黙って除外すると削除になるため）
    const error = await rejection(setup(broken).run());

    expect(error).toBeInstanceOf(ScanAbortedError);
    expect(messageOf(error)).toContain("blog/posts/back\\slash.md");
  });

  it.each([
    ["コンテンツルート外", "other/posts/a.md"],
    ["posts/・pages/の外", "blog/notes/a.md"],
    [".mdでない", "blog/posts/cat.png"],
    ["vaultに無い", "blog/posts/missing.md"],
  ])("%sノートをscopeにすると中止する", async (_label, vaultPath) => {
    const { run } = setup(
      [
        { path: "blog/posts/target.md", content: NOTE },
        { path: "other/posts/a.md", content: NOTE },
        { path: "blog/notes/a.md", content: NOTE },
        { path: "blog/posts/cat.png", content: new Uint8Array([1]) },
      ],
      { scope: { vaultPath } },
    );

    const error = await rejection(run());

    expect(error).toBeInstanceOf(ScanAbortedError);
    expect(messageOf(error)).toContain(vaultPath);
  });

  it("ScanResultの形は変わらず、articlesが1件になる", async () => {
    const result = await setup(files, { scope }).run();

    expect(result.contentRoot).toBe("blog");
    expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.articles).toEqual([
      { path: "posts/target.md", title: "対象", draft: false, issues: [] },
    ]);
    expect(result.summary.markdown.count).toBe(1);
    expect(result.summary.asset.count).toBe(3);
    expect(result.summary.publishedCount).toBe(1);
    expect(new Uint8Array(await result.loadBlob(shaOf(result, "assets/thumb.png")))).toEqual(
      new Uint8Array([4]),
    );
  });
});

describe("scanVault(): 参照アセット", () => {
  it("参照されていないアセットはmanifestにも件数にも入らない", async () => {
    const { run } = setup([
      { path: "blog/posts/a.md", content: NOTE },
      { path: "blog/assets/unused.png", content: new Uint8Array([1, 2, 3]) },
    ]);

    const result = await run();

    expect(pathsOf(result)).toEqual(["posts/a.md"]);
    expect(result.summary.asset).toEqual({ count: 0, bytes: 0 });
  });

  it("コンテンツルート外の参照アセットも、vaultルート相対keyでmanifestへ入る", async () => {
    const { run } = setup([
      { path: "blog/posts/a.md", content: "![猫](../../assets/cat.png)\n" },
      { path: "assets/cat.png", content: new Uint8Array([1, 2, 3]) },
    ]);

    const result = await run();

    // Markdownはコンテンツルート相対、アセットはvaultルート相対
    expect(result.entries.map((entry) => [entry.kind, entry.path])).toEqual([
      ["asset", "assets/cat.png"],
      ["markdown", "posts/a.md"],
    ]);
  });
});

describe("scanVault(): manifest", () => {
  const files: FakeFile[] = [
    { path: "blog/posts/b.md", content: NOTE },
    { path: "blog/pages/a.md", content: NOTE },
    { path: "blog/posts/a.md", content: "![猫](../../assets/cat.png)\n" },
    { path: "assets/cat.png", content: new Uint8Array([1, 2, 3]) },
  ];

  it("entryはpath昇順に並ぶ", async () => {
    const { run } = setup(files);

    expect(pathsOf(await run())).toEqual([
      "assets/cat.png",
      "pages/a.md",
      "posts/a.md",
      "posts/b.md",
    ]);
  });

  it("同じvaultを走査し直すと同じmanifestHashになる", async () => {
    const first = await setup(files).run();
    const second = await setup(files).run();

    expect(first.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.manifestHash).toBe(first.manifestHash);
  });
});

describe("scanVault(): 早期確認", () => {
  it("Markdownがしきい値を超えると、本文を読む前に確認して取り消せる", async () => {
    const asked: ScanAmount[] = [];
    const { vault, run } = setup(notes(CONFIRM_SCAN_MARKDOWN_COUNT + 1), {
      confirmNotes: async (amount) => {
        asked.push(amount);
        return false;
      },
    });

    expect(await rejection(run())).toBeInstanceOf(ScanCancelledError);
    expect(asked).toEqual([{ count: CONFIRM_SCAN_MARKDOWN_COUNT + 1, bytes: expect.any(Number) }]);
    expect(vault.readTextCount).toBe(0);
  });

  it("参照アセットがしきい値を超えると、アセットを読む前に確認して取り消せる", async () => {
    const asked: ScanAmount[] = [];
    const { vault, run } = setup(notesReferencing(CONFIRM_SCAN_ASSET_COUNT + 1), {
      confirmAssets: async (amount) => {
        asked.push(amount);
        return false;
      },
    });

    expect(await rejection(run())).toBeInstanceOf(ScanCancelledError);
    expect(asked).toEqual([{ count: CONFIRM_SCAN_ASSET_COUNT + 1, bytes: expect.any(Number) }]);
    expect(vault.readBinaryCount).toBe(0);
  });

  it("しきい値以内なら確認を求めない", async () => {
    let asked = 0;
    const countUp = async (): Promise<boolean> => {
      asked += 1;
      return true;
    };
    const { run } = setup(
      [
        { path: "blog/posts/a.md", content: "![猫](../assets/cat.png)\n" },
        { path: "blog/assets/cat.png", content: new Uint8Array([1, 2, 3]) },
      ],
      { confirmNotes: countUp, confirmAssets: countUp },
    );

    await run();

    expect(asked).toBe(0);
  });
});

describe("scanVault(): 読み取り失敗", () => {
  it("Markdownを読めなければ中止する", async () => {
    const { run } = setup([{ path: "blog/posts/a.md", content: NOTE, unreadable: true }]);

    expect(await rejection(run())).toBeInstanceOf(ScanAbortedError);
  });

  it("アセットを読めなければ中止する", async () => {
    const { run } = setup([
      { path: "blog/posts/a.md", content: "![猫](../assets/cat.png)\n" },
      { path: "blog/assets/cat.png", content: new Uint8Array([1, 2, 3]), unreadable: true },
    ]);

    expect(await rejection(run())).toBeInstanceOf(ScanAbortedError);
  });

  it("statのsizeが0でないのに本文が空なら、端末へ降りていないとみなして中止する", async () => {
    const { run } = setup([{ path: "blog/posts/a.md", size: 42 }]);

    expect(await rejection(run())).toBeInstanceOf(ScanAbortedError);
  });

  it("statのsizeが0でないのにアセットが0バイトなら中止する", async () => {
    const { run } = setup([
      { path: "blog/posts/a.md", content: "![猫](../assets/cat.png)\n" },
      { path: "blog/assets/cat.png", size: 42 },
    ]);

    expect(await rejection(run())).toBeInstanceOf(ScanAbortedError);
  });
});

describe("scanVault(): pathの衝突", () => {
  it("大文字小文字だけが違う公開対象が2つあると中止する", async () => {
    const { run } = setup([
      { path: "blog/posts/Hello.md", content: NOTE },
      { path: "blog/posts/hello.md", content: NOTE },
    ]);

    const error = await rejection(run());

    expect(error).toBeInstanceOf(ScanAbortedError);
    expect(messageOf(error)).toContain("posts/Hello.md");
  });

  it("NFCにすると同じpathになるファイルが2つあると中止する", async () => {
    // Vault APIが返す`vaultPath`は正規化前なので、NFC化した`path`だけが同じになる
    const composed = "blog/posts/caf\u00e9.md";
    const decomposed = "blog/posts/cafe\u0301.md";
    const { run } = setup([
      { path: composed, vaultPath: composed, content: NOTE },
      { path: composed, vaultPath: decomposed, content: NOTE },
    ]);

    const error = await rejection(run());

    expect(error).toBeInstanceOf(ScanAbortedError);
    expect(messageOf(error)).toContain(decomposed);
  });
});

describe("scanVault(): 上限", () => {
  it("上限を超えるMarkdownはpathを添えて中止する", async () => {
    const { run } = setup([
      { path: "blog/posts/big.md", content: "a".repeat(MAX_MARKDOWN_FILE_BYTES + 1) },
    ]);

    const error = await rejection(run());

    expect(error).toBeInstanceOf(ScanAbortedError);
    expect(messageOf(error)).toContain("posts/big.md");
  });

  it("上限を超える画像はpathを添えて中止する", async () => {
    const { run } = setup([
      { path: "blog/posts/a.md", content: "![猫](../assets/big.png)\n" },
      { path: "blog/assets/big.png", size: MAX_IMAGE_FILE_BYTES + 1 },
    ]);

    const error = await rejection(run());

    expect(error).toBeInstanceOf(ScanAbortedError);
    expect(messageOf(error)).toContain("blog/assets/big.png");
  });

  it("上限を超える動画はpathを添えて中止する", async () => {
    const { run } = setup([
      { path: "blog/posts/a.md", content: "![動画](../assets/big.mp4)\n" },
      { path: "blog/assets/big.mp4", size: MAX_OTHER_ASSET_FILE_BYTES + 1 },
    ]);

    const error = await rejection(run());

    expect(error).toBeInstanceOf(ScanAbortedError);
    expect(messageOf(error)).toContain("blog/assets/big.mp4");
  });

  it("Markdownがmanifestの上限件数を超えると、本文を読まずに中止する", async () => {
    const { vault, run } = setup(notes(MAX_MANIFEST_MARKDOWN_ENTRIES + 1));

    expect(await rejection(run())).toBeInstanceOf(ScanAbortedError);
    expect(vault.readTextCount).toBe(0);
  });
});

describe("scanVault(): 集計", () => {
  it("draft: trueの記事を下書きとして数える", async () => {
    const { run } = setup([
      { path: "blog/posts/published.md", content: NOTE },
      { path: "blog/posts/draft.md", content: "---\ndraft: true\n---\n\n本文\n" },
    ]);

    const { summary } = await run();

    expect(summary.publishedCount).toBe(1);
    expect(summary.draftCount).toBe(1);
  });

  it("参照先が無いアセットを持つ記事をエラーとして数える", async () => {
    const { run } = setup([{ path: "blog/posts/a.md", content: "![猫](../assets/none.png)\n" }]);

    const { summary } = await run();

    expect(summary.errorCount).toBe(1);
  });
});

describe("scanVault(): loadBlob()", () => {
  const markdown = "![猫](../assets/cat.png)\n";
  const files: FakeFile[] = [
    { path: "blog/posts/a.md", content: markdown },
    { path: "blog/assets/cat.png", content: new Uint8Array([1, 2, 3]) },
  ];

  it("Markdownを走査時と同じバイト列で読み直す", async () => {
    const result = await setup(files).run();

    const blob = await result.loadBlob(shaOf(result, "posts/a.md"));

    expect(new TextDecoder().decode(blob)).toBe(markdown);
  });

  it("アセットを走査時と同じバイト列で読み直す", async () => {
    const result = await setup(files).run();

    const blob = await result.loadBlob(shaOf(result, "blog/assets/cat.png"));

    expect([...new Uint8Array(blob)]).toEqual([1, 2, 3]);
  });

  it("走査後にvaultの内容が変わっていると中止する", async () => {
    const { vault, run } = setup(files);
    const result = await run();

    vault.setContent("blog/posts/a.md", "書き換えた本文\n");
    const error = await rejection(result.loadBlob(shaOf(result, "posts/a.md")));

    expect(error).toBeInstanceOf(ScanAbortedError);
    expect(messageOf(error)).toContain("The vault changed while publishing");
  });
});

describe("scanVault(): 進捗", () => {
  it("noteとassetの両方の進捗を通知する", async () => {
    const progress: ScanProgress[] = [];
    const { run } = setup(
      [
        { path: "blog/posts/a.md", content: "![猫](../assets/cat.png)\n" },
        { path: "blog/assets/cat.png", content: new Uint8Array([1, 2, 3]) },
      ],
      { onProgress: (event) => progress.push(event) },
    );

    await run();

    expect(progress).toEqual([
      { phase: "notes", done: 1, total: 1 },
      { phase: "assets", done: 1, total: 1 },
    ]);
  });
});
