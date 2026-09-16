// 一覧・比較・ライフプランで共通に使う絞り込み。
// 相場タブと同じ軸・同じ見た目にしてあるので、どの画面でも同じ感覚で探せる。
// 対象は allUnits()（売り出し中の部屋＋登録した部屋）。
import { el, STATUSES } from './util.js';
import { select, numberInput } from './ui.js';
import { areaOf } from './analysis.js';
import { CLOSED_STATUS } from './price.js';
import {
  AGE_BANDS, WALK_BANDS, FIRM_KEYS, FIRM_LABEL,
  stationsOf, ageOf, walkOf, inBand, options, layoutLabel, nameHit,
} from './units.js';

// 検討の軸。「自分の物件」という区分は持たない。
// 売り出し中かどうかは募集状況で、ガチで検討しているかは登録とステータスで見る
// 「登録した部屋」は検討ステータスと中身がほぼ同じで、どちらを選べばいいのか
// 分からなくなっていた。登録した部屋は必ずどれかのステータスを持つので、
// ステータスだけを出す（登録していない売り出しは、どれを選んでも出ない）
export const OWN_OPTIONS = [['all', 'すべて'], ...STATUSES.map((x) => [x, x])];

/**
 * 絞り込みの状態。画面をまたいで共有するので、一覧で絞れば比較にもそのまま効く。
 *
 * unitUI は「いま効いている条件」、draft は「入力中の条件」。
 * 選んだ瞬間に一覧が変わると、何を変えたのか分からなくなるため、
 * 検索ボタンを押したときに draft を unitUI に写す。
 */
export const unitUI = {
  // 募集状況の既定は「募集中」。終わった部屋まで並べると、比較もライフプランも意味が薄れる
  listing: 'open',
  own: 'all',
  // 建物名・住所・駅名の文字でも絞れるようにする。件数が増えると選択肢から探せない
  name: '',
  // 建物の条件。area は最寄駅、town は町名
  area: 'all', town: 'all', age: 'all', walk: 'all',
  brand: 'all', developer: 'all', builder: 'all', designer: 'all',
  // 部屋の条件。価格と広さは自分で下限・上限を入れる（決め打ちの帯だと刻みが合わない）
  layout: 'all',
  priceMin: null, priceMax: null, areaMin: null, areaMax: null,
  more: false, equip: [],
};

/** 入力中の条件。検索を押すまで一覧には効かない */
export const draft = {};

const KEYS = () => Object.keys(unitUI).filter((k) => k !== 'more');
// 「リセット」で戻す先。読み込み時の値をそのまま覚えておく
const DEFAULTS = JSON.parse(JSON.stringify(unitUI));
/** 入力中の条件を、いま効いている条件に戻す */
export function resetDraft() {
  for (const k of KEYS()) draft[k] = Array.isArray(unitUI[k]) ? [...unitUI[k]] : unitUI[k];
}
/** 入力中の条件を効かせる */
export function applyDraft() {
  for (const k of KEYS()) unitUI[k] = Array.isArray(draft[k]) ? [...draft[k]] : draft[k];
}
/** 条件をすべて外して効かせる */
export function clearDraft() {
  for (const k of KEYS()) draft[k] = Array.isArray(DEFAULTS[k]) ? [...DEFAULTS[k]] : DEFAULTS[k];
  applyDraft();
}

/** 入力中の条件と、いま効いている条件が違うか */
export function draftDirty() {
  return KEYS().some((k) => String(unitUI[k]) !== String(draft[k]));
}
resetDraft();

/** 下限〜上限に入るか。入れていない側は効かない。値が無い部屋は範囲を指定したら外す */
export function inRange(v, min, max) {
  if (min == null && max == null) return true;
  if (v == null) return false;
  if (min != null && v < min) return false;
  if (max != null && v > max) return false;
  return true;
}

/**
 * 1部屋がいまの条件に合うか。
 * except を渡すとその条件だけ外して判定する（選択肢を連動させるために使う）。
 */
