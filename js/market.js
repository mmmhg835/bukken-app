// 建物ごとの「売り出し履歴」。マンションレビューの販売履歴を写して貯める。
//
// 手持ちの部屋（rooms）は検討中の物件そのもの、こちらは同じ建物で過去に売りに出た
// 別の部屋。過去いくらで出ていたか・いくら値下げして・何か月で終わったかを見るための、
// 建物側のデータとして持つ。
import { walkMinutesOf } from './analysis.js';
import { TSUBO_SQM } from './util.js';

/** 「2026-08」を 2026.58 のような小数年にする。並べ替えと横軸に使う */
export function ymToNum(ym) {
  const m = String(ym || '').match(/(\d{4})[-/年]?\s*(\d{1,2})?/);
  if (!m) return null;
  return Number(m[1]) + (Number(m[2] || 1) - 1) / 12;
}

/** 「2026-08」を「2026/08」にする。表に出す形 */
export function ymLabel(ym) {
  const m = String(ym || '').match(/(\d{4})[-/年]?\s*(\d{1,2})?/);
  return m ? `${m[1]}/${String(Number(m[2] || 1)).padStart(2, '0')}` : '—';
}

/** 坪単価。派生値なので保存せず都度出す */
export const tsuboOf = (x) =>
  (x.price && x.area ? x.price / (x.area / TSUBO_SQM) : null);

/** ㎡単価 */
export const sqmOf = (x) => (x.price && x.area ? x.price / x.area : null);

/**
 * 販売にかかった月数。販売中は今月までで数える。
 * 終了年月も販売中の印も無い行（マンレビの「ー」）は分からないので null を返す。
 */
export function monthsOf(x) {
  const from = ymToNum(x.listedYM);
  if (from == null) return null;
  const now = new Date();
  const to = x.closedYM ? ymToNum(x.closedYM)
    : (isOpen(x) ? now.getFullYear() + now.getMonth() / 12 : null);
  return to == null ? null : Math.max(0, Math.round((to - from) * 12));
}

/** 売り出しから最終価格までの変化率（％）。マイナスが値下げ */
export function cutOf(x) {
  const h = [...(x.priceHistory || [])].sort((a, b) => ymToNum(a.ym) - ymToNum(b.ym));
  const first = h[0]?.price ?? x.price;
  if (!first || !x.price) return null;
  return ((x.price - first) / first) * 100;
}

/** 販売中か。open が無い古いデータは終了年月の有無で見る */
export const isOpen = (x) => (x.open != null ? !!x.open : !x.closedYM);

/** 新しい順。同じ月なら価格の高い順で安定させる */
export function sortRows(rows) {
  return [...rows].sort((a, b) =>
    (ymToNum(b.listedYM) ?? -Infinity) - (ymToNum(a.listedYM) ?? -Infinity)
    || (b.price ?? 0) - (a.price ?? 0));
}

/** 建物1棟ぶんのまとめ */
export function summary(rows) {
  const tsubo = rows.map(tsuboOf).filter(Number.isFinite);
  const months = rows.map(monthsOf).filter(Number.isFinite);
  const cuts = rows.map(cutOf).filter((v) => Number.isFinite(v) && v < 0);
  return {
    count: rows.length,
    open: rows.filter(isOpen).length,
    tsuboMin: tsubo.length ? Math.min(...tsubo) : null,
    tsuboMed: median(tsubo),
    tsuboMax: tsubo.length ? Math.max(...tsubo) : null,
    monthsMed: median(months),
    cutRate: rows.length ? (cuts.length / rows.length) * 100 : null,
    cutAvg: cuts.length ? cuts.reduce((s, v) => s + v, 0) / cuts.length : null,
    span: spanOf(rows),
  };
}

/** 貯まっている期間。データの厚みが分かるようにする */
/**
 * いちばん古い売り出しと、いちばん新しい売り出しの年月。
 * 以前は行ごとに Math.min(...全件) を計算し直していたため、
 * 66,768行で17秒かかっていた（件数の2乗に比例する）。1回なめて求める。
 */
