// 接続先。`protocol/v1/openapi.yaml`の`servers`と同じ2つだけを許可する
// （設定へ任意のURLを書けるようにすると、端末トークンの送信先を誤らせられる）。

export const API_BASE_URLS = {
  production: "https://api.nekote.blog/v1/obsidian",
  staging: "https://staging-api.nekote.blog/v1/obsidian",
} as const;

export type ApiEnvironment = keyof typeof API_BASE_URLS;

export const DEFAULT_API_ENVIRONMENT: ApiEnvironment = "production";

export function isApiEnvironment(value: unknown): value is ApiEnvironment {
  return value === "production" || value === "staging";
}

export function apiBaseUrl(environment: ApiEnvironment): string {
  return API_BASE_URLS[environment];
}
