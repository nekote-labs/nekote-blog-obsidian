// HTTPの最小インターフェース。実体はObsidianの`requestUrl()`（`fetch()`と違い
// CORS制約を受けない）で、`src/main.ts`が差し込む。APIクライアント自体はObsidianに
// 依存しないので、テストでは素の関数を渡せる。

export interface HttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  contentType?: string;
  body?: string | ArrayBuffer;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export type HttpFetch = (request: HttpRequest) => Promise<HttpResponse>;

/** ヘッダー名の大文字小文字は実装依存なので、読むときは正規化する */
export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}
