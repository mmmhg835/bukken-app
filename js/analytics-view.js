// 分析タブ。軸をボタンで切り替えながら、登録済みの部屋の傾向を見る。
import { store } from './store.js';
import { el, fmt, mount } from './util.js';
import { section, segmented, controlRow, toggle, select } from './ui.js';
import {
  METRICS, ATTRS, GROUPINGS, buildRows, linearFit, residuals,
  groupStats, histogram, monthlyTrend, areaOf,
  EQUIPMENT_FILTERS, filterByEquipment, hasEquipment,
} from './analysis.js';
import { scatterChart, histogramChart, stepChart, chartLegend, SERIES_COLORS, SERIES_MUTED } from './chart.js';
import { CLOSED_STATUS } from './price.js';

const ui = { metric: 'tsubo', attr: 'area', group: 'building', fit: true, histMetric: 'tsubo', equip: [] };

export function renderAnalysis(root, rerender) {
  const all = buildRows(store);
  const rows = filterByEquipment(all, ui.equip);
  if (all.length < 1) {
    mount(root, el('div', { class: 'empty' }, '分析できる部屋がありません。まず物件を登録してください。'));
    return;
  }

  mount(root,
    equipmentFilter(all, rows, rerender),
    scatterSection(all, rows, rerender),
    valueSection(rows),
    areaSection(rows),
    distributionSection(rows, rerender),
    trendSection(rows),
  );
}

/** 設備での絞り込み。条件を満たす部屋だけを対象に分析できる */
function equipmentFilter(all, rows, rerender) {
  const chips = EQUIPMENT_FILTERS.map(({ name, on }) => {
    const count = all.filter((x) => hasEquipment(x, name)).length;
    const active = ui.equip.includes(name);
    return el('button', {
      class: 'tag' + (active ? ' is-on' : '') + (count ? '' : ' is-empty'),
      title: `${on}の設備　該当 ${count}件`,
      onclick: () => {
        const i = ui.equip.indexOf(name);
        if (i >= 0) ui.equip.splice(i, 1); else ui.equip.push(name);
        rerender();
      },
    }, `${name} ${count}`);
  });

  return el('div', { class: 'section' },
    el('h3', {}, '設備で絞り込む'),
    el('div', { class: 'card', style: 'padding:14px' },
      el('div', { class: 'tagwrap' }, chips),
      el('div', { class: 'filterrow' },
        el('span', { class: 'tiny muted' }, `対象 ${rows.length} / ${all.length} 件`),
        ui.equip.length
          ? el('button', { class: 'btn btn-sm', onclick: () => { ui.equip = []; rerender(); } }, '解除')
          : null),
    ));
}

/* =========================================================
   相関（散布図）
   ========================================================= */
const OTHER = 'その他';

/**
 * 区分に色を割り当てる。並びは絞り込み前の全件で決めるので、
 * 設備で絞っても残った区分の色は変わらない。
 * 色を使い回すと別々の建物が同じ色になるため、6色を超えた分は「その他」にまとめ、
 * 個々の識別は点の名前とホバーに任せる。
 */
function colorOf(all, group) {
  const order = [];
  for (const x of all) {
    const k = group.get(x);
    if (!order.includes(k)) order.push(k);
  }
  return new Map(order.map((k, i) => [k, i < SERIES_COLORS.length ? SERIES_COLORS[i] : null]));
}

/** 点を押したときに出す3行。どの部屋かが分かる最低限に絞る */
function pointInfo(x) {
  // 階は見出しの部屋名に出るので、ここでは繰り返さない
  const spec = [x.r.layout, fmt.sqm(x.r.area), x.r.renovation && x.r.renovation !== 'なし' ? x.r.renovation : null]
    .filter(Boolean).join('・');
  return [
    spec,
    `${fmt.man(x.r.price)}　坪 ${fmt.n(x.c.tsuboPrice, 0)}万`,
    x.r.offerPrice != null ? `指値 ${fmt.man(x.r.offerPrice)}` : '',
  ].filter(Boolean);
}

