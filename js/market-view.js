// 相場タブ。マンションレビューから写した売り出し・賃貸・新築を、建物をまたいで見る。
//
// 分析タブ（登録済みの部屋20室が対象だった）をここに統合した。数万件の実際の
// 売り出しに対して同じことをするほうが、相場の話としては筋が通るため。
// 単位は売買が万円、賃貸が円。混ぜないこと。
import { store } from './store.js';
import { el, mount, fmt, derive, preserveFocus, STATUSES } from './util.js';
import { select, segmented, toggle, controlRow } from './ui.js';
import { scatterChart, chartLegend, histogramChart, SERIES_COLORS, SERIES_MUTED } from './chart.js';
import { linearFit, areaOf, walkMinutesOf, builtYearOf } from './analysis.js';
import { RENOVATION } from './spec.js';
import {
  sortRows, summary, pricePoints, tsuboOf, sqmOf, monthsOf, cutOf, isOpen, ymLabel, ymToNum, median,
  sortRents, rentSummary, rentTsuboOf, rentSqmOf,
  sortNewPrices, newSummary, newTsuboOf, grossYield, vsNew, recent,
  MARKET_METRICS, MARKET_ATTRS, MARKET_GROUPS, yearly, groupBy, bands,
} from './market.js';

const SUBTABS = [
  ['overview', '概況'], ['sale', '売出'], ['trend', '推移'], ['dist', '分布'],
  ['group', '建物別'], ['rent', '賃貸'], ['new', '新築'],
];

/** 一度に読みに行く建物の上限。これを超えたら条件を絞ってもらう */
const LOAD_LIMIT = 60;

const BUILT_BANDS = [['all', 'すべて'], ['-1999', '1999年まで'], ['2000-2009', '2000年代'],
  ['2010-2019', '2010年代'], ['2020-', '2020年以降']];
const WALK_BANDS = [['all', 'すべて'], ['-5', '5分以内'], ['-10', '10分以内'],
  ['-15', '15分以内'], ['15-', '15分超']];

/** 画面の状態。保存する値ではないので、smoke から作れるように出しておく */
const ui = {
  // 建物の範囲。部屋を登録した建物だけに絞るか
  mine: true,
  // 検討状態（検討中・内見済・本命…）。募集状況とは別の軸なので混ぜない
  roomStatus: 'all',
  q: '', dev: '', town: 'all', built: 'all', walk: 'all',
  // 売り出しの行の絞り込み。listing は募集状況（販売中・終了）
  from: 'all', to: 'all', listing: 'all',
  metric: 'tsubo', attr: 'year', group: 'building', fit: true,
};
export const marketUI = ui;

export function renderMarket(root, rerender, view = 'overview') {
  // 参考建物（相場だけ見る建物）はここで初めて読む
  store.ensureRefs();
  const targets = targetBuildings();
  const ids = targets.map((b) => b.id);
  if (ids.length && ids.length <= LOAD_LIMIT) store.ensureMarkets(ids);
  const loaded = targets.filter((b) => store.marketOf(b.id));
  const rows = saleRows(loaded);

  const head = el('div', {},
    subTabs(view),
    buildingFilter(targets, loaded, rows, rerender),
  );

  if (!store.allBuildings.length) {
    mount(root, el('div', { class: 'empty' },
      store.refsReady ? '建物を登録すると相場を貯められます' : '読み込み中'));
    return;
  }
  if (ids.length > LOAD_LIMIT) {
    mount(root, head, el('div', { class: 'empty' },
      `${ids.length}棟が条件に合っています。${LOAD_LIMIT}棟までに絞ってください`));
    return;
  }
  if (!loaded.length) {
    mount(root, head, el('div', { class: 'empty' },
      ids.length ? '読み込み中' : '条件に合う建物がありません'));
    return;
  }

  const body = view === 'rent' ? rentView(loaded)
    : view === 'new' ? newView(loaded)
      : view === 'trend' ? trendView(rows, rerender)
        : view === 'dist' ? distView(rows, rerender)
          : view === 'group' ? groupView(rows, rerender)
            : view === 'sale' ? saleView(rows, loaded, rerender)
              : overview(rows, loaded);

  mount(root, head, body);
}