function spanOf(rows) {
  let lo = null, hi = null, loV = Infinity, hiV = -Infinity;
  for (const x of rows) {
    const y = ymToNum(x.listedYM);
    if (!Number.isFinite(y)) continue;
    if (y < loV) { loV = y; lo = x; }
    if (y > hiV) { hiV = y; hi = x; }
  }
  return lo || hi ? { from: lo?.listedYM ?? null, to: hi?.listedYM ?? null } : null;
}

export function median(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 坪単価の散らばり。横軸は売り出した年、縦軸は坪単価。
 * 価格変更があった行は、変更後の価格でも点を打つ（実際にその月にその値で出ていたため）。
 */
export function pricePoints(rows) {
  const pts = [];
  for (const x of rows) {
    if (!x.area) continue;
    const tsubo = x.area / TSUBO_SQM;
    const hist = (x.priceHistory || []).filter((h) => Number.isFinite(h.price));
    const list = hist.length ? hist : [{ ym: x.listedYM, price: x.price }];
    for (const h of list) {
      const x0 = ymToNum(h.ym ?? x.listedYM);
      if (x0 == null || !Number.isFinite(h.price)) continue;
      pts.push({ x: x0, y: h.price / tsubo, row: x, ym: h.ym ?? x.listedYM, price: h.price });
    }
  }
  return pts.sort((a, b) => a.x - b.x);
}

/* ===== 賃料履歴 ===== */
// 賃貸は円のまま扱う。売買の万円と混ぜないこと。

/** 賃料の坪単価（円/坪・月） */
export const rentTsuboOf = (x) => (x.rent && x.area ? x.rent / (x.area / TSUBO_SQM) : null);

/** 賃料の㎡単価（円/㎡・月） */
export const rentSqmOf = (x) => (x.rent && x.area ? x.rent / x.area : null);

/** 新しい順 */
export function sortRents(rows) {
  return [...rows].sort((a, b) =>
    (ymToNum(b.ym) ?? -Infinity) - (ymToNum(a.ym) ?? -Infinity) || (b.rent ?? 0) - (a.rent ?? 0));
}

export function rentSummary(rows) {
  const tsubo = rows.map(rentTsuboOf).filter(Number.isFinite);
  const rents = rows.map((x) => x.rent).filter(Number.isFinite);
  const ys = rows.map((x) => ymToNum(x.ym)).filter(Number.isFinite);
  return {
    count: rows.length,
    rentMed: median(rents),
    tsuboMin: tsubo.length ? Math.min(...tsubo) : null,
    tsuboMed: median(tsubo),
    tsuboMax: tsubo.length ? Math.max(...tsubo) : null,
    span: ys.length ? {
      from: rows.find((x) => ymToNum(x.ym) === Math.min(...ys))?.ym ?? null,
      to: rows.find((x) => ymToNum(x.ym) === Math.max(...ys))?.ym ?? null,
    } : null,
  };
}

/* ===== 新築分譲価格 ===== */

/** 新築時の坪単価（万円/坪）。売買と同じ単位 */
export const newTsuboOf = (x) => (x.price && x.area ? x.price / (x.area / TSUBO_SQM) : null);

/** 階の高い順。新築時の価格表は階による差を見るためのもの */
export function sortNewPrices(rows) {
  return [...rows].sort((a, b) => (b.floor ?? -Infinity) - (a.floor ?? -Infinity)
    || (b.price ?? 0) - (a.price ?? 0));
}

export function newSummary(rows) {
  const tsubo = rows.map(newTsuboOf).filter(Number.isFinite);
  return {
    count: rows.length,
    tsuboMin: tsubo.length ? Math.min(...tsubo) : null,
    tsuboMed: median(tsubo),
    tsuboMax: tsubo.length ? Math.max(...tsubo) : null,
  };
}

/* ===== 横断の指標 ===== */

/**
 * 表面利回り（％）。年間賃料 ÷ 売買価格。
 * 面積の差をならすため、どちらも坪単価に直してから割る。
 * @param {number} saleTsuboMan 売買の坪単価（万円/坪）
 * @param {number} rentTsuboYen 賃料の坪単価（円/坪・月）
 */
export function grossYield(saleTsuboMan, rentTsuboYen) {
  if (!saleTsuboMan || !rentTsuboYen) return null;
  return ((rentTsuboYen * 12) / (saleTsuboMan * 10000)) * 100;
}

/** 新築時から何倍になったか */
export function vsNew(saleTsuboMan, newTsuboMan) {
  if (!saleTsuboMan || !newTsuboMan) return null;
  return saleTsuboMan / newTsuboMan;
}

/**
 * 直近 n 年ぶんに絞る。
 * 履歴が17年ぶん貯まると全期間の中央値は「今の相場」ではなくなる
 * （2009年の212万/坪まで混ざる）。突き合わせには直近だけを使う。
 */
export function recent(rows, years = 1, key = 'listedYM') {
  const now = new Date();
  const from = now.getFullYear() + now.getMonth() / 12 - years;
  const hit = rows.filter((x) => (ymToNum(x[key]) ?? -Infinity) >= from);
  return hit.length ? hit : rows;   // 直近に1件も無ければ全部で見る
}

/* ===== 相場を切り口ごとに見る =====
   分析タブが部屋20室に対してやっていたことを、相場の数万件に対して行う。
   売り出しの行は { listedYM, price, area, floor, layout, direction, feature, ... } で、
   建物は行に持たせず buildingId で引く。 */

/** 縦軸。何を見るか */
export const MARKET_METRICS = {
  tsubo: { label: '坪単価', unit: '万円/坪', get: (x) => tsuboOf(x) },
  sqm:   { label: '㎡単価', unit: '万円/㎡', get: (x) => sqmOf(x) },
  price: { label: '価格', unit: '万円', get: (x) => x.price ?? null },
  months: { label: '販売期間', unit: 'か月', get: (x) => monthsOf(x) },
};

/** 横軸。何で切るか。b は建物（無いこともある） */
export const MARKET_ATTRS = {
  year:  { label: '売り出した年', unit: '年', get: (x) => ymToNum(x.listedYM),
    tick: (v) => String(Math.round(v)) },
  area:  { label: '専有面積', unit: '㎡', get: (x) => x.area ?? null },
  floor: { label: '所在階', unit: '階', get: (x) => x.floor ?? null,
    tick: (v) => String(Math.round(v)) },
  age:   { label: '売り出し時の築年数', unit: '年',
    get: (x, b) => {
      const built = ymToNum(String(b?.builtYM || '').replace('/', '-'));
      const at = ymToNum(x.listedYM);
      return built == null || at == null ? null : Math.max(0, Math.round((at - built) * 10) / 10);
    } },
};

/** 色分け */
export const MARKET_GROUPS = {
  none:      { label: '指定なし', get: () => 'すべて' },
  building:  { label: '建物', get: (x, b) => b?.name || '不明' },
  layout:    { label: '間取り', get: (x) => x.layout || '不明' },
  direction: { label: '向き', get: (x) => x.direction || '不明' },
  feature:   { label: '特徴', get: (x) => x.feature || 'なし' },
  status:    { label: '募集状況', get: (x) => (isOpen(x) ? '販売中' : x.closedYM ? '終了' : '記録なし') },
  decade:    { label: '売り出した年', get: (x) => {
    const y = ymToNum(x.listedYM);
    return y == null ? '不明' : `${Math.floor(y)}年`;
  } },
  // 順序のある区分。並び順が決まっているので、色も濃さが順に変わるものを当てる
  ageBand: {
    label: '築年数', order: ['築10年以内', '築20年以内', '築30年以内', '築30年超'],
    get: (x, b) => {
      const built = ymToNum(String(b?.builtYM || '').replace('/', '-'));
      if (built == null) return '不明';
      const age = new Date().getFullYear() + new Date().getMonth() / 12 - built;
      return age <= 10 ? '築10年以内' : age <= 20 ? '築20年以内'
        : age <= 30 ? '築30年以内' : '築30年超';
    },
  },
  walkBand: {
    label: '駅徒歩', order: ['5分以内', '10分以内', '15分以内', '15分超'],
    get: (x, b) => {
      const w = walkMinutesOf(b);
      if (w == null) return '不明';
      return w <= 5 ? '5分以内' : w <= 10 ? '10分以内' : w <= 15 ? '15分以内' : '15分超';
    },
  },
};

/**
 * 年ごとの坪単価。上がっているのか下がっているのかを字面でも見たいので、
 * グラフと同じ数字を表にも出せる形で返す。
 * 価格変更のあった行は、変更後の価格でもその月に出ていたものとして数える。
 */
export function yearly(rows, metricKey = 'tsubo') {
  const metric = MARKET_METRICS[metricKey];
  const buckets = new Map();
  for (const x of rows) {
    for (const p of pricePoints([x])) {
      const y = Math.floor(p.x);
      const v = metricKey === 'tsubo' ? p.y
        : metricKey === 'sqm' ? (x.area ? p.price / x.area : null)
          : metricKey === 'price' ? p.price : metric.get(x);
      if (!Number.isFinite(v)) continue;
      if (!buckets.has(y)) buckets.set(y, []);
      buckets.get(y).push(v);
    }
  }
  const list = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([year, vals]) => ({
    year,
    count: vals.length,
    median: median(vals),
    avg: vals.reduce((s, v) => s + v, 0) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
  }));
  // 前の年からの変化。上昇が続いているかを見るための列
  list.forEach((r, i) => {
    const prev = list[i - 1];
    r.diff = prev && prev.median ? ((r.median - prev.median) / prev.median) * 100 : null;
  });
  const first = list[0], last = list[list.length - 1];
  const years = first && last ? last.year - first.year : 0;
  return {
    list,
    // 年平均の伸び（複利）。「1年で何%上がってきたか」
    cagr: first && last && years > 0 && first.median
      ? ((last.median / first.median) ** (1 / years) - 1) * 100 : null,
  };
}

