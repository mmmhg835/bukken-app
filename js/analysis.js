// 住所・駅徒歩・築年の読み取りと、回帰・中央値・度数分布。
//
// もとは「分析」タブのエンジンだったが、その役目は相場タブ（market.js）に移った。
// ここに残しているのは、相場でも一覧でも使う道具だけ。

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
