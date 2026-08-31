// Push同期API v1のリクエスト・レスポンス型。
//
// 機械可読な正本はvendorした`protocol/v1/openapi.yaml`で、このファイルはその
// TypeScript表現。**片方だけ変えない**（契約テストが食い違いを落とす）。

/** 対象ブログ（表示用） */
export interface ConnectionBlog {
  id: string;
  title: string;
  /** `{subdomain}.nekote.blog`のラベル部分 */
  subdomain: string;
}

/** 承認された端末 */
export interface ConnectionDevice {
  id: string;
  name: string;
}

/**
 * 接続中のソース。`obsidian`のときだけvault ID・コンテンツルート・revisionが返る。
 * 他ソース接続中は種別だけで、内容は返らない
 */
export type ConnectionSource =
  | { kind: "none" }
  | { kind: "other"; type: "notion" | "github" }
  | {
      kind: "obsidian";
      contentSourceId: string;
      vaultId: string;
      /** vaultルート相対の正規化済みpath（vaultルートは空文字） */
      contentRoot: string;
      /** 公開まで進んだrevision（`baseRevision`に使う値） */
      appliedRevision: number;
      /** 適用済みmanifestのhash。初回同期前はnull */
      manifestHash: string | null;
    };

export interface ConnectionResponse {
  protocolVersion: number;
  blog: ConnectionBlog;
  device: ConnectionDevice;
  source: ConnectionSource;
}

// --- 端末認可 -------------------------------------------------------------

