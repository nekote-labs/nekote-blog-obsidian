// 端末トークン等の秘密の保管。実体はObsidianの`App.secretStorage`（vault・端末ローカル）。
//
// **`SecretStorage`には削除APIが無い**（`setSecret`/`getSecret`/`listSecrets`だけ）。
// 消すときは空文字を書き、読み出し側は空文字を「無い」として扱う。
//
// secretStorageはObsidian SyncやiCloudで別端末へ共有されない。plugin dataへは
// 秘密を書かない（`src/storage/plugin-data.ts`）。
//
// 同一端末上の別vault間で分離されるかはモバイル実機で未確認
// （`docs/on-device-checks.md`）。

export interface SecretStorageLike {
  getSecret(id: string): string | null;
  setSecret(id: string, secret: string): void;
}

/**
 * secretのID。`SecretStorage`は「小文字英数字とハイフン」しか受け付けず、
 * vault内の全プラグインで共有されるためプラグインIDを前置する。
 */
const SECRET_IDS = {
  /** 端末トークン。1ブログ・`obsidian:push`権限だけを持つopaque token */
  pushToken: "nekote-blog-push-token",
  /** 端末認可の処理中だけ持つPKCE相当のverifier */
  codeVerifier: "nekote-blog-code-verifier",
  /** 端末認可の処理中だけ持つdevice code */
  deviceCode: "nekote-blog-device-code",
  /** 中断したPushの再開に使うpushId（vault走査・反映はPlugin PR2） */
  pendingPushId: "nekote-blog-pending-push-id",
} as const;

export class SecretStore {
  private readonly storage: SecretStorageLike;

  constructor(storage: SecretStorageLike) {
    this.storage = storage;
  }

  getPushToken(): string | null {
    return this.read(SECRET_IDS.pushToken);
  }

  setPushToken(token: string): void {
    this.storage.setSecret(SECRET_IDS.pushToken, token);
  }

  clearPushToken(): void {
    this.clear(SECRET_IDS.pushToken);
  }

  /** 端末認可の処理中だけ持つ値。承認・拒否・中断のいずれでも消す */
  getPendingAuthorization(): { codeVerifier: string; deviceCode: string } | null {
    const codeVerifier = this.read(SECRET_IDS.codeVerifier);
    const deviceCode = this.read(SECRET_IDS.deviceCode);
    if (codeVerifier === null || deviceCode === null) return null;
    return { codeVerifier, deviceCode };
  }

  setPendingAuthorization(value: { codeVerifier: string; deviceCode: string }): void {
    this.storage.setSecret(SECRET_IDS.codeVerifier, value.codeVerifier);
    this.storage.setSecret(SECRET_IDS.deviceCode, value.deviceCode);
  }

  clearPendingAuthorization(): void {
    this.clear(SECRET_IDS.codeVerifier);
    this.clear(SECRET_IDS.deviceCode);
  }

  getPendingPushId(): string | null {
    return this.read(SECRET_IDS.pendingPushId);
  }

  setPendingPushId(pushId: string): void {
    this.storage.setSecret(SECRET_IDS.pendingPushId, pushId);
  }

  clearPendingPushId(): void {
    this.clear(SECRET_IDS.pendingPushId);
  }

  private read(id: string): string | null {
    const value = this.storage.getSecret(id);
    return value === null || value === "" ? null : value;
  }

  private clear(id: string): void {
    this.storage.setSecret(id, "");
  }
}
