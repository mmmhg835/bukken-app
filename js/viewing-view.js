/**
 * 内見タブ。
 *
 * チェックポイント（現地で潰す）／記録（見た結果）／指値（いくらで出すか）の3段。
 * 別タブに切り出さずサブタブにしているのは、対象の部屋という前提を共有するため。
 *
 * 指値の表は、価格・面積・階・築年数・管理費・修繕積立金をすべて登録済みの
 * 部屋から引く。売り出し価格が動いたときに直す場所を2か所にしないため、
 * ここで手入力するのは指値と相場坪単価（掲載サイトの外から持ってくる値）だけ。
 */
import { el, mount, fmt, derive, preserveFocus } from './util.js';
import { store } from './store.js';
import { numberInput, select } from './ui.js';
import { VIEWING_SECTIONS } from './spec.js';

const SUBTABS = [['check', 'チェックポイント'], ['note', '内見の記録'], ['offer', '指値']];

/** 選んでいる部屋。保存する値ではないので画面の状態として持つ */
const ui = { roomId: null };

export function renderViewing(root, rerender, view = 'check') {
  const rooms = store.rooms;
  if (!rooms.some((r) => r.id === ui.roomId)) ui.roomId = rooms[0]?.id ?? null;
  const room = ui.roomId ? store.room(ui.roomId) : null;
  const building = room ? store.building(room.buildingId) : null;
  // 入力のたびに描き直すので、打っている欄からフォーカスを外さない
  const mark = () => { store.markDirty(); preserveFocus(rerender); };

  mount(root,
    subTabs(view),
    view === 'offer'
      ? offerSection(mark)
      : el('div', {},
        roomPicker(room, rerender),
        room
          ? (view === 'note' ? noteSection(room, building) : checkSection(room, mark))
          : el('div', { class: 'empty' }, '部屋を登録すると内見の記録を残せます')),
  );
}

function subTabs(current) {
  return el('nav', { class: 'subtabs' }, SUBTABS.map(([key, label]) =>
    el('button', {
      class: 'subtab' + (key === current ? ' is-active' : ''),
      onclick: () => { location.hash = key === 'check' ? '#/viewing' : `#/viewing/${key}`; },
    }, label)));
}

function roomPicker(room, rerender) {
  const options = store.buildings.flatMap((b) =>
    store.roomsOf(b.id).map((r) => [r.id, `${b.name} ${r.label}`]));
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

/* ===== チェックポイント ===== */

/** 未確認 → 良い → 気になる → 未確認 の順に回す。現地では押す回数が少ないほうがいい */
const NEXT = { undefined: 'ok', ok: 'bad', bad: null };

function checkSection(room, mark) {
  const state = (key) => room.viewingChecks?.[key];
  const counts = { ok: 0, bad: 0 };
  for (const v of Object.values(room.viewingChecks || {})) if (counts[v] != null) counts[v] += 1;

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
      el('div', { class: 'calcgrid calcgrid-3' },
        kvNum('良い', counts.ok),
        kvNum('気になる', counts.bad),
        kvNum('未確認', totalChecks() - counts.ok - counts.bad))),
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

/* ===== 内見の記録 ===== */
function noteSection(room, building) {
  const bad = Object.entries(room.viewingChecks || {})
    .filter(([, v]) => v === 'bad').map(([k]) => k);

  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, `${building?.name ?? ''} ${room.label}`),
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
      el('h3', {}, '気になった点'),
      bad.length
        ? el('div', { class: 'vchklist' },
          bad.map((k) => el('span', { class: 'vchk is-bad', style: 'cursor:default' },
            el('span', { class: 'vchk-mark' }, '△'),
            el('span', { class: 'vchk-label' }, k))))
        : el('div', { class: 'empty' }, 'チェックポイントで「気になる」を付けるとここに集まります')),
  );
}

