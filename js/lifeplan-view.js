// ライフプランタブ。項目を編集しながら、物件ごとの月次収支を試算する。
import { store } from './store.js';
import { el, fmt, mount, toast, uid, preserveFocus } from './util.js';
import { kv, select, toggle, segmented } from './ui.js';
import {
  calcPlan, housingCost, affordablePrice, waterfall,
  CATEGORIES, isOn, categoryOf, incomePatterns, project, milestones,
} from './lifeplan.js';
import { lineChart, stackedBarChart, chartLegend, SERIES_COLORS } from './chart.js';

import { derive } from './util.js';

const ui = { afterLoans: false, openGroups: null };

const SUBTABS = [['plan', 'ライフプラン'], ['burden', '返済負担比率'], ['graph', 'グラフ']];

/**
 * @param {string} sub 'plan' | 'burden'。物件と収入の前提を共有したまま切り替える
 */
export function renderLifeplan(root, rerender, sub = 'plan') {
  const view = SUBTABS.some(([k]) => k === sub) ? sub : 'plan';
  const plan = store.lifeplan;
  const room = plan.selectedRoomId ? store.room(plan.selectedRoomId) : null;
  const building = room ? store.building(room.buildingId) : null;
  const res = calcPlan(plan, room, building, store.loanTerms, { excludeTemporary: ui.afterLoans });

  if (!ui.openGroups) ui.openGroups = new Set(['住居費']);
  // 金額を打つたびに再描画されるため、フォーカスを保ったまま描き直す
  const mark = () => { store.markDirty(); preserveFocus(rerender); };

  mount(root,
    subTabs(view),
    propertyPicker(plan, room, building, rerender, view),
    view === 'burden' ? burdenView(plan, room, res, mark, rerender)
      : view === 'graph' ? graphView(plan, room, building, res)
        : planView(plan, room, building, res, mark, rerender),
  );
}

function subTabs(current) {
  return el('nav', { class: 'subtabs' }, SUBTABS.map(([key, label]) =>
    el('button', {
      class: 'subtab' + (key === current ? ' is-active' : ''),
      onclick: () => { location.hash = key === 'plan' ? '#/plan' : `#/plan/${key}`; },
    }, label)));
}

function planView(plan, room, building, res, mark, rerender) {
  // 物件 → 収入 → 結果 → 支出の順。前提を先に置き、そこから計算結果を見せる
  return el('div', {},
    incomeSection(plan, mark),
    summary(res, plan, rerender),
    housingDetail(res, room, building),
    waterfallSection(res, room, building),
    groupsSection(plan, res, mark, rerender),
    scenarioSection(plan, room, building),
  );
}

/* =========================================================
   グラフ
   ========================================================= */
