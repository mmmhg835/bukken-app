# AI への引き継ぎテンプレ

Claude と ChatGPT で交互に開発するときは、相手に最初にこれを渡してください。

---

物件検討用の PWA を開発しています。2つのリポジトリに分かれています。

- `<owner>/bukken-app` （Public）… アプリ本体。HTML/CSS/素の ES モジュールのみ。**ビルドツールなし**
- `<owner>/bukken-data` （Private）… `properties.json` と `images/<物件ID>/*.jpg`

設計は `docs/ARCHITECTURE.md` に全部書いてあります。**作業前に必ず読んでください。**

守ってほしいこと:

1. **ビルドツールやフレームワークを導入しない**（React / Vite / TypeScript などへの移行は提案のみ、勝手に実行しない）
2. **派生値を `properties.json` に保存しない**。坪単価などは `js/util.js` の `derive()` で計算する
3. **アプリ側リポジトリに個人データを置かない**（物件名・価格・画像はすべて data リポジトリ）
4. スキーマを変える場合は `schemaVersion` を上げ、`docs/ARCHITECTURE.md` の表も更新する
5. 変更後は `npx serve .` で開いて、一覧 / 比較 / 詳細 / 設定の4画面が壊れていないことを確認する

---

## よくある作業

| やりたいこと | 触るファイル |
|---|---|
| 比較表に項目を追加 | `js/views.js` の `renderCompare()` 内 `rows` |
| 入力フォームに項目を追加 | `js/views.js` の `FIELDS` / `TEXTAREAS` |
| 自動計算のルール変更 | `js/util.js` の `derive()` |
| 画像カテゴリを増やす | `js/util.js` の `CATEGORIES` |
| 検討ステータスを増やす | `js/util.js` の `STATUSES` |
| 画像の縮小サイズ変更 | `js/image.js` の `MAX_EDGE` / `QUALITY` |