function subTabs(current) {
  return el('nav', { class: 'subtabs' }, SUBTABS.map(([key, label]) =>
    el('button', {
      class: 'subtab' + (key === current ? ' is-active' : ''),
      onclick: () => { location.hash = key === 'overview' ? '#/market' : `#/market/${key}`; },
    }, label)));
}

/* =========================================================
   絞り込み
   ========================================================= */

/** 条件に合う建物。相場はここで決まった建物ぶんだけ読む */
function targetBuildings() {
  const q = ui.q.trim(), dev = ui.dev.trim();
  return store.allBuildings.filter((b) => {
    const rooms = store.roomsOf(b.id);
    if ((ui.mine || ui.roomStatus !== 'all') && !rooms.length) return false;
    if (ui.roomStatus !== 'all' && !rooms.some((r) => r.status === ui.roomStatus)) return false;
    if (q && !b.name.includes(q)) return false;
    if (dev && ![b.developer, b.builder, b.designer, b.brand]
      .some((v) => (v || '').includes(dev))) return false;
    if (ui.town !== 'all' && areaOf(b).town !== ui.town) return false;
    if (ui.built !== 'all') {
      const y = builtYearOf(b);
      if (y == null) return false;
      const [lo, hi] = ui.built.split('-').map((v) => (v === '' ? null : Number(v)));
      if (lo != null && y < lo) return false;
      if (hi != null && y >= hi + 1) return false;
    }
    if (ui.walk !== 'all') {
      const w = walkMinutesOf(b);
      if (w == null) return false;
      const [lo, hi] = ui.walk.split('-').map((v) => (v === '' ? null : Number(v)));
      if (lo != null && w < lo) return false;
      if (hi != null && w > hi) return false;
    }
    return true;
  });
}

/** 売り出しの行。期間と募集状況で絞る */
function saleRows(buildings) {
  const from = ui.from === 'all' ? null : Number(ui.from);
  const to = ui.to === 'all' ? null : Number(ui.to);
  const out = [];
  for (const b of buildings) {
    for (const x of store.listingsOf(b.id)) {
      const y = ymToNum(x.listedYM);
      if (from != null && (y == null || y < from)) continue;
      if (to != null && (y == null || y >= to + 1)) continue;
      if (ui.listing === 'open' && !isOpen(x)) continue;
      if (ui.listing === 'closed' && isOpen(x)) continue;
      out.push(x);
    }
  }
  return sortRows(out);
}

const buildingOf = (id) => store.building(id);

function buildingFilter(targets, loaded, rows, rerender) {
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort();
  const towns = uniq(store.allBuildings.map((b) => areaOf(b).town));
  const years = uniq(store.allBuildings.flatMap((b) =>
    store.listingsOf(b.id).map((x) => {
      const y = ymToNum(x.listedYM);
      return y == null ? null : String(Math.floor(y));
    })));
  const yearOptions = [['all', 'すべて'], ...years.map((y) => [y, `${y}年`])];
  const pick = (key, options) =>
    select(ui[key], options, (v) => { ui[key] = v; rerender(); }, 'fsel');
  const text = (key, ph) => el('input', {
    type: 'text', class: 'fsel ftext', value: ui[key], placeholder: ph,
    'data-fkey': `market-${key}`,
    oninput: (e) => { ui[key] = e.target.value; preserveFocus(rerender); },
  });

  const loading = store.marketLoadingCount;
  return el('div', { class: 'filterbar' },
    el('div', { class: 'filterbar-row' },
      toggle('登録した部屋がある建物', ui.mine, (v) => { ui.mine = v; rerender(); }),
      el('div', { class: 'fgroup' }, el('label', {}, '検討状態'),
        pick('roomStatus', [['all', 'すべて'], ...STATUSES.map((x) => [x, x])])),
      el('div', { class: 'fgroup' }, el('label', {}, '建物名'), text('q', '名前で探す')),
      el('div', { class: 'fgroup' }, el('label', {}, '事業者'), text('dev', 'デベロッパー・施工')),
      el('div', { class: 'fgroup' }, el('label', {}, 'エリア'),
        pick('town', [['all', 'すべて'], ...towns.map((t) => [t, t])])),
      el('div', { class: 'fgroup' }, el('label', {}, '竣工年'), pick('built', BUILT_BANDS)),
      el('div', { class: 'fgroup' }, el('label', {}, '駅徒歩'), pick('walk', WALK_BANDS)),
      el('div', { class: 'spacer' }),
      el('span', { class: 'fcount' },
        `${targets.length}棟${loading ? `（${loading}棟 読み込み中）` : ''}`
        + (store.refsReady ? '' : '（建物を読み込み中）')),
    ),
    el('div', { class: 'filterbar-row' },
      el('div', { class: 'fgroup' }, el('label', {}, '売り出し年'),
        el('div', { class: 'frange' },
          pick('from', yearOptions), el('span', {}, '〜'), pick('to', yearOptions))),
      el('div', { class: 'fgroup' }, el('label', {}, '募集状況'),
        pick('listing', [['all', 'すべて'], ['open', '販売中'], ['closed', '終了']])),
      el('div', { class: 'spacer' }),
      el('span', { class: 'fcount' }, `売り出し ${rows.length.toLocaleString('ja-JP')}件`),
      loaded.length < targets.length
        ? el('span', { class: 'tiny muted' }, `${loaded.length}/${targets.length}棟`)
        : null,
    ));
}

