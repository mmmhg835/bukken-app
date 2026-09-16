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
import { el, mount, fmt, derive, preserveFocus, STATUSES } from './util.js';
import { store } from './store.js';
import { numberInput, select, toggle } from './ui.js';
import { VIEWING_SECTIONS } from './spec.js';

const SUBTABS = [['check', 'チェックポイント'], ['note', '内見の記録'], ['offer', '指値']];

/** 選んでいる部屋と並び順。保存する値ではないので画面の状態として持つ */
const ui = {
  roomId: null,
  sort: { key: 'offer', dir: 'asc' },
  // 物件が増えると全室を並べても読めないので、見る範囲を絞れるようにする
  filter: { status: '', offerOnly: false },
  // 下段で並べて見る部屋。横に16列ある表のままでは2件でも見比べられない
  picked: new Set(),
};

/**
 * 画面の状態。保存する値ではない。
 * 選択中や絞り込みの分岐は描いてみないと未定義参照に気づけないので、
 * tools/smoke.mjs から状態を作れるように出している。
 */
export const viewingUI = ui;

export function renderViewing(root, rerender, view = 'check') {
  const rooms = store.rooms;
  if (!rooms.some((r) => r.id === ui.roomId)) ui.roomId = rooms[0]?.id ?? null;
  const room = ui.roomId ? store.room(ui.roomId) : null;
  const building = room ? store.building(room.buildingId) : null;
  // 入力のたびに描き直すので、打っている欄からフォーカスを外さない
  const mark = () => { store.markDirty(); preserveFocus(rerender); };

  rerenderPicked = rerender;
  mount(root,
    subTabs(view),
    view === 'offer'
      ? offerSection(mark, rerender)
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

function offerSection(mark, rerender) {
  const terms = store.loanTerms;
  const all = store.rooms;
  const shown = all.filter((r) =>
    (!ui.filter.status || r.status === ui.filter.status)
    && (!ui.filter.offerOnly || r.offerPrice != null));
  const rows = shown.map((r) => {
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
  // 並び替え。空の項目は向きに関わらず末尾に送る。
  // 相場や指値が入っていない部屋が上に来ると、比べたい行が押し下げられるため。
  const value = (x, key) => {
    if (key === 'name') return `${x.b?.name ?? ''} ${x.r.label}`;
    if (key === 'age') return x.d.ageYears;
    if (key === 'floor') return x.r.floor;
    if (key === 'area') return x.r.area;
    if (key === 'price') return x.r.price;
    if (key === 'offer') return x.offer ?? x.r.price;
    if (key === 'tsubo') return x.d.tsuboPrice;
    if (key === 'offerTsubo') return x.offerTsubo;
    if (key === 'fees') return x.fees;
    if (key === 'running') return x.d.kanriShuzen;
    for (const [mk] of MARKET_SOURCES) {
      const m = x.r[mk] ?? null;
      if (key === mk) return m;
      if (key === `${mk}:gross`) return m != null && x.d.tsubo ? m * x.d.tsubo : null;
      // 差で並べるときは、売出より指値のほうが判断に使う数字なので指値側を見る
      if (key === `${mk}:gap`) return m != null && x.offerTsubo != null ? m - x.offerTsubo : null;
    }
    return null;
  };
  const { key: sortKey, dir } = ui.sort;
  rows.sort((a, b) => {
    const va = value(a, sortKey); const vb = value(b, sortKey);
    const ea = va == null || Number.isNaN(va); const eb = vb == null || Number.isNaN(vb);
    if (ea || eb) return ea && eb ? 0 : (ea ? 1 : -1);
    if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb, 'ja') : vb.localeCompare(va, 'ja');
    return dir === 'asc' ? va - vb : vb - va;
  });

  // 名前と「安いほうが良い」項目は昇順から、相場や差は大きいほうから見たい
  const ASC_FIRST = new Set(['name', 'age', 'floor', 'price', 'offer', 'tsubo', 'offerTsubo', 'fees', 'running']);
  const sortTh = (key, title, sub, cls = null) => el('th', {
    class: [cls, 'sortable', sortKey === key ? 'is-sorted' : null].filter(Boolean).join(' '),
    onclick: () => {
      ui.sort = sortKey === key
        ? { key, dir: dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: ASC_FIRST.has(key) ? 'asc' : 'desc' };
      rerender();
    },
  }, el('div', { class: 'thsub' },
    el('b', {}, title, el('span', { class: 'sortmark' },
      sortKey === key ? (dir === 'asc' ? '▲' : '▼') : '')),
    el('span', {}, sub)));

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
      el('td', { class: 'lab' },
        el('label', { class: 'pickcell' },
          el('input', {
            type: 'checkbox', checked: ui.picked.has(r.id) ? '' : null,
            onchange: (e) => {
              if (e.target.checked) ui.picked.add(r.id); else ui.picked.delete(r.id);
              rerender();
            },
          }),
          el('span', {}, `${b?.name ?? ''} ${r.label}`))),
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
  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, '指値の検討'),
    el('div', { class: 'toolbar' },
      select(ui.filter.status, [['', 'すべての状態'], ...STATUSES.map((v) => [v, v])],
        (v) => { ui.filter.status = v; rerender(); }),
      toggle('指値を入れた部屋だけ', ui.filter.offerOnly,
        (v) => { ui.filter.offerOnly = v; rerender(); }),
      el('span', { class: 'tiny muted' },
        rows.length === all.length ? `${all.length}室` : `${rows.length} / ${all.length}室`)),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp offertbl' },
        el('thead', {}, el('tr', {},
          sortTh('name', '物件', '', 'lab'),
          sortTh('age', '築年数', ''),
          sortTh('floor', '階', ''),
          sortTh('area', '広さ', ''),
          sortTh('price', '現価格', '売り出し'),
          sortTh('offer', '指値', '万円'),
          sortTh('tsubo', '元坪', '現価格 ÷ 坪'),
          sortTh('offerTsubo', '指値坪', '指値 ÷ 坪'),
          ...MARKET_SOURCES.flatMap(([mk, label]) => [
            sortTh(mk, `${label} 坪`, '万円/坪'),
            sortTh(`${mk}:gross`, `${label} 価格`, '相場坪 × 坪数'),
            sortTh(`${mk}:gap`, `${label}との差`, '＋ほど相場より安い'),
          ]),
          sortTh('fees', '諸費用', `指値の${t0.costRate}%${t0.costFixed ? ` ＋ ${t0.costFixed}万` : ''}`),
          sortTh('running', '管理＋修繕', '月額'),
        )),
        body))),
    pickedCompare(rows),
  );
}

