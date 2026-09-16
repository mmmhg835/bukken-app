// 一覧・比較・ライフプランで共通に使う絞り込み。
// 相場タブと同じ軸・同じ見た目にしてあるので、どの画面でも同じ感覚で探せる。
// 対象は allUnits()（売り出し中の部屋＋登録した部屋）。
import { el, STATUSES } from './util.js';
import { select } from './ui.js';
import { areaOf } from './analysis.js';
import { CLOSED_STATUS } from './price.js';
import {
  AGE_BANDS, WALK_BANDS, AREA_BANDS, FIRM_KEYS, FIRM_LABEL,
  stationsOf, ageOf, walkOf, inBand, options,
} from './units.js';

export const PRICE_BANDS = [
  ['all', 'すべて'], ['-8000', '8,000万円以下'], ['8000-12000', '8,000〜1.2億'],
  ['12000-15000', '1.2億〜1.5億'], ['15000-', '1.5億以上'],
];

// 検討の軸。「自分の物件」という区分は持たない。
// 売り出し中かどうかは募集状況で、ガチで検討しているかは登録とステータスで見る
const OWN_OPTIONS = [['all', 'すべて'], ['mine', '登録した部屋'],
  ...STATUSES.map((x) => [x, x])];

/** 絞り込みの状態。画面をまたいで共有するので、一覧で絞れば比較にもそのまま効く */
export const unitUI = {
  // 募集状況の既定は「募集中」。終わった部屋まで並べると、比較もライフプランも意味が薄れる
  listing: 'open',
  own: 'all',
  // 建物の条件。area は最寄駅、town は町名
  area: 'all', town: 'all', age: 'all', walk: 'all',
  brand: 'all', developer: 'all', builder: 'all', designer: 'all',
  // 部屋の条件
  price: 'all', layout: 'all', size: 'all',
  more: false, equip: [],
};

/**
 * 1部屋がいまの条件に合うか。
 * except を渡すとその条件だけ外して判定する（選択肢を連動させるために使う）。
 */
export function unitMatches({ r, b }, except = null) {
  if (!b) return false;
  const on = (key) => key !== except;
  if (on('own') && unitUI.own !== 'all') {
    // 売り出しの行そのままの部屋は、まだ「登録した部屋」ではない
    if (r.fromListing) return false;
    if (unitUI.own !== 'mine' && r.status !== unitUI.own) return false;
  }
  if (on('listing') && unitUI.listing !== 'all') {
    const closed = CLOSED_STATUS.includes(r.listingStatus);
    if (unitUI.listing === 'open' && closed) return false;
    if (unitUI.listing === 'closed' && !closed) return false;
  }
  if (on('area') && unitUI.area !== 'all' && !stationsOf(b).includes(unitUI.area)) return false;
  if (on('town') && unitUI.town !== 'all' && areaOf(b).town !== unitUI.town) return false;
  for (const k of FIRM_KEYS) {
    if (on(k) && unitUI[k] !== 'all' && (b[k] || '').trim() !== unitUI[k]) return false;
  }
  if (on('age') && !inBand(unitUI.age, ageOf(b))) return false;
  if (on('walk') && !inBand(unitUI.walk, walkOf(b))) return false;
  if (on('layout') && unitUI.layout !== 'all' && r.layout !== unitUI.layout) return false;
  if (on('size') && !inBand(unitUI.size, r.area)) return false;
  if (on('price') && !inBand(unitUI.price, r.price)) return false;
  if (on('equip') && unitUI.equip.length) {
    const tags = [...(r.roomEquipmentTags || []), ...(b.equipmentTags || []),
      ...(b.facilityTags || [])];
    if (!unitUI.equip.every((t) => tags.includes(t))) return false;
  }
  return true;
}

/**
 * 絞り込みの操作パネル。
 * @param {Array} all   絞り込む前の全部屋（allUnits() の結果）
 * @param {Array} shown 絞り込んだあと。件数の表示に使う
 * @param {Function} rerender
 * @param {object} [opts] lead=先頭に足す要素 / trail=末尾に足す要素 / unit=件数の単位
 */
export function unitFilterBar(all, shown, rerender, { lead = null, trail = null, unit = '物件' } = {}) {
  const pick = (key, list) =>
    select(unitUI[key], [['all', 'すべて'], ...list], (v) => { unitUI[key] = v; rerender(); }, 'fsel');
  const band = (key, list) =>
    select(unitUI[key], list, (v) => { unitUI[key] = v; rerender(); }, 'fsel');
  const group = (label, ctrl) => el('div', { class: 'fgroup' }, el('label', {}, label), ctrl);

  // 選択肢は「その条件だけ外した結果」から作る。1つ選ぶと他の選択肢も連動して減る
  const pool = (key) => all.filter((x) => unitMatches(x, key));
  const buildings = (key) => {
    const seen = new Map();
    for (const x of pool(key)) seen.set(x.b.id, x.b);
    return [...seen.values()];
  };

  const equipOptions = [...new Set(buildings('equip')
    .flatMap((b) => [...(b.equipmentTags || []), ...(b.facilityTags || [])])
    .concat(pool('equip').flatMap((x) => x.r.roomEquipmentTags || [])))].sort();

  return el('div', { class: 'filterbar' },
    el('div', { class: 'filterbar-row' },
      lead,
      group('募集状況', band('listing',
        [['open', '募集中'], ['closed', '募集終了'], ['all', 'すべて']])),
      group('検討', band('own', OWN_OPTIONS)),
      group('エリア（最寄駅）', pick('area', options(buildings('area').flatMap(stationsOf)))),
      group('住所', pick('town', options(buildings('town').map((b) => areaOf(b).town)))),
      group('築年数', band('age', AGE_BANDS)),
      group('駅徒歩', band('walk', WALK_BANDS)),
      el('div', { class: 'spacer' }),
      el('span', { class: 'fcount' }, `${shown.length.toLocaleString('ja-JP')}件の${unit}`),
    ),
    el('div', { class: 'filterbar-row' },
      FIRM_KEYS.map((k) => group(FIRM_LABEL[k],
        pick(k, options(buildings(k).map((b) => (b[k] || '').trim()))))),
      group('間取り', pick('layout', options(pool('layout').map((x) => x.r.layout)))),
      group('広さ', band('size', AREA_BANDS)),
      group('価格', band('price', PRICE_BANDS)),
      equipOptions.length
        ? el('button', {
          class: 'btn btn-sm' + (unitUI.more ? ' btn-primary' : ''),
          onclick: () => { unitUI.more = !unitUI.more; rerender(); },
        }, `設備で絞る${unitUI.equip.length ? ` (${unitUI.equip.length})` : ''}`)
        : null,
      el('div', { class: 'spacer' }),
      trail,
    ),
    unitUI.more
      ? el('div', { class: 'filterbar-more' },
        el('div', { class: 'tagwrap' }, equipOptions.map((t) => el('button', {
          class: 'tag' + (unitUI.equip.includes(t) ? ' is-on' : ''),
          onclick: () => {
            const i = unitUI.equip.indexOf(t);
            if (i >= 0) unitUI.equip.splice(i, 1); else unitUI.equip.push(t);
            rerender();
          },
        }, t))),
        unitUI.equip.length
          ? el('button', { class: 'btn btn-sm', onclick: () => { unitUI.equip = []; rerender(); } }, '解除')
          : null)
      : null,
  );
}

/** いまの条件に合う部屋。keepId は選択中のものを落とさないための逃し口 */
export function filteredUnits(all, keepId = null) {
  return all.filter((x) => x.r.id === keepId || unitMatches(x));
}
