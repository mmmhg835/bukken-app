// 部屋詳細の「販売活動」セクション。掲載状況・価格推移の入力と指標・グラフ。
import { store } from './store.js';
import { el, fmt, toast, mount, preserveFocus } from './util.js';
import { kv, select } from './ui.js';
import { analyze, syncPrice, formatDate, today, LISTING_STATUS, CLOSED_STATUS } from './price.js';
import { stepChart } from './chart.js';

export function salesSection(room, onChange) {
  const box = el('div');

  const paint = () => {
    const a = analyze(room);
    mount(box,
      statusRow(room, repaint),
      metrics(a, room),
      a.history.length ? chartBox(room, a) : null,
      historyEditor(room, repaint),
    );
  };
  function repaint() {
    syncPrice(room);
    store.markDirty();
    onChange();
    preserveFocus(paint);   // 日付や価格を打つ間もフォーカスを保つ
  }
  paint();
  return el('div', { class: 'section' }, el('h3', {}, '販売活動'), box);
}

/* ===== 掲載状況 ===== */
function statusRow(room, repaint) {
  const closed = CLOSED_STATUS.includes(room.listingStatus);
  return el('div', { class: 'card form' },
    el('div', { class: 'field' },
      el('label', {}, '募集状況'),
      select(room.listingStatus, LISTING_STATUS.map((s) => [s, s]), (v) => {
        room.listingStatus = v;
        // 募集終了に変えた日を販売期間の終端にする
        if (CLOSED_STATUS.includes(v)) room.closedAt ||= today();
        else room.closedAt = null;
        repaint();
      })),
    el('div', { class: 'field' },
      el('label', {}, '登録日（掲載開始）'),
      el('input', {
        type: 'date', value: room.listedAt ?? '',
        'data-fkey': 'listedAt',
        oninput: (e) => { room.listedAt = e.target.value || null; repaint(); },
      })),
    el('div', { class: 'field' },
      el('label', {}, closed ? '募集終了日' : '募集終了日（終了時に入ります）'),
      el('input', {
        type: 'date', value: room.closedAt ?? '', disabled: !closed,
        oninput: (e) => { room.closedAt = e.target.value || null; repaint(); },
      })),
  );
}

/* ===== 指標 =====
   4つ×2行にそろえる。自動折り返しに任せると最後の行に空きマスが残って見苦しいため。 */
function metrics(a, room) {
  const sign = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt.man1(Math.round(v))}万円`);
  const price = (v, perTsubo) =>
    kv(null, v != null ? `${fmt.man1(v)}万円` : '—', perTsubo ? `坪 ${fmt.n(perTsubo, 0)}万円` : null);

  return el('div', { class: 'calcgrid calcgrid-4', style: 'margin-top:12px' },
    withLabel('当初価格', price(a.initial, a.initialPerTsubo)),
    withLabel('現在価格', price(a.current, a.currentPerTsubo)),
    withLabel('登録日', kv(null, formatDate(a.listedAt))),
    withLabel(a.closed ? '募集終了日' : '最終更新日',
      kv(null, formatDate(a.closed ? room.closedAt : a.lastUpdate),
        a.closed ? null : '最後に価格が動いた日')),

    withLabel('販売期間', kv(null, a.salesDays != null ? `${a.salesDays}日` : '—',
      a.closed ? '登録から終了まで' : '登録から本日まで')),
    withLabel('価格改定回数', kv(null, `${a.changeCount}回`)),
    withLabel('価格改定総額', kv(null, sign(a.totalChange),
      a.changeRate ? `${a.changeRate > 0 ? '+' : ''}${a.changeRate.toFixed(1)}%` : null)),
    withLabel('初回改定まで', kv(null, a.firstChange ? `${a.firstChange.days}日` : '—',
      a.firstChange ? sign(a.firstChange.amount) : null)),
  );
}

/** kv() のラベル位置を使いつつ、見出しを明示的に差し込む */
function withLabel(label, node) {
  node.prepend(el('div', { class: 'k' }, label));
  return node;
}

function chartBox(room, a) {
  const svg = stepChart([{
    name: room.label || 'この部屋',
    points: a.history.map((h) => ({ date: h.date, price: h.price })),
    open: !a.closed,
  }], { height: 260 });
  return el('div', { class: 'chartwrap', style: 'margin-top:14px' }, svg);
}

/* ===== 価格履歴の編集 ===== */
function historyEditor(room, repaint) {
  room.priceHistory ||= [];
  const rows = room.priceHistory.map((h, i) => el('div', { class: 'histrow' },
    el('input', {
      type: 'date', value: h.date ?? '', 'data-fkey': `hist-date-${i}`,
      oninput: (e) => { h.date = e.target.value || null; repaint(); },
    }),
    el('input', {
      type: 'number', step: 'any', inputmode: 'decimal', value: h.price ?? '',
      placeholder: '価格（万円）', 'data-fkey': `hist-price-${i}`,
      oninput: (e) => { h.price = e.target.value === '' ? null : Number(e.target.value); repaint(); },
    }),
    el('input', {
      type: 'text', value: h.note ?? '', placeholder: 'メモ（例: 値下げ / 登録時）',
      oninput: (e) => { h.note = e.target.value; store.markDirty(); },
    }),
    el('button', {
      class: 'btn btn-sm btn-danger',
      onclick: () => { room.priceHistory.splice(i, 1); repaint(); },
    }, '削除'),
  ));

  const add = el('button', {
    class: 'btn btn-sm',
    onclick: () => {
      const last = room.priceHistory[room.priceHistory.length - 1];
      room.priceHistory.push({
        date: room.priceHistory.length ? today() : (room.listedAt || today()),
        price: last?.price ?? room.price ?? null,
        note: room.priceHistory.length ? '' : '登録時',
      });
      repaint();
    },
  }, '＋ 価格を追加');

  const seed = !room.priceHistory.length && room.price != null
    ? el('button', {
      class: 'btn btn-sm btn-primary',
      onclick: () => {
        room.listedAt ||= today();
        room.priceHistory.push({ date: room.listedAt, price: room.price, note: '登録時' });
        repaint();
        toast('現在価格を当初価格として登録しました');
      },
    }, `現在価格（${fmt.man1(room.price)}万円）から履歴を作る`)
    : null;

  return el('div', { style: 'margin-top:14px' },
    el('h4', { class: 'subhead' }, '価格の推移'),
    rows.length
      ? el('div', { class: 'histhead' },
        el('span', {}, '日付'), el('span', {}, '価格（万円）'), el('span', {}, 'メモ'), el('span', {}))
      : null,
    ...rows,
    el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, add, seed),
  );
}
