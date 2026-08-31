// このプラグインは`isDesktopOnly: false`でiOS/Androidでも動く。モバイルにはNode
// 組み込みモジュールもElectronも存在しないため、これらへの依存がバンドルへ残ると
// 実機で壊れる。出荷前の最後の砦としてビルド成果物そのものを検査する。
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const bundleUrl = new URL("main.js", root);
const sourcemapUrl = new URL("main.js.map", root);

const nodeBuiltins = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "process",
  "stream",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);

// Obsidianが実行時に提供するモジュール。esbuildのexternalと対応しており、
// これらのrequireはバンドルに残っていて正常。
function isProvidedByObsidian(spec) {
  return spec === "obsidian" || spec.startsWith("@codemirror/") || spec.startsWith("@lezer/");
}

function isForbidden(spec) {
  if (isProvidedByObsidian(spec)) return false;
  if (spec.startsWith("node:")) return true;
  if (spec === "electron" || spec.startsWith("electron/")) return true;
  if (spec === "original-fs") return true;
  return nodeBuiltins.has(spec.split("/")[0]);
}

const errors = [];

if (!existsSync(bundleUrl)) {
  errors.push("main.js が見つからない。先に `pnpm run build` を実行する。");
} else {
  const code = readFileSync(bundleUrl, "utf8");

  const found = new Set();
  for (const match of code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (isForbidden(match[1])) found.add(match[1]);
  }
  if (found.size > 0) {
    errors.push(`main.js にNode/Electron依存が残っている: ${[...found].sort().join(", ")}`);
  }

  if (code.includes("//# sourceMappingURL=data:")) {
    errors.push("main.js にinline sourcemapが混入している。`--production` でビルドする。");
  }
}

if (existsSync(sourcemapUrl)) {
  errors.push("main.js.map が存在する。production buildではsourcemapを出力しない。");
}

if (errors.length > 0) {
  for (const error of errors) console.error(`check:bundle: ${error}`);
  process.exitCode = 1;
} else {
  console.log("check:bundle: OK (main.js にNode/Electron依存とsourcemapなし)");
}