function scatterSection(all, rows, rerender) {
  if (!rows.length) {
    return el('div', { class: 'section' },
      el('div', { class: 'empty' }, '絞り込み条件に合う部屋がありません。'));
  }
  const metric = METRICS[ui.metric], attr = ATTRS[ui.attr], group = GROUPINGS[ui.group];

  const valid = rows.filter((x) => Number.isFinite(metric.get(x)) && Number.isFinite(attr.get(x)));
  const fit = ui.fit ? linearFit(valid.map((x) => ({ x: attr.get(x), y: metric.get(x) }))) : null;

  const colors = colorOf(all, group);
  const byGroup = new Map();
  for (const x of valid) {
    const k = colors.get(group.get(x)) ? group.get(x) : OTHER;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push({
      x: attr.get(x), y: metric.get(x),
      label: `${x.b.name} ${x.r.label}`,
      info: pointInfo(x),
    });
  }
  const series = [...byGroup.entries()]
    .sort((a, b) => (a[0] === OTHER ? 1 : 0) - (b[0] === OTHER ? 1 : 0))   // その他は最後
    .map(([name, points]) => ({
      name, points, color: name === OTHER ? SERIES_MUTED : colors.get(name),
    }));

  const controls = el('div', { class: 'panel-controls' },
    controlRow('↕', '表示単位',
      segmented(ui.metric, Object.entries(METRICS).map(([k, v]) => [k, v.label]),
        (k) => { ui.metric = k; rerender(); })),
    controlRow('↔', '物件属性',
      segmented(ui.attr, Object.entries(ATTRS).map(([k, v]) => [k, v.label]),
        (k) => { ui.attr = k; rerender(); })),
    controlRow('◍', '色分け',
      el('div', { style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap' },
        select(ui.group, Object.entries(GROUPINGS).map(([k, v]) => [k, v.label]),
          (k) => { ui.group = k; rerender(); }, 'picksel'),
        toggle('近似直線と相場の幅', ui.fit, (v) => { ui.fit = v; rerender(); }),
      )),
  );

  const chart = scatterChart(series, {
    xLabel: `${attr.label}（${attr.unit}）`,
    yLabel: `${metric.label}（${metric.unit}）`,
    fit, xTick: attr.tick, height: 340,
  });

  const body = valid.length
    ? el('div', { class: 'panel-chart' },
      el('div', { class: 'panel-chart-head' },
        el('span', { class: 'panel-chart-title' },
          metric.label, el('small', {}, '×'), attr.label),
        fit ? el('div', { class: 'fitbadge' },
          el('span', {}, '相関 ', el('b', {}, fit.r.toFixed(2)), `（${strength(fit.r)}）`),
          el('span', {}, `${attr.label}+1${attr.unit} → `, el('b', {}, `${signed(fit.slope)}${metric.unit}`)),
          el('span', {}, '相場の幅 ', el('b', {}, `±${fmt.n(fit.sd, 1)}`)),
          el('span', {}, el('b', {}, `${fit.n}件`)),
        ) : null,
      ),
      el('div', { class: 'chartwrap' }, chart),
      series.length > 1 ? chartLegend(series, chart) : null,
      !fit && ui.fit && valid.length < 3
        ? el('div', { class: 'tiny muted', style: 'margin-top:8px' }, '近似直線には3件以上必要')
        : null,
    )
    : el('div', { class: 'panel-chart' },
      el('div', { class: 'empty' }, `${attr.label} と ${metric.label} が未入力です`));

  return el('div', { class: 'section' },
    el('h3', {}, '傾向分析'),
    el('div', { class: 'panel' }, controls, body));
}

/** 相関の強さを言葉にする。r の数値だけでは判断しづらいため */
const strength = (r) => {
  const a = Math.abs(r);
  return a >= 0.8 ? 'とても強い' : a >= 0.6 ? '強い' : a >= 0.4 ? 'ややあり' : a >= 0.2 ? '弱い' : 'ほぼ無関係';
};
const signed = (v) => `${v > 0 ? '+' : ''}${fmt.n(v, Math.abs(v) >= 100 ? 0 : 2)}`;

/* =========================================================
   割安度（回帰線からの乖離）
   ========================================================= */
function valueSection(rows) {
  const { fit, list } = residuals(rows, ui.metric, ui.attr);
  if (!fit) return null;
  const metric = METRICS[ui.metric], attr = ATTRS[ui.attr];

  return el('div', { class: 'section' },
    el('h3', {}, `割安・割高　${attr.label}から見た${metric.label}`),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp valuetable' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'lab' }, '部屋'),
          el('th', {}, `実際の${metric.label}`),
          el('th', {}, '相場からの期待値'),
          el('th', {}, '差'),
          el('th', {}, '乖離率'),
        )),
        el('tbody', {}, list.map((d) => el('tr', {},
          el('td', { class: 'lab' },
            el('div', { class: 'tiny muted' }, d.row.b.name),
            el('div', {}, d.row.r.label)),
          el('td', {}, fmt.n(d.actual, 1)),
          el('td', {}, fmt.n(d.expected, 1)),
          el('td', { class: d.diff < 0 ? 'best' : 'worse' }, `${d.diff > 0 ? '+' : ''}${fmt.n(d.diff, 1)}`),
          el('td', { class: d.diff < 0 ? 'best' : 'worse' }, `${d.ratio > 0 ? '+' : ''}${(d.ratio * 100).toFixed(1)}%`),
        ))),
      )),
  );
}

