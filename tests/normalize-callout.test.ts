import { describe, expect, it } from "vitest";
import { IssueCollector } from "../src/content/issues";
import { normalizeCallouts } from "../src/normalize/callout";

/** 行を並べて本文を作る。テスト側のインデントが本文へ混ざらないように */
function md(...lines: string[]): string {
  return lines.join("\n");
}

function run(body: string): { text: string; warnings: string[] } {
  const issues = new IssueCollector();
  const text = normalizeCallouts(body, issues);
  const warnings = issues
    .list()
    .filter((issue) => issue.level === "warning")
    .map((issue) => issue.message);
  return { text, warnings };
}

describe("normalizeCallouts(): typeの対応", () => {
  it.each([
    ["note", "note"],
    ["info", "info"],
    ["todo", "check"],
    ["tip", "tip"],
    ["question", "help"],
    ["warning", "warning"],
    ["failure", "alert"],
  ])("[!%s]は:::%sになる", (identifier, type) => {
    const { text, warnings } = run(md(`> [!${identifier}] タイトル`, "> 本文"));

    expect(text).toBe(md(`:::${type}[タイトル]`, "本文", ":::"));
    expect(warnings).toEqual([]);
  });

  it.each([
    ["abstract", "note"],
    ["summary", "note"],
    ["tldr", "note"],
    ["example", "note"],
    ["quote", "note"],
    ["cite", "note"],
    ["success", "check"],
    ["check", "check"],
    ["done", "check"],
    ["hint", "tip"],
    ["important", "tip"],
    ["help", "help"],
    ["faq", "help"],
    ["caution", "warning"],
    ["attention", "warning"],
    ["fail", "alert"],
    ["missing", "alert"],
    ["danger", "alert"],
    ["error", "alert"],
    ["bug", "alert"],
  ])("別名の[!%s]は:::%sへ寄る", (identifier, type) => {
    const { text, warnings } = run(md(`> [!${identifier}] タイトル`, "> 本文"));

    expect(text).toBe(md(`:::${type}[タイトル]`, "本文", ":::"));
    expect(warnings).toEqual([]);
  });

  it("識別子の大文字小文字は区別しない", () => {
    expect(run("> [!Warning] 注意").text).toBe(md(":::warning[注意]", ":::"));
  });

  it("対応表に無い識別子はnoteにして警告する", () => {
    const { text, warnings } = run(md("> [!custom] 独自", "> 本文"));

    expect(text).toBe(md(":::note[独自]", "本文", ":::"));
    expect(warnings).toEqual([
      "This callout type is not supported, so it was rendered as a note: custom",
    ]);
  });
});

describe("normalizeCallouts(): タイトル", () => {
  it("明示されたタイトルをラベルにする", () => {
    expect(run(md("> [!info] 補足です", "> 本文")).text).toBe(
      md(":::info[補足です]", "本文", ":::"),
    );
  });

  it("タイトル省略時は識別子をタイトルケースにしたものを補う（type名ではない）", () => {
    expect(run("> [!tldr]").text).toBe(md(":::note[Tldr]", ":::"));
  });

  it("別名の識別子でも既定タイトルは識別子そのもの", () => {
    expect(run("> [!faq]").text).toBe(md(":::help[Faq]", ":::"));
  });

  it("大文字で書かれた識別子の既定タイトルは先頭だけ大文字にする", () => {
    expect(run("> [!INFO]").text).toBe(md(":::info[Info]", ":::"));
  });

  it("タイトルの]はエスケープする", () => {
    expect(run("> [!note] a] b").text).toBe(md(":::note[a\\] b]", ":::"));
  });
});