export function unitMatches({ r, b }, except = null, f = unitUI) {
  if (!b) return false;
  const on = (key) => key !== except;
  if (on('own') && f.own !== 'all') {
    // 売り出しの行そのままの部屋は、まだ検討ステータスを持っていない
    if (r.fromListing || r.status !== f.own) return false;
  }
  if (on('listing') && f.listing !== 'all') {
    const closed = CLOSED_STATUS.includes(r.listingStatus);
    if (f.listing === 'open' && closed) return false;
    if (f.listing === 'closed' && !closed) return false;
  }
  if (on('name') && f.name && !nameHit(b, f.name)) return false;
  if (on('area') && f.area !== 'all' && !stationsOf(b).includes(f.area)) return false;
  if (on('town') && f.town !== 'all' && areaOf(b).town !== f.town) return false;
  for (const k of FIRM_KEYS) {
    if (on(k) && unitUI[k] !== 'all' && (b[k] || '').trim() !== unitUI[k]) return false;
  }
  if (on('age') && !inBand(f.age, ageOf(b))) return false;
  if (on('walk') && !inBand(f.walk, walkOf(b))) return false;
  if (on('layout') && f.layout !== 'all' && layoutLabel(r.layout) !== f.layout) return false;
  if (on('size') && !inRange(r.area, f.areaMin, f.areaMax)) return false;
  if (on('price') && !inRange(r.price, f.priceMin, f.priceMax)) return false;
  if (on('equip') && f.equip.length) {
    const tags = [...(r.roomEquipmentTags || []), ...(b.equipmentTags || []),
      ...(b.facilityTags || [])];
    if (!f.equip.every((t) => tags.includes(t))) return false;
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
  const dirty = draftDirty();
  const pick = (key, list) =>
    select(draft[key], [['all', 'すべて'], ...list], (v) => { draft[key] = v; rerender(); }, 'fsel');
  const band = (key, list) =>
    select(draft[key], list, (v) => { draft[key] = v; rerender(); }, 'fsel');
  const group = (label, ctrl) => el('div', { class: 'fgroup' }, el('label', {}, label), ctrl);
  const range = (minKey, maxKey, unitLabel) => el('div', { class: 'frange' },
    numberInput({
      value: draft[minKey] ?? '', fkey: minKey, cls: 'fnum', placeholder: '下限',
      onInput: (v) => { draft[minKey] = v; },
    }),
    el('span', {}, '〜'),
    numberInput({
      value: draft[maxKey] ?? '', fkey: maxKey, cls: 'fnum', placeholder: '上限',
      onInput: (v) => { draft[maxKey] = v; },
    }),
    el('span', { class: 'tiny muted' }, unitLabel));

  // 選択肢は「その条件だけ外した結果」から作る。1つ選ぶと他の選択肢も連動して減る
  const pool = (key) => all.filter((x) => unitMatches(x, key, draft));
  const buildings = (key) => {
    const seen = new Map();
    for (const x of pool(key)) seen.set(x.b.id, x.b);
    return [...seen.values()];
  };

  const equipOptions = [...new Set(buildings('equip')
    .flatMap((b) => [...(b.equipmentTags || []), ...(b.facilityTags || [])])
    .concat(pool('equip').flatMap((x) => x.r.roomEquipmentTags || [])))].sort();

  // よく使う条件だけ出し、残りは「条件を増やす」の中へ。
  // 13個を並べると、どれがどこにあるか探す画面になってしまう
  const open = unitUI.more;
  return el('div', { class: 'filterbar' + (dirty ? ' is-dirty' : '') },
    el('div', { class: 'filterbar-row' },
      lead,
      group('建物名', el('input', {
        class: 'ftext', type: 'search', placeholder: '建物名・住所・駅',
        value: draft.name, 'data-fkey': 'unit-name',
        oninput: (e) => { draft.name = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter') { applyDraft(); rerender(); } },
      })),
      group('募集状況', band('listing',
        [['open', '募集中'], ['closed', '募集終了'], ['all', 'すべて']])),
      // 自分が登録した部屋だけを見る使い方が多いので、これは畳まない
      group('検討', band('own', OWN_OPTIONS)),
      group('エリア（最寄駅）', pick('area', options(buildings('area').flatMap(stationsOf)))),
      group('間取り', pick('layout', options(pool('layout').map((x) => layoutLabel(x.r.layout))))),
      group('価格', range('priceMin', 'priceMax', '万円')),
      group('広さ', range('areaMin', 'areaMax', '㎡')),
      el('button', {
        class: 'btn btn-sm fmore' + (open ? ' is-on' : ''),
        onclick: () => { unitUI.more = !open; rerender(); },
      }, `${open ? '条件を隠す' : '条件を増やす'}${extraCount() ? `（${extraCount()}）` : ''}`),
      searchButton(rerender),
    ),
    open
      ? el('div', { class: 'filterbar-row is-more' },
        group('住所', pick('town', options(buildings('town').map((b) => areaOf(b).town)))),
        group('築年数', band('age', AGE_BANDS)),
        group('駅徒歩', band('walk', WALK_BANDS)),
        FIRM_KEYS.map((k) => group(FIRM_LABEL[k],
          pick(k, options(buildings(k).map((b) => (b[k] || '').trim()))))),
      )
      : null,
    open && equipOptions.length
      ? el('div', { class: 'filterbar-row is-more' },
        el('label', { class: 'flabel' }, '設備'),
        el('div', { class: 'tagwrap' }, equipOptions.map((x) => el('button', {
          class: 'tag' + (draft.equip.includes(x) ? ' is-on' : ''),
          onclick: () => {
            const i = draft.equip.indexOf(x);
            if (i >= 0) draft.equip.splice(i, 1); else draft.equip.push(x);
            rerender();
          },
        }, x))))
      : null,
    // いま効いている条件と件数。何で絞れているのかを一目で分かるようにする
    el('div', { class: 'filterbar-row is-foot' },
      el('span', { class: 'fcount' }, `${shown.length.toLocaleString('ja-JP')}件の${unit}`),
      activeChips(rerender),
      el('div', { class: 'spacer' }),
      trail,
    ),
  );
}

/** 「条件を増やす」の中で、いくつ使われているか */
function extraCount() {
  const keys = ['town', 'age', 'walk', ...FIRM_KEYS];
  return keys.filter((k) => draft[k] !== 'all').length + (draft.equip.length ? 1 : 0);
}

/**
 * いま効いている条件を並べる。絞り込みバーのチップにも、一括出力の見出しにも使う。
 * keys はその条件を外すときに戻すキー、clear は戻す値。
 */
export function activeUnitConditions() {
  const label = {
    name: '建物名', listing: '募集状況', own: '検討', area: 'エリア', town: '住所', age: '築年数',
    walk: '駅徒歩', layout: '間取り', brand: 'ブランド', developer: '分譲',
    builder: '施工', designer: '設計',
  };
  const out = [];
  for (const [k, name] of Object.entries(label)) {
    if (unitUI[k] === 'all' || unitUI[k] == null || unitUI[k] === '') continue;
    if (k === 'listing' && unitUI.listing === 'open') continue;   // 既定なので出さない
    const shown = k === 'age' || k === 'walk'
      ? (AGE_BANDS.concat(WALK_BANDS).find(([v]) => v === unitUI[k]) || [])[1] || unitUI[k]
      : k === 'own'
        ? (OWN_OPTIONS.find(([v]) => v === unitUI[k]) || [])[1] || unitUI[k]
        : unitUI[k];
    out.push({ name, value: String(shown), keys: [k], clear: k === 'name' ? '' : 'all' });
  }
  const money = (v) => Number(v).toLocaleString('ja-JP');
  if (unitUI.priceMin != null || unitUI.priceMax != null) {
    out.push({
      name: '価格',
      value: `${unitUI.priceMin != null ? money(unitUI.priceMin) : ''}〜`
        + `${unitUI.priceMax != null ? money(unitUI.priceMax) : ''}万円`,
      keys: ['priceMin', 'priceMax'],
      clear: null,
    });
  }
  if (unitUI.areaMin != null || unitUI.areaMax != null) {
    out.push({
      name: '広さ',
      value: `${unitUI.areaMin ?? ''}〜${unitUI.areaMax ?? ''}㎡`,
      keys: ['areaMin', 'areaMax'],
      clear: null,
    });
  }
  for (const e of unitUI.equip) {
    out.push({ name: '設備', value: e, keys: ['equip'], clear: e });
  }
  return out;
}

/** いま効いている条件。押すとその条件だけ外れる */
function activeChips(rerender) {
  const list = activeUnitConditions();
  if (!list.length) return null;
  const off = (c) => () => {
    if (c.keys[0] === 'equip') draft.equip = draft.equip.filter((x) => x !== c.clear);
    else for (const k of c.keys) draft[k] = c.clear;
    applyDraft();
    rerender();
  };
  return el('div', { class: 'fchips' },
    list.map((c) => el('button', { class: 'fchip', onclick: off(c) },
      `${c.name}：${c.value}`, el('i', {}, '×'))));
}

/**
 * 検索ボタン。条件を選んだ時点では一覧を変えず、これを押して初めて効かせる。
 * 選ぶそばから結果が入れ替わると、何を変えたのか分からなくなるため。
 */
function searchButton(rerender) {
  const dirty = draftDirty();
  return el('div', { class: 'fsearch' },
    dirty ? el('span', { class: 'tiny', style: 'color:var(--warn)' }, '条件が未反映') : null,
    el('button', {
      class: 'btn btn-sm' + (dirty ? ' btn-primary' : ''),
      onclick: () => { applyDraft(); rerender(); },
    }, 'この条件で検索'),
    el('button', {
      class: 'btn btn-sm',
      // 直している途中なら元に戻す、そうでなければ条件を全部外す
      onclick: () => { if (dirty) resetDraft(); else clearDraft(); rerender(); },
    }, dirty ? '戻す' : 'リセット'),
  );
}

/** いまの条件に合う部屋。keepId は選択中のものを落とさないための逃し口 */
export function filteredUnits(all, keepId = null) {
  return all.filter((x) => x.r.id === keepId || unitMatches(x));
}
