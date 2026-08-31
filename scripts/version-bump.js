// `npm version` / `pnpm version` のversionライフサイクルから呼ばれ、
// package.jsonのbumpに manifest.json と versions.json を追従させる。
// 同じcommitへ含める必要があるためgit addまで行う。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const version = process.env.npm_package_version;

if (!version) {
  console.error("version-bump: npm_package_version がない。`pnpm version <x.y.z>` から実行する。");
  process.exit(1);
}

function readJson(name) {
  return JSON.parse(readFileSync(new URL(name, root), "utf8"));
}

function writeJson(name, value) {
  writeFileSync(new URL(name, root), `${JSON.stringify(value, null, 2)}\n`);
}

const manifest = readJson("manifest.json");
manifest.version = version;
writeJson("manifest.json", manifest);

const versions = readJson("versions.json");
versions[version] = manifest.minAppVersion;
writeJson("versions.json", versions);

execFileSync("git", ["add", "manifest.json", "versions.json"], { cwd: root });

console.log(`version-bump: ${version} → Obsidian ${manifest.minAppVersion}`);
