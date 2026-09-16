// 相場タブ。建物ごとに、売り出し・賃貸・新築時の価格を貯めて見る。
//
// 3種類とも出どころはマンションレビューで、スクショから写して入れる。
// 「過去そこがいくらだったか」を、売買・賃貸・新築の3方向から押さえるのが狙い。
// 単位は売買が万円、賃貸が円。混ぜないこと（写し間違いの元になる）。
import { store } from './store.js';
import { el, mount, fmt, derive } from './util.js';
import { select } from './ui.js';
import { scatterChart, chartLegend, SERIES_COLORS, SERIES_MUTED } from './chart.js';
import { linearFit } from './analysis.js';
import {
  sortRows, summary, pricePoints, tsuboOf, sqmOf, monthsOf, cutOf, isOpen, ymLabel,
  sortRents, rentSummary, rentTsuboOf, rentSqmOf, ymToNum,
  sortNewPrices, newSummary, newTsuboOf, grossYield, vsNew,
} from './market.js';

const SUBTABS = [['overview', '概況'], ['sale', '売出'], ['rent', '賃貸'], ['new', '新築']];

/** 画面の状態。保存する値ではないので、smoke から作れるように出しておく */
const ui = { buildingId: null };
export const marketUI = ui;

export function renderMarket(root, rerender, view = 'overview') {
  const buildings = store.buildings;
  if (!buildings.some((b) => b.id === ui.buildingId)) ui.buildingId = buildings[0]?.id ?? null;

  if (!buildings.length) {
    mount(root, el('div', { class: 'empty' }, '建物を登録すると相場を貯められます'));
    return;
  }

  const b = store.building(ui.buildingId);
  const sale = sortRows(store.listingsOf(ui.buildingId));
  const rent = sortRents(store.rentsOf(ui.buildingId));
  const news = sortNewPrices(store.newPricesOf(ui.buildingId));

  const body = view === 'rent' ? rentView(rent, rerender)
    : view === 'new' ? newView(news, b, rerender)
      : view === 'sale' ? saleView(sale, b, rerender)
        : overview(sale, rent, news, b);

  mount(root, subTabs(view), picker(buildings, rerender), body);
}

function subTabs(current) {
  return el('nav', { class: 'subtabs' }, SUBTABS.map(([key, label]) =>
    el('button', {
      class: 'subtab' + (key === current ? ' is-active' : ''),
      onclick: () => { location.hash = key === 'overview' ? '#/market' : `#/market/${key}`; },
    }, label)));
}

/** 建物の切り替え。3種類の件数を添えて、どこが厚いか分かるようにする */
function picker(buildings, rerender) {
  const options = buildings.map((b) => {
    const n = store.listingsOf(b.id).length + store.rentsOf(b.id).length + store.newPricesOf(b.id).length;
    return [b.id, n ? `${b.name}（${n}件）` : b.name];
  });
  return el('div', { class: 'section' },
    el('div', { class: 'filterrow' },
      select(ui.buildingId, options, (v) => { ui.buildingId = v; rerender(); }, 'picksel')),
  );
}

const cell = (k, v, sub = null) =>
  el('div', {}, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v),
    sub ? el('div', { class: 'tiny muted' }, sub) : null);

/* =========================================================
   概況（3つを突き合わせて見る）
   ========================================================= */
function overview(sale, rent, news, b) {
  const s = summary(sale), r = rentSummary(rent), n = newSummary(news);
  const y = grossYield(s.tsuboMed, r.tsuboMed);
  const mult = vsNew(s.tsuboMed, n.tsuboMed);

  if (!sale.length && !rent.length && !news.length) {
    return el('div', { class: 'empty' }, `${b?.name ?? ''} の相場はまだ入っていません`);
  }

  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, '坪単価'),
      el('div', { class: 'calcgrid calcgrid-3' },
        cell('売り出し 中央', s.tsuboMed != null ? `${fmt.n(s.tsuboMed, 0)}万` : '—',
          s.count ? `${s.count}件` : 'データなし'),
        cell('賃料 中央', r.tsuboMed != null ? `${fmt.n(r.tsuboMed, 0)}円/月` : '—',
          r.count ? `${r.count}件` : 'データなし'),
        cell('新築時 中央', n.tsuboMed != null ? `${fmt.n(n.tsuboMed, 0)}万` : '—',
          n.count ? `${n.count}件` : 'データなし'),
      )),
    el('div', { class: 'section' },
      el('h3', {}, '突き合わせ'),
      el('div', { class: 'calcgrid calcgrid-3' },
        cell('表面利回り', y != null ? `${fmt.n(y, 2)}%` : '—',
          y != null ? '年間賃料 ÷ 売り出し価格' : '売出と賃貸の両方が要る'),
        cell('新築時から', mult != null ? `${fmt.n(mult, 2)}倍` : '—',
          mult != null && n.tsuboMed ? `新築 ${fmt.n(n.tsuboMed, 0)}万/坪` : '売出と新築の両方が要る'),
        cell('月の賃料 中央', r.rentMed != null ? `${fmt.n(r.rentMed, 0)}円` : '—'),
      )),
    myRooms(b, s, r),
  );
}

