## 動作ルール

- 実装・設計・ファイル変更は勝手に始めない。ユーザーがタスク実装コマンド・スキルを出すか、明示的に許可するまで待つ。
- 質問への回答・簡単な説明は即座に返してよい。

## このリポジトリについて

ブログ公開サービス「**Nekote Blog**」のObsidian公式プラグイン。vaultのノートと参照アセットをPush同期APIへ送って公開する。

ブログ本体は別リポジトリ`nekote-blog`（ローカルは`../nekote-blog`）。**仕様とAPI schemaの正本は本体側**で、こちらはコピーを持つ。

- 仕様: `../nekote-blog/docs/spec/obsidian.md`
- API schemaの正本: `../nekote-blog/protocol/obsidian/v1/` → このリポジトリの`protocol/v1/`へvendorする
- 開発手順・コマンド一覧: [README.md](./README.md)

## 接続先

本番`api.nekote.blog`とstaging`staging-api.nekote.blog`の2つだけ（`src/api/endpoints.ts`）。設定へ任意のURLを書けるようにすると端末トークンの送信先を誤らせられるため、**localhostへは向けられない**。この2択は仕様なので、検証の都合で増やさない。

Obsidianアプリからの実機確認はstagingで行う。プラグイン設定の「詳細 → 接続先」で切り替える。接続中は変更できないので接続前に選ぶ。

## vaultへの反映（`OBSIDIAN_PLUGIN_DIR`）

vaultで動かすには`.obsidian/plugins/nekote-blog/`へ`main.js`・`manifest.json`・`styles.css`を置く。毎回コピーせずに済ませるには、リポジトリ直下の`.env`（gitignore対象）へ複製先を書く。

```sh
OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/nekote-blog
```

`pnpm run build`がビルドに続けて`scripts/install-to-vault.js`で3ファイルを複製する。**未設定なら何もしない**。CIとReleaseワークフローも同じ`build`を通るため、ここで失敗させてはいけない。

複製後はObsidianを再読み込みする（`Cmd+R`）。iOS/Androidの実機で試すときはvaultの同期経由でこのフォルダを届ける（iCloudはシンボリックリンクを同期しない）。

## モバイル対応の制約

`isDesktopOnly: false`でiOS/Androidでも動く。**Node組み込みモジュールとelectronをesbuildの`external`へ入れてはいけない**。モバイルにはこれらが存在せず、externalにすると解決できないrequireがバンドルへ残る。externalでなければesbuildがビルドを落とす。出荷前の砦として`pnpm run check:bundle`が成果物そのものを検査する。

デスクトップとモバイルで同じ`main.js`・状態機械・変換fixtureを使い、プラットフォーム別実装を作らない。

## staging検証用ブログ

サブドメインは`staging-obsidian`。本体側`apps/delivery`の`env.staging.routes`にルートがあり、無いと本番deliveryの`*.nekote.blog/*`に吸われて404になる。
