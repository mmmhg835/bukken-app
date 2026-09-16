// ライフプランタブ。項目を編集しながら、物件ごとの月次収支を試算する。
import { store } from './store.js';
import { el, fmt, mount, toast, uid, preserveFocus } from './util.js';
import { kv, select, toggle, segmented, numberInput } from './ui.js';
import {
  calcPlan, housingCost, affordablePrice, waterfall,
  CATEGORIES, isOn, categoryOf, incomePatterns, project, milestones,
  WHO,
} from './lifeplan.js';
import { lineChart, stackedBarChart, chartLegend, SERIES_COLORS } from './chart.js';
import { saleView } from './sale-view.js';

import { derive } from './util.js';

const ui = { afterLoans: false, openGroups: null };

const SUBTABS = [['plan', 'ライフプラン'], ['burden', '返済負担比率'], ['matrix', '金利と価格'],
  ['graph', 'グラフ'], ['sale', '売却']];

/**
 * @param {string} sub 'plan' | 'burden'。物件と収入の前提を共有したまま切り替える
 */
export function renderLifeplan(root, rerender, sub = 'plan') {
  const view = SUBTABS.some(([k]) => k === sub) ? sub : 'plan';
  const plan = store.lifeplan;
  const room = plan.selectedRoomId ? store.room(plan.selectedRoomId) : null;
  const building = room ? store.building(room.buildingId) : null;
  const opts = { excludeTemporary: ui.afterLoans };

  // 指値は「いくらまで下がったら」を見るための仮の価格。
  // このタブの中だけで価格に代えて使い、一覧や分析の現在価格には手を触れない。
  const offerRoom = offerRoomOf(room);
  const res = calcPlan(plan, offerRoom || room, building, store.loanTerms, opts);
  // 指値を入れているときだけ、元値の結果も並べて計算する
  const baseRes = offerRoom ? calcPlan(plan, room, building, store.loanTerms, opts) : null;

  if (!ui.openGroups) ui.openGroups = new Set(['住居費']);
  rerenderOffer = rerender;
  // 金額を打つたびに再描画されるため、フォーカスを保ったまま描き直す
  const mark = () => { store.markDirty(); preserveFocus(rerender); };

  mount(root,
    subTabs(view),
    propertyPicker(plan, room, building, rerender, view),
    offerRoom && view === 'plan'
      ? offerComparison(plan, room, offerRoom, building, res, baseRes) : null,
    view === 'matrix' ? matrixView(plan, offerRoom || room, building)
      : view === 'burden' ? burdenView(plan, offerRoom || room, res, mark, rerender)
        : view === 'graph' ? graphView(plan, offerRoom || room, building, res, offerRoom ? room : null)
          : view === 'sale' ? saleView(plan, offerRoom || room, rerender)
            : planView(plan, offerRoom || room, building, res, mark, rerender,
              baseRes, offerRoom ? room : null),
  );
}

/** 指値が入っていれば、その価格に置き換えた部屋を返す。元の部屋は書き換えない */
function offerRoomOf(room) {
  const p = room?.offerPrice;
  if (room == null || p == null || p === room.price) return null;
  return { ...room, price: p };
}

function subTabs(current) {
  return el('nav', { class: 'subtabs' }, SUBTABS.map(([key, label]) =>
    el('button', {
      class: 'subtab' + (key === current ? ' is-active' : ''),
      onclick: () => { location.hash = key === 'plan' ? '#/plan' : `#/plan/${key}`; },
    }, label)));
}

function planView(plan, room, building, res, mark, rerender, baseRes = null, baseRoom = null) {
  // 物件 → 収入 → 結果 → 支出の順。前提を先に置き、そこから計算結果を見せる
  return el('div', {},
    incomeSection(plan, mark),
    summary(res, plan, rerender),
    housingDetail(res, room, building, baseRes, baseRoom),
    waterfallSection(res, room, building, baseRes),
    groupsSection(plan, res, mark, rerender, baseRes),
    scenarioSection(plan, room, building),
  );
}

/* ===== 物件の選択 ===== */
function propertyPicker(plan, room, building, rerender, view = 'plan') {
  const options = [['', '現在の想定（手入力の住居費）']];
  for (const b of store.buildings) {
    for (const r of store.roomsOf(b.id)) {
      options.push([r.id, `${b.name} ${r.label}　${fmt.man1(r.price)}万円`]);
    }
  }
  return el('div', { class: 'section' },
    el('h3', {}, '試算する物件'),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-controls' },
        el('div', { class: 'ctlrow' },
          el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '⌂'), '物件'),
          el('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap' },
            select(plan.selectedRoomId ?? '', options, (v) => {
              plan.selectedRoomId = v || null;
              store.markDirty();
              rerender();
            }, 'picksel picksel-wide'),
            room
              ? el('a', {
                href: '#', class: 'tiny',
                onclick: (e) => { e.preventDefault(); location.hash = `#/r/${room.id}`; },
              }, '物件の詳細を見る')
              : null,
          )),
        room ? offerRow(room, rerender) : null,
        view === 'plan'
          ? el('div', { class: 'ctlrow' },
            el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '◷'), 'シナリオ'),
            toggle('期限付きの支出（車ローン・奨学金）が終わった後で試算',
              ui.afterLoans, (v) => { ui.afterLoans = v; rerender(); }))
          : null,
      )),
  );
}

