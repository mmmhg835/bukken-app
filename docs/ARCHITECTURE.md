# 設計メモ

## 全体像

```
┌─────────────────────────┐        ┌──────────────────────────┐
│  bukken-app (Public)    │        │  bukken-data (Private)   │
│  GitHub Pages で配信     │──API──▶│  properties.json         │
│  HTML/CSS/JS のみ        │        │  images/<物件ID>/*.jpg    │
└─────────────────────────┘        └──────────────────────────┘
        ▲                                     ▲
        │ ブラウザで開く                        │ Contents API (PUT/GET/DELETE)
   Mac / iPhone ───────────────────────────────┘
```

**なぜ2リポジトリに分けているか**: GitHub Pages を無料で使うには公開リポジトリである必要がある一方、
物件の価格や資金計画は非公開にしたい。アプリのコードにデータを一切置かないことで、
コードは公開したままデータだけを Private に保てる。

## データモデル (`properties.json`)

```jsonc
{
  "schemaVersion": 1,
  "updatedAt": "ISO8601",
  "properties": [{
    "id": "p1",              // 画像フォルダ名にも使う不変ID
    "no": 1,                 // 表示順
    "name": "…", "status": "検討中", "rating": 0,   // status は util.js の STATUSES
    "price": 16500,          // 万円
    "area": 113.02,          // ㎡
    "layout": "3LDK", "floor": 39, "totalFloors": 45,
    "builtYM": "2005/02", "stations": "…", "walk": "…",
    "balcony": 17.08,
    "kanrihi": 2.3, "shuzen": 2.1,                  // 万円/月
    "loanPrincipal": 27.5, "loanInterest": 9.7, "monthlyTotal": 41.6,
    "reform": "…", "viewNote": "…", "roomNote": "…", "memo": "…",
    "imageRange": "IMG_7538〜7555",                 // 元のスプレッドシート由来
    "cover": "images/p1/xxx.jpg",                   // カバー画像のパス
    "coverThumb": "data:image/jpeg;base64,…",       // 一覧を即表示するための小サムネ
    "images": [{
      "path": "images/p1/xxx.jpg",        // 拡大表示に使う本体
      "thumbPath": "images/p1/xxx_t.jpg", // 格子表示に使う長辺480pxのサムネ
      "category": "間取り",   // util.js の CATEGORIES
      "caption": "", "name": "IMG_7538.JPG",
      "width": 2560, "height": 1920, "bytes": 612345, "addedAt": "ISO8601"
    }]
  }]
}
```

**派生値は保存しない。** 坪単価・管理＋修繕・年額・築年数は `util.js` の `derive()` が都度計算する。
`monthlyTotal` が入力されていればそれを優先し、無ければ `ローン元金 + 金利分 + 管理 + 修繕` で補う。

## 保存の流れ

| 操作 | 実際に起きること |
|---|---|
| フォームを編集 | メモリ上の `store.data` を更新 → `dirty=true` → IndexedDB にキャッシュ |
| 4秒放置 / 「保存」 | `properties.json` を PUT（`sha` 付き）＝ 1コミット |
| 画像を追加 | 端末で本体＋サムネを生成 → **`properties.json` も含めて1コミット**（Git Data API） |
| 画像を削除 | ファイルを DELETE → `properties.json` を PUT |

**衝突制御**: `properties.json` の `sha` を保持し、PUT 時に渡す。別端末が先に更新していると
409/422 が返るので、その場合は最新 sha を取り直してユーザーに再保存を促す（`store.save()`）。

## 端末間の設定引き継ぎ（QR ペアリング）

トークンを端末ごとに手入力させるのは現実的でないため、設定済みの端末が QR を表示し、
別端末のカメラで読むだけで引き継げるようにしている。

1. 設定画面で `pairingUrl()` が `#/setup/<base64url(JSON)>` 形式の URL を生成
2. `renderQr()` が QR 画像にする（cdnjs の qrcode-generator を設定画面でのみ遅延読み込み）
3. 読み取った端末は `main.js` の `consumePairing()` で設定を保存し、
   **即座に `history.replaceState` で URL からトークンを消す**

設定はクエリ文字列ではなく**ハッシュ（#）に載せる**。ハッシュは HTTP リクエストに含まれず、
サーバーやアクセスログに残らないため。

> この仕組みは Web 版の制約に対する回避策。ネイティブ化する際は
> キーチェーン＋iCloud に置き換わり、QR ペアリングごと不要になる。

## 画像の扱い

1枚の写真から3つの表現を作る。用途ごとに解像度を分けないと、一覧で拡大ボケが起きるか、
ギャラリーで巨大な画像を何十枚も読むことになるため。

| | 解像度 | 置き場所 | 用途 |
|---|---|---|---|
| 本体 | 画質設定による（既定 長辺2560px） | `images/<ID>/xxx.jpg` | 拡大表示・一覧カードのカバー |
| サムネ | 長辺480px | `images/<ID>/xxx_t.jpg` | ギャラリーの格子 |
| カバー | 長辺320pxの data URL | `properties.json` 内 | 一覧を通信なしで即描画する仮表示 |

画質は `js/image.js` の `QUALITY_PRESETS` で3段階（標準/高画質/原寸）。
**原寸かつ元が JPEG の場合は再エンコードせず元データをそのまま使う**。
間取り図や物件概要など、細かい文字を含む資料が再圧縮で読めなくなるのを避けるため。

### まとめてコミットする理由

複数枚を Contents API で1枚ずつ PUT すると、枚数ぶんコミットが乱立し往復も増える。
`GitHubRepo.commitFiles()` は Git Data API（blob → tree → commit → ref）を使い、
**画像も `properties.json` も1コミットにまとめる**。blob 作成のみ並列4本に絞って
二次レート制限を避けている。

## キャッシュ

- `IndexedDB / kv / data` … 最後に同期した `properties.json`（オフラインでも一覧が開ける）
- `IndexedDB / img / <path>` … 画像 Blob（本体・サムネとも）。表示時に `URL.createObjectURL` して使う
- `sw.js` … アプリのシェル（HTML/CSS/JS）のみ。API 通信とデータには触らない

## 意図的に採用していないもの

- **ビルドツール / フレームワーク**: 素の ES モジュールのみ。AI が交互に編集するとき、
  依存やビルド設定の差分で壊れるのを避けるため。
- **バックエンド**: GitHub が唯一の保存先という要件から、サーバーを持たない。
- **git commit による画像管理の最適化**: 枚数が数百を超えたらリポジトリ肥大が問題になる。
  その時点で Git LFS か外部ストレージ（R2 等）への移行を検討する。
