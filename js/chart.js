// 価格推移のステップチャート。依存なしの SVG を組み立てる。
// 価格は改定日に階段状に変わるため、線形補間ではなく段で描く。

const NS = 'http://www.w3.org/2000/svg';
// 系列の色。散布図では任意の2点が隣り合うので、全ペアを色覚シミュレーション（P型・D型）
// 込みで検証した6色に限る。この6色を超えたら色を増やさず「その他」にまとめる。
export const SERIES_COLORS = ['#3186e9', '#cf7b26', '#00a089', '#ba3661', '#864ebc', '#577000'];
// 色が尽きた系列をまとめる中立色。個々の識別は点を押したときの吹き出しが担う
export const SERIES_MUTED = '#7d7a72';

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
  const raw = Math.abs(range) / targetTicks;
  // 0 を返すと目盛りの for ループが進まなくなるため、必ず正の値にする
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag || 1;
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

/**
 * グラフの凡例。chart に散布図を渡すと、項目にさわった系列だけを残せる
 * （15件の凡例から色で点を探すのは無理なので、逆から辿れるようにする）
 */
export function chartLegend(series, chart = null) {
  const box = document.createElement('div');
  box.className = 'chart-legend' + (chart ? ' is-live' : '');
  let pinned = null;
  const items = [];
  series.filter((s) => s.points?.length).forEach((s, i) => {
    const item = document.createElement(chart ? 'button' : 'span');
    if (chart) item.type = 'button';
    item.innerHTML = `<i style="background:${s.color || SERIES_COLORS[i % SERIES_COLORS.length]}"></i>`;
    item.append(s.name);
    box.append(item);
    if (!chart) return;
    items.push({ el: item, name: s.name });
    const paint = () => items.forEach((b) => b.el.classList.toggle('is-on', pinned === b.name));
    item.addEventListener('pointerenter', () => { if (pinned == null) chart.focusSeries(s.name); });
    item.addEventListener('pointerleave', () => { if (pinned == null) chart.focusSeries(null); });
    item.addEventListener('click', () => {
      pinned = pinned === s.name ? null : s.name;
      chart.focusSeries(pinned);
      paint();
    });
  });
  return box;
}


/* =========================================================
   散布図（相関を見る）
   ========================================================= */

/**
 * @param {Array} series [{name, color, points:[{x,y,label,info}]}]
 *   label は吹き出しの見出し、info は吹き出しの本文（最大3行）
 * @param {object} opts { xLabel, yLabel, xUnit, yUnit, fit, height, xTick }
 *   fit は linearFit() の結果。渡すと近似直線と±1σの帯を描く
 * @returns {SVGElement} focusSeries(name) で系列を絞れる
 */