/**
 * 指値の入力。値引き幅の目安は押すだけで入るようにする。
 * 交渉の当たりを付けるとき、率から金額を暗算するのが手間になるため。
 */
const OFFER_STEPS = [3, 5, 8, 10];

function offerRow(room, rerender) {
  const base = Number(room.price) || 0;
  const set = (v) => {
    room.offerPrice = v;
    store.markDirty();
    preserveFocus(rerender);
  };
  const diff = room.offerPrice != null ? room.offerPrice - base : null;

  return el('div', { class: 'ctlrow' },
    el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '¥'), '指値'),
    el('div', { class: 'offerrow' },
      numberInput({
        value: room.offerPrice, cls: 'offerinput', fkey: `offer-${room.id}`,
        placeholder: fmt.man1(base),
        onInput: (num) => { room.offerPrice = num; store.markDirty(); preserveFocus(rerender); },
      }),
      el('span', { class: 'tiny muted' }, '万円'),
      el('div', { class: 'tagwrap' },
        OFFER_STEPS.map((pct) => {
          const v = Math.round(base * (1 - pct / 100));
          return el('button', {
            type: 'button', class: 'tag' + (room.offerPrice === v ? ' is-on' : ''),
            title: `${fmt.man1(v)}万円`,
            onclick: () => set(v),
          }, `-${pct}%`);
        })),
      diff != null
        ? el('span', { class: 'tiny ' + (diff < 0 ? 'pos' : diff > 0 ? 'neg' : 'muted') },
          `${diff > 0 ? '+' : ''}${fmt.man1(diff)}万円`
          + (base ? `（${diff > 0 ? '+' : ''}${(diff / base * 100).toFixed(1)}%）` : ''))
        : null,
      room.offerPrice != null
        ? el('button', { class: 'btn btn-sm', onclick: () => set(null) }, '元値に戻す')
        : null,
    ));
}

/**
 * 元値と指値を、家計まるごとで並べる。
 * ローンの数字だけ見ても暮らしがどう変わるか分からないので、
 * 生活費・毎月の残り・将来の資産まで同じ表に載せる。
 */
const offerUI = { diffOnly: false };

function offerComparison(plan, room, offerRoom, building, res, baseRes) {
  const terms = store.loanTerms;
  const hA = housingCost(room, building, terms);
  const hB = housingCost(offerRoom, building, terms);
  const years = Math.max(40, { ...terms, ...(room.loan || {}) }.years + 5);
  const pA = project(plan, room, building, terms, years);
  const pB = project(plan, offerRoom, building, terms, years);
  const assetsAt = (rows, y) => rows.find((r) => r.year === y)?.assets ?? null;
  const running = (h) => h.items[1].amount + h.items[2].amount;

  // [見出し, 元値, 指値, 表示形式, 増えるほうが良いか]
  const sections = [
    ['購入・借入', [
      ['物件価格', room.price, offerRoom.price, 'man', false],
      ['諸費用', hA.loan.fees, hB.loan.fees, 'man', false],
      ['借入額', hA.loan.principal, hB.loan.principal, 'man', false],
      ['購入時の現金', hA.loan.cash, hB.loan.cash, 'man', false],
      ['総返済額', hA.loan.totalPayment, hB.loan.totalPayment, 'man', false],
      ['うち利息', hA.loan.totalInterest, hB.loan.totalInterest, 'man', false],
    ]],
    ['毎月の収支', [
      ['収入合計', baseRes.income, res.income, 'man1', true],
      ['先取りの資産形成', baseRes.saving, res.saving, 'man1', true],
      ['住居費', baseRes.housingTotal, res.housingTotal, 'man1', false],
      ['　ローン返済', hA.items[0].amount, hB.items[0].amount, 'man1', false],
      ['　管理＋修繕', running(hA), running(hB), 'man1', false],
      ['車関連', baseRes.carTotal, res.carTotal, 'man1', false],
      ['その他固定費', baseRes.fixed, res.fixed, 'man1', false],
      ['変動費（いまの入力）', baseRes.variable, res.variable, 'man1', false],
      ['支出合計', baseRes.expense, res.expense, 'man1', false],
      ['変動費に使える上限', baseRes.variableBudget, res.variableBudget, 'man1', true],
      ['毎月の残り', baseRes.balance, res.balance, 'man1', true],
    ]],
    ['長い目で見た差', [
      ['年間の残り', baseRes.yearlyBalance, res.yearlyBalance, 'man', true],
      ['年間の貯蓄', baseRes.yearlySaving, res.yearlySaving, 'man', true],
      ['10年後の資産', assetsAt(pA, 10), assetsAt(pB, 10), 'man', true],
      ['20年後の資産', assetsAt(pA, 20), assetsAt(pB, 20), 'man', true],
      ['30年後の資産', assetsAt(pA, 30), assetsAt(pB, 30), 'man', true],
    ]],
  ];

  const show = (v, kind) => {
    if (v == null) return '—';
    if (kind === 'man') return `${fmt.man1(Math.round(v))}万円`;
    return `${fmt.n(v, 1)}万円`;
  };

  const body = el('tbody');
  let hidden = 0;
  for (const [name, rows] of sections) {
    const visible = rows.filter(([, a, b]) => !offerUI.diffOnly || Math.abs((b ?? 0) - (a ?? 0)) >= 0.05);
    hidden += rows.length - visible.length;
    if (!visible.length) continue;

    body.append(el('tr', { class: 'secrow' },
      el('td', { class: 'lab secrow-lab' }, name),
      el('td', { class: 'secrow-fill' }), el('td', { class: 'secrow-fill' }), el('td', { class: 'secrow-fill' })));

    for (const [label, a, b, kind, upIsGood] of visible) {
      const d = a == null || b == null ? null : b - a;
      const same = d == null || Math.abs(d) < 0.05;
      const better = d != null && (upIsGood ? d > 0 : d < 0);
      body.append(el('tr', {},
        el('td', { class: 'lab' }, label),
        el('td', {}, show(a, kind)),
        el('td', { class: same ? null : 'best' }, show(b, kind)),
        el('td', { class: same ? 'muted' : (better ? 'pos' : 'neg') },
          same ? '—' : `${d > 0 ? '+' : ''}${fmt.n(d, Math.abs(d) < 100 ? 1 : 0)}万円`),
      ));
    }
  }

  return el('div', { class: 'section' },
    el('h3', {}, '元値と指値の比較'),
    el('div', { class: 'toolbar' },
      toggle('差のある項目だけ', offerUI.diffOnly, (v) => { offerUI.diffOnly = v; rerenderOffer(); }),
      offerUI.diffOnly && hidden ? el('span', { class: 'tiny muted' }, `同じ値の ${hidden} 項目を非表示`) : null),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp offercmp' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'lab' }, '項目'),
          el('th', {}, '元値'),
          el('th', {}, '指値'),
          el('th', {}, '差'))),
        body)),
  );
}

