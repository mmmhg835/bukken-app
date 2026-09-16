// 「物件」を1つの流れにまとめる層。
//
// 売り出し中の行（onsale.json）と、自分が登録した部屋（properties.json）は
// 別々に持っているが、画面から見れば同じ「物件」。ここで同じ形に揃える。
//
// 売買物件に部屋番号は出ない（マンレビの部屋番号つきは有料）。
// 建物・階・専有面積で同じ部屋とみなすのが実務のやり方なので、それに合わせる。
import { store } from './store.js';
import { RENOVATION } from './spec.js';
import { builtYearOf, walkMinutesOf } from './analysis.js';
import { nowYear } from './market.js';


/** 「リフォーム・リノベーション」からリノベ区分を決める */
export function renovationOf(feature = '') {
  if (/リノベーション/.test(feature)) return RENOVATION[2];
  if (/リフォーム/.test(feature)) return RENOVATION[1];
  return RENOVATION[0];
}

/**
 * 売り出しの行を部屋と同じ形にする。画面側が部屋と見分けずに扱えるようにするため。
 * 指値・内見・写真は持たない（自分が手を入れて初めて付く）。
 */
export function listingAsRoom(x) {
  return {
    id: x.id,
    buildingId: x.buildingId,
    label: x.floor != null ? `${x.floor}階` : '階数不明',
    fromListing: true,                 // まだ自分の部屋になっていない印
    status: '検討中', rating: 0,
    listingStatus: '募集中',
    listedAt: x.listedYM ? `${x.listedYM}-01` : null,
    closedAt: null,
    priceHistory: (x.priceHistory || []).map((h) => ({ date: `${h.ym}-01`, price: h.price })),
    roomEquipmentTags: /角部屋/.test(x.feature || '') ? ['角部屋'] : [],
    renovation: renovationOf(x.feature),
    price: x.price ?? null, area: x.area ?? null, layout: x.layout || '',
    floor: x.floor ?? null, balcony: x.balcony ?? null,
    kanrihi: x.kanrihi ?? null, shuzen: x.shuzen ?? null,
    refMonthly: null, refLoanPrincipal: null, refLoanInterest: null, loan: null,
    offerPrice: null, salePrice: null,
    marketIsoge: null, marketMrev: null,
    viewingAt: null, viewingChecks: {}, viewingNote: '',
    reform: '', viewNote: '', roomNote: '',
    imageRange: '', url: store.building(x.buildingId)?.url || '',
    // マンレビの「この部屋の販売情報」ページ。階数・専有面積・価格が一致した行にだけ付く
    listingUrl: x.url || null,
    memo: x.feature ? `マンレビの特徴：${x.feature}` : '',
    cover: null, coverThumb: null, images: [],
  };
}

/**
 * 画面に出す物件の一覧。
 * 売り出し中の行を並べ、自分が登録した部屋があればそちらを使う（指値などが付いているため）。
 * 自分の部屋で売り出しに無いもの（募集が終わった・手で作った）も落とさない。
 */
export function allUnits() {
  const byBuilding = new Map();
  for (const x of store.onsaleRows) {
    if (!byBuilding.has(x.buildingId)) byBuilding.set(x.buildingId, []);
    byBuilding.get(x.buildingId).push(x);
  }
  const out = [];
  const used = new Set();
  for (const r of store.rooms) {
    const { listing, ambiguous } = matchListing(r, byBuilding.get(r.buildingId) || []);
    if (listing) used.add(listing.id);
    out.push({ r, b: store.building(r.buildingId), listing, ambiguous });
  }
  for (const x of store.onsaleRows) {
    if (used.has(x.id)) continue;
    out.push({ r: listingAsRoom(x), b: store.building(x.buildingId), listing: x });
  }
  return out.filter((x) => x.b);
}

/**
 * 売り出しの行から自分の部屋を作る。
 * 一覧や比較から物件を開いたときに呼ぶ。すでに自分の部屋なら何もしない。
 */
export function promote(unit) {
  if (!unit.r.fromListing) return unit.r;
  const x = unit.listing;
  const { id, fromListing, ...rest } = listingAsRoom(x);
  const r = store.addRoom(x.buildingId, rest);
  store.markDirty();
  return r;
}


/* ===== 絞り込みの共通部品。一覧と相場で同じものを使う ===== */

// 竣工年ではなく築年数で見る。何年に建ったかより、いま何年たっているかで選ぶため
export const AGE_BANDS = [['all', 'すべて'], ...[5, 10, 15, 20, 25, 30, 35, 40]
  .map((n) => [`-${n}`, `築${n}年以内`]), ['40-', '築40年超']];
export const WALK_BANDS = [['all', 'すべて'], ['-5', '5分以内'], ['-10', '10分以内'],
  ['-15', '15分以内'], ['15-', '15分超']];
