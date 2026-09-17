// ライフプランタブ。項目を編集しながら、物件ごとの月次収支を試算する。
import { store } from './store.js';
import { dealSummary } from './market.js';
import { el, fmt, mount, toast, uid, preserveFocus, STATUSES } from './util.js';
import { kv, select, toggle, segmented, numberInput } from './ui.js';
// 指値の表から比較に送れるようにする。選択は一覧・比較と同じものを使う
import { isPicked, togglePick } from './views.js';
import {
  calcPlan, housingCost, affordablePrice, waterfall,
  CATEGORIES, isOn, categoryOf, incomePatterns, project, milestones,
  WHO,
} from './lifeplan.js';
import { lineChart, stackedBarChart, chartLegend, SERIES_COLORS } from './chart.js';
import { saleView } from './sale-view.js';

import { derive, TSUBO_SQM } from './util.js';
import { allUnits } from './units.js';
import { unitUI, unitMatches, unitFilterBar } from './unit-filter.js';

const ui = {
  afterLoans: false,
  openGroups: null,
  // 金利と価格の表に出す金利。設定の金利からの上乗せ幅（%）で持つ。
  // 設定側の金利を直しても選び直さずに済むように、絶対値ではなく差で持つ。
  rateSteps: [0, 0.25, 0.5, 0.75, 1],
  // 試算に使う金利の上乗せ幅（%）。0 なら設定のまま。
  // 設定そのものを書き換えずに「上がったらどうなるか」を全サブタブで見るための値で、
  // 保存はしない。一覧・比較・分析は設定の金利のままにしてある。
  rateBump: 0,
  // 指値の表の状態。並び順と絞り込み（保存しない）
  offer: {
    sort: { key: 'offer', dir: 'asc' },
    filter: { status: '', offerOnly: false },
    // 打っている最中は並びを止めるため、直前の並びを覚えておく
    lastOrder: null,
  },
};

/**
 * 画面の状態。保存する値ではない。
 * 試算金利を上げた状態の分岐は描いてみないと未定義参照に気づけないので、
 * tools/smoke.mjs から状態を作れるように出している。
 */
export const lifeplanUI = ui;

/** ライフプランタブの中だけで使う条件。試算金利の上乗せを当てて返す */
function planTerms() {
  const t = store.loanTerms;
  if (!ui.rateBump) return t;
  return { ...t, rate: Math.round(((Number(t.rate) || 0) + ui.rateBump) * 1000) / 1000 };
}

