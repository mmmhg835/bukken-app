// ライフプランタブの中の「売却」サブタブ。
//
// 買うときの試算だけでは、途中で手放す選択肢を金額で比べられない。
// 元本がどれだけ減っているかと、そのとき売れる価格を並べて手残りを出す。
import { store } from './store.js';
import { el, fmt, mount, preserveFocus } from './util.js';
import { kv, select, segmented, numberInput, section } from './ui.js';
import { saleResult, saleSchedule, breakEvenYear, priceAtYear } from './sale.js';
import { lineChart, chartLegend, SERIES_COLORS } from './chart.js';

const COLOR = {
  balance: SERIES_COLORS[3],   // ローン残高
  proceeds: SERIES_COLORS[1],  // 売却の手取り
  cash: SERIES_COLORS[0],      // 手残り
};

const MAX_YEARS = 35;

/** 表に出す節目。全年を並べると読む気にならないので5年刻みにする */
const MILESTONE_YEARS = [3, 5, 10, 15, 20, 25, 30];

export function saleView(plan, room, rerender) {
  if (!room) {
    return el('div', { class: 'empty' }, '対象の物件を選んでください');
  }
  const terms = { ...store.loanTerms, ...(room.loan || {}) };
  const sale = { ...store.saleTerms, price: room.salePrice ?? room.price };
  const res = saleResult(room, terms, sale);
  const rows = saleSchedule(room, terms, sale, MAX_YEARS);
  const be = breakEvenYear(rows);

  return el('div', {},
    assumptions(room, sale, rerender),
    resultTiles(res, be),
    balanceChart(rows, be, res),
    milestoneTable(rows, res),
  );
}

/* =========================================================
   前提
   ========================================================= */
function assumptions(room, sale, rerender) {
  const s = store.saleTerms;
  const mark = () => { store.markDirty(); preserveFocus(rerender); };
  const basePrice = room.salePrice ?? room.price;

  return section('売却の前提',
    el('div', { class: 'panel' },
      el('div', { class: 'panel-controls' },
        el('div', { class: 'ctlrow' },
          el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '¥'), '売却価格'),
          el('div', { class: 'offerrow' },
            numberInput({
              value: room.salePrice, cls: 'offerinput', fkey: `sale-${room.id}`,
              placeholder: fmt.man1(room.price),
              onInput: (num) => { room.salePrice = num; mark(); },
            }),
            el('span', { class: 'tiny muted' }, '万円'),
            el('span', { class: 'tiny muted' }, `現在価格 ${fmt.man1(room.price)}万円`),
            room.salePrice != null
              ? el('button', {
                class: 'btn btn-sm',
                onclick: () => { room.salePrice = null; mark(); },
              }, '現在価格に戻す')
              : null,
          )),

        el('div', { class: 'ctlrow' },
          el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '◷'), '売る年'),
          el('div', { class: 'offerrow' },
            numberInput({
              value: s.years, cls: 'offerinput', fkey: 'sale-years', integer: true,
              onInput: (num) => { s.years = Math.max(1, Math.min(MAX_YEARS, num ?? 1)); mark(); },
            }),
            el('span', { class: 'tiny muted' }, '年後'),
            el('div', { class: 'tagwrap' }, [5, 10, 15, 20].map((y) => el('button', {
              type: 'button', class: 'tag' + (Number(s.years) === y ? ' is-on' : ''),
              onclick: () => { s.years = y; mark(); },
            }, `${y}年`))),
          )),

        el('div', { class: 'ctlrow' },
          el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '↘'), '価格の見方'),
          el('div', { class: 'offerrow' },
            segmented(s.priceMode || 'flat',
              [['flat', '入力した価格のまま'], ['decline', '年ごとに下がる']],
              (v) => { s.priceMode = v; mark(); }),
            s.priceMode === 'decline'
              ? el('span', { class: 'offerrow' },
                el('span', { class: 'tiny muted' }, '年'),
                numberInput({
                  value: s.declineRate, cls: 'offerinput', fkey: 'sale-decline',
                  onInput: (num) => { s.declineRate = num ?? 0; mark(); },
                }),
                el('span', { class: 'tiny muted' }, '%'),
                el('span', { class: 'tiny muted' },
                  `${s.years}年後 ${fmt.man1(Math.round(priceAtYear(basePrice, s, s.years)))}万円`))
              : null,
          )),

        el('div', { class: 'ctlrow' },
          el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '＋'), '売却諸費用'),
          el('div', { class: 'offerrow' },
            numberInput({
              value: s.costRate, cls: 'offerinput', fkey: 'sale-costrate',
              onInput: (num) => { s.costRate = num ?? 0; mark(); },
            }),
            el('span', { class: 'tiny muted' }, '％ ＋'),
            numberInput({
              value: s.costFixed, cls: 'offerinput', fkey: 'sale-costfixed',
              onInput: (num) => { s.costFixed = num ?? 0; mark(); },
            }),
            el('span', { class: 'tiny muted' }, '万円'),
            el('span', { class: 'tiny muted' }, '仲介手数料・印紙税・抵当権抹消'),
          )),
      )),
  );
}