const COLOR = {
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

function graphView(plan, room, building, res) {
  const years = Math.max(40, (room ? { ...store.loanTerms, ...(room.loan || {}) } : store.loanTerms).years + 5);
  const rows = project(plan, room, building, store.loanTerms, years);
  const marks = milestones(plan, room, store.loanTerms)
    .filter((m) => m.year <= years)
    .map((m) => ({ x: m.year, label: m.label }));

  return el('div', {},
    flowSection(rows, marks),
    assetSection(rows, marks),
    breakdownSection(res),
  );
}

/** 年ごとの収入と支出。支出が段階的に下がる様子を見る */
function flowSection(rows, marks) {
  const series = [
    { name: '収入', color: COLOR.income, points: rows.map((r) => ({ x: r.year, y: r.income })) },
    { name: '支出', color: COLOR.expense, points: rows.map((r) => ({ x: r.year, y: r.expense })) },
  ];
  const surplus = [{ name: '年間の残り', color: COLOR.left, fill: true,
    points: rows.map((r) => ({ x: r.year, y: r.balance })) }];
  return el('div', { class: 'section' },
    el('h3', {}, '収入と支出の推移'),
    el('div', { class: 'panel' }, el('div', { class: 'panel-chart' },
      el('div', { class: 'chartwrap' },
        lineChart(series, { xLabel: '経過年数', yLabel: '年額（万円）', xUnit: '年', marks, height: 300 })),
      chartLegend(series),
      el('div', { class: 'subhead', style: 'margin:18px 0 6px' }, '年間の残り'),
      el('div', { class: 'chartwrap' },
        lineChart(surplus, { xLabel: '経過年数', yLabel: '年額（万円）', xUnit: '年', marks, height: 220, baseline: 'zero' })))),
  );
}

/** 積み上がる資産。節目のあとで傾きが変わる */
function assetSection(rows, marks) {
  const series = [
    { name: '累積資産', color: COLOR.assets, fill: true, points: rows.map((r) => ({ x: r.year, y: r.assets })) },
  ];
  const at = (y) => rows.find((r) => r.year === y);
  return el('div', { class: 'section' },
    el('h3', {}, '資産の積み上がり'),
    el('div', { class: 'panel' }, el('div', { class: 'panel-chart' },
      el('div', { class: 'chartwrap' },
        lineChart(series, { xLabel: '経過年数', yLabel: '累積（万円）', xUnit: '年', marks, height: 280, baseline: 'zero' })))),
    el('div', { class: 'calcgrid calcgrid-4', style: 'margin-top:12px' },
      ...[5, 10, 20, 30].map((y) => at(y)
        ? kv(`${y}年後`, `${fmt.man1(Math.round(at(y).assets))}万円`, `年間 ${fmt.n(at(y).saving + at(y).balance, 0)}万円`)
        : kv(`${y}年後`, '—')),
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

/* =========================================================
   返済負担比率
   ========================================================= */
function burdenView(plan, room, res, mark, rerender) {
  plan.grossIncome ||= {
    primary: { name: '夫', annual: 0, net: 0 },
    secondary: { name: '妻', annual: 0, net: 0 },
  };
  const rows = incomePatterns(plan, room, res);

  return el('div', {},
    incomeSettings(plan, mark),
    burdenTable('額面年収', rows, (x) => x.gross, room),
    burdenTable('手取り年収', rows, (x) => x.net, room),
    room ? null : el('div', { class: 'empty' }, '対象の物件を選んでください'),
  );
}

/** 額面と手取りを1行に並べて入力する */
function incomeSettings(plan, mark) {
  const g = plan.grossIncome;
  const field = (who, key, fkey) => el('input', {
    type: 'number', step: 'any', inputmode: 'decimal', class: 'lpitem-input',
    value: g[who][key] ?? '', 'data-fkey': `${fkey}-${who}`,
    oninput: (e) => { g[who][key] = e.target.value === '' ? 0 : Number(e.target.value); mark(); },
  });
  const row = (who) => el('div', { class: 'incrow' },
    el('input', {
      type: 'text', class: 'lpitem-name', style: 'max-width:110px', value: g[who].name ?? '',
      'data-fkey': `name-${who}`,
      oninput: (e) => { g[who].name = e.target.value; store.markDirty(); },
    }),
    el('span', { class: 'tiny muted' }, '額面'), field(who, 'annual', 'gross'),
    el('span', { class: 'tiny muted' }, '手取り'), field(who, 'net', 'net'),
    el('span', { class: 'tiny muted' }, '万円/年'),
  );

  return el('div', { class: 'section' },
    el('h3', {}, '年収'),
    el('div', { class: 'card', style: 'padding:14px' }, row('primary'), row('secondary')),
  );
}

function burdenTable(title, rows, pick, room) {
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
  );
}

/** 列見出しに算式と目安を小さく添える。別途の説明文を置かずに済ませる */
function thSub(title, sub) {
  return el('div', { class: 'thsub' }, el('b', {}, title), el('span', {}, sub));
}

/* ===== 支出グループ ===== */
function groupsSection(plan, res, mark, rerender) {
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
    el('input', {
      type: 'number', step: 'any', inputmode: 'decimal', class: 'lpitem-input',
      value: item.amount ?? '', 'data-fkey': `amt-${item.id}`,
      oninput: (e) => { item.amount = e.target.value === '' ? 0 : Number(e.target.value); mark(); },
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
        el('input', {
          type: 'number', step: '1', min: '0', inputmode: 'numeric',
          value: item.remainingYears ?? '', 'data-fkey': `rem-${item.id}`,
          oninput: (e) => { item.remainingYears = e.target.value === '' ? null : Number(e.target.value); mark(); },
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
        el('input', {
          type: 'number', step: 'any', inputmode: 'decimal', class: 'lpitem-input',
          value: it.amount ?? '', 'data-fkey': `inc-${it.id}`,
          oninput: (e) => { it.amount = e.target.value === '' ? 0 : Number(e.target.value); mark(); },
        }),
        el('span', { class: 'tiny muted' }, '万円'),
        el('button', {
          class: 'chipbtn is-del',
          onclick: () => { plan.income.splice(plan.income.indexOf(it), 1); mark(); },
        }, '削除'),
      )),
      el('div', { class: 'lpitem' + (plan.bonus?.include ? '' : ' is-off') },
        miniSwitch(!!plan.bonus?.include, (v) => { plan.bonus.include = v; mark(); }),
        el('span', { class: 'lpitem-name' }, '賞与（年額）'),
        el('input', {
          type: 'number', step: 'any', inputmode: 'decimal', class: 'lpitem-input',
          value: plan.bonus?.annual ?? '', 'data-fkey': 'bonus',
          oninput: (e) => { plan.bonus.annual = Number(e.target.value) || 0; mark(); },
        }),
        el('span', { class: 'tiny muted' }, '万円/年'),
        el('span', { class: 'tiny muted' },
          plan.bonus?.include ? `月あたり ${fmt.n((plan.bonus.annual || 0) / 12, 1)}万円` : '計画に含めない'),
      ),
      el('button', {
        class: 'btn btn-sm', style: 'margin-top:8px',
        onclick: () => { plan.income.push({ id: uid('i'), name: '新しい収入', amount: 0 }); mark(); },
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