/** 比較表のトグルだけのために画面全体を描き直す */
let rerenderOffer = () => {};

/* ===== サマリー ===== */
function summary(res, plan, rerender) {
  const positive = res.balance >= 0;
  return el('div', { class: 'section' },
    el('div', { class: 'calcgrid calcgrid-4' },
      kv('収入合計', `${fmt.n(res.income, 1)}万円`, '手取り／月'),
      kv('支出合計', `${fmt.n(res.expense, 1)}万円`, '住居費・生活費・積立'),
      kv('毎月の残り', el('span', { class: positive ? 'pos' : 'neg' },
        `${positive ? '+' : ''}${fmt.n(res.balance, 1)}万円`), positive ? '黒字' : '赤字'),
      kv('先取りの資産形成', `${fmt.n(res.saving, 1)}万円`, `貯蓄率 ${res.savingRate.toFixed(1)}%`),
      kv('住居費', `${fmt.n(res.housingTotal, 1)}万円`,
        res.housingFromRoom ? 'ローン＋管理＋修繕' : '手入力の想定額'),
      kv('車代', `${fmt.n(res.carTotal, 1)}万円`, '駐車場・ローン・維持費'),
      kv('その他固定費', `${fmt.n(res.fixed, 1)}万円`, '住居費・車代を除く'),
      kv('変動費', `${fmt.n(res.variable, 1)}万円`,
        `使える上限 ${fmt.n(res.variableBudget, 1)}万円`),
    ),
    el('div', { class: 'stackbar' }, res.groups.map((g, i) =>
      g.total > 0
        ? el('span', {
          class: 'stackseg' + (g.kind === 'saving' ? ' is-saving' : g.kind === 'housing' ? ' is-housing' : ''),
          style: `flex:${g.total}`, title: `${g.name} ${fmt.n(g.total, 1)}万円`,
        }, g.total / res.income > 0.09 ? g.name : '')
        : null),
      res.balance > 0
        ? el('span', { class: 'stackseg is-left', style: `flex:${res.balance}`, title: `残り ${fmt.n(res.balance, 1)}万円` })
        : null),
    plan.bonus
      ? el('div', { class: 'bonusrow' },
        el('span', { class: 'tiny muted' }, `賞与 年${fmt.n(plan.bonus.annual, 1)}万円`),
        toggle('計画に含める', !!plan.bonus.include, (v) => {
          plan.bonus.include = v; store.markDirty(); rerender();
        }))
      : null,
  );
}

/* ===== 住居費の内訳 ===== */
function housingDetail(res, room, building, baseRes = null, baseRoom = null) {
  if (!res.housingFromRoom) return null;
  const manual = store.lifeplan.groups.find((g) => g.kind === 'housing').items
    .reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const diff = res.housingFromRoom.total - manual;
  const t = { ...store.loanTerms, ...(room.loan || {}) };

  // 指値が入っているときは、差を添え字で足さずに元値と指値を1組ずつ並べる。
  // 添え字だと、どの数字がどちらの前提のものか読み取れないため。
  const blocks = baseRoom
    ? [['元値', baseRoom, housingCost(baseRoom, building, store.loanTerms)],
      ['指値', room, res.housingFromRoom]]
    : [[null, room, res.housingFromRoom]];

  return el('div', { class: 'section' },
    el('h3', {}, `${building.name} ${room.label} の住居費`),
    blocks.map(([label, r, h]) => housingBlock(label, r, h, t)),
    el('div', { class: 'tiny muted', style: 'margin-top:8px' },
      '現在の想定（', fmt.n(manual, 1), '万円）との差　',
      el('b', { class: diff <= 0 ? 'pos' : 'neg' }, `${diff > 0 ? '+' : ''}${fmt.n(diff, 1)}万円`)),
  );
}