/* =========================================================
   結果
   ========================================================= */
function resultTiles(r, be) {
  const man = (v) => `${fmt.man1(Math.round(v))}万円`;
  const sign = (v) => `${v > 0 ? '+' : ''}${fmt.man1(Math.round(v))}万円`;

  return el('div', { class: 'section' },
    el('h3', {}, `${r.years}年後に売ったら`),
    el('div', { class: 'calcgrid calcgrid-4' },
      kv('想定売却価格', man(r.salePrice), `購入 ${man(r.buyPrice)}`),
      kv('売却諸費用', man(r.saleCost), '仲介手数料など'),
      kv('ローン残高', man(r.balance), `元本の減り ${man(r.paidPrincipal)}`),
      kv('手残り', el('span', { class: r.cashBack >= 0 ? 'pos' : 'neg' }, sign(r.cashBack)),
        r.underwater ? '残債が上回る' : '残債を返した後'),

      kv('支払った利息', man(r.paidInterest), `ローン返済 ${man(r.paidLoan)}`),
      kv('管理＋修繕', man(r.paidRunning), `${r.months}か月分`),
      kv('実質負担', man(r.netCost), '購入時現金＋支払 − 手残り'),
      kv('月あたり', r.monthlyCost != null ? `${fmt.n(r.monthlyCost, 1)}万円` : '—',
        be != null ? `手残りが0以上 ${be}年後` : '売っても残債が残る'),
    ));
}

/* =========================================================
   元本の減りと売却額
   ========================================================= */
function balanceChart(rows, be, res) {
  const series = [
    { name: 'ローン残高', color: COLOR.balance, points: rows.map((r) => ({ x: r.years, y: r.balance })) },
    { name: '売却の手取り（諸費用を引いた後）', color: COLOR.proceeds,
      points: rows.map((r) => ({ x: r.years, y: r.netProceeds })) },
  ];
  const cash = [{ name: '手残り', color: COLOR.cash, fill: true,
    points: rows.map((r) => ({ x: r.years, y: r.cashBack })) }];

  const marks = [];
  if (be != null) marks.push({ x: be, label: '手残りが0' });
  if (res.years) marks.push({ x: res.years, label: `${res.years}年後` });

  return el('div', { class: 'section' },
    el('h3', {}, '元本の減りと売却額'),
    el('div', { class: 'panel' }, el('div', { class: 'panel-chart' },
      el('div', { class: 'chartwrap' },
        lineChart(series, { xLabel: '経過年数', yLabel: '万円', xUnit: '年', marks, height: 300, baseline: 'zero' })),
      chartLegend(series),
      el('div', { class: 'subhead', style: 'margin:18px 0 6px' }, '手残り'),
      el('div', { class: 'chartwrap' },
        lineChart(cash, { xLabel: '経過年数', yLabel: '万円', xUnit: '年', marks, height: 220, baseline: 'zero' })))),
  );
}

/* =========================================================
   節目ごとの比較
   ========================================================= */
function milestoneTable(rows, res) {
  const pick = MILESTONE_YEARS
    .map((y) => rows.find((r) => r.years === y))
    .filter(Boolean);
  if (!pick.some((r) => r.years === res.years)) {
    const cur = rows.find((r) => r.years === res.years);
    if (cur) pick.push(cur);
  }
  pick.sort((a, b) => a.years - b.years);

  const man = (v) => `${fmt.man1(Math.round(v))}万円`;

  return el('div', { class: 'section' },
    el('h3', {}, '売る年ごとの比較'),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp valuetable' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'lab' }, '売る年'),
          el('th', {}, '想定売却価格'),
          el('th', {}, 'ローン残高'),
          el('th', {}, '手残り'),
          el('th', {}, '実質負担'),
          el('th', {}, '月あたり'),
        )),
        el('tbody', {}, pick.map((r) => el('tr', { class: r.years === res.years ? 'is-current' : null },
          el('td', { class: 'lab' }, `${r.years}年後`),
          el('td', {}, man(r.salePrice)),
          el('td', {}, man(r.balance)),
          el('td', { class: r.cashBack >= 0 ? 'pos' : 'neg' },
            `${r.cashBack > 0 ? '+' : ''}${fmt.man1(Math.round(r.cashBack))}万円`),
          el('td', {}, man(r.netCost)),
          el('td', {}, `${fmt.n(r.monthlyCost, 1)}万円`),
        ))),
      )),
  );
}