/* ===== 指値 ===== */
function offerSection(mark) {
  const terms = store.loanTerms;
  const rows = store.rooms.map((r) => {
    const b = store.building(r.buildingId);
    const d = derive(r, b, terms);
    const offer = r.offerPrice ?? null;
    const offerTsubo = offer != null && d.tsubo ? offer / d.tsubo : null;
    const market = r.marketTsubo ?? null;
    // 相場はグロスでも坪単価でも入れられるようにするが、持つのは坪単価だけ。
    // 両方を保存すると、面積を直したときに片方だけ古いままになる。
    const marketGross = market != null && d.tsubo ? market * d.tsubo : null;
    return {
      r, b, d, offer, offerTsubo, market, marketGross,
      gap: market != null && offerTsubo != null ? market - offerTsubo : null,
    };
  });
  // 指値（無ければ売り出し価格）の安い順。いくらで出すかを上から並べて見る
  rows.sort((a, b) => (a.offer ?? a.r.price ?? 0) - (b.offer ?? b.r.price ?? 0));

  const oku = (v) => (v == null ? '—' : `${(v / 10000).toFixed(3)}億`);
  const man = (v) => (v == null ? '—' : `${fmt.man1(Math.round(v))}万`);

  const body = el('tbody', {}, rows.map(({ r, b, d, offer, offerTsubo, market, marketGross, gap }) => el('tr', {},
    el('td', { class: 'lab' }, `${b?.name ?? ''} ${r.label}`),
    el('td', {}, d.ageYears != null ? `築${d.ageYears}年` : '—'),
    el('td', {}, r.floor != null ? `${r.floor}F` : '—'),
    el('td', {}, r.area != null ? `${r.area}㎡` : '—'),
    el('td', {}, oku(r.price)),
    el('td', { class: 'inputcell' }, numberInput({
      value: offer, cls: 'lpitem-input', fkey: `offer-${r.id}`,
      onInput: (num) => { r.offerPrice = num; mark(); },
    })),
    el('td', { class: 'muted' }, man(d.tsuboPrice)),
    el('td', { class: offerTsubo != null ? 'best' : 'muted' }, man(offerTsubo)),
    el('td', { class: 'inputcell' }, numberInput({
      value: market == null ? null : Number(market.toFixed(1)),
      cls: 'lpitem-input', fkey: `market-${r.id}`,
      onInput: (num) => { r.marketTsubo = num; mark(); },
    })),
    el('td', { class: 'inputcell' }, d.tsubo
      ? numberInput({
        value: marketGross == null ? null : Math.round(marketGross),
        cls: 'lpitem-input', fkey: `mgross-${r.id}`,
        onInput: (num) => { r.marketTsubo = num == null ? null : num / d.tsubo; mark(); },
      })
      : el('span', { class: 'muted' }, '—')),
    el('td', { class: gap == null ? 'muted' : gap >= 0 ? 'pos' : 'neg' },
      gap == null ? '—' : `${gap >= 0 ? '+' : '▲'}${fmt.n(Math.abs(gap), 0)}万/坪`),
    el('td', {}, d.kanriShuzen != null ? `${fmt.n(d.kanriShuzen, 2)}万` : '—'),
  )));

  return el('div', { class: 'section' },
    el('h3', {}, '指値の検討'),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp offertbl' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'lab' }, '物件'),
          el('th', {}, '築年数'),
          el('th', {}, '階'),
          el('th', {}, '広さ'),
          el('th', {}, thSub('現価格', '売り出し')),
          el('th', {}, thSub('指値', '万円')),
          el('th', {}, thSub('元坪', '現価格 ÷ 坪')),
          el('th', {}, thSub('指値坪', '指値 ÷ 坪')),
          el('th', {}, thSub('相場坪', '万円/坪')),
          el('th', {}, thSub('相場価格', '相場坪 × 坪数')),
          el('th', {}, thSub('相場との差', '相場坪 − 指値坪')),
          el('th', {}, thSub('管理＋修繕', '月額')),
        )),
        body)),
  );
}

/** 列見出しに算式を小さく添える。別途の説明文を置かずに済ませる */
function thSub(title, sub) {
  return el('div', { class: 'thsub' }, el('b', {}, title), el('span', {}, sub));
}
