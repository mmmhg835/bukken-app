// 全モジュールを実際に読み込み、import 漏れや未定義参照を検出する。
// ブロック単位で書き換えたときに隣の定義を巻き込む事故が実際に起きたため、
// コミット前に必ず実行する。
// 使い方: node tools/smoke.mjs
// 要素として触られうる操作はすべて受け流す。中身の正しさではなく、
// 読み込み時に未定義参照が出ないかを見るための土台。
const stubEl = () => new Proxy({
  style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  nodeType: 1, hidden: false, value: '', textContent: '', innerHTML: '',
  options: [], children: [], parts: [], length: 0,
}, {
  get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && k.startsWith('on') ? null : () => stubEl())),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = {
  createElement: stubEl, createElementNS: stubEl,
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
  // main.js は起動時に要素を掴むので、常にスタブを返す
  querySelector: stubEl, querySelectorAll: () => [], getElementById: stubEl,
  addEventListener() {}, head: { append() {} }, body: { append() {} },
  documentElement: { setAttribute() {}, removeAttribute() {} },
};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {}, scrollTo() {}, scrollY: 0,
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.indexedDB = { open: () => ({}) };
globalThis.CSS = { escape: (s) => s };
Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: null }, configurable: true });
Object.defineProperty(globalThis, 'location', {
  value: { hash: '', pathname: '/', origin: 'http://x', protocol: 'http:' }, configurable: true,
});

const FILES = [
  'util', 'loan', 'spec', 'price', 'chart', 'idb', 'image', 'github', 'migrate', 'store',
  'ui', 'gallery', 'map', 'pairing', 'theme', 'analysis', 'lifeplan', 'sales', 'parse', 'sale',
  'analytics-view', 'lifeplan-view', 'import-view', 'sale-view', 'views', 'main',
];

let bad = 0;
const mods = {};
for (const f of FILES) {
  try { mods[f] = await import(new URL(`../js/${f}.js`, import.meta.url).href); }
  catch (e) { bad++; console.log(`❌ ${f}.js : ${e.message}`); }
}

