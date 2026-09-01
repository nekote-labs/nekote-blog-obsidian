import type { SecretStorageLike } from "../../src/storage/secrets";

/** `App.secretStorage`の代役。削除APIが無い点まで合わせる（消すのは空文字の書き込み） */
export class FakeSecretStorage implements SecretStorageLike {
  readonly values = new Map<string, string>();
  /** 書き込みの順序。消す時点まで見たいテストが使う */
  readonly writes: { id: string; secret: string }[] = [];

  getSecret(id: string): string | null {
    return this.values.get(id) ?? null;
  }

  setSecret(id: string, secret: string): void {
    this.values.set(id, secret);
    this.writes.push({ id, secret });
  }
}