/**
 * 選んだ部屋だけを縦に並べ替えて見比べる。
 * 上の表は列が16本あり、横に流れるので2件でも同時に読めない。
 * 項目を行・物件を列にすれば、件数が増えても見る場所が変わらない。
 */
function pickedCompare(rows) {
  const picked = rows.filter((x) => ui.picked.has(x.r.id));
  if (!picked.length) return null;

  const man = (v) => (v == null ? '—' : `${fmt.man1(Math.round(v))}万`);
  const gapOf = (x, key) => {
    const m = x.r[key] ?? null;
    return m != null && x.offerTsubo != null ? m - x.offerTsubo : null;
  };
  const signed = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '▲'}${fmt.n(Math.abs(v), 0)}万/坪`);

  // [見出し, 表示, 並べ替え用の値, 望ましい向き]。向きが null の行は優劣を付けない
  const lines = [
    ['築年数', (x) => (x.d.ageYears != null ? `築${x.d.ageYears}年` : '—'), (x) => x.d.ageYears, 'low'],
    ['階 / 広さ', (x) => `${x.r.floor ?? '—'}F / ${x.r.area ?? '—'}㎡`, null, null],
    ['現価格', (x) => man(x.r.price), (x) => x.r.price, 'low'],
    ['指値', (x) => man(x.offer), (x) => x.offer, 'low'],
    ['値引き率', (x) => (x.offer == null || !x.r.price ? '—' : `${((1 - x.offer / x.r.price) * 100).toFixed(1)}%`),
      (x) => (x.offer == null || !x.r.price ? null : 1 - x.offer / x.r.price), 'high'],
    ['元坪', (x) => man(x.d.tsuboPrice), (x) => x.d.tsuboPrice, 'low'],
    ['指値坪', (x) => man(x.offerTsubo), (x) => x.offerTsubo, 'low'],
    ...MARKET_SOURCES.flatMap(([mk, label]) => [
      [`${label} 坪`, (x) => man(x.r[mk]), null, null],
      [`${label}との差`, (x) => signed(gapOf(x, mk)), (x) => gapOf(x, mk), 'high'],
    ]),
    ['諸費用', (x) => man(x.fees), (x) => x.fees, 'low'],
    ['管理＋修繕', (x) => (x.d.kanriShuzen != null ? `${fmt.n(x.d.kanriShuzen, 2)}万` : '—'),
      (x) => x.d.kanriShuzen, 'low'],
  ];

  const body = el('tbody', {}, lines.map(([label, show, pick, better]) => {
    let best = null;
    if (pick && better && picked.length > 1) {
      const vs = picked.map(pick).filter((v) => v != null && !Number.isNaN(v));
      if (vs.length) best = better === 'low' ? Math.min(...vs) : Math.max(...vs);
    }
    return el('tr', {},
      el('td', { class: 'lab' }, label),
      ...picked.map((x) => {
        const v = pick ? pick(x) : null;
        const isBest = best != null && v != null && Math.abs(v - best) < 1e-9;
        return el('td', { class: isBest ? 'best' : null }, show(x));
      }));
  }));

  return el('div', { class: 'section' },
    el('h3', {}, `選んだ${picked.length}件を並べる`),
    el('div', { class: 'toolbar' },
      el('button', {
        class: 'btn btn-sm',
        onclick: () => { ui.picked.clear(); rerenderPicked(); },
      }, '選択を解除')),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'lab' }, '項目'),
          ...picked.map((x) => el('th', {}, `${x.b?.name ?? ''} ${x.r.label}`)))),
        body)));
}

/** 選択解除だけのために画面全体を描き直す */
let rerenderPicked = () => {};