const cell = (k, v, sub = null) =>
  el('div', {}, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v),
    sub ? el('div', { class: 'tiny muted' }, sub) : null);

/* =========================================================
   概況
   ========================================================= */
function overview(rows, buildings) {
  const rent = buildings.flatMap((b) => store.rentsOf(b.id));
  const news = buildings.flatMap((b) => store.newPricesOf(b.id));
  const s = summary(recent(rows)), r = rentSummary(recent(rent, 1, 'ym')), n = newSummary(news);
  const all = summary(rows), allR = rentSummary(rent);
  const y = grossYield(s.tsuboMed, r.tsuboMed);
  const mult = vsNew(s.tsuboMed, n.tsuboMed);
  const yr = yearly(rows);

  if (!rows.length && !rent.length && !news.length) {
    return el('div', { class: 'empty' }, '条件に合う相場がありません');
  }
  const span = (a) => (a.count ? `全${a.count.toLocaleString('ja-JP')}件では ${fmt.n(a.tsuboMed, 0)}` : null);

  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, '坪単価　直近1年'),
      el('div', { class: 'calcgrid calcgrid-3' },
        cell('売り出し 中央', s.tsuboMed != null ? `${fmt.n(s.tsuboMed, 0)}万` : '—',
          s.count ? `${s.count}件　${span(all) ?? ''}` : 'データなし'),
        cell('賃料 中央', r.tsuboMed != null ? `${fmt.n(r.tsuboMed, 0)}円/月` : '—',
          r.count ? `${r.count}件　${span(allR) ?? ''}` : 'データなし'),
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
        cell('年平均の伸び', yr.cagr != null ? `${yr.cagr > 0 ? '+' : ''}${fmt.n(yr.cagr, 2)}%` : '—',
          yr.list.length > 1 ? `${yr.list[0].year}年〜${yr.list[yr.list.length - 1].year}年` : null),
      )),
    onSaleNow(rows, buildings),
    myRooms(buildings, s, r),
  );
}

/**
 * いま出ている数。総戸数に対する割合が高いほど、売りたい人が多いということ。
 * 掲載期間は募集中の行だけで見る（終わった行を混ぜると「売れるまでの早さ」になる）。
 */
function onSaleNow(rows, buildings) {
  const open = rows.filter(isOpen);
  if (!open.length) return null;
  const months = open.map(monthsOf).filter(Number.isFinite);
  const units = buildings.reduce((s, b) => s + (b.totalUnits || 0), 0) || null;
  const ratio = units ? (open.length / units) * 100 : null;
  const longest = months.length ? Math.max(...months) : null;
  return el('div', { class: 'section' },
    el('h3', {}, 'いま出ている数'),
    el('div', { class: 'calcgrid calcgrid-3' },
      cell('募集中', `${open.length}件`, units ? `総戸数 ${units.toLocaleString('ja-JP')}戸` : '総戸数が未入力'),
      cell('総戸数に対して', ratio != null ? `${fmt.n(ratio, 1)}%` : '—',
        ratio != null ? (ratio >= 5 ? '多め' : ratio >= 2 ? '並み' : '少なめ') : null),
      cell('掲載期間 中央', months.length ? `${median(months)}か月` : '—',
        longest != null ? `一番長い ${longest}か月` : null),
    ));
}

