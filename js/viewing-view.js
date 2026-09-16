/**
 * 内見タブ。1つの部屋について、現地で潰すチェックポイントと、見た結果の記録を
 * 1枚にまとめて出す。
 *
 * もとはチェックポイント／記録／指値の3つのサブタブに分けていた。
 * チェックと記録は現地で行き来しながら書くもので、タブを跨ぐ意味がなかった。
 * 指値は「いくらなら返せるか」の話なので、ライフプランに移してある。
 */
import { el, mount, preserveFocus } from './util.js';
import { store } from './store.js';
import { select } from './ui.js';
import { VIEWING_SECTIONS } from './spec.js';
// 絞り込みは一覧・比較・相場と同じもの。タブごとに別の絞り方があると探せない
import { unitFilterBar, unitMatches } from './unit-filter.js';

/** 選んでいる部屋と並び順。保存する値ではないので画面の状態として持つ */
const ui = { roomId: null };

/**
 * 画面の状態。保存する値ではない。
 * 選択中や絞り込みの分岐は描いてみないと未定義参照に気づけないので、
 * tools/smoke.mjs から状態を作れるように出している。
 */
export const viewingUI = ui;

export function renderViewing(root, rerender) {
  const rooms = matching();
  if (!rooms.some((r) => r.id === ui.roomId)) ui.roomId = rooms[0]?.id ?? null;
  const room = ui.roomId ? store.room(ui.roomId) : null;
  const building = room ? store.building(room.buildingId) : null;
  // 入力のたびに描き直すので、打っている欄からフォーカスを外さない
  const mark = () => { store.markDirty(); preserveFocus(rerender); };

  mount(root,
    unitFilterBar(units(), rooms, rerender, { unit: '部屋' }),
    roomPicker(room, rerender),
    room
      ? viewingSection(room, building, mark)
      : el('div', { class: 'empty' }, '部屋を登録すると内見の記録を残せます'),
  );
}

/**
 * 内見で扱えるのは登録した部屋だけ（売り出しの行に内見の記録は持たせられない）。
 * 絞り込みの条件は一覧と共通なので、条件に合う登録済みの部屋を返す。
 */
const units = () => store.rooms.map((r) => ({ r, b: store.building(r.buildingId) }));
const matching = () => units().filter((x) => x.b && unitMatches(x)).map((x) => x.r);

function roomPicker(room, rerender) {
  const options = matching().map((r) =>
    [r.id, `${store.building(r.buildingId)?.name ?? ''} ${r.label}`]);
  if (!options.length) return null;
  return el('div', { class: 'section' },
    el('h3', {}, '内見する部屋'),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-controls' },
        el('div', { class: 'ctlrow' },
          el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '⌂'), '部屋'),
          el('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap' },
            select(room?.id ?? '', options, (v) => { ui.roomId = v; rerender(); }, 'picksel picksel-wide'),
            room
              ? el('a', {
                href: '#', class: 'tiny',
                onclick: (e) => { e.preventDefault(); location.hash = `#/r/${room.id}`; },
              }, '部屋の詳細を見る')
              : null)))));
}

/* ===== 内見（チェックポイントと記録） ===== */

/** 未確認 → 良い → 気になる → 未確認 の順に回す。現地では押す回数が少ないほうがいい */
const NEXT = { undefined: 'ok', ok: 'bad', bad: null };

/**
 * 内見の1画面。上に日付と所感、その下に進み具合、いちばん下にチェックの一覧。
 *
 * 現地では「見て・付けて・書く」を行き来するので、チェックと所感を別の画面に
 * 置くと毎回タブを往復することになる。同じ画面に並べておく。
 */
function viewingSection(room, building, mark) {
  const state = (key) => room.viewingChecks?.[key];
  const counts = { ok: 0, bad: 0 };
  for (const v of Object.values(room.viewingChecks || {})) if (counts[v] != null) counts[v] += 1;
  const bad = Object.entries(room.viewingChecks || {})
    .filter(([, v]) => v === 'bad').map(([k]) => k);

  const item = (key) => {
    const v = state(key);
    return el('button', {
      class: 'vchk' + (v ? ` is-${v}` : ''),
      onclick: () => {
        room.viewingChecks ||= {};
        const next = NEXT[v];
        if (next) room.viewingChecks[key] = next;
        else delete room.viewingChecks[key];
        mark();
      },
    },
    el('span', { class: 'vchk-mark' }, v === 'ok' ? '○' : v === 'bad' ? '△' : ''),
    el('span', { class: 'vchk-label' }, key));
  };

  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, `${building?.name ?? ''} ${room.label} の内見`),
      el('div', { class: 'card', style: 'padding:14px' },
        el('div', { class: 'field' },
          el('label', {}, '内見した日'),
          el('input', {
            type: 'date', value: room.viewingAt ?? '',
            oninput: (e) => { room.viewingAt = e.target.value || null; store.markDirty(); },
          })),
        el('div', { class: 'field wide' },
          el('label', {}, '所感'),
          el('textarea', {
            oninput: (e) => { room.viewingNote = e.target.value; store.markDirty(); },
          }, room.viewingNote ?? '')))),
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-3' },
        kvNum('良い', counts.ok),
        kvNum('気になる', counts.bad),
        kvNum('未確認', totalChecks() - counts.ok - counts.bad)),
      // 気になった点は所感を書くときに見返すので、チェックの一覧より上に出す
      bad.length
        ? el('div', { class: 'vchklist', style: 'margin-top:12px' },
          bad.map((k) => el('span', { class: 'vchk is-bad', style: 'cursor:default' },
            el('span', { class: 'vchk-mark' }, '△'),
            el('span', { class: 'vchk-label' }, k))))
        : null),
    VIEWING_SECTIONS.map(([name, list]) => el('div', { class: 'section' },
      el('h3', {}, name),
      el('div', { class: 'vchklist' }, list.map(item)))),
  );
}

function totalChecks() {
  return VIEWING_SECTIONS.reduce((s, [, list]) => s + list.length, 0);
}

function kvNum(k, n) {
  return el('div', {}, el('div', { class: 'k' }, k), el('div', { class: 'v' }, String(n)));
}
