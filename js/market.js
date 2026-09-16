// 建物ごとの「売り出し履歴」。マンションレビューの販売履歴を写して貯める。
//
// 手持ちの部屋（rooms）は検討中の物件そのもの、こちらは同じ建物で過去に売りに出た
// 別の部屋。過去いくらで出ていたか・いくら値下げして・何か月で終わったかを見るための、
// 建物側のデータとして持つ。
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
function spanOf(rows) {
  const ys = rows.map((x) => ymToNum(x.listedYM)).filter(Number.isFinite);
  if (!ys.length) return null;
  const lo = rows.find((x) => ymToNum(x.listedYM) === Math.min(...ys));
  const hi = rows.find((x) => ymToNum(x.listedYM) === Math.max(...ys));
  return { from: lo?.listedYM ?? null, to: hi?.listedYM ?? null };
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