/* =========================================================
   エリア別の相場
   ========================================================= */
function areaSection(rows) {
  const hasAddress = rows.some((x) => x.b.address);
  const key = hasAddress ? 'town' : 'building';
  const stats = groupStats(rows, key, ui.metric);
  const metric = METRICS[ui.metric];

  return el('div', { class: 'section' },
    el('h3', {}, hasAddress ? 'エリア別の相場' : '建物別の相場'),

    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp valuetable' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'lab' }, '区分'),
          el('th', {}, '件数'),
          el('th', {}, '割合'),
          el('th', {}, `平均${metric.label}`),
          el('th', {}, '中央値'),
          el('th', {}, '最安'),
          el('th', {}, '最高'),
        )),
        el('tbody', {}, [
          ...stats.map((s) => el('tr', {},
            el('td', { class: 'lab' }, s.name),
            el('td', {}, `${s.count}件`),
            el('td', {}, `${s.ratio.toFixed(0)}%`),
            el('td', {}, fmt.n(s.avg, 1)),
            el('td', {}, fmt.n(s.median, 1)),
            el('td', { class: 'best' }, fmt.n(s.min, 1)),
            el('td', {}, fmt.n(s.max, 1)),
          )),
          totalRow(rows, metric),
        ]),
      )),
  );
}

function totalRow(rows, metric) {
  const vals = rows.map((x) => metric.get(x)).filter(Number.isFinite);
  if (!vals.length) return null;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return el('tr', { class: 'totalrow' },
    el('td', { class: 'lab' }, '全体'),
    el('td', {}, `${vals.length}件`),
    el('td', {}, '100%'),
    el('td', {}, fmt.n(avg, 1)),
    el('td', {}, fmt.n([...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)], 1)),
    el('td', {}, fmt.n(Math.min(...vals), 1)),
    el('td', {}, fmt.n(Math.max(...vals), 1)),
  );
}

/* =========================================================
   分布（ヒストグラム）
   ========================================================= */
function distributionSection(rows, rerender) {
  const metric = METRICS[ui.histMetric];
  const vals = rows.map((x) => ({ v: metric.get(x), closed: CLOSED_STATUS.includes(x.r.listingStatus) }))
    .filter((d) => Number.isFinite(d.v));
  if (!vals.length) return null;

  const { bins } = histogram(vals.map((d) => d.v));
  const filled = bins.map((b) => {
    const inBin = vals.filter((d) => d.v >= b.from && d.v < b.to + (b === bins[bins.length - 1] ? 1e-9 : 0));
    return { ...b, a: inBin.filter((d) => !d.closed).length, b: inBin.filter((d) => d.closed).length };
  });

  return el('div', { class: 'section' },
    el('h3', {}, '価格帯の分布'),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-controls' },
        controlRow('▥', '分類',
          segmented(ui.histMetric, Object.entries(METRICS).map(([k, v]) => [k, v.label]),
            (k) => { ui.histMetric = k; rerender(); }))),
      el('div', { class: 'panel-chart' },
        el('div', { class: 'chartwrap' },
          histogramChart(filled, { xLabel: `${metric.label}（${metric.unit}）`, height: 260 })),
        el('div', { class: 'chart-legend' },
          el('span', {}, el('i', { style: `background:${SERIES_COLORS[0]}` }), '募集中'),
          el('span', {}, el('i', { style: 'background:var(--text-3)' }), '募集終了・成約'),
        ))),
  );
}

/* =========================================================
   時系列の推移
   ========================================================= */
function trendSection(rows) {
  const trend = monthlyTrend(rows, 'tsubo');
  if (trend.length < 2) {
    return el('div', { class: 'section' },
      el('h3', {}, '相場の推移'),
      el('div', { class: 'help' },
        '各部屋の「販売活動」に価格の推移を入れると、月ごとの平均坪単価の動きがここに出ます。'
        + '過去の募集情報を入れるほど、相場が上がっているのか下がっているのかが見えるようになります。'));
  }
  return el('div', { class: 'section' },
    el('h3', {}, '相場の推移（月平均の坪単価）'),
    el('div', { class: 'panel' }, el('div', { class: 'panel-chart' },
      el('div', { class: 'chartwrap' },
        stepChart([{ name: '平均坪単価', points: trend, open: true }], { height: 260 })))),
    el('div', { class: 'tiny muted', style: 'margin-top:8px' },
      `${trend.length}か月分のデータ。登録されている価格改定をすべて月単位で平均しています。`),
  );
}
