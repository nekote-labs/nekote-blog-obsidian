// 契約に現れる定数のうち、プラグインが判断に使うもの。
// 正本はサーバー側の`docs/spec/limits.md`と`protocol/v1/openapi.yaml`で、
// ここはそのコピー。値を変えるときは契約の再vendorとセットで行う。

/** 現在のprotocol major。未対応majorはサーバーが426で拒否する */
export const PROTOCOL_MAJOR = 1;

/** 端末認可のpoll間隔の下限（秒）。サーバーの`interval`が壊れていても守る */
export const DEVICE_POLL_MIN_INTERVAL_SECONDS = 1;

/** `slow_down`のたびに伸ばす秒数（RFC 8628のDevice Grantと同じ扱い） */
export const DEVICE_POLL_SLOW_DOWN_STEP_SECONDS = 5;

/** pollの上限間隔（秒）。サーバーが過大な`interval`を返しても待ちすぎない */
export const DEVICE_POLL_MAX_INTERVAL_SECONDS = 60;

// --- ファイルとmanifestの上限 -----------------------------------------------
//
// サーバーはこれらを超えるとmanifest全体を拒否する（1件の超過でPushが丸ごと通らない）。
// **どのファイルが原因か**は受け取ったエラーからは分からないので、送信前に同じ値で
// 判定して、pathを添えて止める。

/** Markdown 1ファイルのbytes */
export const MAX_MARKDOWN_FILE_BYTES = 1 * 1024 * 1024;

/** 画像1ファイルのbytes */
export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;

/** 画像以外のアセット（動画・音声・PDF）1ファイルのbytes */
export const MAX_OTHER_ASSET_FILE_BYTES = 20 * 1024 * 1024;

/** manifestのMarkdown entry数 */
export const MAX_MANIFEST_MARKDOWN_ENTRIES = 10_000;

/** manifestのアセットentry数（Markdownとは別枠） */
export const MAX_MANIFEST_ASSET_ENTRIES = 20_000;

/** 記事1件が申告できる参照アセット数（ソース共通の上限） */
export const MAX_ARTICLE_ASSET_PATHS = 100;

// --- ローカル早期確認のしきい値 ---------------------------------------------
//
// hard capではなく**誤操作を止めるための確認**（`spec/limits.md`「プラグイン側の
// 確認しきい値」）。超えたら件数と原本bytesを見せて続行を確認する。
// preflight後の追加確認はサーバーが`confirmationRequired`で返す。

/** 本文を読む前（pathと`stat`だけの段階）のMarkdown件数 */
export const CONFIRM_SCAN_MARKDOWN_COUNT = 500;

/** 本文を読む前のMarkdown原本bytes */
export const CONFIRM_SCAN_MARKDOWN_BYTES = 50 * 1024 * 1024;

/** アセット本体を読む前（参照解決後・`stat`だけの段階）の参照アセット件数 */
export const CONFIRM_SCAN_ASSET_COUNT = 200;

/** アセット本体を読む前の参照アセット原本bytes */
export const CONFIRM_SCAN_ASSET_BYTES = 200 * 1024 * 1024;
