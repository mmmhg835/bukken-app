// 登録済みの部屋を横断して傾向を見るための集計・回帰。
// 手持ちの数件でも「相場からの乖離」が見えるようにするのが目的。
import { TSUBO_SQM, derive } from './util.js';
import { analyze } from './price.js';
import { BUILDING_EQUIPMENT, ROOM_EQUIPMENT } from './spec.js';

/* ===== 軸の定義 ===== */

/** 縦軸（何を見るか） */
export const METRICS = {
  tsubo:   { label: '坪単価', unit: '万円/坪', get: (x) => x.c.tsuboPrice },
  total:   { label: '総額', unit: '万円', get: (x) => x.r.price },
  sqm:     { label: '㎡単価', unit: '万円/㎡', get: (x) => (x.r.price && x.r.area ? x.r.price / x.r.area : null) },
  monthly: { label: '月額（ローン＋管理）', unit: '万円/月', get: (x) => x.c.monthly },
  running: { label: 'ランニング㎡単価', unit: '円/㎡・月',
    get: (x) => (x.c.kanriShuzen && x.r.area ? (x.c.kanriShuzen * 10000) / x.r.area : null) },
};

/** 横軸（何で切るか） */
export const ATTRS = {
  area:      { label: '平米', unit: '㎡', get: (x) => x.r.area },
  walk:      { label: '駅徒歩', unit: '分', get: (x) => walkMinutesOf(x.b) },
  builtYear: { label: '竣工年', unit: '年', get: (x) => builtYearOf(x.b), tick: (v) => String(Math.round(v)) },
  age:       { label: '築年数', unit: '年', get: (x) => x.c.ageYears },
  floor:     { label: '所在階', unit: '階', get: (x) => x.r.floor },
  balcony:   { label: 'バルコニー', unit: '㎡', get: (x) => x.r.balcony },
  salesDays: { label: '販売期間', unit: '日', get: (x) => x.a.salesDays },
};

/** 設備は建物側と部屋側のどちらに入っていても、同じ「有無」として扱う */
export function hasEquipment(x, name) {
  return (x.r.roomEquipmentTags || []).includes(name)
    || (x.b.equipmentTags || []).includes(name);
}

/** 絞り込みに使える設備の一覧 */
export const EQUIPMENT_FILTERS = [
  ...BUILDING_EQUIPMENT.map((name) => ({ name, on: '建物' })),
  ...ROOM_EQUIPMENT.map((name) => ({ name, on: '部屋' })),
];

/** 色分け（系列の分け方） */
export const GROUPINGS = {
  none:     { label: '指定なし', get: () => 'すべて' },
  building: { label: '建物', get: (x) => x.b.name },
  city:     { label: '市区町村', get: (x) => areaOf(x.b).city || '未設定' },
  town:     { label: '町名', get: (x) => areaOf(x.b).town || '未設定' },
  station:  { label: '最寄駅', get: (x) => x.b.stations || '未設定' },
  layout:   { label: '間取り', get: (x) => x.r.layout || '未設定' },
  listing:  { label: '募集状況', get: (x) => x.r.listingStatus || '募集中' },
  status:   { label: '検討状態', get: (x) => x.r.status || '検討中' },
  renovation: { label: 'リノベ区分', get: (x) => x.r.renovation || 'なし' },
  // 設備ごとの有無。価格差の理由を探すときに使う
  ...Object.fromEntries(EQUIPMENT_FILTERS.map(({ name }) => [
    `eq:${name}`, { label: `${name}の有無`, get: (x) => (hasEquipment(x, name) ? 'あり' : 'なし') },
  ])),
};

/** 指定した設備をすべて持つ行だけに絞る */
export function filterByEquipment(rows, names) {
  if (!names?.length) return rows;
  return rows.filter((x) => names.every((n) => hasEquipment(x, n)));
}

/* ===== 値の取り出し ===== */

/** 「辰巳7分・東雲12分」から最短の分数を取る。徒歩表記は自由記述のため */
export function walkMinutesOf(building) {
  const m = String(building?.walk || '').match(/(\d+)\s*分/g);
  if (!m) return null;
  return Math.min(...m.map((s) => Number(s.match(/\d+/)[0])));
}

/** 「2007/02」を 2007.08 のような小数年にする。年内の差も傾きに反映させるため */
export function builtYearOf(building) {
  const m = String(building?.builtYM || '').match(/(\d{4})[/\-.年]?\s*(\d{1,2})?/);
  if (!m) return null;
  return Number(m[1]) + (Number(m[2] || 1) - 1) / 12;
}