describe("normalizeCallouts(): 本文", () => {
  it("複数行の本文をそのまま並べる", () => {
    expect(run(md("> [!note] タイトル", "> 1行目", "> 2行目")).text).toBe(
      md(":::note[タイトル]", "1行目", "2行目", ":::"),
    );
  });

  it("本文が無いCalloutも開始行と終了行で出す", () => {
    expect(run("> [!warning] 注意").text).toBe(md(":::warning[注意]", ":::"));
  });

  it("本文末尾の空行は落とす", () => {
    expect(run(md("> [!note] タイトル", "> 本文", ">", ">")).text).toBe(
      md(":::note[タイトル]", "本文", ":::"),
    );
  });

  it("本文に:::があればフェンスを1本長くする", () => {
    expect(run(md("> [!note] タイトル", "> :::note[中]", "> 本文", "> :::")).text).toBe(
      md("::::note[タイトル]", ":::note[中]", "本文", ":::", "::::"),
    );
  });
});

describe("normalizeCallouts(): 折りたたみ指定", () => {
  it("-は無視する", () => {
    const { text, warnings } = run("> [!tip]- タイトル");

    expect(text).toBe(md(":::tip[タイトル]", ":::"));
    expect(warnings).toEqual([]);
  });

  it("+はタイトル省略時も無視する", () => {
    const { text, warnings } = run("> [!tip]+");

    expect(text).toBe(md(":::tip[Tip]", ":::"));
    expect(warnings).toEqual([]);
  });
});

describe("normalizeCallouts(): 入れ子のCallout", () => {
  it("外側は変換し、内側は通常の引用にして警告する", () => {
    const { text, warnings } = run(md("> [!question] 外側", "> > [!todo] 内側"));

    expect(text).toBe(md(":::help[外側]", "> 内側", ":::"));
    expect(warnings).toEqual(["Nested callouts were rendered as regular blockquotes."]);
  });

  it("内側のタイトルが無ければ既定タイトルを残す", () => {
    expect(run(md("> [!question] 外側", "> > [!todo]")).text).toBe(
      md(":::help[外側]", "> Todo", ":::"),
    );
  });

  it("Calloutでない引用の中にあっても記法だけ取り除いて警告する", () => {
    const { text, warnings } = run(md("> ふつうの引用", "> > [!warning] 内側"));

    expect(text).toBe(md("> ふつうの引用", "> > 内側"));
    expect(warnings).toEqual(["Nested callouts were rendered as regular blockquotes."]);
  });
});

describe("normalizeCallouts(): 変えないもの", () => {
  it("Calloutでない引用はそのまま", () => {
    const body = md("> ふつうの引用", "> 続き");
    const { text, warnings } = run(body);

    expect(text).toBe(body);
    expect(warnings).toEqual([]);
  });

  it("フェンス付きコードブロックの中のCalloutはそのまま", () => {
    const body = md("```md", "> [!note] タイトル", "> 本文", "```");
    const { text, warnings } = run(body);

    expect(text).toBe(body);
    expect(warnings).toEqual([]);
  });

  it("行頭の空白が4個以上ならblockquoteとして扱わない", () => {
    const body = md("    > [!note] タイトル", "    > 本文");

    expect(run(body).text).toBe(body);
  });
});

describe("normalizeCallouts(): 出力の体裁", () => {
  it("行頭のインデントを開始行・本文・終了行へ引き継ぐ", () => {
    expect(run(md("- 項目", "  > [!info] メモ", "  > 本文")).text).toBe(
      md("- 項目", "", "  :::info[メモ]", "  本文", "  :::"),
    );
  });

  it("前後が段落なら空行で挟む", () => {
    expect(run(md("段落", "> [!info] メモ", "> 本文", "次の段落")).text).toBe(
      md("段落", "", ":::info[メモ]", "本文", ":::", "", "次の段落"),
    );
  });

  it("すでに空行があれば増やさない", () => {
    expect(run(md("段落", "", "> [!info] メモ", "", "次の段落")).text).toBe(
      md("段落", "", ":::info[メモ]", ":::", "", "次の段落"),
    );
  });

  it("CRLFの本文でも改行の形を保つ", () => {
    expect(run("> [!note] タイトル\r\n> 本文\r\n").text).toBe(
      ":::note[タイトル]\r\n本文\r\n:::\r\n",
    );
  });
});
