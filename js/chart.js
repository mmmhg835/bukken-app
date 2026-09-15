// 価格推移のステップチャート。依存なしの SVG を組み立てる。
// 価格は改定日に階段状に変わるため、線形補間ではなく段で描く。

const NS = 'http://www.w3.org/2000/svg';
export const SERIES_COLORS = ['#2563eb', '#0d9488', '#d97706', '#db2777', '#7c3aed', '#65a30d'];

function n(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  e.append(...kids.filter(Boolean));
  return e;
}

const parse = (d) => Date.parse(d);
const fmtMan = (v) => `${Math.round(v).toLocaleString('ja-JP')}万`;
const fmtDate = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 目盛りが半端な値にならないよう、1/2/5×10ⁿ に丸める */
function niceStep(range, targetTicks) {
  const raw = range / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * @param {Array} series [{ name, color, points: [{date:'YYYY-MM-DD', price}], open: boolean }]
 *   open が true なら最終点から右端まで水平に伸ばす（まだ募集中の意味）
 * @param {object} opts { height }
 * @returns {SVGElement}
 */
export function stepChart(series, { height = 280 } = {}) {
  const live = series.filter((s) => s.points?.length);
  if (!live.length) return n('svg', { viewBox: '0 0 10 10' });

  const W = 760, H = height;
  const pad = { t: 16, r: 16, b: 34, l: 66 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  const times = live.flatMap((s) => s.points.map((p) => parse(p.date)));
  const vals = live.flatMap((s) => s.points.map((p) => p.price));
  let t0 = Math.min(...times), t1 = Math.max(...times);
  if (t0 === t1) { t0 -= 15 * 864e5; t1 += 15 * 864e5; }   // 1点しかない場合の逃げ
  // 募集中の系列は今日まで伸ばす
  if (live.some((s) => s.open)) t1 = Math.max(t1, Date.now());

  let v0 = Math.min(...vals), v1 = Math.max(...vals);
  const vPad = (v1 - v0) * 0.15 || Math.max(1, v1 * 0.05);
  v0 -= vPad; v1 += vPad;

  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v) => pad.t + ih - ((v - v0) / (v1 - v0)) * ih;

  const svg = n('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });

  // Y 軸グリッド
  const vStep = niceStep(v1 - v0, 4);
  for (let v = Math.ceil(v0 / vStep) * vStep; v <= v1; v += vStep) {
    svg.append(
      n('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'chart-grid' }),
      n('text', { x: pad.l - 8, y: y(v) + 4, class: 'chart-lab', 'text-anchor': 'end' }, fmtMan(v)),
    );
  }

  // X 軸（月単位の目盛り）
  const months = Math.max(1, Math.round((t1 - t0) / (30 * 864e5)));
  const every = Math.ceil(months / 6);
  const d = new Date(t0); d.setDate(1);
  for (let i = 0; d.getTime() <= t1; i++) {
    if (d.getTime() >= t0 && i % every === 0) {
      svg.append(n('text', {
        x: x(d.getTime()), y: H - 12, class: 'chart-lab', 'text-anchor': 'middle',
      }, fmtDate(d.getTime())));
    }
    d.setMonth(d.getMonth() + 1);
  }
  svg.append(n('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + ih, y2: pad.t + ih, class: 'chart-axis' }));

  // 系列
  live.forEach((s, si) => {
    const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length];
    const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
    const dAttr = [];
    pts.forEach((p, i) => {
      const px = x(parse(p.date)), py = y(p.price);
      if (i === 0) dAttr.push(`M ${px} ${py}`);
      else dAttr.push(`H ${px}`, `V ${py}`);   // 横に伸ばしてから縦に落とす＝階段
    });
    if (s.open) dAttr.push(`H ${x(t1)}`);
    svg.append(n('path', { d: dAttr.join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));

    pts.forEach((p) => {
      const c = n('circle', { cx: x(parse(p.date)), cy: y(p.price), r: 4.5, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 });
      c.append(n('title', {}, `${s.name}　${p.date}　${fmtMan(p.price)}`));
      svg.append(c);
    });
  });

  return svg;
}

/** グラフの凡例 */
export function chartLegend(series) {
  const box = document.createElement('div');
  box.className = 'chart-legend';
  series.filter((s) => s.points?.length).forEach((s, i) => {
    const item = document.createElement('span');
    item.innerHTML = `<i style="background:${s.color || SERIES_COLORS[i % SERIES_COLORS.length]}"></i>`;
    item.append(s.name);
    box.append(item);
  });
  return box;
}