export function scatterChart(series, opts = {}) {
  const { xLabel = '', yLabel = '', fit = null, height = 320, xTick = null } = opts;
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return n('svg', { viewBox: '0 0 10 10' });

  const W = 780, H = height;
  const pad = { t: 14, r: 18, b: 44, l: 74 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  const span = (vals) => {
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= Math.abs(lo || 1) * 0.1; hi += Math.abs(hi || 1) * 0.1; }
    const p = (hi - lo) * 0.08;
    return [lo - p, hi + p];
  };
  const [x0, x1] = span(pts.map((p) => p.x));
  const [y0, y1] = span(pts.map((p) => p.y));
  const X = (v) => pad.l + ((v - x0) / (x1 - x0)) * iw;
  const Y = (v) => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;

  const svg = n('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'xMidYMid meet' });

  // グリッドと目盛り
  const yStep = niceStep(y1 - y0, 5);
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) {
    svg.append(
      n('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'chart-grid' }),
      n('text', { x: pad.l - 8, y: Y(v) + 4, class: 'chart-lab', 'text-anchor': 'end' }, trim(v)),
    );
  }
  const xStep = niceStep(x1 - x0, 6);
  let lastLabel = null;
  for (let v = Math.ceil(x0 / xStep) * xStep; v <= x1; v += xStep) {
    const label = xTick ? xTick(v) : trim(v);
    svg.append(n('line', { x1: X(v), x2: X(v), y1: pad.t, y2: pad.t + ih, class: 'chart-grid' }));
    // 竣工年のように丸めると同じ文字列が続く軸では、重複した目盛りを出さない
    if (label !== lastLabel) {
      svg.append(n('text', { x: X(v), y: H - 24, class: 'chart-lab', 'text-anchor': 'middle' }, label));
      lastLabel = label;
    }
  }

  // 近似直線と相場の帯（±1σ）
  if (fit) {
    const line = (d) => [[x0, fit.slope * x0 + fit.intercept + d], [x1, fit.slope * x1 + fit.intercept + d]];
    const [a1, b1] = line(fit.sd), [a2, b2] = line(-fit.sd);
    svg.append(n('path', {
      d: `M ${X(a1[0])} ${Y(a1[1])} L ${X(b1[0])} ${Y(b1[1])} L ${X(b2[0])} ${Y(b2[1])} L ${X(a2[0])} ${Y(a2[1])} Z`,
      fill: 'var(--accent)', opacity: '.08',
    }));
    const [p, q] = line(0);
    svg.append(n('line', {
      x1: X(p[0]), y1: Y(p[1]), x2: X(q[0]), y2: Y(q[1]),
      stroke: 'var(--accent)', 'stroke-width': 1.8, 'stroke-dasharray': '7 5', opacity: '.8', 'stroke-linecap': 'round',
    }));
  }

  svg.append(
    n('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + ih, y2: pad.t + ih, class: 'chart-axis' }),
    n('line', { x1: pad.l, x2: pad.l, y1: pad.t, y2: pad.t + ih, class: 'chart-axis' }),
    n('text', { x: pad.l + iw / 2, y: H - 6, class: 'chart-lab', 'text-anchor': 'middle' }, xLabel),
    n('text', { x: 14, y: pad.t + ih / 2, class: 'chart-lab', 'text-anchor': 'middle',
      transform: `rotate(-90 14 ${pad.t + ih / 2})` }, yLabel),
  );

  // 点。件数が増えるほど小さくする（20件で約4.5、50件を超えると3で止める）。
  // 小さい点は押しにくいので、当たり判定は透明な円を別に重ねて確保する。
  const R = Math.max(3, Math.min(5.5, 20 / Math.sqrt(pts.length)));
  const dots = [];
  series.forEach((s, si) => {
    const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length];
    for (const p of s.points) {
      const c = n('circle', { cx: X(p.x), cy: Y(p.y), r: R, fill: color, opacity: '.9',
        stroke: 'var(--surface)', 'stroke-width': Math.min(2, R / 2.6), class: 'dot' });
      svg.append(c);
      dots.push({ el: c, name: s.name, x: X(p.x), y: Y(p.y), p, text: p.label || s.name });
    }
  });
  // 当たり判定は点より大きく取る。点の上に重ねるので、描画はすべて済ませてから
  const hitR = Math.max(R + 5, 10);

  // 点にさわると出る吹き出し。既定の title は出るまで遅く、指では出ない。
  // クリックすると留まるので、名前が重なって出せなかった点もここで読める。
  const tip = n('g', { class: 'chart-tip', visibility: 'hidden' });
  const tipBg = n('rect', { rx: 7, class: 'chart-tip-bg' });
  const tipName = n('text', { class: 'chart-tip-n' });
  const tipLines = [0, 1, 2].map(() => n('text', { class: 'chart-tip-v' }));
  tip.append(tipBg, tipName, ...tipLines);
  svg.append(tip);
  let pinned = null;

  const showTip = (d) => {
    const info = d.p.info?.length ? d.p.info : [`${xLabel} ${trim(d.p.x)}　${yLabel} ${trim(d.p.y)}`];
    tipName.textContent = d.text;
    tipLines.forEach((t, i) => {
      t.textContent = info[i] || '';
      t.setAttribute('visibility', info[i] ? 'visible' : 'hidden');
    });
    const shown = tipLines.filter((t) => t.textContent);
    const PX = 10, PY = 8, LH = 15;
    const tw = Math.max(tipName.getComputedTextLength(),
      ...shown.map((t) => t.getComputedTextLength())) + PX * 2;
    const th = 13 + LH * shown.length + PY * 2;
    let bx = d.x + 13, by = d.y - th - 10;
    if (bx + tw > W - 3) bx = d.x - 13 - tw;     // 右端では左に開く
    if (by < 3) by = d.y + 14;                   // 上端では下に開く
    // それでも収まらない場合は枠の中へ押し込む。はみ出すと外側で切られて読めなくなる
    bx = Math.max(3, Math.min(bx, W - tw - 3));
    by = Math.max(3, Math.min(by, H - th - 3));
    tipBg.setAttribute('x', bx); tipBg.setAttribute('y', by);
    tipBg.setAttribute('width', tw); tipBg.setAttribute('height', th);
    tipName.setAttribute('x', bx + PX);
    tipName.setAttribute('y', by + PY + 11);
    shown.forEach((t, i) => {
      t.setAttribute('x', bx + PX);
      t.setAttribute('y', by + PY + 13 + LH * (i + 1));
    });
    for (const q of dots) {
      q.el.classList.toggle('is-hot', q === d);
      q.el.setAttribute('r', q === d ? R + 2.5 : R);   // 押した点だけ少し大きくする
    }
    tip.setAttribute('visibility', 'visible');
  };
  const hideTip = () => {
    for (const d of dots) { d.el.classList.remove('is-hot'); d.el.setAttribute('r', R); }
    tip.setAttribute('visibility', 'hidden');
  };
  for (const d of dots) {
    const hit = n('circle', { cx: d.x, cy: d.y, r: hitR, fill: 'transparent', class: 'dothit' });
    svg.insertBefore(hit, tip);
    hit.addEventListener('pointerenter', () => { if (!pinned) showTip(d); });
    hit.addEventListener('click', (e) => {
      e.stopPropagation();
      pinned = pinned === d ? null : d;          // もう一度押すと閉じる
      if (pinned) showTip(d); else hideTip();
    });
  }
  svg.addEventListener('pointerleave', () => { if (!pinned) hideTip(); });
  svg.addEventListener('click', () => { pinned = null; hideTip(); });

  /** 凡例から呼ぶ。指定した系列だけ残して他を薄くする（null で解除） */
  svg.focusSeries = (name) => {
    for (const d of dots) d.el.classList.toggle('is-dim', name != null && d.name !== name);
  };

  return svg;
}

/* =========================================================
   度数分布（ヒストグラム）
   ========================================================= */

/**
 * @param {Array} bins histogram() の bins に { a, b } の内訳を足したもの
 *   a = 手前の色で積む件数、b = 奥の色で積む件数
 */
export function histogramChart(bins, opts = {}) {
  const { xLabel = '', height = 260, fmt: fmtX = trim, legend = ['募集中', '募集終了'] } = opts;
  if (!bins.length) return n('svg', { viewBox: '0 0 10 10' });

  const W = 780, H = height;
  const pad = { t: 14, r: 16, b: 52, l: 52 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxN = Math.max(...bins.map((b) => b.a + b.b), 1);

  const svg = n('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'xMidYMid meet' });
  const Y = (v) => pad.t + ih - (v / maxN) * ih;

  const step = niceStep(maxN, 4) || 1;
  for (let v = 0; v <= maxN; v += step) {
    svg.append(
      n('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'chart-grid' }),
      n('text', { x: pad.l - 8, y: Y(v) + 4, class: 'chart-lab', 'text-anchor': 'end' }, String(Math.round(v))),
    );
  }

  const bw = iw / bins.length;
  const every = Math.ceil(bins.length / 10);
  bins.forEach((b, i) => {
    const x = pad.l + i * bw + bw * 0.12;
    const w = bw * 0.76;
    const hA = (b.a / maxN) * ih, hB = (b.b / maxN) * ih;
    if (hB) svg.append(n('rect', { x, y: Y(b.a + b.b), width: w, height: hB, fill: 'var(--text-3)', opacity: '.75', rx: 2 }));
    if (hA) svg.append(n('rect', { x, y: Y(b.a), width: w, height: hA, fill: SERIES_COLORS[0], rx: 2 }));
    const rect = n('rect', { x, y: pad.t, width: w, height: ih, fill: 'transparent' });
    rect.append(n('title', {}, `${fmtX(b.from)} 〜 ${fmtX(b.to)}\n${legend[0]} ${b.a}件 / ${legend[1]} ${b.b}件`));
    svg.append(rect);
    if (i % every === 0) {
      svg.append(n('text', {
        x: x + w / 2, y: H - 26, class: 'chart-lab', 'text-anchor': 'end',
        transform: `rotate(-40 ${x + w / 2} ${H - 26})`,
      }, fmtX(b.from)));
    }
  });

  svg.append(
    n('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + ih, y2: pad.t + ih, class: 'chart-axis' }),
    n('text', { x: pad.l + iw / 2, y: H - 4, class: 'chart-lab', 'text-anchor': 'middle' }, xLabel),
  );
  return svg;
}

/** 目盛りに出す数値を読みやすく丸める */
function trim(v) {
  const a = Math.abs(v);
  if (a >= 10000) return Math.round(v).toLocaleString('ja-JP');
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}


/* =========================================================
   折れ線（横軸が数値）
   ========================================================= */

/**
 * @param {Array} series [{ name, color, points: [{x, y}] }]
 * @param {object} opts { xLabel, yLabel, height, marks: [{x, label}] }
 */
export function lineChart(series, opts = {}) {
  const {
    xLabel = '', yLabel = '', height = 300, marks = [], xUnit = '',
    baseline = 'auto',   // 'zero' なら0を基準にする。収支の推移は差が潰れるので既定は auto
  } = opts;
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return n('svg', { viewBox: '0 0 10 10' });

  const W = 780, H = height;
  const pad = { t: 30, r: 16, b: 44, l: 76 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = baseline === 'zero' ? Math.min(0, ...ys) : Math.min(...ys);
  let y1 = Math.max(...ys);
  if (y0 === y1) { y0 -= Math.abs(y0 || 1) * 0.1; y1 += Math.abs(y1 || 1) * 0.1; }
  const span = y1 - y0;
  if (baseline !== 'zero') y0 -= span * 0.18;   // 折れ線が枠の上端に貼りつかないよう余白をとる
  y1 += span * 0.14;

  const X = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * iw;
  const Y = (v) => pad.t + ih - ((v - y0) / (y1 - y0)) * ih;

  const svg = n('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'xMidYMid meet' });

  const yStep = niceStep(y1 - y0, 5);
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) {
    svg.append(
      n('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'chart-grid' }),
      n('text', { x: pad.l - 8, y: Y(v) + 4, class: 'chart-lab', 'text-anchor': 'end' }, trim(v)),
    );
  }
  const xStep = niceStep(x1 - x0, 8);
  for (let v = Math.ceil(x0 / xStep) * xStep; v <= x1; v += xStep) {
    svg.append(n('text', { x: X(v), y: H - 24, class: 'chart-lab', 'text-anchor': 'middle' }, `${trim(v)}${xUnit}`));
  }

  // 支出が変わる節目に縦線を引く
  // 節目が近いとラベルが重なるので、直前との距離を見て段をずらす
  let lastX = -Infinity, level = 0;
  for (const mk of [...marks].sort((a, b) => a.x - b.x)) {
    if (mk.x < x0 || mk.x > x1) continue;
    const px = X(mk.x);
    level = px - lastX < 120 ? (level + 1) % 2 : 0;
    lastX = px;
    const near = px > pad.l + iw * 0.72;
    svg.append(
      n('line', { x1: px, x2: px, y1: pad.t - 10, y2: pad.t + ih,
        stroke: 'var(--text-3)', 'stroke-width': 1, 'stroke-dasharray': '3 4', opacity: '.55' }),
      n('text', {
        x: px + (near ? -6 : 6), y: pad.t - 14 + level * 13, class: 'chart-lab',
        'text-anchor': near ? 'end' : 'start',
      }, mk.label),
    );
  }

  svg.append(
    n('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + ih, y2: pad.t + ih, class: 'chart-axis' }),
    n('text', { x: pad.l + iw / 2, y: H - 6, class: 'chart-lab', 'text-anchor': 'middle' }, xLabel),
    n('text', { x: 14, y: pad.t + ih / 2, class: 'chart-lab', 'text-anchor': 'middle',
      transform: `rotate(-90 14 ${pad.t + ih / 2})` }, yLabel),
  );

  series.forEach((s, si) => {
    const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length];
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'} ${X(p.x)} ${Y(p.y)}`).join(' ');
    if (s.fill) {
      svg.append(n('path', {
        d: `${d} L ${X(s.points[s.points.length - 1].x)} ${pad.t + ih} L ${X(s.points[0].x)} ${pad.t + ih} Z`,
        fill: color, opacity: '.12',
      }));
    }
    // 比較用の線は破線にする。色だけだと重なったときにどちらか分からない
    svg.append(n('path', {
      d, fill: 'none', stroke: color, 'stroke-width': s.dashed ? 2 : 2.4,
      'stroke-linejoin': 'round', 'stroke-dasharray': s.dashed ? '6 5' : null,
    }));
  });

  return svg;
}

/* =========================================================
   積み上げ棒
   ========================================================= */

/**
 * @param {Array} bars [{ name, parts: [{ label, value, color }] }]
 */
export function stackedBarChart(bars, opts = {}) {
  const { height = 320, unit = '万円' } = opts;
  const totals = bars.map((b) => b.parts.reduce((s, p) => s + Math.max(0, p.value), 0));
  const max = Math.max(...totals, 1);

  const W = 780, H = height;
  const pad = { t: 16, r: 16, b: 46, l: 66 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const Y = (v) => pad.t + ih - (v / max) * ih;

  const svg = n('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'xMidYMid meet' });

  const step = niceStep(max, 5);
  for (let v = 0; v <= max; v += step) {
    svg.append(
      n('line', { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), class: 'chart-grid' }),
      n('text', { x: pad.l - 8, y: Y(v) + 4, class: 'chart-lab', 'text-anchor': 'end' }, trim(v)),
    );
  }

  const slot = iw / bars.length;
  const bw = Math.min(140, slot * 0.5);
  bars.forEach((bar, i) => {
    const cx = pad.l + slot * (i + 0.5);
    const x = cx - bw / 2;
    let acc = 0;
    bar.parts.filter((p) => p.value > 0).forEach((p, j) => {
      const h = (p.value / max) * ih;
      const rect = n('rect', {
        x, y: Y(acc + p.value), width: bw, height: Math.max(1, h),
        fill: p.color || SERIES_COLORS[j % SERIES_COLORS.length], rx: 2,
      });
      rect.append(n('title', {}, `${p.label}　${trim(p.value)}${unit}`));
      svg.append(rect);
      // 帯が十分に高いときだけラベルを載せる
      if (h > 22) {
        svg.append(n('text', {
          x: cx, y: Y(acc + p.value / 2) + 4, 'text-anchor': 'middle',
          fill: '#fff', 'font-size': 11, 'font-weight': 700, 'font-family': 'inherit',
        }, `${p.label} ${trim(p.value)}`));
      }
      acc += p.value;
    });
    svg.append(
      n('text', { x: cx, y: Y(acc) - 8, 'text-anchor': 'middle', class: 'chart-lab' },
        `${trim(acc)}${unit}`),
      n('text', { x: cx, y: H - 22, 'text-anchor': 'middle', class: 'chart-lab',
        'font-size': 12.5 }, bar.name),
    );
  });

  svg.append(n('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + ih, y2: pad.t + ih, class: 'chart-axis' }));
  return svg;
}
