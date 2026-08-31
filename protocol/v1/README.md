# protocol/v1（vendorしたAPI契約）

このディレクトリは、非公開リポジトリ `nekote-labs/nekote-blog` の `protocol/obsidian/v1/` からコピーしたAPI契約です。**正本はあちらで、ここはコピー**です。

runtimeで正本リポジトリやnpm packageへ依存しないために、このリポジトリ内にコピーを置いています。プラグインは配布物だけで動き、契約の参照でネットワークや追加の依存を必要としません。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `openapi.yaml` | エンドポイント・スキーマ・エラーコードの定義（機械可読な正本のコピー） |
| `fixtures/*.json` | 正常・異常のリクエスト/レスポンス例 |
| `protocol.json` | protocol majorと、`openapi.yaml` + `fixtures/*.json` の内容hash・対象ファイル一覧 |

現在の値:

- protocol major: `1`
- `contentHash`: `62f96d6088760c6ea7c94fc06c4a3365fb54e2d139bbb0405a8ab9fd9f779dbc`

## 編集しないこと

**このディレクトリのファイルを手で編集しないでください。** 1文字でも変えると `protocol.json` の `contentHash` とずれます。

更新手順:

1. 正本（`nekote-blog` の `protocol/obsidian/v1/`）を変更し、あちらでhashを更新する
2. `openapi.yaml`・`fixtures/`・`protocol.json` を丸ごとコピーし直す
3. `nr test` で `tests/protocol-contract.test.ts` を通す（hash・エラーコード表・fixtureの構造が `src/protocol/` と一致するかを見ています）

この README.md は `protocol.json` の `files` に含まれないため、hashの対象外です。

## 整形の対象外

このディレクトリは `.prettierignore` で除外しています。整形すると内容hashがずれて、正本と同じファイルでなくなるためです。
