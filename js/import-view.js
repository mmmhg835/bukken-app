// 掲載ページのテキストを貼り付けて項目を起こす画面。
//
// 解析そのものは parse.js（DOM に触らない純関数）に置き、ここは
// 「どこへ入れるか」と「どれを入れるか」を選ばせることだけを受け持つ。
import { store } from './store.js';
import { el, fmt, toast, mount } from './util.js';
import { select, section } from './ui.js';
import { parseListing } from './parse.js';
import { today } from './price.js';
import { SPEC_GROUPS } from './spec.js';
import { go } from './views.js';

/** 画面を離れても貼り付けた内容を残す。戻ってやり直すことが多いため */
const ui = {
  text: '',
  buildingId: 'new',
  roomId: 'new',
  choice: new Map(),   // キー → 取り込むか。既定から変えたものだけを持つ
  tagOff: new Set(),
  memoOn: false,
};

let parsed = { items: [], tags: [], leftovers: [], url: null };

export function renderImport(root) {
  parsed = parseListing(ui.text);

  const body = el('div');
  const count = el('span', { class: 'tiny muted' });
  const paint = () => {
    count.textContent = `${parsed.items.length}項目`;
    mount(body, targetCard(paint), reviewCard(paint));
  };
  paint();

  const ta = el('textarea', {
    class: 'pastebox', rows: 10, spellcheck: 'false',
    placeholder: '掲載ページの表をコピーして貼り付け',
    oninput: (e) => { ui.text = e.target.value; parsed = parseListing(ui.text); paint(); },
  }, ui.text);

  mount(root,
    el('button', { class: 'back', onclick: () => go('list') }, '‹ 一覧へ戻る'),
    el('div', { class: 'detail-head' }, el('h2', {}, '貼り付けて取り込む')),
    el('div', { class: 'card', style: 'padding:14px' },
      ta,
      el('div', { class: 'toolbar', style: 'margin-top:10px' },
        el('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            try {
              ta.value = ui.text = await navigator.clipboard.readText();
              parsed = parseListing(ui.text); paint();
            } catch { toast('クリップボードを読めませんでした。貼り付けてください。', true); }
          },
        }, 'クリップボードから'),
        ui.text
          ? el('button', {
            class: 'btn btn-sm',
            onclick: () => { ta.value = ui.text = ''; parsed = parseListing(''); paint(); },
          }, '消す')
          : null,
        el('div', { class: 'spacer' }),
        count,
      )),
    body,
  );
}

/* =========================================================
   取り込み先
   ========================================================= */
function targetCard(paint) {
  const buildings = store.buildings;
  const rooms = ui.buildingId === 'new' ? [] : store.roomsOf(ui.buildingId);
  if (ui.roomId !== 'new' && !rooms.some((r) => r.id === ui.roomId)) ui.roomId = 'new';

  return section('取り込み先',
    el('div', { class: 'card form' },
      el('div', { class: 'field' },
        el('label', {}, '建物'),
        select(ui.buildingId,
          [['new', '新しい建物'], ...buildings.map((b) => [b.id, b.name || '(名称未設定)'])],
          (v) => { ui.buildingId = v; ui.roomId = 'new'; ui.choice.clear(); paint(); })),
      el('div', { class: 'field' },
        el('label', {}, '部屋'),
        select(ui.roomId,
          [['new', '新しい部屋'], ...rooms.map((r) => [r.id, r.label || '(部屋)'])],
          (v) => { ui.roomId = v; ui.choice.clear(); paint(); })),
    ));
}

const targetBuilding = () => (ui.buildingId === 'new' ? null : store.building(ui.buildingId));
const targetRoom = () => (ui.roomId === 'new' ? null : store.room(ui.roomId));
const targetOf = (on) => (on === 'building' ? targetBuilding() : targetRoom());

/* =========================================================
   取り込む内容の確認
   ========================================================= */

/** 既存の値を消さないよう、値が入っている項目は既定で取り込まない */
function defaultOn(item) {
  const t = targetOf(item.on);
  if (!t) return true;
  const cur = t[item.key];
  if (cur === null || cur === undefined || cur === '') return true;
  return String(cur) === String(item.value);
}

const keyOf = (item) => `${item.on}.${item.key}`;
const isOn = (item) => ui.choice.get(keyOf(item)) ?? defaultOn(item);

