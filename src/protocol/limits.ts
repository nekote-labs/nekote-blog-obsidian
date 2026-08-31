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
