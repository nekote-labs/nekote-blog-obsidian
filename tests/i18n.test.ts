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