function reviewCard(paint) {
  if (!ui.text.trim()) return null;
  if (!parsed.items.length && !parsed.tags.length) {
    return el('div', { class: 'empty' }, '取り込める項目が見つかりませんでした');
  }

  const groups = [
    ['建物', parsed.items.filter((i) => i.on === 'building')],
    ['部屋', parsed.items.filter((i) => i.on === 'room')],
  ];

  const setAll = (on) => {
    for (const item of parsed.items) ui.choice.set(keyOf(item), on);
    ui.tagOff.clear();
    if (!on) for (const g of parsed.tags) for (const t of g.tags) ui.tagOff.add(`${g.key}.${t}`);
    paint();
  };

  const count = parsed.items.filter(isOn).length;

  return el('div', {},
    section('取り込む項目',
      el('div', { class: 'toolbar' },
        el('span', { class: 'tiny muted' }, `${count} / ${parsed.items.length} 項目`),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn btn-sm', onclick: () => setAll(true) }, 'すべて'),
        el('button', { class: 'btn btn-sm', onclick: () => setAll(false) }, '解除'),
      ),
      el('div', { class: 'card', style: 'padding:14px' },
        groups.map(([name, items]) => (items.length
          ? el('div', { class: 'impgroup' },
            el('h4', {}, name),
            el('div', { class: 'imphead' },
              el('span', {}), el('span', {}, '項目'), el('span', {}, '取り込む値'), el('span', {}, '現在の値')),
            items.map((item) => itemRow(item, paint)),
          )
          : null)),
        priceHistoryRow(paint),
      )),
    tagSection(paint),
    memoSection(paint),
    el('div', { class: 'toolbar', style: 'margin:16px 0 40px' },
      el('button', {
        class: 'btn btn-primary', disabled: !count && !acceptedTags().length,
        onclick: () => apply(),
      }, '取り込む'),
    ),
  );
}

function itemRow(item, paint) {
  const t = targetOf(item.on);
  const cur = t ? t[item.key] : null;
  const on = isOn(item);

  return el('label', { class: 'improw' + (on ? '' : ' is-off') },
    el('input', {
      type: 'checkbox', checked: on,
      onchange: (e) => { ui.choice.set(keyOf(item), e.target.checked); paint(); },
    }),
    el('span', { class: 'improw-key' }, item.title),
    el('span', { class: 'improw-val' }, show(item.value)),
    el('span', { class: 'improw-cur' }, cur === null || cur === undefined || cur === '' ? '—' : show(cur)),
  );
}

const show = (v) => (typeof v === 'number' ? fmt.n(v, 2) : String(v));

/**
 * 価格と登録日が取れたら、価格推移にも1行足せるようにする。
 * 値下げの経緯が残らないと指値の判断材料にならないため、ここで作っておきたい。
 */
