// Obsidian Community Pluginsは`versions.json`で「プラグインversion →
// 必要な最小Obsidian version」を解決する。ここがずれると古いObsidianへ
// 動かないバージョンが配信されるため、リリース前に整合を検査する。
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);

function readJson(name) {
  return JSON.parse(readFileSync(new URL(name, root), "utf8"));
}

const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const expectedVersion = process.argv[2];

const semverPattern = /^\d+\.\d+\.\d+$/;
const errors = [];

if (expectedVersion && manifest.version !== expectedVersion) {
  errors.push(
    `期待versionと manifest.json の version が一致しない: 期待 ${expectedVersion} / manifest ${manifest.version}`,
  );
}

for (const key of Object.keys(versions)) {
  if (!semverPattern.test(key)) {
    errors.push(`versions.json のキーがsemver形式ではない: ${key}`);
  }
}

if (!Object.hasOwn(versions, manifest.version)) {
  errors.push(`versions.json に manifest.json の version がない: ${manifest.version}`);
} else if (versions[manifest.version] !== manifest.minAppVersion) {
  errors.push(
    `versions.json["${manifest.version}"] が minAppVersion と一致しない: ` +
      `versions.json ${versions[manifest.version]} / manifest ${manifest.minAppVersion}`,
  );
}

if (errors.length > 0) {
  for (const error of errors) console.error(`check:versions: ${error}`);
  process.exitCode = 1;
} else {
  console.log(`check:versions: OK (${manifest.version} → Obsidian ${manifest.minAppVersion})`);
}
