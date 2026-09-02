import js from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
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
  // 公式のガイドライン検査。`files`で囲うとpackage.json向けの設定まで巻き込んで
  // srcがJSONとして解析されるため、この配列はそのまま展開する
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // 公式ルールはプラグイン本体を検査するもので、テストとビルドスクリプトには当てない。
    // 型情報を要るルールが混ざっており、`tsconfig.json`の外にあるこれらでは動かせない
    files: ["tests/**/*.ts", "scripts/**/*.js", "*.js", "*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: Object.fromEntries(
      Object.keys(obsidianmd.rules).map((name) => [`obsidianmd/${name}`, "off"]),
    ),
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
      // 既定ではブランド名も文中の語として小文字化を促されるため、固有名詞と
      // 画像形式の綴りを教える
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Nekote", "Nekote Blog", "Obsidian", "Community plugins", "Markdown", "WebP"],
          acronyms: ["PNG", "JPG", "JPEG", "GIF", "AVIF", "URL", "API", "SVG", "YAML"],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts", "scripts/**/*.js", "*.js", "*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