/** 最寄駅。「有明テニスの森 / 有明 / 国際展示場」を配列にする */
export const stationsOf = (b) =>
  String(b?.stations || '').split('/').map((x) => x.trim()).filter(Boolean);

// 事業者の4項目。ブランド（プラウド等）と会社は別物なので、選択肢も別に出す
export const FIRM_KEYS = ['brand', 'developer', 'builder', 'designer'];
export const FIRM_LABEL = {
  brand: 'ブランド', developer: '分譲', builder: '施工', designer: '設計',
};

/** 築年数。竣工年そのものではなく、いま何年たっているかで見る */
export function ageOf(b) {
  const y = builtYearOf(b);
  return y == null ? null : nowYear() - y;
}

export const walkOf = (b) => walkMinutesOf(b);

/** 「-10」「40-」のような帯に入るか */
export function inBand(band, v) {
  if (band === 'all' || band == null) return true;
  if (v == null) return false;
  const [lo, hi] = String(band).split('-').map((x) => (x === '' ? null : Number(x)));
  if (lo != null && v < lo) return false;
  if (hi != null && v > hi) return false;
  return true;
}

/**
 * 名前の突き合わせ用に均す。
 * 「プラウド 武蔵小杉」「ぷらうど武蔵小杉」のように打っても当たるよう、
 * 大文字小文字・全角半角・空白・中黒の違いは無視する。
 */
export const searchKey = (v) => String(v || '')
  .normalize('NFKC').toLowerCase()
  // ひらがなで打っても当たるようにカタカナに寄せる（ぷらうど → プラウド）
  .replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
  .replace(/[\s\u3000・ー–—-]/g, '');

/** 建物名か住所に、打った文字が含まれるか */
export function nameHit(b, q) {
  const k = searchKey(q);
  if (!k) return true;
  if (!b) return false;
  return searchKey(b.name).includes(k) || searchKey(b.address).includes(k)
    || searchKey(b.stations).includes(k);
}

/** 件数の多い順に並べた選択肢。何を選べばいいか分かるように件数を添える */
export function options(values, label = (v) => v) {
  const count = new Map();
  for (const v of values) if (v) count.set(v, (count.get(v) || 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0], 'ja'))
    .map(([v, n]) => [v, `${label(v)}（${n}）`]);
}

/**
 * 建物ごとの売り出し中の部屋数。
 * 同じ建物から何部屋も出ていれば、売り急ぎや供給過多のしるしになる。
 * 1,500件を建物ごとに数え直すと重いので、行が入れ替わるまで使い回す。
 */
let countCache = { rows: null, map: new Map() };
export function onsaleCount(buildingId) {
  const rows = store.onsaleRows;
  if (countCache.rows !== rows) {
    const map = new Map();
    for (const x of rows) map.set(x.buildingId, (map.get(x.buildingId) || 0) + 1);
    countCache = { rows, map };
  }
  return countCache.map.get(buildingId) || 0;
}

/** カードから開くリンク。部屋の募集ページがあればそれ、無ければ建物のページ */
export function unitUrl({ r, b, listing }) {
  return listing?.url || r?.listingUrl || b?.url || '';
}

/* ===== 突き合わせ ===== */

// 面積の許容差。まず小数2桁まで一致で探し、見つからないときだけ緩める
const AREA_EXACT = 0.05;
const AREA_TOL = 0.6;
const near = (a, b, tol) =>
  a != null && b != null && Math.abs(a - b) <= tol;
const sameUnit = (a, b) =>
  a.floor != null && a.floor === b.floor && near(a.area, b.area, AREA_TOL);
const norm = (v) => String(v || '').replace(/[\s\u3000]/g, '').toUpperCase();

/**
 * 間取りを「部屋数＋型」に均す。
 * 掲載元によって 3LDK+S と 3SLDK、4LDK+W+TS のように書き方が違うので、
 * 納戸やWICの付け方は無視して、部屋数と LDK/DK/K/R だけで比べる。
 * 部屋数か型が違えば別の部屋とみなす。
 */
export function canonLayout(v) {
  return layoutLabel(v) || null;
}

/**
 * 選択肢に出す間取りの形。
 *
 * 納戸（S）の書き方は 2SLDK・2SSLDK・3LDK+S・3LDKS（納戸）とばらばらで、
 * 分けて並べても選びようがない。S は落として 2LDK・3LDK にまとめる。
 * データそのものは掲載元の記録のまま残してある。
 */
export function layoutLabel(v) {
  const t = norm(v).replace(/[＋+]/g, '');
  if (!t) return '';
  const m = t.match(/(\d+)\s*S*\s*(LDK|DK|LK|K)/);
  return m ? `${m[1]}${m[2]}` : t;
}

