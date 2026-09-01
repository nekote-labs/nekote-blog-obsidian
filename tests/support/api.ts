import { expect } from "vitest";
import type { HttpResponse } from "../../src/api/http";
import { NekoteApiError } from "../../src/protocol/errors";

export function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, headers: {}, text: JSON.stringify(body) };
}

/** 例外の中身まで見たいのでrejects matcherではなく捕まえて返す */
export async function catchApiError(run: () => Promise<unknown>): Promise<NekoteApiError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(NekoteApiError);
    return error as NekoteApiError;
  }
  throw new Error("NekoteApiErrorが投げられませんでした。");
}
