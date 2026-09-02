// UI文言の言語切り替え。`en`が正本で、Obsidianの表示言語が日本語のときだけ`ja`を返す。
//
// **`obsidian`をimportしない**。走査・正規化・APIといったpure層のテストは`obsidian`を
// モックしていないので、ここでimportすると全テストにモックが要る。言語コードは
// `main.ts`が`setLanguageSource()`で注入する。
import { en, type LocaleStrings } from "./locales/en";
import { ja } from "./locales/ja";

export type { LocaleStrings };

export type LocaleCode = "en" | "ja";

const LOCALES: Record<LocaleCode, LocaleStrings> = { en, ja };

/** 未注入なら`en`。テストはこの状態で走る */
let languageSource: () => string = () => "en";

/** 言語コードの取得元を差し替える。`main.ts`が`onload()`でObsidianの`getLanguage()`を注入する */
export function setLanguageSource(source: () => string): void {
  languageSource = source;
}

/** 小文字化と`_`→`-`の正規化 → 完全一致 → 先頭の言語部分（`ja-JP`→`ja`） → `en` */
export function resolveLocale(language: string): LocaleCode {
  const normalized = language.toLowerCase().replace(/_/g, "-");
  if (isLocaleCode(normalized)) return normalized;
  const primary = normalized.split("-")[0] ?? "";
  return isLocaleCode(primary) ? primary : "en";
}

/**
 * いまの表示言語の文言表。呼ぶたびに言語を解決するので、
 * Obsidianが言語変更で再読み込みを要求しなくても次の描画から切り替わる
 */
export function getTranslations(): LocaleStrings {
  return LOCALES[resolveLocale(languageSource())];
}

function isLocaleCode(value: string): value is LocaleCode {
  return value === "en" || value === "ja";
}