/** 検討中の部屋を相場の中に置く。買おうとしている値がどのあたりか */
function myRooms(buildings, s, r) {
  const rooms = buildings.flatMap((b) => store.roomsOf(b.id).map((x) => ({ b, x })))
    .filter(({ b, x }) => derive(x, b, store.loanTerms).tsuboPrice);
  if (!rooms.length) return null;
  return el('div', { class: 'section' },
    el('h3', {}, '検討中の部屋'),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp markettbl' },
        el('thead', {}, el('tr', {},
          ['部屋', '坪単価', '売出中央との差', '想定賃料', '表面利回り'].map((c, i) =>
            el('th', { class: i === 0 ? 'lab' : null }, c)))),
        el('tbody', {}, rooms.map(({ b, x }) => {
          const t = derive(x, b, store.loanTerms).tsuboPrice;
          const diff = s.tsuboMed != null ? t - s.tsuboMed : null;
          const tsubo = x.area ? x.area / 3.305785 : null;
          const rentGuess = r.tsuboMed != null && tsubo ? r.tsuboMed * tsubo : null;
          const y = grossYield(t, r.tsuboMed);
          return el('tr', {},
            el('td', { class: 'lab' }, `${b.name} ${x.label}`),
            el('td', {}, `${fmt.n(t, 0)}万`),
            el('td', { class: diff != null && diff > 0 ? 'worse' : null },
              diff != null ? `${diff > 0 ? '+' : ''}${fmt.n(diff, 0)}万` : '—'),
            el('td', {}, rentGuess != null ? `${fmt.n(rentGuess, 0)}円/月` : '—'),
            el('td', {}, y != null ? `${fmt.n(y, 2)}%` : '—'));
        })))));
}

/* =========================================================
   売出（散布図：軸を選べる）
   ========================================================= */
function saleView(rows, buildings, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');
  const s = summary(rows);
  const span = s.span ? `${ymLabel(s.span.from)}〜${ymLabel(s.span.to)}` : '—';

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('件数', `${s.count.toLocaleString('ja-JP')}件`, `販売中 ${s.open}件`),
        cell('期間', span),
        cell('坪単価 中央', s.tsuboMed != null ? `${fmt.n(s.tsuboMed, 0)}万` : '—',
          s.tsuboMin != null ? `${fmt.n(s.tsuboMin, 0)}〜${fmt.n(s.tsuboMax, 0)}万` : null),
        cell('販売期間 中央', s.monthsMed != null ? `${s.monthsMed}か月` : '—'),
        cell('値下げした割合', s.cutRate != null ? `${fmt.n(s.cutRate, 0)}%` : '—'),
        cell('値下げ幅 平均', s.cutAvg != null ? `${fmt.n(s.cutAvg, 1)}%` : '—'),
        cell('最安', s.tsuboMin != null ? `${fmt.n(s.tsuboMin, 0)}万/坪` : '—'),
        cell('最高', s.tsuboMax != null ? `${fmt.n(s.tsuboMax, 0)}万/坪` : '—'),
      )),
    axisControls(rerender, { attr: true, group: true, fit: true }),
    scatterSection(rows, buildings),
    saleTable(rows.slice(0, 400), rows.length, rerender),
  );
}

/**
 * 軸の操作。画面によって効く軸が違うので、効くものだけ出す。
 * 使えない操作を並べると、押しても何も起きない欄が増える。
 */
function axisControls(rerender, { attr = false, group = false, groupLabel = '色分け', fit = false } = {}) {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-controls' },
      controlRow('↕', '表示単位',
        segmented(ui.metric, Object.entries(MARKET_METRICS).map(([k, v]) => [k, v.label]),
          (k) => { ui.metric = k; rerender(); })),
      attr ? controlRow('↔', '物件属性',
        segmented(ui.attr, Object.entries(MARKET_ATTRS).map(([k, v]) => [k, v.label]),
          (k) => { ui.attr = k; rerender(); })) : null,
      group ? controlRow('◍', groupLabel,
        el('div', { style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap' },
          select(ui.group, Object.entries(MARKET_GROUPS).map(([k, v]) => [k, v.label]),
            (k) => { ui.group = k; rerender(); }, 'picksel'),
          fit ? toggle('近似直線と相場の幅', ui.fit, (v) => { ui.fit = v; rerender(); }) : null)) : null,
    ));
}