export interface DeviceAuthorizationRequest {
  protocolVersion: number;
  /** 承認画面と端末一覧に出す端末名。秘密ではない */
  deviceName: string;
  /** code verifierのsha256をbase64url（パディングなし）にした値 */
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface DeviceAuthorizationResponse {
  /** pollに使うコード。**plugin dataへ書かず、secretStorageへ置く** */
  deviceCode: string;
  /** 利用者が確認する8文字のコード（`XXXX-XXXX`） */
  userCode: string;
  verificationUri: string;
  /** user code入りの承認URL。プラグインはこれをブラウザで開く */
  verificationUriComplete: string;
  /** 有効期限（秒） */
  expiresIn: number;
  /** pollの推奨間隔（秒） */
  interval: number;
}

export interface DeviceTokenRequest {
  protocolVersion: number;
  deviceCode: string;
  codeVerifier: string;
}

export type DeviceTokenStatus = "pending" | "slow_down" | "denied" | "expired" | "approved";

/**
 * pollの応答。**未承認・拒否・期限切れはエラーではなく200のstatus**で返る。
 * 存在しないdevice codeも`expired`になる（総当たりへ手掛かりを与えないため）
 */
export type DeviceTokenResponse =
  | { status: "pending" | "slow_down"; interval: number }
  | { status: "denied" | "expired" }
  | {
      status: "approved";
      /** 端末トークン。**この応答でだけ返る** */
      token: string;
      blog: ConnectionBlog;
      device: ConnectionDevice;
    };

// --- Push世代 -------------------------------------------------------------

/** Push世代の段階（サーバーのD1と同じ語彙） */
export type PushState =
  | "preflight"
  | "confirmed"
  | "verifying"
  | "verified"
  | "enqueue_pending"
  | "enqueued"
  | "transforming"
  | "committed"
  | "published"
  | "succeeded"
  | "failed"
  | "expired";

/** 追加確認を求める理由（hard capではない） */
export type ConfirmationReason =
  | "initial_connect"
  | "source_switch"
  | "content_root_changed"
  | "large_delete"
  | "large_change"
  | "large_upload";

export interface SyncManifestEntry {
  /**
   * Markdownはコンテンツルート相対（`posts/…`・`pages/…`）、アセットは
   * vaultルート相対。`/`区切り・Unicode NFC・絶対path/`.`/`..`/空segment禁止
   */
  path: string;
  kind: "markdown" | "asset";
  sha256: string;
  bytes: number;
  /** Markdownだけが持つ、本文とfrontmatterから解決した参照アセット */
  assetPaths?: string[];
  /** Markdownだけが持つ、公開対象への相対記事リンク */
  linkedArticlePaths?: string[];
}

/**
 * 同期manifest（beginのbody）。entryは**path昇順**（UTF-16コード単位順）で、
 * 重複と大文字小文字だけが異なるpathの共存を禁じる
 */
export interface SyncManifest {
  protocolVersion: number;
  vaultId: string;
  contentRoot: string;
  baseRevision: number;
  entries: SyncManifestEntry[];
}

export interface PushPreflight {
  /** 記事（Markdown entry）単位の差分。アセットの増減は不足blobに出る */
  addedCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
  missingBlobCount: number;
  missingBlobBytes: number;
  initialConnect: boolean;
  confirmationReasons: ConfirmationReason[];
}

export interface MissingBlob {
  sha256: string;
  kind: "markdown" | "asset";
  bytes: number;
}

export interface PushBeginResponse {
  protocolVersion: number;
  pushId: string;
  state: PushState;
  baseRevision: number;
  /** サーバーの現在revision（初回接続前は0） */
  appliedRevision: number;
  manifestHash: string;
  preflight: PushPreflight;
  missingBlobs: MissingBlob[];
  confirmationRequired: boolean;
  /** Push世代の期限（ISO） */
  expiresAt: string;
}

export interface PushConfirmRequest {
  protocolVersion: number;
  /** beginが返したhash。表示した内容と確定対象の取り違えを防ぐ */
  manifestHash: string;
}

export interface PushConfirmResponse {
  pushId: string;
  state: PushState;
  /** 短時間予約した不足原本の件数と総bytes。これを超えるuploadは拒否される */
  reservedBlobCount: number;
  reservedBlobBytes: number;
  expiresAt: string;
}

export interface BlobUploadResponse {
  sha256: string;
  bytes: number;
  /** サーバーが管理する原本の世代番号（クライアントは指定しない） */
  blobGen: number;
  state: "live";
}

export interface PushFinalizeRequest {
  protocolVersion: number;
  manifestHash: string;
  baseRevision: number;
}

/** 完備確認の進捗（202と`GET /pushes/{pushId}`が返す） */
export interface PushVerificationProgress {
  cursor: number;
  verifiedEntryCount: number;
  entryCount: number;
  /** 次の問い合わせまでの推奨待ち時間（秒） */
  retryAfter: number;
}

/** `finalize`が受理した（Queue投入まで終わった） */
export interface PushFinalizeAcceptedResponse {
  pushId: string;
  state: "enqueued";
  /** Push用の同期Run（`sync_blog` job）のID */
  jobId: string;
  targetRevision: number;
}

/** `finalize`が完備確認を継続中（202）。`retryAfter`後に同じpushIdで再送する */
export interface PushFinalizeVerifyingResponse {
  pushId: string;
  state: "verifying";
  verification: PushVerificationProgress;
}

export type PushFinalizeResponse = PushFinalizeAcceptedResponse | PushFinalizeVerifyingResponse;

/** `GET /pushes/{pushId}`。記事別の結果は件数とsampleだけ */
export interface PushStatusResponse {
  pushId: string;
  state: PushState;
  baseRevision: number;
  targetRevision: number | null;
  appliedRevision: number;
  manifestHash: string;
  verification?: PushVerificationProgress;
  counts?: Record<string, number>;
  /** 代表エラー・警告（本文・ローカル絶対pathは含まれない） */
  samples?: { kind: "error" | "warning"; path?: string; message: string }[];
  expiresAt: string;
}

/** `GET /manifest`。409時に現在の適用済み集合と比較するために読む */
export interface AppliedManifestResponse {
  protocolVersion: number;
  appliedRevision: number;
  manifestHash: string | null;
  contentRoot: string | null;
  entries: { path: string; sha256: string; state: "published" | "unpublished" }[];
}
