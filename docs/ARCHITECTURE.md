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
      "path": "images/p1/xxx.jpg",
      "category": "間取り",   // util.js の CATEGORIES
      "caption": "", "name": "IMG_7538.JPG",
      "width": 1600, "height": 1200, "addedAt": "ISO8601"
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
| 画像を追加 | 端末で縮小 → 画像を PUT（枚数ぶんコミット）→ 最後に `properties.json` を PUT |
| 画像を削除 | ファイルを DELETE → `properties.json` を PUT |

**衝突制御**: `properties.json` の `sha` を保持し、PUT 時に渡す。別端末が先に更新していると
409/422 が返るので、その場合は最新 sha を取り直してユーザーに再保存を促す（`store.save()`）。

## キャッシュ

- `IndexedDB / kv / data` … 最後に同期した `properties.json`（オフラインでも一覧が開ける）
- `IndexedDB / img / <path>` … 画像 Blob。表示時に `URL.createObjectURL` して使う
- `sw.js` … アプリのシェル（HTML/CSS/JS）のみ。API 通信とデータには触らない

## 意図的に採用していないもの

- **ビルドツール / フレームワーク**: 素の ES モジュールのみ。AI が交互に編集するとき、
  依存やビルド設定の差分で壊れるのを避けるため。
- **バックエンド**: GitHub が唯一の保存先という要件から、サーバーを持たない。
- **git commit による画像管理の最適化**: 枚数が数百を超えたらリポジトリ肥大が問題になる。
  その時点で Git LFS か外部ストレージ（R2 等）への移行を検討する。