/** 住居費の1組（月々の内訳と、購入・借入の内訳）。元値と指値で同じ形を使う */
function housingBlock(label, room, h, t) {
  const loan = h.loan;
  const inc = t.includeFees;
  const man = (v) => `${fmt.man1(Math.round(v ?? 0))}万円`;
  // ローン返済がいくらの借入に対するものかを、その場で言い切る。
  // 諸費用を借入に含めるかどうかで額が変わり、表だけでは判断できないため。
  const loanSub = `借入 ${man(loan?.principal)}（${inc ? '諸費用を含む' : '諸費用は含まない'}）の返済`;

  return el('div', { class: 'hblock' + (label === '指値' ? ' is-offer' : '') },
    label
      ? el('div', { class: 'hblock-label' }, label,
        el('span', { class: 'amt' }, `物件価格 ${fmt.man1(room.price)}万円`))
      : null,
    el('div', { class: 'calcgrid calcgrid-4' },
      ...h.items.map((it, i) => kv(it.name, `${fmt.n(it.amount, 1)}万円`, i === 0 ? loanSub : null)),
      kv('住居費 合計', `${fmt.n(h.total, 1)}万円`, `ローン ${t.rate}% ${t.years}年`),
    ),
    el('div', { class: 'calcgrid calcgrid-4', style: 'margin-top:10px' },
      kv('物件価格', `${fmt.man1(room.price)}万円`, label === '指値' ? '指値' : '掲載価格'),
      kv('諸費用', man(loan?.fees),
        `価格の${t.costRate}%${t.costFixed ? ` ＋ ${t.costFixed}万円` : ''}`),
      kv('借入額', man(loan?.principal), inc ? '物件価格＋諸費用−頭金' : '物件価格−頭金'),
      kv('購入時の現金', man(loan?.cash), inc ? '頭金のみ' : '頭金＋諸費用'),
    ),
  );
}

function waterfallSection(res, room, building, baseRes = null) {
  const w = waterfall(res, room ? `${building.name} ${room.label}` : null);
  const yen = (v) => `${fmt.n(v, 1)}万円`;

  const stepRow = (st, i) => el('div', { class: 'wfstep' },
    el('div', { class: 'wfstep-head' },
      el('span', { class: 'wfstep-no' }, String(i + 1)),
      el('span', { class: 'wfstep-label' }, st.label),
      el('span', { class: 'wfstep-minus' }, `− ${yen(st.amount)}`),
    ),
    el('div', { class: 'wfstep-detail' },
      st.items.length
        ? st.items.map((it) => el('span', { class: 'wfchip' }, `${it.name} ${fmt.n(it.amount, 1)}`))
        : el('span', { class: 'tiny muted' }, st.note)),
    el('div', { class: 'wfstep-after' },
      el('span', { class: 'tiny muted' }, '残り'),
      el('b', {}, yen(st.after))),
  );

  return el('div', { class: 'section' },
    el('h3', {}, 'この物件だと、生活費にいくら使えるか'),
    el('div', { class: 'panel wfpanel' },
      el('div', { class: 'wfhead' },
        el('span', {}, '月の手取り収入'),
        el('b', {}, yen(res.income))),
      w.steps.map(stepRow),
      el('div', { class: 'wfresult' },
        el('div', {},
          el('div', { class: 'tiny muted' }, '変動費に使える額'),
          el('div', { class: 'wfresult-big' }, yen(w.variableBudget))),
        el('div', { class: 'wfresult-sub' },
          el('div', {}, `いまの変動費　− ${yen(w.variableActual)}`),
          el('div', { class: w.rest >= 0 ? 'pos' : 'neg' },
            `差し引き　${w.rest >= 0 ? '+' : ''}${yen(w.rest)}`)),
      ),
      el('div', { class: 'wfvar' },
        w.variableItems.map((it) => el('span', { class: 'wfchip' }, `${it.name} ${fmt.n(it.amount, 1)}`))),
    ));
}

const COLOR = {
  base: '#94a3b8',        // 元値の線。指値と見分けつつ、主役にしない
  income: SERIES_COLORS[0],
  expense: SERIES_COLORS[3],
  assets: SERIES_COLORS[1],
  saving: '#0f766e',
  housing: '#2563eb',
  car: '#7c3aed',
  fixed: '#0ea5e9',
  variable: '#94a3b8',
  left: '#d97706',
};

/**
 * @param {object|null} baseRoom 指値を入れているときの元値の部屋。
 *   線を2本並べないと、指値で将来どれだけ差がつくかが読み取れない。
 */