/** 検討中の部屋を相場の中に置く。買おうとしている値がどのあたりか */
function myRooms(b, s, r) {
  const rooms = store.roomsOf(b?.id).filter((x) => derive(x, b, store.loanTerms).tsuboPrice);
  if (!rooms.length) return null;
  return el('div', { class: 'section' },
    el('h3', {}, '検討中の部屋'),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp markettbl' },
        el('thead', {}, el('tr', {},
          ['部屋', '坪単価', '売出中央との差', '想定賃料', '表面利回り'].map((c, i) =>
            el('th', { class: i === 0 ? 'lab' : null }, c)))),
        el('tbody', {}, rooms.map((x) => {
          const t = derive(x, b, store.loanTerms).tsuboPrice;
          const diff = s.tsuboMed != null ? t - s.tsuboMed : null;
          // 想定賃料は賃料の坪単価の中央値をこの部屋の坪数に当てたもの
          const tsubo = x.area ? x.area / 3.305785 : null;
          const rentGuess = r.tsuboMed != null && tsubo ? r.tsuboMed * tsubo : null;
          const y = grossYield(t, r.tsuboMed);
          return el('tr', {},
            el('td', { class: 'lab' }, x.label),
            el('td', {}, `${fmt.n(t, 0)}万`),
            el('td', { class: diff != null && diff > 0 ? 'worse' : null },
              diff != null ? `${diff > 0 ? '+' : ''}${fmt.n(diff, 0)}万` : '—'),
            el('td', {}, rentGuess != null ? `${fmt.n(rentGuess, 0)}円/月` : '—'),
            el('td', {}, y != null ? `${fmt.n(y, 2)}%` : '—'));
        })))));
}

/* =========================================================
   売出（中古の売り出し履歴）
   ========================================================= */
function saleView(rows, b, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '売り出し履歴はまだありません');
  const s = summary(rows);
  const span = s.span ? `${ymLabel(s.span.from)}〜${ymLabel(s.span.to)}` : '—';

  return el('div', {},
    el('div', { class: 'section' },
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
      )),
    saleChart(rows, b),
    saleTable(rows, rerender),
  );
}

function saleChart(rows, b) {
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

  const now = new Date().getFullYear() + new Date().getMonth() / 12;
  const mine = store.roomsOf(b?.id).map((r) => {
    const c = derive(r, b, store.loanTerms);
    return c.tsuboPrice ? {
      x: now, y: c.tsuboPrice, label: `${r.label}（検討中）`,
      info: [[r.layout, r.area ? fmt.sqm(r.area) : null].filter(Boolean).join('・'),
        `${fmt.man(r.price)}　坪 ${fmt.n(c.tsuboPrice, 0)}万`].filter(Boolean),
    } : null;
  }).filter(Boolean);

  const series = [
    { name: '売り出し履歴', points: pts, color: SERIES_MUTED },
    mine.length ? { name: '検討中の部屋', points: mine, color: SERIES_COLORS[0] } : null,
  ].filter(Boolean);

  const fit = linearFit(pts);
  const chart = scatterChart(series, {
    xLabel: '売り出した年', yLabel: '坪単価（万円/坪）',
    xTick: (v) => String(Math.round(v)), height: 300, fit,
  });
  return el('div', { class: 'section' },
    chartHead('坪単価', '売り出した年', fit, '万円/坪'),
    el('div', { class: 'chartwrap' }, chart),
    series.length > 1 ? chartLegend(series, chart) : null);
}

