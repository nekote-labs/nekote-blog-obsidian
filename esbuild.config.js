// Obsidianプラグインのバンドル。出力はリポジトリ直下の`main.js`（Releaseのasset）。
import esbuild from "esbuild";

const production = process.argv.includes("--production");

// Obsidianが実行時に提供するモジュールだけをexternalにする。
// **Node組み込みモジュールとelectronは意図的にexternalへ入れない**: モバイル
// （iOS/Android）にはこれらが存在せず、externalにすると解決できないrequireが
// バンドルへ残ってしまう。externalでなければesbuildが解決失敗としてビルドを落とす。
const external = [
  "obsidian",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
];

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: false,
  outfile: "main.js",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