function graphView(plan, room, building, res, baseRoom = null) {
  const years = Math.max(40, (room ? { ...store.loanTerms, ...(room.loan || {}) } : store.loanTerms).years + 5);
  const rows = project(plan, room, building, store.loanTerms, years);
  const baseRows = baseRoom ? project(plan, baseRoom, building, store.loanTerms, years) : null;
  const marks = milestones(plan, room, store.loanTerms)
    .filter((m) => m.year <= years)
    .map((m) => ({ x: m.year, label: m.label }));

  return el('div', {},
    flowSection(rows, marks, baseRows),
    assetSection(rows, marks, baseRows),
    breakdownSection(res),
  );
}

/** 年ごとの収入と支出。支出が段階的に下がる様子を見る */

function flowSection(rows, marks, baseRows = null) {
  const pts = (list, key) => list.map((r) => ({ x: r.year, y: r[key] }));
  const series = [
    { name: '収入', color: COLOR.income, points: pts(rows, 'income') },
    { name: baseRows ? '支出（指値）' : '支出', color: COLOR.expense, points: pts(rows, 'expense') },
    baseRows ? { name: '支出（元値）', color: COLOR.base, dashed: true, points: pts(baseRows, 'expense') } : null,
  ].filter(Boolean);
  const surplus = [
    { name: baseRows ? '年間の残り（指値）' : '年間の残り', color: COLOR.left, fill: !baseRows,
      points: pts(rows, 'balance') },
    baseRows ? { name: '年間の残り（元値）', color: COLOR.base, dashed: true, points: pts(baseRows, 'balance') } : null,
  ].filter(Boolean);
  return el('div', { class: 'section' },
    el('h3', {}, '収入と支出の推移'),
    el('div', { class: 'panel' }, el('div', { class: 'panel-chart' },
      el('div', { class: 'chartwrap' },
        lineChart(series, { xLabel: '経過年数', yLabel: '年額（万円）', xUnit: '年', marks, height: 300 })),
      chartLegend(series),
      el('div', { class: 'subhead', style: 'margin:18px 0 6px' }, '年間の残り'),
      el('div', { class: 'chartwrap' },
        lineChart(surplus, { xLabel: '経過年数', yLabel: '年額（万円）', xUnit: '年', marks, height: 220, baseline: 'zero' })),
      baseRows ? chartLegend(surplus) : null)),
  );
}

/** 積み上がる資産。節目のあとで傾きが変わる */

function assetSection(rows, marks, baseRows = null) {
  const series = [
    { name: baseRows ? '累積資産（指値）' : '累積資産', color: COLOR.assets, fill: !baseRows,
      points: rows.map((r) => ({ x: r.year, y: r.assets })) },
    baseRows
      ? { name: '累積資産（元値）', color: COLOR.base, dashed: true,
        points: baseRows.map((r) => ({ x: r.year, y: r.assets })) }
      : null,
  ].filter(Boolean);
  const at = (y) => rows.find((r) => r.year === y);
  const baseAt = (y) => baseRows?.find((r) => r.year === y);
  return el('div', { class: 'section' },
    el('h3', {}, '資産の積み上がり'),
    el('div', { class: 'panel' }, el('div', { class: 'panel-chart' },
      el('div', { class: 'chartwrap' },
        lineChart(series, { xLabel: '経過年数', yLabel: '累積（万円）', xUnit: '年', marks, height: 280, baseline: 'zero' })),
      baseRows ? chartLegend(series) : null)),
    el('div', { class: 'calcgrid calcgrid-4', style: 'margin-top:12px' },
      ...[5, 10, 20, 30].map((y) => {
        const r = at(y);
        if (!r) return kv(`${y}年後`, '—');
        const b = baseAt(y);
        const d = b ? r.assets - b.assets : null;
        return kv(`${y}年後`, `${fmt.man1(Math.round(r.assets))}万円`,
          d != null
            ? `元値との差 ${d > 0 ? '+' : ''}${fmt.man1(Math.round(d))}万円`
            : `年間 ${fmt.n(r.saving + r.balance, 0)}万円`);
      }),
    ),
  );
}

/** いま入力している金額が、収入と支出でどう釣り合っているか */

function breakdownSection(res) {
  const income = store.lifeplan.income.filter(isOn)
    .map((i, k) => ({ label: i.name, value: Number(i.amount) || 0, color: SERIES_COLORS[k % SERIES_COLORS.length] }));
  if (store.lifeplan.bonus?.include) {
    income.push({ label: '賞与', value: (store.lifeplan.bonus.annual || 0) / 12, color: SERIES_COLORS[4] });
  }

  const expense = [
    { label: '資産形成', value: res.saving, color: COLOR.saving },
    { label: '住居費', value: res.housingTotal, color: COLOR.housing },
    { label: '車代', value: res.carTotal, color: COLOR.car },
    { label: 'その他固定費', value: res.fixed, color: COLOR.fixed },
    { label: '変動費', value: res.variable, color: COLOR.variable },
    { label: '残り', value: Math.max(0, res.balance), color: COLOR.left },
  ];

  return el('div', { class: 'section' },
    el('h3', {}, '毎月の収入と支出'),
    el('div', { class: 'panel' }, el('div', { class: 'panel-chart' },
      el('div', { class: 'chartwrap' },
        stackedBarChart([
          { name: '収入', parts: income },
          { name: '支出', parts: expense },
        ], { height: 340 })))),
  );
}

