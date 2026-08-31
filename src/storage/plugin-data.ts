// plugin data（`data.json`）に置く**非秘密**の設定。
//
// このファイルはObsidian Sync等で別端末へ同期され得る。トークン・device code・
// code verifierは絶対に書かない（それらは`src/storage/secrets.ts`）。
// ここにある接続情報は表示と競合検出のためのhintで、正は`GET /connection`。
import { DEFAULT_API_ENVIRONMENT, isApiEnvironment, type ApiEnvironment } from "../api/endpoints";
import type { ConnectionBlog, ConnectionDevice } from "../protocol/types";

/** 承認済みの接続先（表示用のhint。秘密は含まない） */
export interface ConnectionHint {
  blog: ConnectionBlog;
  device: ConnectionDevice;
}

export interface PluginSettings {
  apiEnvironment: ApiEnvironment;
  connection: ConnectionHint | null;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  apiEnvironment: DEFAULT_API_ENVIRONMENT,
  connection: null,
};

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
    connection: parseConnectionHint(input.connection),
  };
}

/** 保存するのも既知のキーだけ */
export function serializePluginSettings(settings: PluginSettings): PluginSettings {
  return {
    apiEnvironment: settings.apiEnvironment,
    connection:
      settings.connection === null
        ? null
        : {
            blog: { ...settings.connection.blog },
            device: { ...settings.connection.device },
          },
  };
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