/** 区分ごとのまとめ。建物別・間取り別などに使う */
export function groupBy(rows, buildingOf, groupKey, metricKey = 'tsubo') {
  const g = MARKET_GROUPS[groupKey], metric = MARKET_METRICS[metricKey];
  const map = new Map();
  for (const x of rows) {
    const k = g.get(x, buildingOf(x.buildingId));
    const v = metric.get(x, buildingOf(x.buildingId));
    if (!Number.isFinite(v)) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  }
  const total = [...map.values()].reduce((s, v) => s + v.length, 0);
  return [...map.entries()].map(([name, vals]) => ({
    name,
    count: vals.length,
    ratio: total ? (vals.length / total) * 100 : 0,
    median: median(vals),
    avg: vals.reduce((s, v) => s + v, 0) / vals.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
  })).sort((a, b) => b.median - a.median);
}

/** 度数分布。価格帯がどこに寄っているか */
export function bands(rows, metricKey = 'tsubo', binSize = null) {
  const metric = MARKET_METRICS[metricKey];
  const vals = rows.map((x) => metric.get(x)).filter(Number.isFinite);
  if (!vals.length) return { bins: [], binSize: 0 };
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const size = binSize || niceBin((hi - lo) || Math.abs(hi) || 1);
  const start = Math.floor(lo / size) * size;
  const count = Math.max(1, Math.ceil(((hi - start) || size) / size));
  const bins = Array.from({ length: count }, (_, i) => ({ from: start + i * size, to: start + (i + 1) * size, a: 0, b: 0 }));
  for (const x of rows) {
    const v = metric.get(x);
    if (!Number.isFinite(v)) continue;
    const i = Math.min(bins.length - 1, Math.floor((v - start) / size));
    if (isOpen(x)) bins[i].a++; else bins[i].b++;
  }
  return { bins, binSize: size };
}

function niceBin(range) {
  const raw = range / 10;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}