/** 色は絞り込み前の全建物の並びで決める。絞っても残った系列の色が変わらないように */
function colorOf(names) {
  const map = new Map();
  names.forEach((k, i) => map.set(k, i < SERIES_COLORS.length ? SERIES_COLORS[i] : null));
  return map;
}

function scatterSection(rows, buildings) {
  const metric = MARKET_METRICS[ui.metric], attr = MARKET_ATTRS[ui.attr];
  const group = MARKET_GROUPS[ui.group];
  const pts = [];
  for (const x of rows) {
    const b = buildingOf(x.buildingId);
    const xv = attr.get(x, b), yv = metric.get(x, b);
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    pts.push({ x: xv, y: yv, key: group.get(x, b), row: x, b });
  }
  if (!pts.length) return el('div', { class: 'empty' }, `${attr.label} と ${metric.label} が揃った行がありません`);

  const order = [...new Set(pts.map((p) => p.key))];
  const colors = colorOf(order);
  const OTHER = 'その他';
  const byKey = new Map();
  for (const p of pts) {
    const k = colors.get(p.key) ? p.key : OTHER;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({
      x: p.x, y: p.y,
      label: `${p.b?.name ?? ''} ${p.row.floor != null ? `${p.row.floor}階` : ''}`.trim(),
      info: [
        [p.row.layout, p.row.area ? fmt.sqm(p.row.area) : null, p.row.feature || null]
          .filter(Boolean).join('・'),
        `${fmt.man(p.row.price)}　坪 ${fmt.n(tsuboOf(p.row), 0)}万`,
        isOpen(p.row) ? '販売中' : `${ymLabel(p.row.listedYM)}〜${ymLabel(p.row.closedYM)}`,
      ].filter(Boolean),
    });
  }
  const series = [...byKey.entries()]
    .sort((a, b) => (a[0] === OTHER ? 1 : 0) - (b[0] === OTHER ? 1 : 0))
    .map(([name, points]) => ({ name, points, color: name === OTHER ? SERIES_MUTED : colors.get(name) }));

  const fit = ui.fit ? linearFit(pts) : null;
  const chart = scatterChart(series, {
    xLabel: `${attr.label}（${attr.unit}）`, yLabel: `${metric.label}（${metric.unit}）`,
    xTick: attr.tick, height: 340, fit,
  });
  return el('div', { class: 'section' },
    el('div', { class: 'panel-chart-head' },
      el('span', { class: 'panel-chart-title' }, metric.label, el('small', {}, '×'), attr.label),
      fit ? el('div', { class: 'fitbadge' },
        el('span', {}, `${attr.label}+1${attr.unit} → `,
          el('b', {}, `${fit.slope > 0 ? '+' : ''}${fmt.n(fit.slope, 1)}${metric.unit}`)),
        el('span', {}, '相場の幅 ', el('b', {}, `±${fmt.n(fit.sd, 1)}`)),
        el('span', {}, el('b', {}, `${fit.n.toLocaleString('ja-JP')}点`)),
      ) : null),
    el('div', { class: 'chartwrap' }, chart),
    series.length > 1 ? chartLegend(series, chart) : null);
}

/* =========================================================
   推移（年ごと）
   ========================================================= */
