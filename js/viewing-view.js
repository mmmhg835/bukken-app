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

/**
 * 相場の出どころ。同じ住戸でもサイトによって値が違うので、どちらと比べたのかを
 * 残せるように枠を分けている。持つのは坪単価だけで、グロスは坪数から都度出す。
 */
const MARKET_SOURCES = [['marketIsoge', 'ISOGE'], ['marketMrev', 'マンレビ']];

function offerSection(mark) {
  const terms = store.loanTerms;
  const rows = store.rooms.map((r) => {
    const b = store.building(r.buildingId);
    const d = derive(r, b, terms);
    const t = { ...terms, ...(r.loan || {}) };
    const offer = r.offerPrice ?? null;
    const base = offer ?? r.price ?? null;
    return {
      r, b, d, t, offer,
      offerTsubo: offer != null && d.tsubo ? offer / d.tsubo : null,
      // 諸費用は指値に対して出す。指値がまだ無い部屋は売り出し価格で見る
      fees: base == null ? null : (base * (Number(t.costRate) || 0)) / 100 + (Number(t.costFixed) || 0),
      feesOnOffer: offer != null,
    };
  });
  // 指値（無ければ売り出し価格）の安い順。いくらで出すかを上から並べて見る
  rows.sort((a, b) => (a.offer ?? a.r.price ?? 0) - (b.offer ?? b.r.price ?? 0));

  const oku = (v) => (v == null ? '—' : `${(v / 10000).toFixed(3)}億`);
  const man = (v) => (v == null ? '—' : `${fmt.man1(Math.round(v))}万`);
  const signed = (v) => (v == null
    ? el('span', { class: 'muted' }, '—')
    : el('span', { class: v >= 0 ? 'pos' : 'neg' }, `${v >= 0 ? '+' : '▲'}${fmt.n(Math.abs(v), 0)}`));

  /** 相場1つ分のセル3つ。坪単価・グロス・差（売出と指値）を並べる */
  const marketCells = ({ r, d, offerTsubo }, key) => {
    const m = r[key] ?? null;
    const gross = m != null && d.tsubo ? m * d.tsubo : null;
    return [
      el('td', { class: 'inputcell' }, numberInput({
        value: m == null ? null : Number(m.toFixed(1)),
        cls: 'lpitem-input', fkey: `${key}-${r.id}`,
        onInput: (num) => { r[key] = num; mark(); },
      })),
      el('td', { class: 'inputcell' }, d.tsubo
        ? numberInput({
          value: gross == null ? null : Math.round(gross),
          cls: 'lpitem-input', fkey: `${key}g-${r.id}`,
          onInput: (num) => { r[key] = num == null ? null : num / d.tsubo; mark(); },
        })
        : el('span', { class: 'muted' }, '—')),
      el('td', {},
        el('div', { class: 'diffline' }, el('span', { class: 'dk' }, '売出'),
          signed(m != null && d.tsuboPrice != null ? m - d.tsuboPrice : null)),
        el('div', { class: 'diffline' }, el('span', { class: 'dk' }, '指値'),
          signed(m != null && offerTsubo != null ? m - offerTsubo : null))),
    ];
  };

  const body = el('tbody', {}, rows.map((row) => {
    const { r, b, d, t, offer, offerTsubo, fees, feesOnOffer } = row;
    return el('tr', {},
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
      ...MARKET_SOURCES.flatMap(([key]) => marketCells(row, key)),
      el('td', { class: feesOnOffer ? null : 'muted' }, man(fees)),
      el('td', {}, d.kanriShuzen != null ? `${fmt.n(d.kanriShuzen, 2)}万` : '—'),
    );
  }));

  const t0 = store.loanTerms;
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
          ...MARKET_SOURCES.flatMap(([, label]) => [
            el('th', {}, thSub(`${label} 坪`, '万円/坪')),
            el('th', {}, thSub(`${label} 価格`, '相場坪 × 坪数')),
            el('th', {}, thSub(`${label}との差`, '＋ほど相場より安い')),
          ]),
          el('th', {}, thSub('諸費用', `指値の${t0.costRate}%${t0.costFixed ? ` ＋ ${t0.costFixed}万` : ''}`)),
          el('th', {}, thSub('管理＋修繕', '月額')),
        )),
        body)),
  );
}

/** 列見出しに算式を小さく添える。別途の説明文を置かずに済ませる */
function thSub(title, sub) {
  return el('div', { class: 'thsub' }, el('b', {}, title), el('span', {}, sub));
}