/** 傾きと件数の見出し。分析タブと同じ形にそろえる */
function chartHead(y, x, fit, unit) {
  return el('div', { class: 'panel-chart-head' },
    el('span', { class: 'panel-chart-title' }, y, el('small', {}, '×'), x),
    fit ? el('div', { class: 'fitbadge' },
      el('span', {}, '1年で ', el('b', {}, `${fit.slope > 0 ? '+' : ''}${fmt.n(fit.slope, 1)}${unit}`)),
      el('span', {}, '相場の幅 ', el('b', {}, `±${fmt.n(fit.sd, 1)}`)),
      el('span', {}, el('b', {}, `${fit.n}点`)),
    ) : null);
}

const SALE_COLS = ['売り出し', '終了', '階', '間取り', '向き', '特徴', '専有', 'バルコニー',
  '価格', '価格変更', '坪単価', '㎡単価', '管理費', '修繕', ''];

function saleTable(rows, rerender) {
  const body = el('tbody', {}, rows.map((x) => {
    const cut = cutOf(x);
    const months = monthsOf(x);
    return el('tr', {},
      el('td', { class: 'lab' }, ymLabel(x.listedYM)),
      el('td', { class: 'lab' },
        isOpen(x) ? el('b', { class: 'openmark' }, '販売中') : el('span', {}, ymLabel(x.closedYM)),
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
      delCell(() => store.deleteListing(x.id), ymLabel(x.listedYM), rerender));
  }));
  return table(SALE_COLS, body, 6);
}

/* =========================================================
   賃貸（募集に出た賃料）
   ========================================================= */
function rentView(rows, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '賃料履歴はまだありません');
  const r = rentSummary(rows);
  const span = r.span ? `${ymLabel(r.span.from)}〜${ymLabel(r.span.to)}` : '—';

  const pts = rows.filter((x) => rentTsuboOf(x) != null && ymToNum(x.ym) != null).map((x) => ({
    x: ymToNum(x.ym), y: rentTsuboOf(x),
    label: `${ymLabel(x.ym)}　${x.floor != null ? `${x.floor}階` : '階数不明'} ${x.layout || ''}`.trim(),
    info: [
      [x.layout, x.area ? fmt.sqm(x.area) : null, x.direction || null].filter(Boolean).join('・'),
      `${fmt.n(x.rent, 0)}円/月　坪 ${fmt.n(rentTsuboOf(x), 0)}円`,
      x.kanrihi != null ? `管理費 ${fmt.n(x.kanrihi, 0)}円` : '',
    ].filter(Boolean),
  }));
  const fit = linearFit(pts);
  const series = [{ name: '賃料', points: pts, color: SERIES_COLORS[2] }];
  const chart = scatterChart(series, {
    xLabel: '募集した年', yLabel: '賃料の坪単価（円/坪・月）',
    xTick: (v) => String(Math.round(v)), height: 300, fit,
  });

  const cols = ['募集', '階', '間取り', '向き', '専有', '賃料', '坪単価', '㎡単価',
    '管理費', '敷金', '礼金', '保証金', ''];
  const body = el('tbody', {}, rows.map((x) => el('tr', {},
    el('td', { class: 'lab' }, ymLabel(x.ym)),
    el('td', { class: 'lab' }, x.floor != null ? `${x.floor}階` : '—'),
    el('td', { class: 'lab' }, x.layout || '—'),
    el('td', { class: 'lab' }, x.direction || '—'),
    el('td', {}, x.area != null ? fmt.n(x.area, 2) : '—'),
    el('td', {}, x.rent != null ? fmt.n(x.rent, 0) : '—'),
    el('td', {}, rentTsuboOf(x) != null ? fmt.n(rentTsuboOf(x), 0) : '—'),
    el('td', {}, rentSqmOf(x) != null ? fmt.n(rentSqmOf(x), 0) : '—'),
    el('td', {}, x.kanrihi != null ? fmt.n(x.kanrihi, 0) : '—'),
    el('td', {}, x.deposit != null ? fmt.n(x.deposit, 0) : '—'),
    el('td', {}, x.keyMoney != null ? fmt.n(x.keyMoney, 0) : '—'),
    el('td', {}, x.guarantee != null ? fmt.n(x.guarantee, 0) : '—'),
    delCell(() => store.deleteRent(x.id), ymLabel(x.ym), rerender))));

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('件数', `${r.count}件`),
        cell('期間', span),
        cell('坪単価 中央', r.tsuboMed != null ? `${fmt.n(r.tsuboMed, 0)}円` : '—',
          r.tsuboMin != null ? `${fmt.n(r.tsuboMin, 0)}〜${fmt.n(r.tsuboMax, 0)}円` : null),
        cell('賃料 中央', r.rentMed != null ? `${fmt.n(r.rentMed, 0)}円/月` : '—'),
      )),
    el('div', { class: 'section' },
      chartHead('賃料の坪単価', '募集した年', fit, '円/坪'),
      el('div', { class: 'chartwrap' }, chart)),
    table(cols, body, 4));
}