function trendView(rows, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');
  const metric = MARKET_METRICS[ui.metric];
  const { list, cagr } = yearly(rows, ui.metric);
  if (!list.length) return el('div', { class: 'empty' }, '年ごとにまとめられる行がありません');

  const pts = list.map((r) => ({
    x: r.year, y: r.median,
    label: `${r.year}年`,
    info: [`中央 ${fmt.n(r.median, 1)}${metric.unit}　${r.count}件`,
      `${fmt.n(r.min, 0)}〜${fmt.n(r.max, 0)}`,
      r.diff != null ? `前年から ${r.diff > 0 ? '+' : ''}${fmt.n(r.diff, 1)}%` : ''].filter(Boolean),
  }));
  const fit = linearFit(pts);
  const chart = scatterChart([{ name: '年ごとの中央値', points: pts, color: SERIES_COLORS[0] }], {
    xLabel: '売り出した年', yLabel: `${metric.label}（${metric.unit}）`,
    xTick: (v) => String(Math.round(v)), height: 320, fit,
  });

  const body = el('tbody', {}, [...list].reverse().map((r) => el('tr', {},
    el('td', { class: 'lab' }, `${r.year}年`),
    el('td', {}, r.count.toLocaleString('ja-JP')),
    el('td', {}, fmt.n(r.median, 1)),
    el('td', { class: r.diff == null ? null : r.diff >= 0 ? 'up' : 'down' },
      r.diff == null ? '—' : `${r.diff > 0 ? '+' : ''}${fmt.n(r.diff, 1)}%`),
    el('td', {}, fmt.n(r.avg, 1)),
    el('td', {}, fmt.n(r.min, 0)),
    el('td', {}, fmt.n(r.max, 0)))));

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('年平均の伸び', cagr != null ? `${cagr > 0 ? '+' : ''}${fmt.n(cagr, 2)}%` : '—',
          `${list[0].year}年〜${list[list.length - 1].year}年`),
        cell('最初の年', `${fmt.n(list[0].median, 0)}${metric.unit}`, `${list[0].year}年　${list[0].count}件`),
        cell('最後の年', `${fmt.n(list[list.length - 1].median, 0)}${metric.unit}`,
          `${list[list.length - 1].year}年　${list[list.length - 1].count}件`),
        cell('この間の倍率', list[0].median ? `${fmt.n(list[list.length - 1].median / list[0].median, 2)}倍` : '—'),
      )),
    axisControls(rerender),
    el('div', { class: 'section' },
      el('div', { class: 'chartwrap' }, chart)),
    el('div', { class: 'section' },
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {},
            ['年', '件数', `中央（${metric.unit}）`, '前年から', '平均', '最安', '最高']
              .map((c, i) => el('th', { class: i === 0 ? 'lab' : null }, c)))),
          body))));
}

/* =========================================================
   分布
   ========================================================= */
function distView(rows, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');
  const metric = MARKET_METRICS[ui.metric];
  const { bins } = bands(rows, ui.metric);
  return el('div', {},
    axisControls(rerender),
    el('div', { class: 'section' },
      el('h3', {}, `${metric.label}の分布`),
      el('div', { class: 'chartwrap' },
        histogramChart(bins, {
          xLabel: metric.unit, height: 300,
          fmt: (v) => fmt.n(v, 0), legend: ['販売中', '終了'],
        }))));
}

/* =========================================================
   建物別
   ========================================================= */
function groupView(rows, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');
  const metric = MARKET_METRICS[ui.metric];
  const stats = groupBy(rows, buildingOf, ui.group === 'none' ? 'building' : ui.group, ui.metric);
  const body = el('tbody', {}, stats.map((r) => el('tr', {},
    el('td', { class: 'lab' }, r.name),
    el('td', {}, r.count.toLocaleString('ja-JP')),
    el('td', {}, `${fmt.n(r.ratio, 1)}%`),
    el('td', {}, fmt.n(r.median, 1)),
    el('td', {}, fmt.n(r.avg, 1)),
    el('td', {}, fmt.n(r.min, 0)),
    el('td', {}, fmt.n(r.max, 0)))));
  return el('div', {},
    axisControls(rerender, { group: true, groupLabel: '区分' }),
    el('div', { class: 'section' },
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {},
            ['区分', '件数', '割合', `中央（${metric.unit}）`, '平均', '最安', '最高']
              .map((c, i) => el('th', { class: i === 0 ? 'lab' : null }, c)))),
          body))));
}

/* =========================================================
   売出の表
   ========================================================= */
const SALE_COLS = ['建物', '売り出し', '終了', '階', '間取り', '向き', '特徴', '専有', 'バルコニー',
  '価格', '価格変更', '坪単価', '㎡単価', '管理費', '修繕', ''];

