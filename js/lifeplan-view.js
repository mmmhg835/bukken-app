// ライフプランタブ。項目を編集しながら、物件ごとの月次収支を試算する。
import { store } from './store.js';
import { el, fmt, mount, toast, uid, preserveFocus } from './util.js';
import { kv, select, toggle, segmented } from './ui.js';
import {
  calcPlan, housingCost, affordablePrice, waterfall,
  CATEGORIES, isOn, categoryOf, incomePatterns,
} from './lifeplan.js';

import { derive } from './util.js';

const ui = { afterLoans: false, openGroups: null };

export function renderLifeplan(root, rerender) {
  const plan = store.lifeplan;
  const room = plan.selectedRoomId ? store.room(plan.selectedRoomId) : null;
  const building = room ? store.building(room.buildingId) : null;
  const res = calcPlan(plan, room, building, store.loanTerms, { excludeTemporary: ui.afterLoans });

  if (!ui.openGroups) ui.openGroups = new Set(['住居費']);
  // 金額を打つたびに再描画されるため、フォーカスを保ったまま描き直す
  const mark = () => { store.markDirty(); preserveFocus(rerender); };

  mount(root,
    propertyPicker(plan, room, building, rerender),
    summary(res, plan, rerender),
    housingDetail(res, room, building),
    waterfallSection(res, room, building),
    burdenSection(plan, room, res, mark, rerender),
    groupsSection(plan, res, mark, rerender),
    incomeSection(plan, mark),
    scenarioSection(plan, room, building),
  );
}

/* ===== 物件の選択 ===== */
function propertyPicker(plan, room, building, rerender) {
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
        el('div', { class: 'ctlrow' },
          el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '◷'), 'シナリオ'),
          toggle('期限付きの支出（車ローン・奨学金）が終わった後で試算',
            ui.afterLoans, (v) => { ui.afterLoans = v; rerender(); })),
      )),
  );
}

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
      kv('変動費', `${fmt.n(res.variable, 1)}万円`, `使える上限 ${fmt.n(res.variableBudget, 1)}万円`),
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
function housingDetail(res, room, building) {
  if (!res.housingFromRoom) return null;
  const manual = store.lifeplan.groups.find((g) => g.kind === 'housing').items
    .reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const diff = res.housingFromRoom.total - manual;
  const t = { ...store.loanTerms, ...(room.loan || {}) };

  return el('div', { class: 'section' },
    el('h3', {}, `${building.name} ${room.label} の住居費`),
    el('div', { class: 'calcgrid calcgrid-4' },
      ...res.housingFromRoom.items.map((it) => kv(it.name, `${fmt.n(it.amount, 1)}万円`)),
      kv('住居費 合計', `${fmt.n(res.housingFromRoom.total, 1)}万円`, `ローン ${t.rate}% ${t.years}年`),
    ),
    el('div', { class: 'tiny muted', style: 'margin-top:8px' },
      '現在の想定（', fmt.n(manual, 1), '万円）との差　',
      el('b', { class: diff <= 0 ? 'pos' : 'neg' }, `${diff > 0 ? '+' : ''}${fmt.n(diff, 1)}万円`)),
  );
}

/* =========================================================
   収入から順に差し引く段階表
   ========================================================= */
function waterfallSection(res, room, building) {
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

/* =========================================================
   返済負担率と年収倍率
   ========================================================= */
/** 列見出しに算式と目安を小さく添える。別途の説明文を置かずに済ませる */
function thSub(title, sub) {
  return el('div', { class: 'thsub' }, el('b', {}, title), el('span', {}, sub));
}

function burdenSection(plan, room, res, mark, rerender) {
  plan.grossIncome ||= { primary: { name: '夫', annual: 0 }, secondary: { name: '妻', annual: 0 } };
  const g = plan.grossIncome;
  const rows = incomePatterns(plan, room, res);

  const personInput = (who) => el('div', { class: 'lpitem', style: 'padding:0' },
    el('input', {
      type: 'text', class: 'lpitem-name', style: 'max-width:90px', value: g[who].name ?? '',
      'data-fkey': `gross-name-${who}`,
      oninput: (e) => { g[who].name = e.target.value; store.markDirty(); },
    }),
    el('input', {
      type: 'number', step: 'any', inputmode: 'decimal', class: 'lpitem-input',
      value: g[who].annual ?? '', 'data-fkey': `gross-${who}`,
      oninput: (e) => { g[who].annual = e.target.value === '' ? 0 : Number(e.target.value); mark(); },
    }),
    el('span', { class: 'tiny muted' }, '万円/年'),
  );

  const cell = (v, fmtFn, judge) => {
    if (v == null) return el('td', { class: 'muted' }, '—');
    return el('td', { class: judge ? judge(v) : null }, fmtFn(v));
  };

  return el('div', { class: 'section' },
    el('h3', {}, '返済負担率と年収倍率'),
    el('div', { class: 'panel' },
      el('div', { class: 'panel-controls' },
        el('div', { class: 'ctlrow' },
          el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '¥'), '額面年収'),
          el('div', { style: 'display:flex;gap:18px;flex-wrap:wrap' },
            personInput('primary'), personInput('secondary')))),
      el('div', { class: 'panel-chart', style: 'padding:0' },
        el('div', { class: 'tablewrap', style: 'border:0;border-radius:0' },
          el('table', { class: 'cmp valuetable' },
            el('thead', {}, el('tr', {},
              el('th', { class: 'lab' }, '年収の見方'),
              el('th', {}, '額面年収'),
              el('th', {}, thSub('返済負担率', 'ローンのみ　25%以下')),
              el('th', {}, thSub('返済負担率', '管理費・修繕込み')),
              el('th', {}, thSub('年収倍率', '価格 ÷ 年収　7倍以下')),
            )),
            el('tbody', {}, rows.map((x) => el('tr', {},
              el('td', { class: 'lab' }, x.label),
              el('td', {}, `${fmt.man1(Math.round(x.annual))}万円`),
              cell(x.burdenLoan, (v) => `${v.toFixed(1)}%`,
                (v) => (v <= 25 ? 'best' : v <= 35 ? null : 'worse')),
              cell(x.burdenHousing, (v) => `${v.toFixed(1)}%`,
                (v) => (v <= 30 ? 'best' : v <= 40 ? null : 'worse')),
              cell(x.multiple, (v) => `${v.toFixed(1)}倍`,
                (v) => (v <= 7 ? 'best' : v <= 9 ? null : 'worse')),
            ))),
          ))),
    ),
  );
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
      title: '期限付きの支出（完済すると無くなる）',
      onclick: () => { item.temporary = !item.temporary; mark(); },
    }, '期限付'),
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
