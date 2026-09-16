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

/** 同じ部屋かどうかの鍵。建物・階・専有面積で決める */
export const unitKey = (buildingId, floor, area) =>
  `${buildingId}|${floor ?? ''}|${area ?? ''}`;

const keyOfRoom = (r) => unitKey(r.buildingId, r.floor, r.area);
const keyOfListing = (x) => unitKey(x.buildingId, x.floor, x.area);

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
  const mine = new Map();
  for (const r of store.rooms) mine.set(keyOfRoom(r), r);

  const out = [];
  const used = new Set();
  for (const x of store.onsaleRows) {
    const k = keyOfListing(x);
    const r = mine.get(k);
    if (r) used.add(k);
    out.push({ r: r || listingAsRoom(x), b: store.building(x.buildingId), listing: x });
  }
  for (const [k, r] of mine) {
    if (used.has(k)) continue;
    out.push({ r, b: store.building(r.buildingId), listing: null });
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
export const AREA_BANDS = [['all', 'すべて'], ['-50', '50㎡未満'], ['50-60', '50〜60㎡'],
  ['60-70', '60〜70㎡'], ['70-80', '70〜80㎡'], ['80-90', '80〜90㎡'],
  ['90-100', '90〜100㎡'], ['100-', '100㎡以上']];

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
  if (y == null) return null;
  const now = new Date();
  return now.getFullYear() + now.getMonth() / 12 - y;
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

/** 件数の多い順に並べた選択肢。何を選べばいいか分かるように件数を添える */
export function options(values, label = (v) => v) {
  const count = new Map();
  for (const v of values) if (v) count.set(v, (count.get(v) || 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(b[0], 'ja'))
    .map(([v, n]) => [v, `${label(v)}（${n}）`]);
}

/** カードから開くリンク。部屋の募集ページがあればそれ、無ければ建物のページ */
export function unitUrl({ r, b, listing }) {
  return listing?.url || r?.listingUrl || b?.url || '';
}

/* ===== 募集状況の突き合わせ ===== */

// 面積の許容差。同じ部屋でも、掲載元によって 80.1 と 80.14 のようにぶれる
const AREA_TOL = 0.6;
const sameUnit = (a, b) =>
  a.floor != null && a.floor === b.floor
  && a.area != null && b.area != null && Math.abs(a.area - b.area) <= AREA_TOL;

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

  const live = store.onsaleRows.filter((x) => x.buildingId === r.buildingId && sameUnit(r, x));
  if (live.length) {
    const ym = live.map((x) => x.listedYM).filter(Boolean).sort().pop() || null;
    return { state: 'open', ym };
  }
  const market = store.marketOf(r.buildingId);
  if (!market || !(market.sale || []).length) return { state: 'unknown', ym: null };

  const past = market.sale.filter((x) => sameUnit(r, x));
  if (!past.length) return { state: 'unknown', ym: null };      // 階も面積も一致しない＝別物
  const ym = past.map((x) => x.closedYM).filter(Boolean).sort().pop() || null;
  return { state: 'closed', ym };
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
