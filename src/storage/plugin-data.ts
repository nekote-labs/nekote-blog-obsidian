// plugin data（`data.json`）に置く**非秘密**の設定。
//
// このファイルはObsidian Sync等で別端末へ同期され得る。トークン・device code・
// code verifierは絶対に書かない（それらは`src/storage/secrets.ts`）。
// ここにある接続情報は表示と競合検出のためのhintで、正は`GET /connection`。
import { DEFAULT_API_ENVIRONMENT, isApiEnvironment, type ApiEnvironment } from "../api/endpoints";
import type { ConnectionBlog, ConnectionDevice } from "../protocol/types";
import { isCanonicalContentRoot } from "../vault/paths";

/** 承認済みの接続先（表示用のhint。秘密は含まない） */
export interface ConnectionHint {
  blog: ConnectionBlog;
  device: ConnectionDevice;
}

/** 最後に適用まで進んだPush。表示と競合検出のhintで、正は`GET /connection` */
export interface LastPushHint {
  revision: number;
  manifestHash: string;
  /** 反映が終わった時刻（ISO） */
  syncedAt: string;
}

export interface PluginSettings {
  apiEnvironment: ApiEnvironment;
  /**
   * 開発者モード。`data.json`への手書き専用で、UIからは変更できない。
   * trueの端末だけ設定画面に「接続先」（staging切替）を描画する。
   * 隠す目的はUIの整理だけで、セキュリティ境界ではない（接続先の許可リストが守り）
   */
  devMode: boolean;
  connection: ConnectionHint | null;
  /**
   * このvaultの安定ID。サーバーは有効なObsidian sourceについて一意にし、
   * **同じIDを別ブログへ接続させない**。vaultの所有権を証明する秘密ではない
   */
  vaultId: string | null;
  /** コンテンツルート（vaultルート相対。vaultルート自体は空文字）。未選択はnull */
  contentRoot: string | null;
  lastPush: LastPushHint | null;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  apiEnvironment: DEFAULT_API_ENVIRONMENT,
  devMode: false,
  connection: null,
  vaultId: null,
  contentRoot: null,
  lastPush: null,
};

/** サーバーが受け付けるvault IDの形（`openapi.yaml`の`vaultId`） */
const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * `loadData()`の戻り値を設定へ落とす。
 *
 * **既知のキーだけを取り出す**（未知のキーを持ち回すと、うっかり書かれた秘密が
 * plugin dataへ残り続ける）。壊れた値は既定値へ倒す。
 */
export function parsePluginSettings(raw: unknown): PluginSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  const input = raw as Record<string, unknown>;
  return {
    apiEnvironment: isApiEnvironment(input.apiEnvironment)
      ? input.apiEnvironment
      : DEFAULT_API_ENVIRONMENT,
    devMode: input.devMode === true,
    connection: parseConnectionHint(input.connection),
    vaultId:
      typeof input.vaultId === "string" && VAULT_ID_PATTERN.test(input.vaultId)
        ? input.vaultId
        : null,
    contentRoot:
      typeof input.contentRoot === "string" && isCanonicalContentRoot(input.contentRoot)
        ? input.contentRoot
        : null,
    lastPush: parseLastPush(input.lastPush),
  };
}

/** 保存するのも既知のキーだけ */
export function serializePluginSettings(settings: PluginSettings): PluginSettings {
  return {
    apiEnvironment: settings.apiEnvironment,
    devMode: settings.devMode,
    connection:
      settings.connection === null
        ? null
        : {
            blog: { ...settings.connection.blog },
            device: { ...settings.connection.device },
          },
    vaultId: settings.vaultId,
    contentRoot: settings.contentRoot,
    lastPush: settings.lastPush === null ? null : { ...settings.lastPush },
  };
}

function parseLastPush(value: unknown): LastPushHint | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { revision, manifestHash, syncedAt } = value as Record<string, unknown>;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (typeof manifestHash !== "string" || typeof syncedAt !== "string") return null;
  return { revision, manifestHash, syncedAt };
}

function parseConnectionHint(value: unknown): ConnectionHint | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { blog, device } = value as { blog?: unknown; device?: unknown };
  const parsedBlog = parseBlog(blog);
  const parsedDevice = parseDevice(device);
  if (parsedBlog === null || parsedDevice === null) return null;
  return { blog: parsedBlog, device: parsedDevice };
}

function parseBlog(value: unknown): ConnectionBlog | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, title, subdomain } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof title !== "string" || typeof subdomain !== "string") {
    return null;
  }
  return { id, title, subdomain };
}

function parseDevice(value: unknown): ConnectionDevice | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof name !== "string") return null;
  return { id, name };
}
