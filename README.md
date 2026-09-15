# 物件検討ボード

**https://mmmhg835.github.io/bukken-app/**

検討中の物件を **写真つきで比較・管理** するための PWA（Mac / iPhone 両対応）。

- **アプリ本体（このリポジトリ・Public）**: HTML / CSS / Vanilla JS のみ。ビルド不要。個人情報は一切含まない。
- **データ（[mmmhg835/bukken-data](https://github.com/mmmhg835/bukken-data)・Private）**: `properties.json` と `images/<物件ID>/*.jpg`。

アプリはブラウザから GitHub Contents API を直接叩いてデータリポジトリを読み書きするため、
**サーバー不要**で Mac と iPhone の内容が同期されます。画像をアップロードすると、その場で
1コミットとしてデータリポジトリに保存されます。

## 使い方

1. GitHub Pages の URL を開く（iPhone は Safari の共有 →「ホーム画面に追加」でアプリ化）
2. **設定** タブでデータリポジトリと Fine-grained トークンを入力 →「保存して接続テスト」
3. **2台目以降は入力不要**。設定済みの端末で「QR コードを表示」を押し、それをカメラで読むだけ
4. あとは **一覧 / 比較 / 詳細** で編集。変更は 4 秒後に自動コミット（「保存」ボタンでも即時コミット）

トークンは端末のブラウザ（localStorage）にのみ保存され、GitHub 以外には送信されません。
端末ごとに一度だけ入力が必要です。

## ローカルで動かす

`file://` だと ES モジュールが読めないので、同梱の簡易サーバー経由で開いてください（依存なし）。

```bash
node tools/serve.mjs 8765
```

→ http://localhost:8765 を開く

## ディレクトリ

```
index.html            画面の骨組み
app.css               スタイル（ライト/ダーク自動）
js/main.js            起動・ハッシュルーティング・自動保存
js/views.js           一覧 / 建物 / 部屋 / 比較 / 地図 / 設定 の描画
js/ui.js              画面共通の小さな部品
js/gallery.js         画像ギャラリーと全画面ビューワ
js/loan.js            住宅ローン試算（元利均等・元金均等）
js/price.js           販売活動の分析（販売期間・価格改定・値下げ幅）
js/chart.js           グラフ描画（ステップ・散布図・ヒストグラム、依存なしSVG）
js/analysis.js        集計と回帰（相場・割安度・エリア別）
js/lifeplan.js        家計シミュレーションの計算
js/lifeplan-view.js   ライフプランタブの画面
js/analytics-view.js  分析タブの画面
js/sales.js           部屋詳細の「販売活動」セクション
js/map.js             地図表示と住所ジオコーディング（国土地理院）
js/migrate.js         properties.json のスキーマ移行
js/spec.js            建物・部屋のスペック項目と設備の選択肢
js/theme.js           ライト / ダークの切り替え
js/store.js           状態管理（GitHub が実体、IndexedDB がキャッシュ）
js/github.js          GitHub Contents API クライアント
js/image.js           アップロード前の画像縮小（長辺1600px / サムネ420px）
js/pairing.js         QR による端末間の設定引き継ぎ
js/idb.js             IndexedDB ラッパ
js/util.js            整形・自動計算（坪単価・ローン・月額合計・築年数）
tools/smoke.mjs       全モジュールの読み込み確認（コミット前に実行）
tools/verify-loan.mjs ローン計算の検証
tools/serve.mjs       ローカル確認用の静的サーバー（依存なし）
tools/make-icons.mjs  PWA アイコン生成（依存なし）
docs/ARCHITECTURE.md  設計メモ
docs/HANDOFF.md       AI に引き継ぐときのテンプレ
```

詳細は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。