function burdenView(plan, room, res, mark, rerender) {
  plan.grossIncome ||= {
    primary: { name: '夫', annual: 0 },
    secondary: { name: '妻', annual: 0 },
  };
  const rows = incomePatterns(plan, room, res);

  return el('div', {},
    incomeSettings(plan, mark),
    burdenTable('額面年収', rows, (x) => x.gross, room),
    burdenTable('手取り年収', rows, (x) => x.net, room,
      el('button', {
        class: 'btn btn-sm',
        onclick: () => { location.hash = '#/plan'; },
      }, '手取りを直す（ライフプラン）')),
    room ? null : el('div', { class: 'empty' }, '対象の物件を選んでください'),
  );
}

/**
 * 額面だけをここで入力する。
 * 手取りはライフプランの収入から集計するので、入力欄は置かない。
 * 二か所に持たせると、片方だけ直したときに必ず食い違う。
 *
 * 集計した手取りの額はこのカードには出さない。入力欄（額面）と読み取り専用の
 * 数字（手取り）が同じ行に並ぶと、どちらを直せばいいのか分からなくなるため。
 * 手取りは「手取り年収」の表の側で見せる。
 */
function incomeSettings(plan, mark) {
  const g = plan.grossIncome;

  const row = (who) => el('div', { class: 'incrow' },
    el('input', {
      type: 'text', class: 'lpitem-name', style: 'max-width:110px', value: g[who].name ?? '',
      'data-fkey': `name-${who}`,
      oninput: (e) => { g[who].name = e.target.value; store.markDirty(); },
    }),
    el('span', { class: 'tiny muted' }, '額面'),
    numberInput({
      value: g[who].annual, cls: 'lpitem-input', fkey: `gross-${who}`,
      onInput: (num) => { g[who].annual = num ?? 0; mark(); },
    }),
    el('span', { class: 'tiny muted' }, '万円/年'),
  );

  return el('div', { class: 'section' },
    el('h3', {}, '年収'),
    el('div', { class: 'card', style: 'padding:14px' },
      row('primary'), row('secondary')),
  );
}

function burdenTable(title, rows, pick, room, footer = null) {
  const cell = (v, format, judge) =>
    (v == null ? el('td', { class: 'muted' }, '—')
      : el('td', { class: judge(v) }, format(v)));

  return el('div', { class: 'section' },
    el('h3', {}, `${title}ベース`),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp valuetable' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'lab' }, '年収の見方'),
          el('th', {}, title),
          el('th', {}, thSub('返済負担率', 'ローンのみ')),
          el('th', {}, thSub('返済負担率', '管理費・修繕込み')),
          el('th', {}, thSub('年収倍率', '価格 ÷ 年収')),
        )),
        el('tbody', {}, rows.map((x) => {
          const v = pick(x);
          return el('tr', {},
            el('td', { class: 'lab' }, x.label),
            el('td', {}, `${fmt.man1(Math.round(v.annual))}万円`),
            cell(v.loan, (n) => `${n.toFixed(1)}%`, (n) => (n <= 25 ? 'best' : n <= 35 ? null : 'worse')),
            cell(v.housing, (n) => `${n.toFixed(1)}%`, (n) => (n <= 30 ? 'best' : n <= 40 ? null : 'worse')),
            cell(v.multiple, (n) => `${n.toFixed(1)}倍`, (n) => (n <= 7 ? 'best' : n <= 9 ? null : 'worse')),
          );
        })),
      )),
    footer ? el('div', { class: 'toolbar', style: 'margin-top:10px' }, footer) : null,
  );
}

/** 列見出しに算式と目安を小さく添える。別途の説明文を置かずに済ませる */

function thSub(title, sub) {
  return el('div', { class: 'thsub' }, el('b', {}, title), el('span', {}, sub));
}

/* ===== 金利と価格のマトリクス ===== */

/**
 * 金利が上がったら、価格がいくらなら、毎月どうなるか。
 * ローンの返済額だけでは家計に効いてくる形が見えないので、住居費と毎月の残りを
 * 同じマスに並べる。前提（収入・生活費・車）はライフプランのものをそのまま使う。
 */
