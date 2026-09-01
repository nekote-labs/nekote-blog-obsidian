// 同期manifestの組み立てと、manifest hashの計算。
//
// **正規形JSONの作り方はサーバー（`canonicalObsidianManifestJson`）の写し**。
// hashの対象は`contentRoot`とpath順のentryだけで、`protocolVersion`・`vaultId`・
// `baseRevision`は入れない（hashは「vaultの中身」の同一性を表す）。
// 同じvaultから同じhashが出ないと、中断したPushの再開も冪等なbeginも成立しない。
import { sha256Hex } from "../crypto/hash";
import { PROTOCOL_MAJOR } from "../protocol/limits";
import type { SyncManifest, SyncManifestEntry } from "../protocol/types";

/**
 * entryをpath昇順（UTF-16コード単位順）へ並べる。
 *
 * サーバーは並びが崩れたmanifestを`invalid_manifest`で拒否する（正規化されていない
 * 入力とみなす契約）ので、送る前に必ず通す
 */
export function sortManifestEntries(entries: readonly SyncManifestEntry[]): SyncManifestEntry[] {
  return [...entries].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

/**
 * 大文字小文字だけが違うpathの組。OS間で同じvaultを扱えなくなるため、
 * サーバーもmanifest全体を拒否する
 */
export function findCaseCollision(
  entries: readonly SyncManifestEntry[],
): { first: string; second: string } | null {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) return { first, second: entry.path };
    seen.set(key, entry.path);
  }
  return null;
}

/**
 * 正規形JSON。キーの並びを固定し、空の参照配列は落とす。
 * `JSON.stringify`のキー順に依存しないよう1件ずつ組み立てる
 */
export function canonicalManifestJson(
  contentRoot: string,
  entries: readonly SyncManifestEntry[],
): string {
  const items = entries.map((entry) => {
    const parts = [
      `"path":${JSON.stringify(entry.path)}`,
      `"kind":${JSON.stringify(entry.kind)}`,
      `"sha256":${JSON.stringify(entry.sha256)}`,
      `"bytes":${entry.bytes}`,
    ];
    if (entry.assetPaths !== undefined && entry.assetPaths.length > 0) {
      parts.push(`"assetPaths":${JSON.stringify(entry.assetPaths)}`);
    }
    if (entry.linkedArticlePaths !== undefined && entry.linkedArticlePaths.length > 0) {
      parts.push(`"linkedArticlePaths":${JSON.stringify(entry.linkedArticlePaths)}`);
    }
    return `{${parts.join(",")}}`;
  });
  return `{"contentRoot":${JSON.stringify(contentRoot)},"entries":[${items.join(",")}]}`;
}

/** 正規形JSONのsha256（hex）。これがmanifest hash */
export function manifestHash(
  contentRoot: string,
  entries: readonly SyncManifestEntry[],
): Promise<string> {
  return sha256Hex(new TextEncoder().encode(canonicalManifestJson(contentRoot, entries)));
}

export function buildSyncManifest(input: {
  vaultId: string;
  contentRoot: string;
  baseRevision: number;
  entries: readonly SyncManifestEntry[];
}): SyncManifest {
  return {
    protocolVersion: PROTOCOL_MAJOR,
    vaultId: input.vaultId,
    contentRoot: input.contentRoot,
    baseRevision: input.baseRevision,
    entries: [...input.entries],
  };
}

export interface ManifestDiff {
  added: string[];
  updated: string[];
  deleted: string[];
  unchanged: string[];
}

/**
 * 適用済みmanifest（`GET /manifest`）との差分。
 *
 * **409（`revision_conflict`）で利用者に上書きの可否を判断してもらうためだけ**に使う。
 * 実際の適用差分はサーバーがbeginで出す（コンテンツルートが違えばpathの基準も違うので、
 * ここでの比較はあくまで目安）
 */
export function diffAgainstApplied(
  entries: readonly SyncManifestEntry[],
  applied: readonly { path: string; sha256: string }[],
): ManifestDiff {
  const appliedByPath = new Map(applied.map((entry) => [entry.path, entry.sha256]));
  const diff: ManifestDiff = { added: [], updated: [], deleted: [], unchanged: [] };

  for (const entry of entries) {
    if (entry.kind !== "markdown") continue;
    const previous = appliedByPath.get(entry.path);
    if (previous === undefined) diff.added.push(entry.path);
    else if (previous === entry.sha256) diff.unchanged.push(entry.path);
    else diff.updated.push(entry.path);
  }

  const currentPaths = new Set(entries.map((entry) => entry.path));
  for (const entry of applied) {
    if (!currentPaths.has(entry.path)) diff.deleted.push(entry.path);
  }
  return diff;
}