function priceHistoryEntry() {
  const price = parsed.items.find((i) => i.on === 'room' && i.key === 'price');
  if (!price || !isOn(price)) return null;
  const listed = parsed.items.find((i) => i.on === 'room' && i.key === 'listedAt');
  const r = targetRoom();
  const h = (r?.priceHistory || []).filter((x) => x.date && x.price != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = h[h.length - 1];
  if (last && last.price === price.value) return null;
  return {
    date: (isOn0(listed) && listed?.value) || (h.length ? today() : r?.listedAt || today()),
    price: price.value,
    note: h.length ? '取り込み' : '登録時',
  };
}

const isOn0 = (item) => (item ? isOn(item) : false);
const HIST_KEY = 'room.__priceHistory';

function priceHistoryRow(paint) {
  const entry = priceHistoryEntry();
  if (!entry) return null;
  const on = ui.choice.get(HIST_KEY) ?? true;
  const r = targetRoom();
  const n = (r?.priceHistory || []).length;

  return el('div', { class: 'impgroup' },
    el('h4', {}, '価格の推移'),
    el('label', { class: 'improw' + (on ? '' : ' is-off') },
      el('input', {
        type: 'checkbox', checked: on,
        onchange: (e) => { ui.choice.set(HIST_KEY, e.target.checked); paint(); },
      }),
      el('span', { class: 'improw-key' }, entry.note),
      el('span', { class: 'improw-val' }, `${entry.date}　${fmt.man1(entry.price)}万円`),
      el('span', { class: 'improw-cur' }, n ? `${n}件` : '—'),
    ));
}

/* ===== 設備タグ ===== */
function acceptedTags() {
  const out = [];
  for (const g of parsed.tags) {
    const tags = g.tags.filter((t) => !ui.tagOff.has(`${g.key}.${t}`));
    if (tags.length) out.push({ ...g, tags });
  }
  return out;
}

function tagSection(paint) {
  if (!parsed.tags.length) return null;
  return section('見つかった設備',
    el('div', { class: 'card', style: 'padding:14px' },
      parsed.tags.map((g) => el('div', { class: 'specgroup' },
        el('h4', {}, SPEC_GROUPS[g.key]?.label || g.key),
        el('div', { class: 'tagwrap' }, g.tags.map((t) => {
          const id = `${g.key}.${t}`;
          const owner = targetOf(g.on);
          const already = (owner?.[g.key] || []).includes(t);
          const chip = el('button', {
            type: 'button', class: 'tag' + (ui.tagOff.has(id) ? '' : ' is-on'),
            title: already ? '登録済み' : '',
            onclick: () => {
              if (ui.tagOff.has(id)) ui.tagOff.delete(id); else ui.tagOff.add(id);
              paint();
            },
          }, already ? `${t} ✓` : t);
          return chip;
        }))))));
}

/* ===== 保存先の無い項目 ===== */
function memoSection(paint) {
  if (!parsed.leftovers.length) return null;
  return section('取り込み先のない項目',
    el('div', { class: 'card', style: 'padding:14px' },
      el('label', { class: 'improw' + (ui.memoOn ? '' : ' is-off') },
        el('input', {
          type: 'checkbox', checked: ui.memoOn,
          onchange: (e) => { ui.memoOn = e.target.checked; paint(); },
        }),
        el('span', { class: 'improw-key' }, '部屋のメモに追記'),
        el('span', { class: 'improw-val' }, `${parsed.leftovers.length}件`),
        el('span', { class: 'improw-cur' }, ''),
      ),
      el('div', { class: 'tiny muted', style: 'margin-top:8px;line-height:1.9' },
        parsed.leftovers.map((l) => el('div', {}, `${l.label}：${l.value}`))),
    ));
}

/* =========================================================
   取り込みの実行
   ========================================================= */

/**
 * 選んだ内容を建物と部屋へ書き込む。
 * store に触らない純粋な合成にしてあるので、tools/smoke.mjs から直接検証できる。
 */
export function mergeInto(b, r, { items = [], tags = [], entry = null, leftovers = [] }) {
  for (const item of items) {
    const target = item.on === 'building' ? b : r;
    target[item.key] = item.value;
  }
  for (const g of tags) {
    const target = g.on === 'building' ? b : r;
    target[g.key] = [...new Set([...(target[g.key] || []), ...g.tags])];
  }
  if (entry) {
    r.priceHistory = [...(r.priceHistory || []), entry]
      .sort((x, y) => String(x.date).localeCompare(String(y.date)));
    // 表もローン計算も price だけを見ているので、最新値を必ず反映させる
    r.price = r.priceHistory[r.priceHistory.length - 1].price;
  }
  if (leftovers.length) {
    const add = leftovers.map((l) => `${l.label}：${l.value}`).join('\n');
    r.memo = r.memo ? `${r.memo}\n${add}` : add;
  }
  // 部屋の呼び名が既定のままだと一覧で見分けられない
  if (!r.label || r.label === '新規の部屋') r.label = r.floor != null ? `${r.floor}階` : '部屋';
  return { b, r };
}

function apply() {
  const items = parsed.items.filter(isOn);
  const tags = acceptedTags();
  const entry = (ui.choice.get(HIST_KEY) ?? true) ? priceHistoryEntry() : null;
  const leftoverLines = ui.memoOn ? parsed.leftovers : [];

  const b = targetBuilding() || store.addBuilding();
  const r = targetRoom() || store.addRoom(b.id);
  if (r.buildingId !== b.id) store.moveRoom(r.id, b.id);

  mergeInto(b, r, { items, tags, entry, leftovers: leftoverLines });

  store.markDirty();
  ui.text = '';
  ui.choice.clear();
  ui.tagOff.clear();
  ui.memoOn = false;
  ui.buildingId = 'new';
  ui.roomId = 'new';
  toast(`${items.length}項目を取り込みました`);
  go('r', r.id);   // ハッシュが変わるので、描き直しは main.js のルーターが行う
}