/* =========================================================
   新築（新築時の分譲価格）
   ========================================================= */
function newView(rows, b, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '新築分譲価格はまだありません');
  const n = newSummary(rows);

  // 横軸を階にする。新築時の価格表は階による差を見るためのもの
  const pts = rows.filter((x) => newTsuboOf(x) != null && x.floor != null).map((x) => ({
    x: x.floor, y: newTsuboOf(x),
    label: `${x.floor}階 ${x.layout || ''}`.trim(),
    info: [
      [x.layout, x.area ? fmt.sqm(x.area) : null, x.direction || null].filter(Boolean).join('・'),
      `${fmt.man(x.price)}　坪 ${fmt.n(newTsuboOf(x), 0)}万`,
    ].filter(Boolean),
  }));
  const fit = linearFit(pts);
  const series = [{ name: '新築時', points: pts, color: SERIES_COLORS[1] }];
  const chart = scatterChart(series, {
    xLabel: '所在階', yLabel: '坪単価（万円/坪）',
    xTick: (v) => String(Math.round(v)), height: 300, fit,
  });

  const cols = ['階', '向き', '間取り', '専有', 'バルコニー', '新築時価格', '坪単価', ''];
  const body = el('tbody', {}, rows.map((x) => el('tr', {},
    el('td', { class: 'lab' }, x.floor != null ? `${x.floor}階` : '—'),
    el('td', { class: 'lab' }, x.direction || '—'),
    el('td', { class: 'lab' }, x.layout || '—'),
    el('td', {}, x.area != null ? fmt.n(x.area, 2) : '—'),
    el('td', {}, x.balcony != null ? fmt.n(x.balcony, 1) : '—'),
    el('td', {}, x.price != null ? fmt.n(x.price, 0) : '—'),
    el('td', {}, newTsuboOf(x) != null ? fmt.n(newTsuboOf(x), 2) : '—'),
    delCell(() => store.deleteNewPrice(x.id), `${x.floor ?? ''}階`, rerender))));

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('件数', `${n.count}件`),
        cell('築年月', b?.builtYM || '—'),
        cell('坪単価 中央', n.tsuboMed != null ? `${fmt.n(n.tsuboMed, 0)}万` : '—',
          n.tsuboMin != null ? `${fmt.n(n.tsuboMin, 0)}〜${fmt.n(n.tsuboMax, 0)}万` : null),
        cell('最高', n.tsuboMax != null ? `${fmt.n(n.tsuboMax, 0)}万/坪` : '—'),
      )),
    el('div', { class: 'section' },
      chartHead('坪単価', '所在階', fit, '万円/坪'),
      el('div', { class: 'chartwrap' }, chart)),
    table(cols, body, 3));
}

/* ===== 表の共通部分 ===== */

/** labs は左寄せにする列数。名前や年月は右寄せだと読みにくい */
function table(cols, body, labs) {
  const head = el('tr', {}, cols.map((c, i) => el('th', { class: i < labs ? 'lab' : null }, c)));
  return el('div', { class: 'section' },
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp markettbl' }, el('thead', {}, head), body)));
}

function delCell(remove, name, rerender) {
  return el('td', {},
    el('button', {
      class: 'btn btn-sm',
      onclick: () => {
        if (!confirm(`${name} の行を消しますか`)) return;
        remove();
        rerender();
      },
    }, '削除'));
}