/** 住所を 都道府県 / 市区町村 / 町名 に分ける。エリア別の相場を出すために使う */
export function areaOf(building) {
  const a = String(building?.address || '').trim();
  if (!a) return { pref: '', city: '', town: '' };
  // 「京都府」を「京都」と切ってしまうため、都道府県は総当たりではなく明示的に判定する
  const m = a.match(/^(東京都|北海道|京都府|大阪府|.{2,3}県)?(.+?[市区町村郡])?(.*)$/);
  const pref = (m?.[1] || '').trim();
  const city = (m?.[2] || '').trim();
  // 丁目・番地の手前までを町名とする
  const rest = (m?.[3] || '').trim();
  const town = rest.replace(/[0-9０-９].*$/, '').replace(/[-‐−―ー].*$/, '').trim();
  return { pref, city, town: town ? `${city}${town}` : city };
}

/** 画面が扱いやすい形に部屋をならす */
export function buildRows(store) {
  const rows = [];
  for (const b of store.buildings) {
    for (const r of store.roomsOf(b.id)) {
      rows.push({ b, r, c: derive(r, b, store.loanTerms), a: analyze(r) });
    }
  }
  return rows;
}

/* ===== 回帰 ===== */

/**
 * 最小二乗法による直線あてはめ。
 * @returns {{slope:number, intercept:number, r:number, n:number, sd:number}|null}
 */
export function linearFit(points) {
  const p = points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  const n = p.length;
  if (n < 3) return null;   // 2点では必ず直線になり、傾向とは呼べない
  const mx = p.reduce((s, q) => s + q.x, 0) / n;
  const my = p.reduce((s, q) => s + q.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const q of p) {
    sxy += (q.x - mx) * (q.y - my);
    sxx += (q.x - mx) ** 2;
    syy += (q.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
  // 残差の標準偏差。相場の幅として帯で描く
  const sd = Math.sqrt(p.reduce((s, q) => s + (q.y - (slope * q.x + intercept)) ** 2, 0) / n);
  return { slope, intercept, r, n, sd };
}

/**
 * 回帰線からの乖離＝割安度。
 * 面積や築年から期待される値に対し、実際がどれだけ安いかを出す。
 */
export function residuals(rows, metricKey, attrKey) {
  const metric = METRICS[metricKey], attr = ATTRS[attrKey];
  const pts = rows.map((x) => ({ x: attr.get(x), y: metric.get(x), row: x }));
  const fit = linearFit(pts);
  if (!fit) return { fit: null, list: [] };
  const list = pts
    .filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y))
    .map((q) => {
      const expected = fit.slope * q.x + fit.intercept;
      return { row: q.row, actual: q.y, expected, diff: q.y - expected, ratio: expected ? (q.y - expected) / expected : 0 };
    })
    .sort((a, b) => a.diff - b.diff);   // 安い順
  return { fit, list };
}

/* ===== 集計 ===== */

/** 区分ごとの件数・割合・相場（平均/中央/最安/最高） */
export function groupStats(rows, groupKey, metricKey) {
  const g = GROUPINGS[groupKey], metric = METRICS[metricKey];
  const map = new Map();
  for (const x of rows) {
    const k = g.get(x);
    if (!map.has(k)) map.set(k, []);
    const v = metric.get(x);
    if (Number.isFinite(v)) map.get(k).push(v);
  }
  const total = [...map.values()].reduce((s, v) => s + v.length, 0);
  return [...map.entries()]
    .map(([name, vals]) => ({
      name,
      count: vals.length,
      ratio: total ? (vals.length / total) * 100 : 0,
      avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null,
      median: median(vals),
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
    }))
    .filter((s) => s.count)
    .sort((a, b) => (a.avg ?? Infinity) - (b.avg ?? Infinity));
}

export function median(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 度数分布。binSize を省略すると値の範囲から自動で決める */
export function histogram(values, binSize = null) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { bins: [], binSize: 0 };
  const lo = Math.min(...v), hi = Math.max(...v);
  const size = binSize || niceBin((hi - lo) || Math.abs(hi) || 1);
  const start = Math.floor(lo / size) * size;
  const count = Math.max(1, Math.ceil(((hi - start) || size) / size));
  const bins = Array.from({ length: count }, (_, i) => ({ from: start + i * size, to: start + (i + 1) * size, values: [] }));
  for (const x of v) {
    const i = Math.min(bins.length - 1, Math.floor((x - start) / size));
    bins[i].values.push(x);
  }
  return { bins, binSize: size };
}

function niceBin(range) {
  const raw = range / 8;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

/** 価格履歴を月次にならした推移。過去の募集情報を入れるほど意味を持つ */
export function monthlyTrend(rows, metricKey = 'tsubo') {
  const buckets = new Map();   // 'YYYY-MM' -> 値の配列
  for (const x of rows) {
    const tsubo = x.r.area ? x.r.area / TSUBO_SQM : null;
    for (const h of x.a.history) {
      const key = h.date.slice(0, 7);
      const v = metricKey === 'tsubo' ? (tsubo ? h.price / tsubo : null) : h.price;
      if (!Number.isFinite(v)) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(v);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, vals]) => ({
      date: `${month}-01`,
      price: vals.reduce((s, v) => s + v, 0) / vals.length,
      count: vals.length,
    }));
}
