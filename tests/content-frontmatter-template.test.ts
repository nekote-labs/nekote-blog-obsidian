import { describe, expect, it } from "vitest";
import {
  applyFrontmatterTemplate,
  localIsoDate,
  needsFrontmatterTemplate,
} from "../src/content/frontmatter-template";

describe("applyFrontmatterTemplate()", () => {
  it("空のfrontmatterへ全キーを挿入する", () => {
    const frontmatter: Record<string, unknown> = {};

    const changed = applyFrontmatterTemplate(frontmatter, "2026-09-01");

    expect(changed).toBe(true);
    expect(frontmatter).toEqual({
      draft: true,
      date: "2026-09-01",
      tags: [],
      category: "",
      slug: "",
      emoji: "",
      thumbnail: "",
      cover: "",
    });
  });

  it("titleは挿入しない（ファイル名で補完される）", () => {
    const frontmatter: Record<string, unknown> = {};

    applyFrontmatterTemplate(frontmatter, "2026-09-01");

    expect("title" in frontmatter).toBe(false);
  });

  it("既存の値は上書きせず、欠けているキーだけ足す", () => {
    const frontmatter: Record<string, unknown> = {
      draft: false,
      date: "2020-01-01",
      tags: ["cat"],
    };

    const changed = applyFrontmatterTemplate(frontmatter, "2026-09-01");

    expect(changed).toBe(true);
    expect(frontmatter.draft).toBe(false);
    expect(frontmatter.date).toBe("2020-01-01");
    expect(frontmatter.tags).toEqual(["cat"]);
    expect(frontmatter.slug).toBe("");
  });

  it("nullや空文字が入っているキーも既存の値として保つ", () => {
    const frontmatter: Record<string, unknown> = { date: null, slug: "" };

    applyFrontmatterTemplate(frontmatter, "2026-09-01");

    expect(frontmatter.date).toBeNull();
    expect(frontmatter.slug).toBe("");
  });

  it("全キーが揃っていればfalse", () => {
    const frontmatter: Record<string, unknown> = {};
    applyFrontmatterTemplate(frontmatter, "2026-09-01");

    expect(applyFrontmatterTemplate(frontmatter, "2026-12-31")).toBe(false);
  });
});

describe("needsFrontmatterTemplate()", () => {
  it("空のfrontmatterは挿入が必要", () => {
    expect(needsFrontmatterTemplate({})).toBe(true);
  });

  it("一部のキーだけあるなら挿入が必要", () => {
    expect(needsFrontmatterTemplate({ draft: true, date: "2026-09-01" })).toBe(true);
  });

  it("全キーが揃っていれば不要（値の中身は問わない）", () => {
    const frontmatter: Record<string, unknown> = {};
    applyFrontmatterTemplate(frontmatter, "2026-09-01");

    expect(needsFrontmatterTemplate(frontmatter)).toBe(false);
  });

  it.each([
    { label: "null", value: null },
    { label: "配列", value: [] },
    { label: "文字列", value: "draft: true" },
  ])("マップでない値（$label）は挿入が必要", ({ value }) => {
    expect(needsFrontmatterTemplate(value)).toBe(true);
  });
});

describe("localIsoDate()", () => {
  it("ローカル時刻の日付をYYYY-MM-DDで返す", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("月日を0詰めする", () => {
    expect(localIsoDate(new Date(2026, 8, 1))).toBe("2026-09-01");
  });
});
