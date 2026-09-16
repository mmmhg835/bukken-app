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

/** 販売にかかった月数。販売中は今月までで数える */
export function monthsOf(x) {
  const from = ymToNum(x.listedYM);
  if (from == null) return null;
  const now = new Date();
  const to = x.closedYM ? ymToNum(x.closedYM) : now.getFullYear() + now.getMonth() / 12;
  return to == null ? null : Math.max(0, Math.round((to - from) * 12));
}

/** 売り出しから最終価格までの変化率（％）。マイナスが値下げ */
export function cutOf(x) {
  const h = [...(x.priceHistory || [])].sort((a, b) => ymToNum(a.ym) - ymToNum(b.ym));
  const first = h[0]?.price ?? x.price;
  if (!first || !x.price) return null;
  return ((x.price - first) / first) * 100;
}

export const isOpen = (x) => !x.closedYM;

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
