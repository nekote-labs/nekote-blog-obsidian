import { describe, expect, it } from "vitest";
import { PROTOCOL_MAJOR } from "../src/protocol/limits";
import type { SyncManifestEntry } from "../src/protocol/types";
import {
  buildSyncManifest,
  canonicalManifestJson,
  diffAgainstApplied,
  findCaseCollision,
  manifestHash,
  sortManifestEntries,
} from "../src/sync/manifest";

function markdown(path: string, sha256 = "a".repeat(64)): SyncManifestEntry {
  return { path, kind: "markdown", sha256, bytes: 10 };
}

function asset(path: string, sha256 = "b".repeat(64)): SyncManifestEntry {
  return { path, kind: "asset", sha256, bytes: 20 };
}

describe("sortManifestEntries()", () => {
  it("path昇順へ並べ替える", () => {
    const sorted = sortManifestEntries([markdown("posts/b.md"), markdown("posts/a.md")]);

    expect(sorted.map((entry) => entry.path)).toEqual(["posts/a.md", "posts/b.md"]);
  });

  it("大文字はUTF-16コード単位順で小文字より前に来る", () => {
    const sorted = sortManifestEntries([markdown("posts/a.md"), markdown("posts/Z.md")]);

    expect(sorted.map((entry) => entry.path)).toEqual(["posts/Z.md", "posts/a.md"]);
  });

  it("ASCII以外もコード単位順に並ぶ", () => {
    const sorted = sortManifestEntries([
      markdown("posts/あ.md"),
      markdown("posts/z.md"),
      markdown("posts/0.md"),
    ]);

    expect(sorted.map((entry) => entry.path)).toEqual(["posts/0.md", "posts/z.md", "posts/あ.md"]);
  });

  it("元の配列は並べ替えない", () => {
    const entries = [markdown("posts/b.md"), markdown("posts/a.md")];

    const sorted = sortManifestEntries(entries);

    expect(entries.map((entry) => entry.path)).toEqual(["posts/b.md", "posts/a.md"]);
    expect(sorted).not.toBe(entries);
  });
});

describe("findCaseCollision()", () => {
  it("大文字小文字だけが違うpathの組を返す", () => {
    const collision = findCaseCollision([
      markdown("posts/a.md"),
      markdown("posts/b.md"),
      markdown("posts/A.md"),
    ]);

    expect(collision).toEqual({ first: "posts/a.md", second: "posts/A.md" });
  });

  it("kindが違っても衝突として扱う", () => {
    expect(findCaseCollision([markdown("posts/a.md"), asset("posts/A.MD")])).toEqual({
      first: "posts/a.md",
      second: "posts/A.MD",
    });
  });

  it("衝突が無ければnull", () => {
    expect(findCaseCollision([markdown("posts/a.md"), markdown("posts/b.md")])).toBeNull();
  });

  it("空の配列はnull", () => {
    expect(findCaseCollision([])).toBeNull();
  });
});

describe("canonicalManifestJson()", () => {
  it("キーの並びを固定する", () => {
    // 入力のキー順に依存しないことを見るため、型と逆の順で書く
    const entry: SyncManifestEntry = {
      linkedArticlePaths: ["posts/b.md"],
      assetPaths: ["assets/x.png"],
      bytes: 10,
      sha256: "c".repeat(64),
      kind: "markdown",
      path: "posts/a.md",
    };

    expect(canonicalManifestJson("blog", [entry])).toBe(
      `{"contentRoot":"blog","entries":[{"path":"posts/a.md","kind":"markdown","sha256":"${"c".repeat(64)}","bytes":10,"assetPaths":["assets/x.png"],"linkedArticlePaths":["posts/b.md"]}]}`,
    );
  });

  it("参照フィールドが未指定なら出力されない", () => {
    expect(canonicalManifestJson("blog", [markdown("posts/a.md", "d".repeat(64))])).toBe(
      `{"contentRoot":"blog","entries":[{"path":"posts/a.md","kind":"markdown","sha256":"${"d".repeat(64)}","bytes":10}]}`,
    );
  });

  it("空配列の参照フィールドは出力されない", () => {
    const entry: SyncManifestEntry = {
      ...markdown("posts/a.md", "d".repeat(64)),
      assetPaths: [],
      linkedArticlePaths: [],
    };

    expect(canonicalManifestJson("blog", [entry])).toBe(
      `{"contentRoot":"blog","entries":[{"path":"posts/a.md","kind":"markdown","sha256":"${"d".repeat(64)}","bytes":10}]}`,
    );
  });

  it("contentRootが空文字（vaultルート）でも出力する", () => {
    expect(canonicalManifestJson("", [])).toBe('{"contentRoot":"","entries":[]}');
  });

  it("entryが無ければentriesは空配列", () => {
    expect(canonicalManifestJson("blog", [])).toBe('{"contentRoot":"blog","entries":[]}');
  });

  it("JSONとして読み戻せる", () => {
    const json = canonicalManifestJson("blog", [markdown("posts/a.md"), asset("assets/x.png")]);

    expect(JSON.parse(json)).toEqual({
      contentRoot: "blog",
      entries: [
        { path: "posts/a.md", kind: "markdown", sha256: "a".repeat(64), bytes: 10 },
        { path: "assets/x.png", kind: "asset", sha256: "b".repeat(64), bytes: 20 },
      ],
    });
  });
});