function matrixView(plan, room, building) {
  if (!room) return el('div', { class: 'empty' }, '対象の物件を選んでください');
  const terms = store.loanTerms;
  const opts = { excludeTemporary: ui.afterLoans };
  const t = { ...terms, ...(room.loan || {}) };

  // 金利はいまの条件に上振れを3段。同じ値が並ばないよう重複は落とす
  const rates = [...new Set([Number(t.rate), 1.5, 2.0, 2.5])]
    .filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  // 価格は売り出しから500万刻みで下へ。指値が入っていればその額も行に混ぜる
  const steps = [0, 500, 1000, 1500, 2000].map((d) => (room.price ?? 0) - d);
  const prices = [...new Set([...steps, room.offerPrice].filter((v) => v != null && v > 0))]
    .sort((a, b) => b - a);

  const at = (price, rate) => {
    const r2 = { ...room, price, loan: { ...(room.loan || {}), rate } };
    return calcPlan(plan, r2, building, { ...terms, rate }, opts);
  };

  const body = el('tbody', {}, prices.map((price) => {
    const principal = housingCost({ ...room, price }, building, terms).loan.principal;
    const isOffer = room.offerPrice != null && price === room.offerPrice;
    return el('tr', { class: isOffer ? 'is-current' : null },
      el('td', { class: 'lab' }, `${fmt.man1(price)}万円`,
        isOffer ? el('span', { class: 'tiny muted' }, '　指値') : null),
      el('td', { class: 'muted' }, `${fmt.man1(Math.round(principal))}万円`),
      ...rates.map((rate) => {
        const c = at(price, rate);
        const ok = c.balance >= 0;
        return el('td', {},
          el('div', { class: 'mxline' }, el('span', { class: 'dk' }, '住居'),
            el('span', {}, `${fmt.n(c.housingTotal, 1)}万`)),
          el('div', { class: 'mxline' }, el('span', { class: 'dk' }, '残り'),
            el('span', { class: ok ? 'pos' : 'neg' },
              `${ok ? '+' : '▲'}${fmt.n(Math.abs(c.balance), 1)}万`)));
      }));
  }));

  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, `${building?.name ?? ''} ${room.label}　金利と価格`),
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp mxtbl' },
          el('thead', {}, el('tr', {},
            el('th', { class: 'lab' }, '物件価格'),
            el('th', {}, thSub('借入額', t.includeFees ? '諸費用を含む' : '諸費用は現金')),
            ...rates.map((r) => el('th', {},
              thSub(`金利 ${r}%`, `${t.years}年 ${t.method === 'equal' ? '元利均等' : '元金均等'}`))),
          )),
          body))),
  );
}

/* ===== 支出グループ ===== */
function groupsSection(plan, res, mark, rerender, baseRes = null) {
  return el('div', { class: 'section' },
    el('h3', {}, '支出の内訳'),
    plan.groups.map((g) => {
      const calc = res.groups.find((x) => x.id === g.id);
      const open = ui.openGroups.has(g.name);
      const locked = calc?.fromRoom;

      return el('div', { class: 'card lpgroup' },
        el('div', {
          class: 'lpgroup-head',
          onclick: () => { open ? ui.openGroups.delete(g.name) : ui.openGroups.add(g.name); rerender(); },
        },
          el('span', { class: 'sec-caret' + (open ? ' is-open' : '') }, '▸'),
          el('span', { class: 'lpgroup-name' }, g.name),
          locked ? el('span', { class: 'badge badge-ok' }, '物件から自動') : null,
          el('span', { class: 'spacer' }),
          el('span', { class: 'lpgroup-total' }, `${fmt.n(calc?.total ?? 0, 1)}万円`),
        ),
        open
          ? el('div', { class: 'lpgroup-body' },
            (locked ? calc.items : g.items).map((it) => itemRow(g, it, mark, rerender, locked)),
            locked
              ? null
              : el('button', {
                class: 'btn btn-sm', style: 'margin-top:8px',
                onclick: () => {
                  g.items.push({ id: uid('it'), name: '新しい項目', amount: 0 });
                  ui.openGroups.add(g.name); mark();
                },
              }, '＋ 項目を追加'),
          )
          : null,
      );
    }),
    el('button', {
      class: 'btn btn-sm', style: 'margin-top:4px',
      onclick: () => {
        plan.groups.push({ id: uid('g'), name: '新しい分類', kind: 'expense', items: [] });
        mark();
      },
    }, '＋ 分類を追加'),
  );
}

function itemRow(group, item, mark, rerender, locked) {
  if (locked) {
    return el('div', { class: 'lpitem is-locked' },
      el('span', { class: 'lpitem-name' }, item.name),
      el('span', { class: 'lpitem-amount' }, `${fmt.n(item.amount, 1)}万円`),
    );
  }
  const on = isOn(item);
  return el('div', { class: 'lpitem' + (on ? '' : ' is-off') },
    miniSwitch(on, (v) => { item.enabled = v; mark(); }, on ? '計算に入れています' : '計算から外しています'),
    el('input', {
      type: 'text', class: 'lpitem-name', value: item.name,
      oninput: (e) => { item.name = e.target.value; store.markDirty(); },
    }),
    numberInput({
      value: item.amount, cls: 'lpitem-input', fkey: `amt-${item.id}`,
      onInput: (num) => { item.amount = num ?? 0; mark(); },
    }),
    el('span', { class: 'tiny muted' }, '万円'),
    el('select', {
      class: 'catsel cat-' + categoryOf(item),
      onchange: (e) => { item.category = e.target.value; mark(); },
    }, Object.entries(CATEGORIES).map(([k, c]) =>
      el('option', { value: k, selected: k === categoryOf(item) }, c.label))),
    el('button', {
      class: 'chipbtn' + (item.temporary ? ' is-on' : ''),
      onclick: () => {
        item.temporary = !item.temporary;
        if (item.temporary) item.remainingYears ??= 5;
        mark();
      },
    }, '期限付'),
    item.temporary
      ? el('span', { class: 'remain' },
        'あと',
        numberInput({
          value: item.remainingYears, fkey: `rem-${item.id}`, integer: true,
          onInput: (num) => { item.remainingYears = num; mark(); },
        }),
        '年')
      : null,
    el('button', {
      class: 'chipbtn is-del',
      onclick: () => { group.items.splice(group.items.indexOf(item), 1); mark(); },
    }, '削除'),
  );
}

