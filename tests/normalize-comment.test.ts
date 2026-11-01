import { describe, expect, it } from "vitest";
import { removeObsidianComments } from "../src/normalize/comment";

/** 行を並べて本文を作る */
function md(...lines: string[]): string {
  return lines.join("\n");
}

describe("removeObsidianComments()", () => {
  it.each([
    { label: "行内", body: "公開 %%非公開 ![](hidden.png)%% 本文", expected: "公開  本文" },
    { label: "行頭から始まり同じ行で閉じる", body: "%%メモ%% 本文", expected: " 本文" },
    {
      label: "空行をまたぐブロック",
      body: md("a", "%%", "メモ", "", "メモ", "%%", "b"),
      expected: md("a", "", "", "", "", "", "b"),
    },
    { label: "閉じた後ろの文字", body: md("%%", "メモ", "%% 本文"), expected: md("", "", " 本文") },
    {
      label: "閉じないブロックは本文の最後まで",
      body: md("a", "%%", "メモ", "", "b"),
      expected: md("a", "", "", "", ""),
    },
    {
      label: "ブロックの中のフェンス",
      body: md("%%", "```", "%%", "b"),
      expected: md("", "", "", "b"),
    },
    {
      label: "引用の中",
      body: md("> a", "> %%", "> メモ", "> %%", "> b"),
      expected: md("> a", "> ", "> ", "> ", "> b"),
    },
    {
      label: "リスト項目の中",
      body: md("- %%", "  メモ", "  %%", "- b"),
      expected: md("- ", "", "", "- b"),
    },
    {
      label: "閉じた後ろから始まるブロック",
      body: md("%%", "a", "%% %%", "b", "%%", "c"),
      expected: md("", "", " ", "", "", "c"),
    },
    { label: "CRLF", body: "a\r\n%%\r\nメモ\r\n%%\r\nb", expected: "a\r\n\r\n\r\n\r\nb" },
  ])("コメントを中身ごと取り除く（$label）", ({ body, expected }) => {
    expect(removeObsidianComments(body)).toBe(expected);
  });

  it.each([
    { label: "コードの中", body: md("`%%a%%`", "```", "%%", "```") },
    { label: "同じ行で閉じない%%", body: "100%% と書く" },
    { label: "行をまたぐ行内の%%", body: md("a %%b", "c%% d") },
    { label: "エスケープした%%", body: "\\%%a\\%%" },
    { label: "HTMLコメントの中の%%", body: "a <!-- %% --> b %% c" },
  ])("$labelは残す", ({ body }) => {
    expect(removeObsidianComments(body)).toBe(body);
  });
});
