# Nekote Blog for Obsidian

[Nekote Blog](https://nekote.blog) の公式Obsidianプラグイン。vault内のMarkdownと、
そこから参照されるアセットをNekote Blogへ送信して公開する。

**現在は開発中で、まだ配布していない。** Community PluginsにもBRATにも登録していない。

## 状態

| できること | 状態 |
| --- | --- |
| ダッシュボード承認によるブログとの接続（端末認可） | 実装済み |
| 接続状態の確認・この端末の接続解除 | 実装済み |
| コンテンツルートの選択、vault走査、Obsidian記法の正規化 | 未実装 |
| 「Nekote Blogへ反映」コマンド | 未実装 |

## 前提

- Obsidian 1.11.4 以降（`App.secretStorage` が必要）
- デスクトップ（macOS・Windows・Linux）とモバイル（iOS・Android）の両方で動く。
  Node.js・Electron APIは使わない
- Nekote Blogのアカウントとブログが必要。接続の承認はブラウザで開くダッシュボードで行う

## 開発

```sh
pnpm install
pnpm run dev        # esbuildのwatch。main.jsを出力する
pnpm run lint       # eslint + prettier
pnpm run typecheck
pnpm run test
pnpm run build      # 本番ビルド（sourcemapなし）
pnpm run check:bundle   # ビルド成果物にNode/Electron依存が無いことを検査
```

vaultで動かすには、vaultの `.obsidian/plugins/nekote-blog/` へ `main.js`・`manifest.json`・
`styles.css` を置く（またはリポジトリごとリンクする）。

### リリース

`manifest.json` と `versions.json` のversionを上げ（`pnpm version <newversion>` が両方を
更新する）、`x.y.z` 形式のタグをpushすると、GitHub Actionsが `main.js`・`manifest.json`・
`styles.css` を添えたReleaseを作る。

## API契約

サーバーとのAPI契約の正本は非公開リポジトリ `nekote-labs/nekote-blog` にあり、この
リポジトリは対応するmajorのschemaとfixtureを [`protocol/v1/`](./protocol/v1/) へコピー
して持つ。runtimeで非公開リポジトリやnpm packageへ依存しない。コピーのずれは
`tests/protocol-contract.test.ts` の内容hash照合で落とす。

## 補足

- 実機で確定していない前提は [`docs/on-device-checks.md`](./docs/on-device-checks.md)
- 送信するデータ・サーバー側のログ・データの削除方法といった利用者向けの説明は、
  配布を始めるときにここへ追加する

## ライセンス

MIT