/** 一覧の行に置ける小さなON/OFFスイッチ */
function miniSwitch(checked, onChange, title) {
  const input = el('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) });
  return el('label', { class: 'miniswitch', title }, input, el('span', { class: 'track' }));
}

/* ===== 収入 ===== */
function incomeSection(plan, mark) {
  return el('div', { class: 'section' },
    el('h3', {}, '収入'),
    el('div', { class: 'card lpgroup-body', style: 'padding:14px' },
      plan.income.map((it) => el('div', { class: 'lpitem' + (isOn(it) ? '' : ' is-off') },
        miniSwitch(isOn(it), (v) => { it.enabled = v; mark(); }, '計算に入れるか'),
        el('input', {
          type: 'text', class: 'lpitem-name', value: it.name,
          oninput: (e) => { it.name = e.target.value; store.markDirty(); },
        }),
        numberInput({
          value: it.amount, cls: 'lpitem-input', fkey: `inc-${it.id}`,
          onInput: (num) => { it.amount = num ?? 0; mark(); },
        }),
        el('span', { class: 'tiny muted' }, '万円'),
        // 誰の収入かは返済負担率の「本人だけ／配偶者も含めて」の切り分けに使う
        select(WHO[it.who] ? it.who : 'shared', Object.entries(WHO),
          (v) => { it.who = v; mark(); }, 'whosel'),
        el('button', {
          class: 'chipbtn is-del',
          onclick: () => { plan.income.splice(plan.income.indexOf(it), 1); mark(); },
        }, '削除'),
      )),
      el('div', { class: 'lpitem' + (plan.bonus?.include ? '' : ' is-off') },
        miniSwitch(!!plan.bonus?.include, (v) => { plan.bonus.include = v; mark(); }),
        el('span', { class: 'lpitem-name' }, '賞与（年額）'),
        numberInput({
          value: plan.bonus?.annual, cls: 'lpitem-input', fkey: 'bonus',
          onInput: (num) => { plan.bonus.annual = num ?? 0; mark(); },
        }),
        el('span', { class: 'tiny muted' }, '万円/年'),
        el('span', { class: 'tiny muted' },
          plan.bonus?.include ? `月あたり ${fmt.n((plan.bonus.annual || 0) / 12, 1)}万円` : '計画に含めない'),
      ),
      el('button', {
        class: 'btn btn-sm', style: 'margin-top:8px',
        onclick: () => { plan.income.push({ id: uid('i'), name: '新しい収入', amount: 0, who: 'shared' }); mark(); },
      }, '＋ 収入を追加'),
    ));
}

/* =========================================================
   物件ごとの比較と、買える上限の逆算
   ========================================================= */
function scenarioSection(plan, currentRoom, currentBuilding) {
  const rows = [];
  for (const b of store.buildings) {
    for (const r of store.roomsOf(b.id)) {
      const res = calcPlan(plan, r, b, store.loanTerms, { excludeTemporary: ui.afterLoans });
      rows.push({ b, r, res, housing: housingCost(r, b, store.loanTerms) });
    }
  }
  if (!rows.length) return null;
  rows.sort((a, x) => x.res.balance - a.res.balance);

  const afford = affordablePrice(plan, currentRoom || rows[0].r, currentBuilding || rows[0].b, store.loanTerms);

  return el('div', { class: 'section' },
    el('h3', {}, '物件ごとの月次収支'),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp valuetable' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'lab' }, '部屋'),
          el('th', {}, '価格'),
          el('th', {}, 'ローン'),
          el('th', {}, '管理＋修繕'),
          el('th', {}, '住居費'),
          el('th', {}, '毎月の残り'),
          el('th', {}, '積み上がる額'),
        )),
        el('tbody', {}, rows.map(({ b, r, res, housing }) => el('tr', {
          class: r.id === plan.selectedRoomId ? 'is-current' : null,
        },
          el('td', { class: 'lab' },
            el('div', { class: 'tiny muted' }, b.name),
            el('a', { href: '#', onclick: (e) => { e.preventDefault(); location.hash = `#/r/${r.id}`; } }, r.label)),
          el('td', {}, `${fmt.man1(r.price)}万`),
          el('td', {}, `${fmt.n(housing.items[0].amount, 1)}万`),
          el('td', {}, `${fmt.n(housing.items[1].amount + housing.items[2].amount, 1)}万`),
          el('td', {}, `${fmt.n(housing.total, 1)}万`),
          el('td', { class: res.balance >= 0 ? 'best' : 'worse' },
            `${res.balance >= 0 ? '+' : ''}${fmt.n(res.balance, 1)}万`),
          el('td', {}, `${fmt.n(res.totalLeft, 1)}万`),
        ))),
      )),
    el('div', { class: 'calcgrid calcgrid-3', style: 'margin-top:14px' },
      kv('住居費に回せる上限', `${fmt.n(afford.budget, 1)}万円`, '毎月の残りが0になる水準'),
      kv('うちローンに回せる額', `${fmt.n(afford.loanBudget, 1)}万円`, '管理費・修繕を差し引いた額'),
      kv('買える価格の上限', `${fmt.man1(Math.round(afford.price))}万円`,
        `残りが0になる価格・${store.loanTerms.rate}% ${store.loanTerms.years}年`),
    ),
  );
}