const SUBTABS = [['plan', 'ライフプラン'], ['burden', '返済負担比率'], ['matrix', '金利と価格'],
  ['graph', 'グラフ'], ['offer', '指値'], ['sale', '売却']];

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
  const res = calcPlan(plan, offerRoom || room, building, planTerms(), opts);
  // 指値を入れているときだけ、元値の結果も並べて計算する
  const baseRes = offerRoom ? calcPlan(plan, room, building, planTerms(), opts) : null;

  if (!ui.openGroups) ui.openGroups = new Set(['住居費']);
  rerenderOffer = rerender;
  // 金額を打つたびに再描画されるため、フォーカスを保ったまま描き直す
  const mark = () => { store.markDirty(); preserveFocus(rerender); };

  if (view === 'offer') {
    mount(root, subTabs(view), offerView(mark, rerender));
    return;
  }

  mount(root,
    subTabs(view),
    propertyPicker(plan, room, building, rerender, view),
    offerRoom && view === 'plan'
      ? offerComparison(plan, room, offerRoom, building, res, baseRes) : null,
    view === 'matrix' ? matrixView(plan, room, building, mark, rerender)
      : view === 'burden' ? burdenView(plan, offerRoom || room, res, mark, rerender)
        : view === 'graph' ? graphView(plan, offerRoom || room, building, res, offerRoom ? room : null)
          : view === 'sale' ? saleView(plan, offerRoom || room, rerender, planTerms())
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

/**
 * 試算の対象にする部屋。絞り込みは一覧・比較と同じものを使う。
 * 既定は募集中だけ（募集が終わった部屋は買えない）。
 * ただし選択中の部屋だけは、条件から外れても消えないよう残す。
 */
function planRooms(keepId = null) {
  store.ensureOnsale();
  return allUnits().filter((x) => x.r.id === keepId || unitMatches(x));
}

// 月次収支の表に並べる件数。売り出し中を全部試算すると重いうえに読めない
const PLAN_MAX = 12;

/* ===== 物件の選択 ===== */
function propertyPicker(plan, room, building, rerender, view = 'plan') {
  const rooms = planRooms(plan.selectedRoomId);
  const options = [['', '現在の想定（手入力の住居費）']];
  for (const { b, r } of rooms) {
    options.push([r.id, `${b.name} ${r.label}　${fmt.man1(r.price)}万円`]);
  }
  return el('div', { class: 'section' },
    el('h3', {}, '試算する物件'),
    unitFilterBar(allUnits(), rooms, rerender, { unit: '部屋' }),
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
        rateRow(rerender),
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
 * 試算金利。設定の金利から0.25%刻みで上げ下げして、このタブの全サブタブに効かせる。
 * 金利が上がったときの影響は、返済額だけでなく負担率・売却時の残高・将来の資産
 * にも出る。設定そのものを書き換えると一覧や分析の数字まで動いてしまうので、
 * ここでは上乗せ幅だけを画面の状態として持つ。
 */
const RATE_BUMPS = [0, 0.25, 0.5, 0.75, 1, 1.5];

function rateRow(rerender) {
  const base = Number(store.loanTerms.rate) || 0;
  const cur = planTerms().rate;
  return el('div', { class: 'ctlrow' },
    el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '％'), '試算金利'),
    el('div', { style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap' },
      el('div', { class: 'pillrow', style: 'margin:0' }, RATE_BUMPS.map((o) => el('button', {
        class: 'pill' + (ui.rateBump === o ? ' is-on' : ''),
        onclick: () => { ui.rateBump = o; rerender(); },
      }, `${Math.round((base + o) * 1000) / 1000}%`))),
      el('span', { class: 'tiny muted' },
        ui.rateBump ? `設定は ${base}%。このタブだけ +${ui.rateBump}% で試算中` : `設定どおり ${cur}%`)),
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
  const terms = planTerms();
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
  const t = { ...planTerms(), ...(room.loan || {}) };

  // 指値が入っているときは、差を添え字で足さずに元値と指値を1組ずつ並べる。
  // 添え字だと、どの数字がどちらの前提のものか読み取れないため。
  const blocks = baseRoom
    ? [['元値', baseRoom, housingCost(baseRoom, building, planTerms())],
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

  const plus = w.rest >= 0;
  return el('div', { class: 'section' },
    el('h3', {}, '収入から何を引くと、いくら残るか'),
    el('div', { class: 'panel wfpanel' },
      el('div', { class: 'wfhead' },
        el('span', {}, '月の手取り収入'),
        el('b', {}, yen(res.income))),
      w.steps.map(stepRow),
      // 最後の1行だけは結果なので、段と同じ形にしつつ数字を大きく置く
      el('div', { class: 'wfend' },
        el('span', {}, '毎月の残り'),
        el('b', { class: plus ? 'pos' : 'neg' },
          `${plus ? '+' : '▲'}${yen(Math.abs(w.rest))}`)),
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
  const years = Math.max(40, (room ? { ...planTerms(), ...(room.loan || {}) } : planTerms()).years + 5);
  const rows = project(plan, room, building, planTerms(), years);
  const baseRows = baseRoom ? project(plan, baseRoom, building, planTerms(), years) : null;
  const marks = milestones(plan, room, planTerms())
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

/**
 * 買える価格の上限まわり。
 * 合算した額だけを出すと、そこに諸費用や管理費が入っているのか分からず
 * 実態と突き合わせられない。足す前の額をすべて並べる。
 */
function affordCards(afford, room, building) {
  const t = { ...planTerms(), ...(room?.loan || {}) };
  const price = Math.round(afford.price);
  const fees = (price * (Number(t.costRate) || 0)) / 100 + (Number(t.costFixed) || 0);
  const down = Number(t.downPayment) || 0;
  const principal = price + (t.includeFees ? fees : 0) - down;
  const cash = down + (t.includeFees ? 0 : fees);
  const kanri = Number(room?.kanrihi) || 0;
  const shuzen = Number(room?.shuzen) || 0;
  const loan = derive({ price, kanrihi: 0, shuzen: 0 }, building, t).loan;
  const man = (v) => `${fmt.man1(Math.round(v))}万円`;
  const base = room && building ? `${building.name} ${room.label} の実額` : '対象の部屋の実額';

  return el('div', { class: 'calcgrid calcgrid-3', style: 'margin-top:14px' },
    kv('住居費に回せる上限', `${fmt.n(afford.budget, 1)}万円`, '毎月の残りが0になる水準'),
    kv('管理費', `${fmt.n(kanri, 2)}万円`, base),
    kv('修繕積立金', `${fmt.n(shuzen, 2)}万円`, base),
    kv('うちローンに回せる額', `${fmt.n(afford.loanBudget, 1)}万円`, '上限から管理費と修繕を引いた額'),
    kv('買える価格の上限', man(price), `物件価格のみ・${t.rate}% ${t.years}年`),
    kv('諸費用', man(fees), `価格の${t.costRate}%${t.costFixed ? ` ＋ ${t.costFixed}万円` : ''}`),
    kv('借入額', man(principal), t.includeFees ? '物件価格＋諸費用−頭金' : '物件価格−頭金'),
    kv('購入時の現金', man(cash), t.includeFees ? '頭金のみ' : '頭金＋諸費用'),
    kv('総返済額', man(loan?.totalPayment ?? 0),
      `うち利息 ${man(loan?.totalInterest ?? 0)}`),
  );
}

/* ===== 金利と価格のマトリクス ===== */

/**
 * 金利が上がったら、価格がいくらなら、毎月どうなるか。
 *
 * 行は「意味のある価格」だけを並べる。500万刻みは根拠が無く、相場と
 * 見比べながら指値を決めるのに使えないため。売り出し・指値・相場（出どころ別）
 * を同じ表に並べ、相場の行からそのまま指値に落とせるようにしてある。
 *
 * 前提（収入・生活費・車）はライフプランのものをそのまま使う。
 */
function matrixView(plan, room, building, mark, rerender) {
  if (!room) return el('div', { class: 'empty' }, '対象の物件を選んでください');
  const terms = planTerms();
  const opts = { excludeTemporary: ui.afterLoans };
  const t = { ...terms, ...(room.loan || {}) };
  const tsubo = room.area ? room.area / TSUBO_SQM : null;
  const marketPrice = (key) => (room[key] != null && tsubo ? room[key] * tsubo : null);

  // 設定の金利を起点に0.25%刻み。押した分だけ列になる
  const baseRate = Number(t.rate) || 0;
  const OFFSETS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const picked = OFFSETS.filter((o) => ui.rateSteps.includes(o));
  const rates = (picked.length ? picked : [0]).map((o) => Math.round((baseRate + o) * 1000) / 1000);

  // 並びは固定。価格順にすると、指値を打っている最中に行が動いてしまう。
  // 指値の行は額が未入力でも残す。ここが指値を決める場所なので、
  // 空だと入れる場所が無くなる。
  const anchors = [
    { label: '売り出し', price: room.price },
    { label: '指値', price: room.offerPrice, editable: true },
    { label: 'ISOGE 相場', price: marketPrice('marketIsoge') },
    { label: 'マンレビ 相場', price: marketPrice('marketMrev') },
  ].filter((a) => a.editable || (a.price != null && a.price > 0));

  const at = (price, rate) =>
    calcPlan(plan, { ...room, price, loan: { ...(room.loan || {}), rate } },
      building, { ...terms, rate }, opts);

  const body = el('tbody', {}, anchors.map((a) => {
    const price = a.price != null && a.price > 0 ? Math.round(a.price) : null;
    const loan = price == null ? null : housingCost({ ...room, price }, building, t).loan;
    const principal = loan?.principal ?? null;
    const fees = loan?.fees ?? null;
    const isOffer = a.editable;
    return el('tr', { class: isOffer ? 'is-current' : null },
      el('td', { class: 'lab' },
        el('div', { class: 'anchor-label' }, a.label),
        isOffer
          ? numberInput({
            value: price, cls: 'lpitem-input', fkey: 'mx-offer',
            placeholder: '未入力',
            onInput: (num) => { room.offerPrice = num; mark(); },
          })
          : el('div', { class: 'anchor-price' }, `${fmt.man1(price)}万円`,
            el('button', {
              class: 'btn btn-sm anchor-set',
              onclick: () => { room.offerPrice = price; mark(); },
            }, '指値にする'))),
      el('td', { class: 'muted' }, price != null && tsubo ? `${fmt.man1(Math.round(price / tsubo))}万/坪` : '—'),
      el('td', {}, price == null ? el('span', { class: 'muted' }, '—') : [
        el('div', { class: 'mxline' }, el('span', { class: 'dk' }, '諸費用'),
          el('span', {}, `${fmt.man1(Math.round(fees))}万`)),
        el('div', { class: 'mxline' }, el('span', { class: 'dk' }, '借入'),
          el('span', {}, `${fmt.man1(Math.round(principal))}万`))]),
      ...rates.map((rate) => {
        if (price == null) return el('td', { class: 'muted' }, '—');
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

  // 毎月の残りがちょうど0になる価格。いくらまでなら出せるかの上限になる。
  // 別の指標グリッドに出すと列数が金利の本数に左右されて空きマスが出るので、
  // 表の脚に畳んで金利の列の真下に置く。
  const zeroFoot = el('tfoot', {}, el('tr', { class: 'mxfoot' },
    el('td', { class: 'lab', colspan: '3' }, '毎月の残りが0になる価格'),
    ...rates.map((rate) => {
      const { price } = affordablePrice(plan, room, building, { ...terms, rate });
      const fees = (price * (Number(t.costRate) || 0)) / 100 + (Number(t.costFixed) || 0);
      return el('td', {},
        el('div', { class: 'mxline' }, el('span', { class: 'dk' }, '物件'),
          el('b', {}, `${fmt.man1(Math.round(price))}万`)),
        el('div', { class: 'mxline' }, el('span', { class: 'dk' }, '諸費用'),
          el('span', {}, `${fmt.man1(Math.round(fees))}万`)),
        el('div', { class: 'mxline' }, el('span', { class: 'dk' }, '坪'),
          el('span', {}, tsubo ? `${fmt.man1(Math.round(price / tsubo))}万` : '—')));
    })));

  const ratePicker = el('div', { class: 'pillrow' }, OFFSETS.map((o) => el('button', {
    class: 'pill' + (ui.rateSteps.includes(o) ? ' is-on' : ''),
    onclick: () => {
      ui.rateSteps = ui.rateSteps.includes(o)
        ? ui.rateSteps.filter((x) => x !== o)
        : [...ui.rateSteps, o].sort((a, b) => a - b);
      // 表に出す金利は画面の状態なので、保存の対象にはしない
      rerender();
    },
  }, `${Math.round((baseRate + o) * 1000) / 1000}%`)));

  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, `${building?.name ?? ''} ${room.label}　金利と価格`),
      ratePicker,
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp mxtbl' },
          el('thead', {}, el('tr', {},
            el('th', { class: 'lab' }, '物件価格'),
            el('th', {}, thSub('坪単価', '価格 ÷ 坪数')),
            el('th', {}, thSub('諸費用と借入', `諸費用は価格の${t.costRate}%`)),
            ...rates.map((r, i) => el('th', {},
              thSub(`金利 ${r}%`, picked[i] ? `いまより +${picked[i]}%` : 'いまの設定'))),
          )),
          body, zeroFoot))),
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
  // 価格の安い順に上から PLAN_MAX 件だけ試算する。選択中の部屋は必ず入れる
  const target = planRooms(plan.selectedRoomId)
    .sort((a, x) => (a.r.id === plan.selectedRoomId ? -1 : x.r.id === plan.selectedRoomId ? 1 : 0)
      || (a.r.price ?? Infinity) - (x.r.price ?? Infinity))
    .slice(0, PLAN_MAX);
  const rows = [];
  for (const { b, r } of target) {
    const res = calcPlan(plan, r, b, planTerms(), { excludeTemporary: ui.afterLoans });
    rows.push({ b, r, res, housing: housingCost(r, b, planTerms()) });
  }
  if (!rows.length) return null;
  rows.sort((a, x) => x.res.balance - a.res.balance);

  const afford = affordablePrice(plan, currentRoom || rows[0].r, currentBuilding || rows[0].b, planTerms());

  return el('div', { class: 'section' },
    el('h3', {}, '物件ごとの月次収支'),
    target.length < planRooms(plan.selectedRoomId).length
      ? el('p', { class: 'tiny muted' }, `条件に合う部屋のうち、価格の安い順に${PLAN_MAX}件を試算しています。`)
      : null,
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
    // 上限の額が何を含んでいるのか分からないと使えないので、
    // 月々と購入時の内訳を、合算する前の額のまま並べる
    affordCards(afford, currentRoom || rows[0].r, currentBuilding || rows[0].b),
  );
}

/* =========================================================
   指値
   ========================================================= */
/**
 * 指値の検討。登録した部屋を1枚の表に並べて、いくらで出すかを決める。
 *
 * もとは内見タブに置いていたが、指値は「いくらなら返せるか」の話なので、
 * 試算金利・諸費用・返済とひと続きで見られるライフプランに移した。
 * 表の数字は部屋の登録内容から引く。ここで打つのは指値と相場坪単価だけ。
 */
/**
 * 相場の出どころ。同じ住戸でもサイトによって値が違うので、どちらと比べたのかを
 * 残せるように枠を分けている。持つのは坪単価だけで、グロスは坪数から都度出す。
 */
const MARKET_SOURCES = [['marketIsoge', 'ISOGE'], ['marketMrev', 'マンレビ']];

function offerView(mark, rerender, all = store.rooms) {
  store.ensureDeals();          // 成約は指値を決めるときに使う
  const terms = planTerms();
  const shown = all.filter((r) =>
    (!ui.offer.filter.status || r.status === ui.offer.filter.status)
    && (!ui.offer.filter.offerOnly || r.offerPrice != null));
  const rows = shown.map((r) => {
    const b = store.building(r.buildingId);
    const d = derive(r, b, terms);
    const t = { ...terms, ...(r.loan || {}) };
    const offer = r.offerPrice ?? null;
    const base = offer ?? r.price ?? null;
    // その建物の成約（仲介からもらった実績）。指値を決めるときの拠りどころ
    const deals = store.dealsOf(r.buildingId);
    return {
      r, b, d, t, offer, deals: deals.length ? dealSummary(deals) : null,
      offerTsubo: offer != null && d.tsubo ? offer / d.tsubo : null,
      // 諸費用は指値に対して出す。指値がまだ無い部屋は売り出し価格で見る
      fees: base == null ? null : (base * (Number(t.costRate) || 0)) / 100 + (Number(t.costFixed) || 0),
      feesOnOffer: offer != null,
    };
  });
  // 並び替え。空の項目は向きに関わらず末尾に送る。
  // 相場や指値が入っていない部屋が上に来ると、比べたい行が押し下げられるため。
  const value = (x, key) => {
    if (key === 'name') return `${x.b?.name ?? ''} ${x.r.label}`;
    if (key === 'age') return x.d.ageYears;
    if (key === 'floor') return x.r.floor;
    if (key === 'area') return x.r.area;
    if (key === 'price') return x.r.price;
    if (key === 'offer') return x.offer ?? x.r.price;
    if (key === 'tsubo') return x.d.tsuboPrice;
    if (key === 'offerTsubo') return x.offerTsubo;
    if (key === 'fees') return x.fees;
    if (key === 'running') return x.d.kanriShuzen;
    if (key === 'deal:n') return x.deals?.count ?? null;
    if (key === 'deal:min') return x.deals?.tsuboMin ?? null;
    if (key === 'deal:med') return x.deals?.tsuboMed ?? null;
    if (key === 'deal:avg') return x.deals?.tsuboAvg ?? null;
    if (key === 'deal:max') return x.deals?.tsuboMax ?? null;
    // 指値が成約の中央値からどれだけ離れているか。＋なら成約より安く買おうとしている
    if (key === 'deal:gap') {
      return x.deals?.tsuboMed != null && x.offerTsubo != null
        ? x.deals.tsuboMed - x.offerTsubo : null;
    }
    for (const [mk] of MARKET_SOURCES) {
      const m = x.r[mk] ?? null;
      if (key === mk) return m;
      if (key === `${mk}:gross`) return m != null && x.d.tsubo ? m * x.d.tsubo : null;
      // 差で並べるときは、売出より指値のほうが判断に使う数字なので指値側を見る
      if (key === `${mk}:gap`) return m != null && x.offerTsubo != null ? m - x.offerTsubo : null;
    }
    return null;
  };
  const { key: sortKey, dir } = ui.offer.sort;
  // 指値や相場を打っている最中は並びを固定する。1文字ごとに並び替えると、
  // 入力中の行が表の中で動いてしまい、どこを打っているのか分からなくなる。
  const typing = /^(offer|market)/.test(document.activeElement?.dataset?.fkey ?? '');
  if (typing && ui.offer.lastOrder) {
    const at = new Map(ui.offer.lastOrder.map((id, i) => [id, i]));
    rows.sort((a, b) => (at.get(a.r.id) ?? 1e9) - (at.get(b.r.id) ?? 1e9));
  } else {
    rows.sort((a, b) => {
      const va = value(a, sortKey); const vb = value(b, sortKey);
      const ea = va == null || Number.isNaN(va); const eb = vb == null || Number.isNaN(vb);
      if (ea || eb) return ea && eb ? 0 : (ea ? 1 : -1);
      if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb, 'ja') : vb.localeCompare(va, 'ja');
      return dir === 'asc' ? va - vb : vb - va;
    });
    ui.offer.lastOrder = rows.map((x) => x.r.id);
  }

  // 名前と「安いほうが良い」項目は昇順から、相場や差は大きいほうから見たい
  const ASC_FIRST = new Set(['name', 'age', 'floor', 'price', 'offer', 'tsubo', 'offerTsubo', 'fees', 'running']);
  const sortTh = (key, title, sub, cls = null) => el('th', {
    class: [cls, 'sortable', sortKey === key ? 'is-sorted' : null].filter(Boolean).join(' '),
    onclick: () => {
      ui.offer.sort = sortKey === key
        ? { key, dir: dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: ASC_FIRST.has(key) ? 'asc' : 'desc' };
      rerender();
    },
  }, el('div', { class: 'thsub' },
    el('b', {}, title, el('span', { class: 'sortmark' },
      sortKey === key ? (dir === 'asc' ? '▲' : '▼') : '')),
    el('span', {}, sub)));

  const oku = (v) => (v == null ? '—' : `${(v / 10000).toFixed(3)}億`);
  const man = (v) => (v == null ? '—' : `${fmt.man1(Math.round(v))}万`);
  const signed = (v) => (v == null
    ? el('span', { class: 'muted' }, '—')
    : el('span', { class: v >= 0 ? 'pos' : 'neg' }, `${v >= 0 ? '+' : '▲'}${fmt.n(Math.abs(v), 0)}`));

  /**
   * その建物の成約のセル。件数・最安・中央・平均・最高と、指値との差。
   *
   * 成約は「実際に決まった額」なので、指値を決めるときにいちばん効く。
   * 中央だけだと幅が見えないので、最安と最高も並べる。
   */
  const dealCells = ({ deals, offerTsubo }) => {
    const n = (v) => (v == null ? el('span', { class: 'muted' }, '—') : fmt.n(v, 0));
    if (!deals) return [0, 1, 2, 3, 4, 5].map(() => el('td', { class: 'muted' }, '—'));
    const gap = deals.tsuboMed != null && offerTsubo != null ? deals.tsuboMed - offerTsubo : null;
    return [
      el('td', {}, `${deals.count}件`),
      el('td', { class: 'muted' }, n(deals.tsuboMin)),
      el('td', { class: 'best' }, n(deals.tsuboMed)),
      el('td', { class: 'muted' }, n(deals.tsuboAvg)),
      el('td', { class: 'muted' }, n(deals.tsuboMax)),
      el('td', {}, signed(gap)),
    ];
  };

  /** 相場1つ分のセル3つ。坪単価・グロス・差（売出と指値）を並べる */
  const marketCells = ({ r, d, offerTsubo }, key) => {
    const m = r[key] ?? null;
    const gross = m != null && d.tsubo ? m * d.tsubo : null;
    return [
      el('td', { class: 'inputcell' }, numberInput({
        value: m == null ? null : Number(m.toFixed(1)),
        cls: 'lpitem-input', fkey: `${key}-${r.id}`,
        onInput: (num) => { r[key] = num; mark(); },
      })),
      el('td', { class: 'inputcell' }, d.tsubo
        ? numberInput({
          value: gross == null ? null : Math.round(gross),
          cls: 'lpitem-input', fkey: `${key}g-${r.id}`,
          onInput: (num) => { r[key] = num == null ? null : num / d.tsubo; mark(); },
        })
        : el('span', { class: 'muted' }, '—')),
      el('td', {},
        el('div', { class: 'diffline' }, el('span', { class: 'dk' }, '売出'),
          signed(m != null && d.tsuboPrice != null ? m - d.tsuboPrice : null)),
        el('div', { class: 'diffline' }, el('span', { class: 'dk' }, '指値'),
          signed(m != null && offerTsubo != null ? m - offerTsubo : null))),
    ];
  };

  const body = el('tbody', {}, rows.map((row) => {
    const { r, b, d, t, offer, offerTsubo, fees, feesOnOffer } = row;
    return el('tr', {},
      el('td', { class: 'lab' },
        el('label', { class: 'pickcell' },
          el('input', {
            type: 'checkbox', checked: isPicked(r.id) ? '' : null,
            onchange: (e) => { togglePick(r.id, e.target.checked); rerender(); },
          }),
          el('span', {}, `${b?.name ?? ''} ${r.label}`))),
      el('td', {}, d.ageYears != null ? `築${d.ageYears}年` : '—'),
      el('td', {}, r.floor != null ? `${r.floor}F` : '—'),
      el('td', {}, r.area != null ? `${r.area}㎡` : '—'),
      el('td', {}, oku(r.price)),
      el('td', { class: 'inputcell' }, numberInput({
        value: offer, cls: 'lpitem-input', fkey: `offer-${r.id}`,
        onInput: (num) => { r.offerPrice = num; mark(); },
      })),
      el('td', { class: 'muted' }, man(d.tsuboPrice)),
      el('td', { class: offerTsubo != null ? 'best' : 'muted' }, man(offerTsubo)),
      ...MARKET_SOURCES.flatMap(([key]) => marketCells(row, key)),
      ...dealCells(row),
      el('td', { class: feesOnOffer ? null : 'muted' }, man(fees)),
      el('td', {}, d.kanriShuzen != null ? `${fmt.n(d.kanriShuzen, 2)}万` : '—'),
    );
  }));

  const t0 = terms;   // 見出しに出す諸費用の条件。試算金利の上乗せと同じものを使う
  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, '指値の検討'),
    el('div', { class: 'toolbar' },
      select(ui.offer.filter.status, [['', 'すべての状態'], ...STATUSES.map((v) => [v, v])],
        (v) => { ui.offer.filter.status = v; rerender(); }),
      toggle('指値を入れた部屋だけ', ui.offer.filter.offerOnly,
        (v) => { ui.offer.filter.offerOnly = v; rerender(); }),
      el('span', { class: 'tiny muted' },
        rows.length === all.length ? `${all.length}室` : `${rows.length} / ${all.length}室`)),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp offertbl' },
        el('thead', {}, el('tr', {},
          sortTh('name', '物件', '', 'lab'),
          sortTh('age', '築年数', ''),
          sortTh('floor', '階', ''),
          sortTh('area', '広さ', ''),
          sortTh('price', '現価格', '売り出し'),
          sortTh('offer', '指値', '万円'),
          sortTh('tsubo', '元坪', '現価格 ÷ 坪'),
          sortTh('offerTsubo', '指値坪', '指値 ÷ 坪'),
          ...MARKET_SOURCES.flatMap(([mk, label]) => [
            sortTh(mk, `${label} 坪`, '万円/坪'),
            sortTh(`${mk}:gross`, `${label} 価格`, '相場坪 × 坪数'),
            sortTh(`${mk}:gap`, `${label}との差`, '＋ほど相場より安い'),
          ]),
          sortTh('deal:n', '成約', '件数'),
          sortTh('deal:min', '成約 最安', '万円/坪'),
          sortTh('deal:med', '成約 中央', '万円/坪'),
          sortTh('deal:avg', '成約 平均', '万円/坪'),
          sortTh('deal:max', '成約 最高', '万円/坪'),
          sortTh('deal:gap', '成約中央との差', '＋ほど成約より安い'),
          sortTh('fees', '諸費用', `指値の${t0.costRate}%${t0.costFixed ? ` ＋ ${t0.costFixed}万` : ''}`),
          sortTh('running', '管理＋修繕', '月額'),
        )),
        body))),
    el('div', { class: 'toolbar', style: 'margin-top:12px' },
      el('button', {
        class: 'btn btn-sm',
        onclick: () => { location.hash = '#/compare'; },
      }, '選んだ部屋を比較で見る')),
  );
}

