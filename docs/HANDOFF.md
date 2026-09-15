# AI への引き継ぎテンプレ

Claude と ChatGPT で交互に開発するときは、相手に最初にこれを渡してください。

---

物件検討用の PWA を開発しています。2つのリポジトリに分かれています。
公開URL: https://mmmhg835.github.io/bukken-app/

- `mmmhg835/bukken-app` （Public）… アプリ本体。HTML/CSS/素の ES モジュールのみ。**ビルドツールなし**
- `mmmhg835/bukken-data` （Private）… `properties.json` と `images/<物件ID>/*.jpg`

設計は `docs/ARCHITECTURE.md` に全部書いてあります。**作業前に必ず読んでください。**

守ってほしいこと:

1. **ビルドツールやフレームワークを導入しない**（React / Vite / TypeScript などへの移行は提案のみ、勝手に実行しない）
2. **派生値を `properties.json` に保存しない**。坪単価やローン返済額は `js/util.js` の `derive()` で計算する
3. **建物と部屋の区別を崩さない**。別の部屋でも同じ値になる項目は建物側に置く
4. **検討状態（status）と募集状況（listingStatus）を統合しない**。別の軸として扱う
5. **設備は自由記述にしない**。表記ゆれで比較できなくなるため `spec.js` のタグで持つ
6. **アプリ側リポジトリに個人データを置かない**（物件名・価格・画像はすべて data リポジトリ）
7. スキーマを変える場合は `schemaVersion` を上げ、`docs/ARCHITECTURE.md` の表も更新する
8. 変更後は `node tools/serve.mjs` で開いて、一覧 / 建物 / 部屋 / 比較 / 地図 / 設定が壊れていないことを確認する
9. 条件分岐で子要素を差し替えるときは `replaceChildren` ではなく `util.js` の `mount()` を使う
   （`replaceChildren` は `null` を文字列 "null" として描画してしまう）

---

## よくある作業

| やりたいこと | 触るファイル |
|---|---|
| 建物の項目を追加 | `js/spec.js` の `BUILDING_FORM` |
| 設備の選択肢を追加 | `js/spec.js` の各配列 |
| 配色・テーマ | `js/theme.js` と `app.css` の `:root` |
| 公開後に更新が届かない | `sw.js` の `VERSION` と `util.js` の `APP_VERSION` を揃えて上げる |
| 部屋の項目を追加 | `js/views.js` の `ROOM_FIELDS` |
| ローン計算の仕様変更 | `js/loan.js` |
| 販売活動の指標を追加 | `js/price.js` の `analyze()` |
| グラフの見た目 | `js/chart.js` |
| 分析の軸を追加 | `js/analysis.js` の `METRICS` / `ATTRS` / `GROUPINGS` |
| 分析画面の構成 | `js/analytics-view.js` |
| 比較対象の選択 | `js/views.js` の `selector()` |
| 地図・ジオコーディング | `js/map.js` |
| スキーマ変更と移行 | `js/migrate.js`（`CURRENT_SCHEMA` を上げる） |
| 比較表に項目を追加 | `js/views.js` の `renderCompare()` 内 `defs` |
| 自動計算のルール変更 | `js/util.js` の `derive()` |
| 画像カテゴリを増やす | `js/util.js` の `CATEGORIES` |
| 検討ステータスを増やす | `js/util.js` の `STATUSES` |
| 画質プリセットの変更 | `js/image.js` の `QUALITY_PRESETS` |
| まとめてコミットする処理 | `js/github.js` の `commitFiles()` |
