import { describe, expect, it } from "vitest";
import { normalizeHighlights } from "../src/normalize/highlight";

/** 行を並べて本文を作る。テスト側のインデントが本文へ混ざらないように */
function md(...lines: string[]): string {
  return lines.join("\n");
}

describe("normalizeHighlights(): 色付きハイライト", () => {
  it.each([
    ["🔴", "red"],
    ["🟠", "orange"],
    ["🟡", "yellow"],
    ["🟢", "green"],
    ["🔵", "blue"],
    ["🟣", "purple"],
  ])("%sを色名%sのマーカーにする", (emoji, color) => {
    expect(normalizeHighlights(`これは==${emoji}重要==です`)).toBe(
      `これは:marker[重要]{${color}}です`,
    );
  });

  it("四角の絵文字も丸と同じ色にする（Obsidianの対応表）", () => {
    expect(normalizeHighlights("==🟦参考==")).toBe(":marker[参考]{blue}");
  });

  it("中のインラインコードも含めてマーカーにする", () => {
    expect(normalizeHighlights("==🔴`npm i`を忘れない==")).toBe(":marker[`npm i`を忘れない]{red}");
  });

  it("対応の取れた括弧はそのままラベルへ入れる", () => {
    expect(normalizeHighlights("==🔴[リンク](https://example.com)==")).toBe(
      ":marker[[リンク](https://example.com)]{red}",
    );
  });

  it("直前が空白の==では閉じない", () => {
    expect(normalizeHighlights("==🔴a ==b==")).toBe(":marker[a ==b]{red}");
  });

  it("直前の:はエスケープする（::markerはdirectiveとして読まれない）", () => {
    expect(normalizeHighlights("Note:==🔴大事==")).toBe("Note\\::marker[大事]{red}");
  });
});

describe("normalizeHighlights(): 変えないもの", () => {
  it("色の無いハイライトはそのまま", () => {
    expect(normalizeHighlights("==重要==")).toBe("==重要==");
  });

  it("色の無いハイライトの中にある==🔴は変換しない", () => {
    expect(normalizeHighlights("==a ==🔴b==")).toBe("==a ==🔴b==");
  });

  it.each([
    ["空の中身", "==🔴=="],
    ["対応しない]", "==🔴a]b=="],
    ["末尾の\\（閉じる]をエスケープしてしまう）", "==🔴a\\=="],
  ])("ラベルにできない中身（%s）はそのまま", (_name, body) => {
    expect(normalizeHighlights(body)).toBe(body);
  });

  it("コードの中はそのまま", () => {
    const body = md("`==🔴a==`", "```", "==🔴a==", "```");

    expect(normalizeHighlights(body)).toBe(body);
  });
});