function saleTable(rows, total, rerender) {
  const body = el('tbody', {}, rows.map((x) => {
    const cut = cutOf(x);
    const months = monthsOf(x);
    const b = buildingOf(x.buildingId);
    return el('tr', {},
      el('td', { class: 'lab' }, b?.name ?? '—'),
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
      el('td', {},
        isOpen(x) ? roomButton(x, rerender) : null,
        el('button', {
          class: 'btn btn-sm',
          onclick: () => {
            if (!confirm(`${ymLabel(x.listedYM)} の行を消しますか`)) return;
            store.deleteListing(x.buildingId, x.id);
            rerender();
          },
        }, '削除')));
  }));
  return el('div', { class: 'section' },
    total > rows.length
      ? el('div', { class: 'filterrow' },
        el('span', { class: 'tiny muted' },
          `${total.toLocaleString('ja-JP')}件のうち新しい ${rows.length} 件`))
      : null,
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp markettbl' },
        el('thead', {}, el('tr', {}, SALE_COLS.map((c, i) =>
          el('th', { class: i < 7 ? 'lab' : null }, c)))),
        body)));
}

/**
 * 募集中の行から検討中の部屋を作る。
 * 掲載サイトのスクショを撮り直さずに済ませるための入口で、写して入れる項目は
 * すべてこの行に揃っている（足りないのは部屋番号と写真だけ）。
 */
function roomButton(x, rerender) {
  const b = store.building(x.buildingId);
  const dup = store.roomsOf(x.buildingId).find((r) =>
    r.floor === x.floor && r.area === x.area && r.price === x.price);
  if (dup) {
    return el('a', {
      href: '#', class: 'tiny',
      onclick: (e) => { e.preventDefault(); location.hash = `#/r/${dup.id}`; },
    }, '登録済み');
  }
  return el('button', {
    class: 'btn btn-sm btn-primary',
    onclick: () => {
      const r = store.addRoom(x.buildingId, {
        label: x.floor != null ? `${x.floor}階` : '新規の部屋',
        price: x.price, area: x.area, layout: x.layout, floor: x.floor, balcony: x.balcony,
        kanrihi: x.kanrihi, shuzen: x.shuzen,
        listingStatus: '募集中',
        listedAt: x.listedYM ? `${x.listedYM}-01` : null,
        priceHistory: (x.priceHistory || []).map((h) => ({ date: `${h.ym}-01`, price: h.price })),
        roomEquipmentTags: /角部屋/.test(x.feature || '') ? ['角部屋'] : [],
        renovation: renovationOf(x.feature),
        url: b?.url || '',
        memo: x.feature ? `マンレビの特徴：${x.feature}` : '',
      });
      if (!r.priceHistory.length && x.price != null && x.listedYM) {
        r.priceHistory = [{ date: `${x.listedYM}-01`, price: x.price }];
      }
      store.markDirty();
      rerender();
      location.hash = `#/r/${r.id}`;
    },
  }, '部屋にする');
}

/** 「リフォーム・リノベーション」からリノベ区分を決める */
function renovationOf(feature = '') {
  if (/リノベーション/.test(feature)) return RENOVATION[2];
  if (/リフォーム/.test(feature)) return RENOVATION[1];
  return RENOVATION[0];
}

/* =========================================================
   賃貸
   ========================================================= */
function rentView(buildings) {
  const rows = sortRents(buildings.flatMap((b) => store.rentsOf(b.id)));
  if (!rows.length) return el('div', { class: 'empty' }, '賃料履歴がありません');
  const r = rentSummary(rows);
  const span = r.span ? `${ymLabel(r.span.from)}〜${ymLabel(r.span.to)}` : '—';

  const pts = rows.filter((x) => rentTsuboOf(x) != null && ymToNum(x.ym) != null).map((x) => ({
    x: ymToNum(x.ym), y: rentTsuboOf(x),
    label: `${buildingOf(x.buildingId)?.name ?? ''} ${x.floor != null ? `${x.floor}階` : ''}`.trim(),
    info: [
      [x.layout, x.area ? fmt.sqm(x.area) : null, x.direction || null].filter(Boolean).join('・'),
      `${fmt.n(x.rent, 0)}円/月　坪 ${fmt.n(rentTsuboOf(x), 0)}円`,
      `${ymLabel(x.ym)}`,
    ].filter(Boolean),
  }));
  const fit = linearFit(pts);
  const chart = scatterChart([{ name: '賃料', points: pts, color: SERIES_COLORS[2] }], {
    xLabel: '募集した年', yLabel: '賃料の坪単価（円/坪・月）',
    xTick: (v) => String(Math.round(v)), height: 300, fit,
  });

  const cols = ['建物', '募集', '階', '間取り', '向き', '専有', '賃料', '坪単価', '㎡単価',
    '管理費', '敷金', '礼金', '保証金'];
  const shown = rows.slice(0, 400);
  const body = el('tbody', {}, shown.map((x) => el('tr', {},
    el('td', { class: 'lab' }, buildingOf(x.buildingId)?.name ?? '—'),
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
    el('td', {}, x.guarantee != null ? fmt.n(x.guarantee, 0) : '—'))));

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('件数', `${r.count.toLocaleString('ja-JP')}件`),
        cell('期間', span),
        cell('坪単価 中央', r.tsuboMed != null ? `${fmt.n(r.tsuboMed, 0)}円` : '—',
          r.tsuboMin != null ? `${fmt.n(r.tsuboMin, 0)}〜${fmt.n(r.tsuboMax, 0)}円` : null),
        cell('賃料 中央', r.rentMed != null ? `${fmt.n(r.rentMed, 0)}円/月` : '—'),
      )),
    el('div', { class: 'section' },
      el('div', { class: 'chartwrap' }, chart)),
    el('div', { class: 'section' },
      rows.length > shown.length
        ? el('div', { class: 'filterrow' },
          el('span', { class: 'tiny muted' },
            `${rows.length.toLocaleString('ja-JP')}件のうち新しい ${shown.length} 件`))
        : null,
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {}, cols.map((c, i) =>
            el('th', { class: i < 5 ? 'lab' : null }, c)))),
          body))));
}

