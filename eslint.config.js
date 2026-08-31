import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Node/Electron依存を禁じるためのパターン。
 *
 * このプラグインは`isDesktopOnly: false`でiOS/Androidでも動く必要があり、
 * そこにはNode組み込みモジュールもElectronも存在しない。ビルド（esbuildの
 * `platform: "browser"`）と`nr check:bundle`でも見ているが、型だけのimportは
 * バンドルに残らないためlintでしか捕まえられない。
 */
const forbiddenRuntimePatterns = [
  {
    // gitignore風のグロブではpath segmentに一致してしまい、`./http`のような相対importまで
    // 巻き込むため、先頭から正規表現で判定する
    regex: "^(node:|electron$|electron/)",
    message: "Node組み込みモジュール・Electron APIはモバイルで動かない。",
  },
  {
    regex:
      "^(assert|buffer|child_process|crypto|events|fs|http|https|module|net|os|path|process|stream|url|util|worker_threads|zlib)(/|$)",
    message: "Node組み込みモジュールはモバイルで動かない。Web標準APIを使う。",
  },
];

export default tseslint.config(
  {
    ignores: ["node_modules", "main.js", "main.js.map", "protocol/v1"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // プラグイン本体だけに課す制約。テストとビルドスクリプトはNodeで動くので対象外
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: forbiddenRuntimePatterns }],
      "no-restricted-globals": [
        "error",
        { name: "process", message: "Node環境の値。モバイルには存在しない。" },
        { name: "Buffer", message: "Node環境の値。ArrayBuffer/Uint8Arrayを使う。" },
        { name: "require", message: "CommonJSのrequireは使わない。" },
        { name: "__dirname", message: "Node環境の値。" },
        { name: "__filename", message: "Node環境の値。" },
      ],
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  {
    files: ["tests/**/*.ts", "scripts/**/*.js", "*.js", "*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
