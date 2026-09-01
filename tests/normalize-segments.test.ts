import { describe, expect, it } from "vitest";
import { joinBodyLines, replaceOutsideCode, splitBodyLines } from "../src/normalize/segments";

/** 行ごとの`fenced`だけを取り出す */
function fencedFlags(body: string): boolean[] {
  return splitBodyLines(body).map((line) => line.fenced);
}

/** `replace`へ渡った断片を記録しつつ、`[[…]]`をXへ置き換える */
function replaceWikilinks(body: string): { result: string; fragments: string[] } {
  const fragments: string[] = [];
  const result = replaceOutsideCode(body, (text) => {
    fragments.push(text);
    return text.replace(/\[\[[^\]]*\]\]/g, "X");
  });
  return { result, fragments };
}

describe("splitBodyLines(): フェンス付きコードブロック", () => {
  it("フェンス行自体と内側がtrue、閉じた後はfalse", () => {
    expect(fencedFlags("a\n```\ncode\n```\nb")).toEqual([false, true, true, true, false]);
  });

  it("~~~のフェンスも同じ", () => {
    expect(fencedFlags("a\n~~~\ncode\n~~~\nb")).toEqual([false, true, true, true, false]);
  });

  it("情報文字列付きの開始フェンスも開く", () => {
    expect(fencedFlags("```ts\ncode\n```\nb")).toEqual([true, true, true, false]);
  });

  it("閉じフェンスは情報文字列を持てない", () => {
    expect(fencedFlags("```\ncode\n```ts\nb")).toEqual([true, true, true, true]);
  });

  it("長いフェンスは短い閉じフェンスでは閉じない", () => {
    expect(fencedFlags("````\n```\ncode\n````\nb")).toEqual([true, true, true, true, false]);
  });

  it("開始より長い閉じフェンスは閉じる", () => {
    expect(fencedFlags("```\ncode\n`````\nb")).toEqual([true, true, true, false]);
  });

  it("~~~は```では閉じない", () => {
    expect(fencedFlags("~~~\ncode\n```\nb")).toEqual([true, true, true, true]);
  });

  it("閉じないフェンスは最後までtrue", () => {
    expect(fencedFlags("a\n```\ncode\nmore")).toEqual([false, true, true, true]);
  });

  it.each([0, 1, 2, 3])("行頭%dスペースのフェンスは有効", (indent) => {
    const pad = " ".repeat(indent);
    expect(fencedFlags(`a\n${pad}\`\`\`\ncode\n${pad}\`\`\`\nb`)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("行頭4スペース以上のフェンスは無効", () => {
    expect(fencedFlags("a\n    ```\ncode\n    ```\nb")).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("インラインコードだけの行はフェンスにならない", () => {
    expect(fencedFlags("a ``b`` c")).toEqual([false]);
  });

  it("フェンスが無ければすべてfalse", () => {
    expect(fencedFlags("a\nb\nc")).toEqual([false, false, false]);
  });
});

describe("joinBodyLines()", () => {
  it.each([
    { label: "空文字", body: "" },
    { label: "改行なし", body: "hello" },
    { label: "末尾改行あり", body: "a\nb\n" },
    { label: "空行を含む", body: "a\n\n\nb" },
    { label: "フェンス付き", body: "a\n```ts\ncode\n```\nb\n" },
    { label: "閉じないフェンス", body: "```\ncode" },
    { label: "CRLF", body: "a\r\n```\r\ncode\r\n```\r\nb\r\n" },
  ])("splitBodyLines()の結果を繋ぐと元の本文へ戻る（$label）", ({ body }) => {
    expect(joinBodyLines(splitBodyLines(body).map((line) => line.text))).toBe(body);
  });

  it("CRLFの本文でもフェンスを認識する", () => {
    expect(fencedFlags("a\r\n```\r\ncode\r\n```\r\nb")).toEqual([false, true, true, true, false]);
  });
});

describe("replaceOutsideCode()", () => {
  it("コードでない部分は置換される", () => {
    expect(replaceWikilinks("[[a]] と [[b]]").result).toBe("X と X");
  });

  it("フェンス付きコードブロックの中身は置換されない", () => {
    const body = "[[a]]\n```\n[[b]]\n```\n[[c]]";

    expect(replaceWikilinks(body).result).toBe("X\n```\n[[b]]\n```\nX");
  });

  it("インラインコードの中身は置換されない", () => {
    expect(replaceWikilinks("[[a]] `[[b]]` [[c]]").result).toBe("X `[[b]]` X");
  });

  it("二重バックティックのインラインコードも保護する", () => {
    expect(replaceWikilinks("[[a]] ``[[b]]`` [[c]]").result).toBe("X ``[[b]]`` X");
  });

  it("二重バックティックの中の単独バックティックは閉じ扱いにならない", () => {
    expect(replaceWikilinks("x ``a`[[b]]`` y").result).toBe("x ``a`[[b]]`` y");
  });

  it("長さの違うバックティックでは閉じない", () => {
    // 開いたまま閉じないので、以降は全部テキスト扱い
    expect(replaceWikilinks("``[[a]]` [[b]]").result).toBe("``X` X");
  });

  it("閉じないバックティック以降はテキスト扱い", () => {
    const { result, fragments } = replaceWikilinks("x `[[a]] y");

    expect(result).toBe("x `X y");
    expect(fragments).toEqual(["x `[[a]] y"]);
  });

  it("置換関数はコード以外の断片だけを受け取る", () => {
    const { fragments } = replaceWikilinks("a `code` b\n```\nfenced\n```\nc ``x`` d");

    expect(fragments).toEqual(["a ", " b", "c ", " d"]);
  });

  it("置換しなければ本文は元のまま", () => {
    const body = "a `code` b\n```ts\nfenced\n```\nc\r\nd";

    expect(replaceOutsideCode(body, (text) => text)).toBe(body);
  });
});
