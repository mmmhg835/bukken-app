// 住所・駅徒歩・築年の読み取りと、回帰・中央値・度数分布。
//
// もとは「分析」タブのエンジンだったが、その役目は相場タブ（market.js）に移った。
// ここに残しているのは、相場でも一覧でも使う道具だけ。

/* ===== 値の取り出し ===== */

/**
 * 「辰巳7分・東雲12分」を 駅名 → 分 の対応にする。
 * どの駅から何分かが分かれば、選んだ駅までの距離で絞れる。
 */
export function walkByStation(building) {
  const out = new Map();
  for (const m of String(building?.walk || '').matchAll(/([^・/、,]+?)\s*(\d+)\s*分/g)) {
    const name = m[1].trim();
    const min = Number(m[2]);
    if (name && Number.isFinite(min) && !out.has(name)) out.set(name, min);
  }
  return out;
}

/**
 * 駅からの徒歩分。
 *
 * only に駅を渡すと、その駅までの分数で見る。渡さなければ最短の駅で見る。
 * 「豊洲まで10分以内」で探しているのに、隣の辰巳まで6分だからという理由で
 * 残ってしまうと、条件の意味が変わってしまうため。
 * 選んだ駅が徒歩の記載に無いときは、最短の駅に戻す（黙って落とさない）。
 *
 * @param {object} building
 * @param {string[]} [only] 選んでいる駅
 */
export function walkMinutesOf(building, only = null) {
  const map = walkByStation(building);
  if (!map.size) return null;
  if (only && only.length) {
    const picked = [...map].filter(([name]) => only.includes(name)).map(([, v]) => v);
    if (picked.length) return Math.min(...picked);
  }
  return Math.min(...map.values());
}

/** 「2007/02」を 2007.08 のような小数年にする。年内の差も傾きに反映させるため */
/** 最寄駅。「有明テニスの森 / 有明 / 国際展示場」を配列にする */
export const stationsOf = (b) =>
  String(b?.stations || '').split('/').map((x) => x.trim()).filter(Boolean);

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

/**
 * タワーマンションとみなす階数。
 *
 * 名前に「タワー」が付くかで見ると取りこぼす。手元のデータだと名前は83棟、
 * 20階以上は103棟で、Wコンフォートタワーズのような表記ゆれや、
 * 低層なのに「タワー」と付く物件を拾えない。階建で決める。
 */
export const TOWER_FLOORS = 20;
export const isTower = (b) => (Number(b?.totalFloors) || 0) >= TOWER_FLOORS;

/**
 * 区（政令市は「川崎市中原区」まで）。エリアの単位として使う。
 *
 * 町名まで見ると細かすぎて数が揃わず、市だけだと横浜市が1つになってしまう。
 * 買う側が「このへん」と考える単位は区なので、そこで切る。
 * 区の無い市（藤沢市など）はその市を返す。
 */
export function wardOf(building) {
  const rest = String(building?.address || '').trim()
    .replace(/^(東京都|北海道|京都府|大阪府|.{2,3}県)/, '').trim();
  if (!rest) return '';
  // 「市川市」を「市」と切らないよう、市町村名は2文字以上を求める
  const city = rest.match(/^(.{2,}?[市町村郡])/)?.[1] || '';
  const ward = rest.slice(city.length).match(/^(.{1,}?区)/)?.[1] || '';
  return city + ward;
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
