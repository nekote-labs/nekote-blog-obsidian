import { afterEach, describe, expect, it } from "vitest";
import { getTranslations, resolveLocale, setLanguageSource } from "../src/i18n";
import { en } from "../src/i18n/locales/en";
import { ja } from "../src/i18n/locales/ja";

afterEach(() => {
  setLanguageSource(() => "en");
});

describe("resolveLocale()", () => {
  it.each([
    { label: "完全一致", language: "ja", expected: "ja" },
    { label: "地域付き", language: "ja-JP", expected: "ja" },
    { label: "大文字と_区切り", language: "JA_jp", expected: "ja" },
    { label: "未対応の地域付き英語", language: "en-GB", expected: "en" },
    { label: "未対応の言語", language: "fr", expected: "en" },
    { label: "空文字", language: "", expected: "en" },
  ])("$language は $expected", ({ language, expected }) => {
    expect(resolveLocale(language)).toBe(expected);
  });
});

describe("getTranslations()", () => {
  it("jaを注入するとjaの表が返る", () => {
    setLanguageSource(() => "ja");
    expect(getTranslations()).toBe(ja);
  });

  it("enを注入するとenの表が返る", () => {
    setLanguageSource(() => "en");
    expect(getTranslations()).toBe(en);
  });

  it("未知の言語ならenの表が返る", () => {
    setLanguageSource(() => "de");
    expect(getTranslations()).toBe(en);
  });
});

describe("en: 単数形と複数形", () => {
  it("1件なら単数形になる", () => {
    expect(en.reportModal.needAttention(1)).toBe("1 post needs attention");
    expect(en.publish.scanConfirm.noteAmount('"blog"', 1, "1 KB")).toBe(
      'The content root "blog" contains 1 note (1 KB).',
    );
    expect(en.publish.preflight.articles(1, 1)).toBe("1 public / 1 draft");
  });

  it("2件以上なら複数形になる", () => {
    expect(en.reportModal.needAttention(2)).toBe("2 posts need attention");
    expect(en.publish.confirmPublish.summary(3, 1, 2, 4, '"blog"')).toBe(
      'Publishing 3 notes (1 public, 2 drafts) and 4 referenced assets from the content root "blog".',
    );
  });
});
