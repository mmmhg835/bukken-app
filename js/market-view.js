// 相場タブ。建物ごとに、過去そこで売りに出た部屋がいくらだったかを見る。
//
// マンションレビューの販売履歴を写して貯めた `marketListings` を出す。
// 検討中の部屋（rooms）と同じ図に重ねるのは、「いま見ている部屋は、この建物の
// 過去の売り出しの中でどのあたりか」が知りたいのが目的だから。
import { store } from './store.js';
import { el, mount, fmt, derive } from './util.js';
import { select } from './ui.js';
import { scatterChart, chartLegend, SERIES_COLORS, SERIES_MUTED } from './chart.js';
import { linearFit } from './analysis.js';
import {
  sortRows, summary, pricePoints, tsuboOf, sqmOf, monthsOf, cutOf, isOpen, ymLabel,
} from './market.js';

/** 画面の状態。保存する値ではないので、smoke から作れるように出しておく */
const ui = { buildingId: null };
export const marketUI = ui;

export function renderMarket(root, rerender) {
  const buildings = store.buildings;
  if (!buildings.some((b) => b.id === ui.buildingId)) ui.buildingId = buildings[0]?.id ?? null;

  if (!buildings.length) {
    mount(root, el('div', { class: 'empty' }, '建物を登録すると売り出し履歴を貯められます'));
    return;
  }

  const building = store.building(ui.buildingId);
  const rows = sortRows(store.listingsOf(ui.buildingId));

  mount(root,
    picker(buildings, rerender),
    rows.length
      ? el('div', {},
        summarySection(rows),
        chartSection(rows, building),
        tableSection(rows, rerender))
      : el('div', { class: 'empty' }, `${building?.name ?? ''} の売り出し履歴はまだありません`),
  );
}

/** 建物の切り替え。件数を添えて、どこが厚いか分かるようにする */
function picker(buildings, rerender) {
  const options = buildings.map((b) => {
    const n = store.listingsOf(b.id).length;
    return [b.id, n ? `${b.name}（${n}件）` : b.name];
  });
  return el('div', { class: 'section' },
    el('div', { class: 'filterrow' },
      select(ui.buildingId, options, (v) => { ui.buildingId = v; rerender(); }, 'picksel'),
      el('span', { class: 'tiny muted' }, `全${store.marketListings.length}件`)),
  );
}

function summarySection(rows) {
  const s = summary(rows);
  const span = s.span ? `${ymLabel(s.span.from)}〜${ymLabel(s.span.to)}` : '—';
  return el('div', { class: 'section' },
    el('h3', {}, '売り出し履歴'),
    el('div', { class: 'calcgrid calcgrid-4' },
      cell('件数', `${s.count}件`, `販売中 ${s.open}件`),
      cell('期間', span),
      cell('坪単価 中央', s.tsuboMed != null ? `${fmt.n(s.tsuboMed, 0)}万` : '—',
        s.tsuboMin != null ? `${fmt.n(s.tsuboMin, 0)}〜${fmt.n(s.tsuboMax, 0)}万` : null),
      cell('販売期間 中央', s.monthsMed != null ? `${s.monthsMed}か月` : '—'),
      cell('値下げした割合', s.cutRate != null ? `${fmt.n(s.cutRate, 0)}%` : '—'),
      cell('値下げ幅 平均', s.cutAvg != null ? `${fmt.n(s.cutAvg, 1)}%` : '—'),
      cell('最安', s.tsuboMin != null ? `${fmt.n(s.tsuboMin, 0)}万/坪` : '—'),
      cell('最高', s.tsuboMax != null ? `${fmt.n(s.tsuboMax, 0)}万/坪` : '—'),
    ));
}

const cell = (k, v, sub = null) =>
  el('div', {}, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v),
    sub ? el('div', { class: 'tiny muted' }, sub) : null);