/* =========================================================
   新築
   ========================================================= */
function newView(buildings) {
  const rows = sortNewPrices(buildings.flatMap((b) => store.newPricesOf(b.id)));
  if (!rows.length) return el('div', { class: 'empty' }, '新築分譲価格がありません');
  const n = newSummary(rows);

  // 横軸を階にする。新築時は同じ時点で一斉に売られたので、年で見ても意味がない
  const pts = rows.filter((x) => newTsuboOf(x) != null && x.floor != null).map((x) => ({
    x: x.floor, y: newTsuboOf(x),
    label: `${buildingOf(x.buildingId)?.name ?? ''} ${x.floor}階`.trim(),
    info: [
      [x.layout, x.area ? fmt.sqm(x.area) : null, x.direction || null].filter(Boolean).join('・'),
      `${fmt.man(x.price)}　坪 ${fmt.n(newTsuboOf(x), 0)}万`,
    ].filter(Boolean),
  }));
  const fit = linearFit(pts);
  const chart = scatterChart([{ name: '新築時', points: pts, color: SERIES_COLORS[1] }], {
    xLabel: '所在階', yLabel: '坪単価（万円/坪）',
    xTick: (v) => String(Math.round(v)), height: 300, fit,
  });

  const cols = ['建物', '階', '向き', '間取り', '専有', 'バルコニー', '新築時価格', '坪単価'];
  const body = el('tbody', {}, rows.map((x) => el('tr', {},
    el('td', { class: 'lab' }, buildingOf(x.buildingId)?.name ?? '—'),
    el('td', { class: 'lab' }, x.floor != null ? `${x.floor}階` : '—'),
    el('td', { class: 'lab' }, x.direction || '—'),
    el('td', { class: 'lab' }, x.layout || '—'),
    el('td', {}, x.area != null ? fmt.n(x.area, 2) : '—'),
    el('td', {}, x.balcony != null ? fmt.n(x.balcony, 1) : '—'),
    el('td', {}, x.price != null ? fmt.n(x.price, 0) : '—'),
    el('td', {}, newTsuboOf(x) != null ? fmt.n(newTsuboOf(x), 2) : '—'))));

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('件数', `${n.count}件`),
        cell('棟数', `${new Set(rows.map((x) => x.buildingId)).size}棟`),
        cell('坪単価 中央', n.tsuboMed != null ? `${fmt.n(n.tsuboMed, 0)}万` : '—',
          n.tsuboMin != null ? `${fmt.n(n.tsuboMin, 0)}〜${fmt.n(n.tsuboMax, 0)}万` : null),
        cell('最高', n.tsuboMax != null ? `${fmt.n(n.tsuboMax, 0)}万/坪` : '—'),
      )),
    el('div', { class: 'section' },
      el('div', { class: 'chartwrap' }, chart)),
    el('div', { class: 'section' },
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {}, cols.map((c, i) =>
            el('th', { class: i < 4 ? 'lab' : null }, c)))),
          body))));
}