// 画面描画の入口が実際に呼べるか（未定義参照はここで露見する）
const checks = [
  ['migrate', () => {
    const { migrate, CURRENT_SCHEMA } = mods.migrate;
    const d = migrate({ schemaVersion: 1, properties: [] });
    if (d.schemaVersion !== CURRENT_SCHEMA) throw new Error('スキーマ番号が一致しない');
    for (const key of ['loan', 'places', 'lifeplan']) {
      if (!d.settings[key]) throw new Error(`settings.${key} が初期化されていない`);
    }
  }],
  ['lifeplan', () => {
    const { defaultLifeplan, calcPlan, waterfall } = mods.lifeplan;
    const res = calcPlan(defaultLifeplan(), null, null, mods.loan.DEFAULT_TERMS);
    const w = waterfall(res);
    const sum = res.saving + res.housingTotal + res.carTotal + res.fixed + res.variable;
    if (Math.abs(sum - res.expense) > 1e-9) {
      throw new Error(`区分の合計 ${sum} が支出合計 ${res.expense} と一致しない`);
    }
    if (w.steps.length !== 4) throw new Error('段階表の段数が想定と違う');
    // 段階表の最後の残りが、変動費に回せる額と一致すること
    if (Math.abs(w.variableBudget - res.variableBudget) > 1e-9) {
      throw new Error('段階表と変動費予算が食い違う');
    }
  }],
  ['手取りの集計', () => {
    const { defaultLifeplan, netIncomeByWho, calcPlan, incomePatterns } = mods.lifeplan;
    const plan = defaultLifeplan();
    const base = netIncomeByWho(plan);
    if (base.primary !== 960) throw new Error(`本人の手取りが 960 でない (${base.primary})`);
    if (base.secondary !== 480) throw new Error(`配偶者の手取りが 480 でない (${base.secondary})`);
    if (base.shared !== 0) throw new Error('計画に含めない賞与が入っている');

    // OFF にした収入は入らない
    plan.income[0].enabled = false;
    if (netIncomeByWho(plan).primary !== 0) throw new Error('OFF にした収入が集計に残っている');
    plan.income[0].enabled = true;

    // 賞与を ON にすると共通に乗る
    plan.bonus.include = true;
    if (netIncomeByWho(plan).shared !== plan.bonus.annual) throw new Error('賞与が反映されていない');
    plan.bonus.include = false;

    // 共通の収入は、どの見方（本人だけ／配偶者も含めて）にも入る
    plan.income[2].enabled = true;
    plan.income[2].amount = 3;
    const res = calcPlan(plan, { price: 13200, area: 80, kanrihi: 2, shuzen: 2 }, null, mods.loan.DEFAULT_TERMS);
    const rows = incomePatterns(plan, { price: 13200 }, res);
    if (rows[0].net.annual !== 960 + 36) throw new Error('本人のみの手取りに共通が入っていない');
    if (rows[2].net.annual !== 960 + 480 + 36) throw new Error('配偶者込みの手取りが合わない');
    plan.income[2].enabled = false;
  }],
  ['incomePatterns', () => {
    const { defaultLifeplan, calcPlan, incomePatterns } = mods.lifeplan;
    const plan = defaultLifeplan();
    const room = { price: 13200, area: 80, kanrihi: 2, shuzen: 2 };
    const res = calcPlan(plan, room, null, mods.loan.DEFAULT_TERMS);
    const rows = incomePatterns(plan, room, res);
    if (rows.length !== 3) throw new Error('年収パターンが3つでない');
    for (const base of ['gross', 'net']) {
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1][base], cur = rows[i][base];
        if (!(cur.annual > prev.annual)) throw new Error(`${base}: 年収の並びが不正`);
        if (!(cur.loan < prev.loan)) throw new Error(`${base}: 返済負担率の並びが不正`);
        if (!(cur.multiple < prev.multiple)) throw new Error(`${base}: 年収倍率の並びが不正`);
      }
      for (const r of rows) {
        if (!(r[base].housing > r[base].loan)) throw new Error(`${base}: 住居費込みがローンのみを下回っている`);
      }
    }
    // 手取りは額面より小さいので、負担率は必ず手取りベースの方が高くなる
    for (const r of rows) {
      if (!(r.net.loan > r.gross.loan)) throw new Error('手取りベースの負担率が額面ベースを上回っていない');
    }
  }],
  ['loan', () => {
    const { calcLoan } = mods.loan;
    const r = calcLoan(10000, { rate: 1, years: 35 });
    if (!(r.monthly > 0 && r.totalPayment > r.principal)) throw new Error('返済額が不正');
  }],
  ['spec', () => {
    const { SPEC_GROUPS } = mods.spec;
    for (const [key, g] of Object.entries(SPEC_GROUPS)) {
      if (!g.options?.length) throw new Error(`${key} に選択肢がない`);
      if (new Set(g.options).size !== g.options.length) throw new Error(`${key} に重複がある`);
    }
  }],
  ['parse', () => {
    const { parseListing } = mods.parse;
    const r = parseListing('価格\t1億2,800万円\n専有面積\t80.5m2\n所在階\t20階/RC40階建');
    const get = (on, key) => r.items.find((i) => i.on === on && i.key === key)?.value;
    if (get('room', 'price') !== 12800) throw new Error('価格を読めていない');
    if (get('room', 'area') !== 80.5) throw new Error('面積を読めていない');
    if (get('room', 'floor') !== 20) throw new Error('所在階を読めていない');
    if (get('building', 'totalFloors') !== 40) throw new Error('総階数を所在階と取り違えている');
  }],
  ['numberInput', () => {
    const { sanitizeNumeric, numOrNull } = mods.util;
    const cases = [
      ['1.5', '1.5'], ['1.', '1.'], ['0.', '0.'], ['.5', '.5'],
      ['１．５', '1.5'],                 // 全角で打たれても通す
      ['1.2.3', '1.23'],                // 2つ目以降の小数点は落とす
      ['12a3', '123'], ['-3', '-3'],
      ['3-4', '34'],                    // 途中で打たれたマイナスは押し間違いとみなして捨てる
      ['', ''],
    ];
    for (const [input, want] of cases) {
      const got = sanitizeNumeric(input);
      if (got !== want) throw new Error(`sanitize ${JSON.stringify(input)} → ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
    }
    if (sanitizeNumeric('2.5', { integer: true }) !== '25') throw new Error('整数欄で小数点が残っている');
    // 入力途中でも壊れないこと（ここで null を返すと打った小数点が消える）
    if (numOrNull('1.') !== 1) throw new Error('「1.」を読めていない');
    if (numOrNull('') !== null || numOrNull('-') !== null || numOrNull('.') !== null) {
      throw new Error('未入力を null として扱えていない');
    }
    if (numOrNull('0') !== 0) throw new Error('0 を null にしてしまっている');
    if (numOrNull('1.5') !== 1.5) throw new Error('小数を読めていない');
  }],
  ['指値', () => {
    const { defaultLifeplan, calcPlan, housingCost } = mods.lifeplan;
    const plan = defaultLifeplan();
    const terms = mods.loan.DEFAULT_TERMS;
    const room = { price: 16500, area: 100, kanrihi: 2, shuzen: 2 };
    const offer = { ...room, price: 15000 };
    const a = calcPlan(plan, room, null, terms);
    const b = calcPlan(plan, offer, null, terms);
    if (!(b.housingTotal < a.housingTotal)) throw new Error('指値で住居費が下がっていない');
    if (!(b.balance > a.balance)) throw new Error('指値で毎月の残りが増えていない');
    // 管理費・修繕は価格に連動しないので、差はローン返済だけのはず
    const dLoan = housingCost(room, null, terms).items[0].amount - housingCost(offer, null, terms).items[0].amount;
    if (Math.abs((a.housingTotal - b.housingTotal) - dLoan) > 0.15) {
      throw new Error('住居費の差がローン返済の差と合わない');
    }
    // 元の部屋を書き換えていないこと（一覧や分析の現在価格が変わってしまう）
    if (room.price !== 16500) throw new Error('元の部屋の価格を書き換えている');
  }],
  ['売却', () => {
    const { saleResult, saleSchedule, breakEvenYear, DEFAULT_SALE } = mods.sale;
    const terms = mods.loan.DEFAULT_TERMS;
    const room = { price: 16500, kanrihi: 2.3, shuzen: 2.1 };
    const sale = { ...DEFAULT_SALE, years: 10, price: 17000 };
    const r = saleResult(room, terms, sale);
    if (Math.abs(r.cashBack - (r.netProceeds - r.balance)) > 1e-9) throw new Error('手残りの式が合わない');
    if (Math.abs(r.netCost - (r.upfront + r.paidTotal - r.cashBack)) > 1e-9) throw new Error('実質負担の式が合わない');
    // 同じ価格なら、年が経つほど残債が減って手残りは増える
    const rows = saleSchedule(room, terms, sale, 30);
    for (let i = 1; i < rows.length; i++) {
      if (!(rows[i].cashBack > rows[i - 1].cashBack)) throw new Error('手残りが年々増えていない');
    }
    if (breakEvenYear(rows) == null) throw new Error('手残りが0以上になる年を出せていない');
  }],
  ['import', () => {
    const { parseListing } = mods.parse;
    const { mergeInto } = mods['import-view'];
    const res = parseListing([
      'マンション名：テスト南タワー',
      '価格：1億2,800万円',
      '所在階：20階',
      '専有面積：80.5m2',
      '設備：オートロック、食器洗い乾燥機',
    ].join('\n'));
    const b = { name: '', facilityTags: [] };
    const r = { label: '新規の部屋', priceHistory: [], roomEquipmentTags: ['床暖房'] };
    mergeInto(b, r, {
      items: res.items, tags: res.tags,
      entry: { date: '2026-01-10', price: 12800, note: '登録時' },
    });
    if (b.name !== 'テスト南タワー') throw new Error('建物名が入っていない');
    if (r.price !== 12800) throw new Error('価格が最新の履歴と揃っていない');
    if (r.label !== '20階') throw new Error('部屋の呼び名が既定のまま');
    if (!b.facilityTags.includes('オートロック')) throw new Error('共用施設のタグが入っていない');
    // 既存のタグを消さずに足すこと
    if (!r.roomEquipmentTags.includes('床暖房') || !r.roomEquipmentTags.includes('食洗機')) {
      throw new Error('部屋の設備タグの合成が不正');
    }
  }],
  ['analysis', () => {
    const { METRICS, ATTRS, GROUPINGS } = mods.analysis;
    for (const [name, set] of [['METRICS', METRICS], ['ATTRS', ATTRS], ['GROUPINGS', GROUPINGS]]) {
      for (const [k, def] of Object.entries(set)) {
        if (typeof def.get !== 'function' || !def.label) throw new Error(`${name}.${k} の定義が不正`);
      }
    }
  }],
];

for (const [name, fn] of checks) {
  try { fn(); console.log(`✅ ${name}`); }
  catch (e) { bad++; console.log(`❌ ${name} : ${e.message}`); }
}

/* ===== 画面を実際に描いてみる =====
   モジュールを読み込むだけでは、関数の中で未定義を参照していても気づけない。
   ブロック単位の書き換えで隣の関数を消す事故が4回起きているため、
   すべての画面の入口を呼び出して確認する。 */
const { store } = mods.store;
store.data = mods.migrate.migrate({
  schemaVersion: 1,
  properties: [
    { id: 'p1', name: 'テストタワー', price: 12000, area: 80, layout: '3LDK',
      floor: 20, totalFloors: 40, builtYM: '2010/04', stations: 'A駅 / B駅',
      walk: 'A駅5分・B駅9分', balcony: 12, kanrihi: 2, shuzen: 1.8,
      monthlyTotal: 30, reform: '水回り・全室', viewNote: '', roomNote: '',
      imageRange: '', memo: '', images: [] },
  ],
});
store.data.buildings[0].address = '東京都江東区東雲1-9-10';
store.data.buildings[0].lat = 35.6; store.data.buildings[0].lng = 139.8;
const room = store.data.rooms[0];
room.listedAt = '2026-01-10';
room.priceHistory = [
  { date: '2026-01-10', price: 12800 },
  { date: '2026-05-01', price: 12000 },
];

const screens = [
  ['一覧', () => mods.views.renderList(stubEl())],
  ['比較', () => mods.views.renderCompare(stubEl())],
  ['建物詳細', () => mods.views.renderBuilding(stubEl(), store.data.buildings[0].id)],
  ['部屋詳細', () => mods.views.renderRoom(stubEl(), room.id)],
  ['設定', () => mods.views.renderSettings(stubEl())],
  ['取り込み', () => mods['import-view'].renderImport(stubEl())],
  ['地図', () => mods.views.renderMap(stubEl())],
  ['分析', () => mods['analytics-view'].renderAnalysis(stubEl(), () => {})],
  ['ライフプラン', () => mods['lifeplan-view'].renderLifeplan(stubEl(), () => {}, 'plan')],
  ['返済負担比率', () => mods['lifeplan-view'].renderLifeplan(stubEl(), () => {}, 'burden')],
  ['グラフ', () => mods['lifeplan-view'].renderLifeplan(stubEl(), () => {}, 'graph')],
  ['売却', () => mods['lifeplan-view'].renderLifeplan(stubEl(), () => {}, 'sale')],
];

mods.views.bindRouter(() => {}, () => {});
for (const [name, fn] of screens) {
  try { fn(); console.log(`✅ 描画 ${name}`); }
  catch (e) { bad++; console.log(`❌ 描画 ${name} : ${e.message}`); }
}

console.log(bad ? `\n${bad} 件の問題` : '\n✅ すべて通過');
process.exit(bad ? 1 : 0);
