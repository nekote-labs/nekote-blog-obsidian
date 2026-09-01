// ローカル検証用に、ビルド成果物をvaultのプラグインフォルダへ複製する。
// 接続先を切り替えた実機確認のたびに手でコピーするのを避けるためのもの。
// `OBSIDIAN_PLUGIN_DIR`（環境変数か、gitignore対象の`.env`）が無ければ何もしない。
// CIとReleaseは同じ`build`を通るため、ここで失敗させてはいけない。
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  // .envが無いのは通常の状態
}

const target = process.env.OBSIDIAN_PLUGIN_DIR?.trim();
if (!target) {
  console.log("[install-to-vault] OBSIDIAN_PLUGIN_DIR が未設定のためスキップしました");
  process.exit(0);
}

const files = ["main.js", "manifest.json", "styles.css"];
const missing = files.filter((file) => !existsSync(join(root, file)));
if (missing.length > 0) {
  console.error(`[install-to-vault] 成果物がありません: ${missing.join(", ")}`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of files) {
  copyFileSync(join(root, file), join(target, file));
}
console.log(`[install-to-vault] ${files.join(", ")} を ${target} へ複製しました`);