describe("manifestHash()", () => {
  it("同じ入力からは同じhashが出る", async () => {
    const entries = [markdown("posts/a.md"), asset("assets/x.png")];

    expect(await manifestHash("blog", entries)).toBe(await manifestHash("blog", entries));
  });

  it("sha256のhex（64文字）を返す", async () => {
    expect(await manifestHash("blog", [markdown("posts/a.md")])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("入力オブジェクトのキーの並びが違っても同じhashになる", async () => {
    const forward: SyncManifestEntry = {
      path: "posts/a.md",
      kind: "markdown",
      sha256: "c".repeat(64),
      bytes: 10,
      assetPaths: ["assets/x.png"],
    };
    const reversed: SyncManifestEntry = {
      assetPaths: ["assets/x.png"],
      bytes: 10,
      sha256: "c".repeat(64),
      kind: "markdown",
      path: "posts/a.md",
    };

    expect(await manifestHash("blog", [reversed])).toBe(await manifestHash("blog", [forward]));
  });

  it("contentRootが違えば違うhashになる", async () => {
    const entries = [markdown("posts/a.md")];

    expect(await manifestHash("blog", entries)).not.toBe(await manifestHash("", entries));
  });

  it("entryの内容が違えば違うhashになる", async () => {
    expect(await manifestHash("blog", [markdown("posts/a.md", "a".repeat(64))])).not.toBe(
      await manifestHash("blog", [markdown("posts/a.md", "e".repeat(64))]),
    );
  });

  it("entryの並びが違えば違うhashになる", async () => {
    const first = markdown("posts/a.md");
    const second = markdown("posts/b.md");

    expect(await manifestHash("blog", [first, second])).not.toBe(
      await manifestHash("blog", [second, first]),
    );
  });
});

describe("buildSyncManifest()", () => {
  const input = {
    vaultId: "vault-abcdefgh",
    contentRoot: "blog",
    baseRevision: 3,
    mode: "full" as const,
    entries: [markdown("posts/a.md")],
  };

  it("protocolVersionを入れて組み立てる", () => {
    expect(buildSyncManifest(input)).toEqual({
      protocolVersion: PROTOCOL_MAJOR,
      vaultId: "vault-abcdefgh",
      contentRoot: "blog",
      baseRevision: 3,
      mode: "full",
      entries: [markdown("posts/a.md")],
    });
  });

  it.each(["full", "partial"] as const)("mode: %sをそのまま載せる", (mode) => {
    expect(buildSyncManifest({ ...input, mode }).mode).toBe(mode);
  });

  it("modeが違ってもmanifestHashは変わらない", async () => {
    const full = buildSyncManifest({ ...input, mode: "full" });
    const partial = buildSyncManifest({ ...input, mode: "partial" });

    expect(await manifestHash(partial.contentRoot, partial.entries)).toBe(
      await manifestHash(full.contentRoot, full.entries),
    );
  });

  it("entriesの配列は入力と共有しない", () => {
    const entries = [markdown("posts/a.md")];

    const manifest = buildSyncManifest({ ...input, entries });

    manifest.entries.push(markdown("posts/b.md"));
    expect(entries).toHaveLength(1);
  });
});

describe("diffAgainstApplied()", () => {
  it("追加・更新・削除へ振り分ける", () => {
    const entries = [
      markdown("posts/added.md", "1".repeat(64)),
      markdown("posts/updated.md", "2".repeat(64)),
      markdown("posts/same.md", "3".repeat(64)),
    ];
    const applied = [
      { path: "posts/updated.md", sha256: "9".repeat(64) },
      { path: "posts/same.md", sha256: "3".repeat(64) },
      { path: "posts/deleted.md", sha256: "4".repeat(64) },
    ];

    expect(diffAgainstApplied(entries, applied)).toEqual({
      added: ["posts/added.md"],
      updated: ["posts/updated.md"],
      deleted: ["posts/deleted.md"],
    });
  });

  it("適用済みが空なら全Markdownが追加になる", () => {
    expect(diffAgainstApplied([markdown("posts/a.md"), markdown("posts/b.md")], [])).toEqual({
      added: ["posts/a.md", "posts/b.md"],
      updated: [],
      deleted: [],
    });
  });

  it("アセットentryは追加・更新の判定に含めない", () => {
    const diff = diffAgainstApplied(
      [asset("assets/new.png"), asset("assets/changed.png", "5".repeat(64))],
      [{ path: "assets/changed.png", sha256: "6".repeat(64) }],
    );

    expect(diff).toEqual({ added: [], updated: [], deleted: [] });
  });

  // 削除判定は種別を見ないので、アセットとして残っているpathは削除に出ない
  it("適用済みのpathがアセットとして残っていれば削除にしない", () => {
    const diff = diffAgainstApplied(
      [asset("assets/x.png")],
      [{ path: "assets/x.png", sha256: "7".repeat(64) }],
    );

    expect(diff.deleted).toEqual([]);
  });

  it("現在のmanifestに無い適用済みpathだけが削除になる", () => {
    const diff = diffAgainstApplied(
      [markdown("posts/a.md")],
      [
        { path: "posts/a.md", sha256: "a".repeat(64) },
        { path: "posts/gone.md", sha256: "8".repeat(64) },
        { path: "assets/gone.png", sha256: "8".repeat(64) },
      ],
    );

    expect(diff.deleted).toEqual(["posts/gone.md", "assets/gone.png"]);
  });

  it("何も無ければすべて空", () => {
    expect(diffAgainstApplied([], [])).toEqual({
      added: [],
      updated: [],
      deleted: [],
    });
  });
});
