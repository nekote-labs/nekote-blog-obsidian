# 実機で確定していない前提

基準日: 2026-09-01・`nekote-blog@2c5fa5d2`

このプラグインは macOS・Windows・Linux・iOS・Android を対象にする（`isDesktopOnly: false`）。
そのうち**実機でしか確かめられない前提**は、公式ドキュメントと公式型定義で確認できる
範囲までを根拠に暫定のまま実装している。ここに何が暫定で、どう測れば確定するかを残す。

確定したら該当行を消し、必要なら実装を直す。値の正本はサーバー側リポジトリ
（`nekote-blog` の `docs/spec/limits.md`）で、ここには書かない。

## 確認済み

| 項目 | 端末 | 結果 |
| --- | --- | --- |
| `crypto.subtle.digest("SHA-256")` のメモリ挙動 | iPhone実機（Obsidian 1.13.7 / iOS 18.7） | 20MiB 1件が14ms。20MiB×100件の逐次hash化も完走。純JSのフォールバックは不要 |

## 未確定（このPRの実装が依存している）

| # | 何を | どの端末で | どう測るか | 暫定の前提 |
| --- | --- | --- | --- | --- |
| 1 | `App.secretStorage` の実挙動。**端末間**（Obsidian Sync / iCloud経由）と**同一端末上の別vault間**の両方で共有されないこと | macOS・iOS・Android | 最小プラグインで `setSecret` / `getSecret` を往復させ、(a) 同じvaultを別端末へ同期して値が来ないこと、(b) 同じ端末に2つのvaultを作って一方の値が他方から読めないことを確認する。(b) はモバイルで値が混ざるという未解決のフォーラム報告があり、公式ドキュメントにも記載が無い | `minAppVersion: 1.11.4`。端末トークンがvault・端末ローカルに閉じる前提で `src/storage/secrets.ts` へ置いている |
| 2 | `requestUrl()` でのArrayBuffer送信 | iOS・Android実機 | 10MiB・20MiBのバイナリをPUTし、成功率・所要時間・アプリのメモリ挙動を見る | 1ファイル上限は画像10MiB・動画/PDF 20MiB。厳しければ上限を下げるのではなくchunk uploadを足す。`NekoteApiClient.uploadBlob()` が該当 |
| 3 | `crypto.subtle` のAndroid実機挙動 | Android実機 | 上の「確認済み」と同じ手順をAndroidで行う | iOSと同じに動く前提 |
| 4 | モバイルOSによる中断 | iOS・Android実機 | 認可のpoll中・upload中にアプリをバックグラウンドへ送り、復帰後に続きから進めることを確認する | バックグラウンド完走は保証しない。端末ローカルの `pendingPushId` から再開する（`src/sync/publish.ts` の `reportResumedPush()`）|
| 5 | Vault APIの走査コスト | macOS・iOS・Android | 10,000ノートのvaultで `getFiles()` と `TFile.stat` だけの件数集計、続いて本文の逐次読み取りの所要時間を測る | 本文を読む前のしきい値（Markdown 500件／50MiB）で止められる前提。`src/sync/scan.ts` の `scanVault()` が該当 |
| 6 | iCloud未取得ファイル（placeholder）の挙動 | iOS・macOS（iCloud Driveにvaultを置く） | ダウンロード前のファイルを作り、`read()` / `readBinary()` / `TFile.stat` が何を返すか（例外か・0バイトか・待つか）を確認する | 暫定で「例外」と「`stat` のsizeが0でないのに中身が空」の2つを読み取り失敗とみなし、走査全体を止めている（`src/sync/scan.ts` の `readText()` / `readAssetBytes()`）。挙動が分かったら判定を見直す |
| 7 | 実vaultでの正規化結果 | いずれか1台 | 実際のvaultをコンテンツルートへ置き、wikilink・embed・Calloutの正規化結果と警告件数を目視する | 変換規則は `nekote-blog` の `docs/spec/obsidian.md`「Obsidian記法の正規化」。Calloutの既定タイトルはObsidian公式ヘルプの "type identifier in title case" をそのまま実装しており、実機の表示と突き合わせていない |
| 8 | リボン・ノートヘッダー・メニューのアイコン表示と、モバイルでの表示位置 | macOS・iOS・Android | 公開対象ノートを開き、ヘッダーの反映ボタンの表示・非表示（公開対象外ノートで消えること）とリボンメニューを目視する | アイコン名 `cat`・`upload`・`settings`・`image` が同梱lucideに存在する前提。無くても機能は動くがアイコンが空になる（`src/main.ts`） |
| 9 | `<input type="file">` での画像取り込み | iOS・Android実機 | サムネイル選択モーダルの「画像ファイルを取り込む…」で写真を選び、取り込み先フォルダ（既定はコンテンツルート直下の `assets`）へ保存されfrontmatterへ相対pathが書かれることを確認する | モバイルでもファイル/写真ピッカーが開く前提。選択の取り消しは `cancel` イベントが来ない環境では何も起きないだけ（`src/ui/frontmatter-image-modal.ts` の `pickLocalImage()`） |
| 10 | 内部API `app.setting` での設定画面オープン | いずれか1台 | リボンメニューの「設定を開く」でNekote Blogの設定タブが開くことを確認する | 公開APIが無く非公開APIに頼っている。取れない形ならNoticeの案内へ倒す（`src/main.ts` の `openSettings()`） |