/** 横軸は売り出した年、縦軸は坪単価。検討中の部屋も重ねる */
function chartSection(rows, building) {
  const pts = pricePoints(rows).map((p) => ({
    x: p.x, y: p.y,
    label: `${ymLabel(p.ym)}　${p.row.floor != null ? `${p.row.floor}階` : '階数不明'} ${p.row.layout || ''}`.trim(),
    info: [
      [p.row.layout, p.row.area ? fmt.sqm(p.row.area) : null, p.row.feature || null]
        .filter(Boolean).join('・'),
      `${fmt.man(p.price)}　坪 ${fmt.n(p.price / (p.row.area / 3.305785), 0)}万`,
      p.row.closedYM ? `${ymLabel(p.row.listedYM)}〜${ymLabel(p.row.closedYM)}` : '販売中',
    ].filter(Boolean),
  }));

  // 検討中の部屋。同じ図に置くと、過去のどのあたりで買おうとしているかが分かる
  const now = new Date().getFullYear() + new Date().getMonth() / 12;
  const mine = store.roomsOf(building?.id).map((r) => {
    const c = derive(r, building, store.loanTerms);
    return c.tsuboPrice ? {
      x: now, y: c.tsuboPrice,
      label: `${r.label}（検討中）`,
      info: [[r.layout, r.area ? fmt.sqm(r.area) : null].filter(Boolean).join('・'),
        `${fmt.man(r.price)}　坪 ${fmt.n(c.tsuboPrice, 0)}万`].filter(Boolean),
    } : null;
  }).filter(Boolean);

  const series = [
    { name: '売り出し履歴', points: pts, color: SERIES_MUTED },
    mine.length ? { name: '検討中の部屋', points: mine, color: SERIES_COLORS[0] } : null,
  ].filter(Boolean);

  // 傾きは「1年でいくら動いたか」。履歴が薄いうちは出ない（3件未満）
  const fit = linearFit(pts);
  const chart = scatterChart(series, {
    xLabel: '売り出した年', yLabel: '坪単価（万円/坪）',
    xTick: (v) => String(Math.round(v)), height: 300, fit,
  });

  return el('div', { class: 'section' },
    el('div', { class: 'panel-chart-head' },
      el('span', { class: 'panel-chart-title' }, '坪単価', el('small', {}, '×'), '売り出した年'),
      fit ? el('div', { class: 'fitbadge' },
        el('span', {}, '1年で ', el('b', {}, `${fit.slope > 0 ? '+' : ''}${fmt.n(fit.slope, 1)}万円/坪`)),
        el('span', {}, '相場の幅 ', el('b', {}, `±${fmt.n(fit.sd, 1)}`)),
        el('span', {}, el('b', {}, `${fit.n}点`)),
      ) : null),
    el('div', { class: 'chartwrap' }, chart),
    series.length > 1 ? chartLegend(series, chart) : null,
  );
}

const COLS = [
  '売り出し', '終了', '階', '間取り', '向き', '特徴', '専有', 'バルコニー',
  '価格', '価格変更', '坪単価', '㎡単価', '管理費', '修繕', '',
];

function tableSection(rows, rerender) {
  const head = el('tr', {}, COLS.map((c, i) =>
    el('th', { class: i < 6 ? 'lab' : null }, c)));

  const body = el('tbody', {}, rows.map((x) => {
    const cut = cutOf(x);
    const months = monthsOf(x);
    return el('tr', {},
      el('td', { class: 'lab' }, ymLabel(x.listedYM)),
      el('td', { class: 'lab' },
        isOpen(x)
          ? el('b', { class: 'openmark' }, '販売中')
          : el('span', {}, ymLabel(x.closedYM)),
        months ? el('div', { class: 'tiny muted' }, `${months}か月`) : null),
      el('td', { class: 'lab' }, x.floor != null ? `${x.floor}階` : '—'),
      el('td', { class: 'lab' }, x.layout || '—'),
      el('td', { class: 'lab' }, x.direction || '—'),
      el('td', { class: 'lab' }, x.feature || '—'),
      el('td', {}, x.area != null ? fmt.n(x.area, 2) : '—'),
      el('td', {}, x.balcony != null ? fmt.n(x.balcony, 1) : '—'),
      el('td', {}, x.price != null ? fmt.n(x.price, 0) : '—'),
      el('td', { class: 'lab' },
        (x.priceHistory || []).length
          ? el('div', {}, x.priceHistory.map((h) =>
            el('div', { class: 'tiny' }, `${ymLabel(h.ym)} ${fmt.n(h.price, 0)}`)))
          : '—',
        cut != null && cut < 0 ? el('div', { class: 'tiny cutmark' }, `${fmt.n(cut, 1)}%`) : null),
      el('td', {}, tsuboOf(x) != null ? fmt.n(tsuboOf(x), 2) : '—'),
      el('td', {}, sqmOf(x) != null ? fmt.n(sqmOf(x), 2) : '—'),
      el('td', {}, x.kanrihi != null ? fmt.n(x.kanrihi, 2) : '—'),
      el('td', {}, x.shuzen != null ? fmt.n(x.shuzen, 2) : '—'),
      el('td', {},
        el('button', {
          class: 'btn btn-sm',
          onclick: () => {
            if (!confirm(`${ymLabel(x.listedYM)} の行を消しますか`)) return;
            store.deleteListing(x.id);
            rerender();
          },
        }, '削除')),
    );
  }));

  return el('div', { class: 'section' },
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp markettbl' }, el('thead', {}, head), body)));
}
