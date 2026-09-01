# 実装プラン: エディタUX強化（フロントマター自動挿入・画像選択・反映導線）

基準日: 2026-09-01・dfd52e4

## 目的

公開対象ノートの執筆体験を上げる3機能を追加する。

1. 公開対象フォルダに作った新規ノートへ、対応フロントマターを自動挿入する
2. `thumbnail`・`cover`をモーダルで選べるようにする（vault内選択＋取り込み）
3. 反映の導線を増やす（リボンアイコン・ノート上のボタン・右クリックメニュー）

## 決定事項

- 自動挿入するキーと初期値: `draft: true`・`date: 当日`・`tags: []`・`category: ""`・`slug: ""`・`emoji: ""`・`thumbnail: ""`・`cover: ""`。`title`は入れない（ファイル名補完があるため）
- **`date`だけ当日を入れる**。サーバー（`nekote-blog`の`packages/core/src/markdown/frontmatter.ts`）は`date: ""`も`date:`（null）も同期エラーにするため、空では入れられない。他のキーは空文字＝未指定として扱われるので空でよい
- 対象は「実際に公開対象になるノート」だけ: コンテンツルート配下の`posts/`・`pages/`配下の`.md`。判定はPush走査と同じ`src/vault/paths.ts`の規則を使う
- 自動挿入の契機は2つ。**新規作成**（`create`。中身が空のファイルだけ。同期で届いた既存原稿へ挿入しない）と、**公開対象の外→中への移動・改名**（`rename`。Obsidianの新規ノートはルート直下に作られやすく、あとから移す流れが基本のため）。移動時は中身があってもよいが、全キーが揃っていればファイルへ触れない（`processFrontMatter()`のYAML再整形を避ける）
- 自動挿入は設定でON/OFF（既定ON）。既存ノートにはコマンド「フロントマターを挿入」（欠けているキーだけ足す）
- `thumbnail`・`cover`へ書く値はノート起点の相対パスを`encodePathForMarkdownUrl()`で符号化した形。サーバーは本文画像と同じく`decodeURIComponent()`で解決する
- 画像取り込みの保存先は設定`imageImportFolder`（既定＝コンテンツルート直下の`assets`。フォルダが無ければ作る。同名は「名前 1.png」の連番）
- **反映はどの導線からでも送信直前に必ず1回確認モーダルを出す**（`publish.ts`。1クリックでPushまで進ませない）
- ノートヘッダーのボタンは即反映ではなく**メニュー**（反映・サムネイル・カバー・フロントマター挿入）を開く
- 記事ごとの反映も全体Pushのトリガー。manifestは全公開対象を含む必要があり（欠けると削除扱い）、単記事Pushは同期モデル上できない。変更なしのファイルはハッシュ照合で送られないため実害はない
- Obsidianのプロパティ欄（フロントマター入力UI）へのボタン追加は公開APIが無くDOM注入になるため不採用。代わりがノートヘッダーのメニュー
- 「設定を開く」は内部API`app.setting`頼み（公開APIが無い）。取れなければNoticeで案内に倒す

## 変更ファイル

### 1. `src/vault/paths.ts`

- `isPublishTargetVaultPath(vaultPath: string, contentRoot: string | null): boolean`を追加。`normalizeVaultPath` → `toContentRootRelative` → `isArticlePath`の合成。`contentRoot === null`はfalse

### 2. `src/content/frontmatter-template.ts`（新規・Obsidian非依存）

- `applyFrontmatterTemplate(frontmatter: Record<string, unknown>, today: string): boolean` — 欠けているキーだけ足す。1つでも足したらtrue
- `localIsoDate(now: Date): string` — ローカル日付の`YYYY-MM-DD`

### 3. `src/storage/plugin-data.ts`

- `autoInsertFrontmatter: boolean`（既定true）を追加。parse/serializeへ反映

### 4. `src/settings/settings-tab.ts`

- 「公開」セクションへ自動挿入のトグルを追加

### 5. `src/ui/frontmatter-image-modal.ts`（新規）

- `FuzzySuggestModal`ベース。項目は「画像ファイルを取り込む…」＋vault内のラスタ画像（png・jpg・jpeg・gif・webp・avif）
- 選択→`processFrontMatter`で`thumbnail`/`cover`へ相対パスを書き込み
- 取り込み→`<input type="file">`で選んだ画像を`fileManager.getAvailablePathForAttachment()`の先へ`vault.createBinary()`で保存→書き込み

### 6. `src/main.ts`

- `onLayoutReady`後に`vault.on("create")`を登録（起動時の全ファイル分の発火を避ける定石）。空の新規公開対象ノートへ自動挿入
- コマンド追加: 「フロントマターを挿入」「サムネイル画像を選択」「カバー画像を選択」（いずれも`checkCallback`でアクティブファイルが公開対象のときだけ）
- リボンアイコン（`cat`）→ `Menu`で「Nekote Blogへ反映」「設定を開く」
- ノートヘッダーの反映ボタン: `MarkdownView.addAction`。`layout-change`等でview分を維持し、公開対象ノートのときだけ表示。unloadで除去
- `file-menu`（右クリック）: 公開対象mdに「Nekote Blogへ反映」「サムネイル画像を選択」「カバー画像を選択」

## テスト

- `tests/content-frontmatter-template.test.ts`（新規）: 空へ全キー挿入・既存値は保持・変更なし判定・日付形式
- `tests/vault-paths.test.ts`: `isPublishTargetVaultPath`のケース追加
- `tests/storage.test.ts`: `autoInsertFrontmatter`のparse既定・保存
- `tests/settings-tab.test.ts`: トグルの描画確認
- モーダルとmain.tsの配線はObsidian API依存のため対象外（既存方針どおり）

## 検証

`pnpm run typecheck` / `lint` / `test` / `build`（`check:bundle`含む出荷条件はCIと同じ）。実機確認は検証用vault＋stagingで、自動挿入・画像選択・各導線を通す。