/** 間取りが食い違っていないか。どちらかが分からないときは判断しない */
const layoutOk = (a, b) => {
  const x = canonLayout(a), y = canonLayout(b);
  return !x || !y || x === y;
};

/**
 * 部屋に対応する売り出しの行を1つだけ選ぶ。
 *
 * 売買に部屋番号は無いので、階と専有面積で探すしかない。ただしタワーは
 * 同じ階に同じ広さの部屋が複数あるため、それだけでは足りない。
 * 間取りと価格まで見て1件に絞れなければ、**結びつけない**。
 * 取り違えて別の部屋の価格や履歴を出すくらいなら、出さない方がよい。
 *
 * @returns {{listing: object|null, ambiguous: object[]|null}}
 */
export function matchListing(r, rows) {
  // 間取りが食い違う行は、候補が1件しか無くても別の部屋として外す
  const onFloor = rows.filter((x) =>
    x.floor != null && x.floor === r.floor && layoutOk(r.layout, x.layout));
  let list = onFloor.filter((x) => near(x.area, r.area, AREA_EXACT));
  if (!list.length) list = onFloor.filter((x) => near(x.area, r.area, AREA_TOL));
  if (list.length > 1 && r.price != null) {
    const same = list.filter((x) => x.price === r.price);
    if (same.length) list = same;
  }
  if (list.length > 1) {
    // 同じ部屋が2社から出ているだけなら、中身は同じなのでどれを選んでも変わらない
    const sig = (x) => [x.layout, x.direction, x.price, x.feature, x.balcony].join('|');
    if (new Set(list.map(sig)).size > 1) return { listing: null, ambiguous: list };
  }
  return { listing: list[0] || null, ambiguous: null };
}

/**
 * マンレビの取り込みから見て、その部屋がいま売り出し中かどうか。
 * 自分で付けた listingStatus とは別に、証拠として出す。
 *
 *  open    … 売り出し中の行と一致した
 *  closed  … 一致する売り出しが無く、同じ部屋が過去に売られた履歴はある
 *  unknown … その建物の相場をまだ取り込んでいない（判定できない）
 *
 * 取り込んだ時点のスナップショットなので、最新かどうかは取り込みの新しさ次第。
 */
export function listingHint(r, b = null) {
  if (!r || r.fromListing) return { state: 'open', ym: null };
  const building = b || store.building(r.buildingId);
  if (!building) return { state: 'unknown', ym: null };

  const live = store.onsaleRows.filter((x) => x.buildingId === r.buildingId);
  const { listing, ambiguous } = matchListing(r, live);
  // どの部屋か決まらないうちは、募集中とも終了とも言わない
  if (ambiguous) return { state: 'unknown', ym: null };
  if (listing) return { state: 'open', ym: listing.listedYM || null };
  const market = store.marketOf(r.buildingId);
  if (!market || !(market.sale || []).length) return { state: 'unknown', ym: null };

  const past = market.sale.filter((x) => sameUnit(r, x) && layoutOk(r.layout, x.layout));
  if (!past.length) return { state: 'unknown', ym: null };      // 階も面積も一致しない＝別物
  const ym = past.map((x) => x.closedYM).filter(Boolean).sort().pop() || null;
  return { state: 'closed', ym };
}

/**
 * 同じ広さの売り出し履歴。同じ建物の中で、専有面積が近い行を集める。
 *
 * まったく同じ部屋（同じ階・同じ広さ）が売りに出ることは滅多にないので、
 * 同じ広さの部屋の事例をまとめて見る。同じ階のものには印を付ける。
 * 間取りが食い違う行は別の部屋なので入れない。
 *
 * 建物の相場（market/<建物>.json）を読み込んでいないと空で返る。
 */
export function unitHistory(r, tol = 1.0) {
  if (!r || r.area == null) return [];
  const m = store.marketOf(r.buildingId);
  if (!m) return [];
  return (m.sale || [])
    .filter((x) => near(x.area, r.area, tol) && layoutOk(r.layout, x.layout))
    // 同じ階なら同じ部屋の可能性が高い。印を付けて見分けられるようにする
    .map((x) => ({ ...x, sameFloor: r.floor != null && x.floor === r.floor }))
    .sort((a, x) => String(x.listedYM || '').localeCompare(String(a.listedYM || '')));
}

/** マンレビと食い違っている部屋。まとめて直すときに使う */
export function listingMismatches(rooms = store.rooms) {
  const out = [];
  for (const r of rooms) {
    const hint = listingHint(r);
    if (hint.state === 'unknown') continue;
    const want = hint.state === 'open' ? '募集中' : '募集終了';
    // 商談中・成約は自分で付けた細かい状態なので、勝手には戻さない
    if (r.listingStatus === want || r.listingStatus === '商談中' || r.listingStatus === '成約') continue;
    out.push({ r, want, ym: hint.ym });
  }
  return out;
}
