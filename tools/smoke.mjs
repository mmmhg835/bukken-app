// 全モジュールを実際に読み込み、import 漏れや未定義参照を検出する。
// ブロック単位で書き換えたときに隣の定義を巻き込む事故が実際に起きたため、
// コミット前に必ず実行する。
// 使い方: node tools/smoke.mjs
// 要素として触られうる操作はすべて受け流す。中身の正しさではなく、
// 読み込み時に未定義参照が出ないかを見るための土台。
const stubEl = () => new Proxy({
  style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  hidden: false, value: '', textContent: '', innerHTML: '', options: [], children: [],
}, {
  get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && k.startsWith('on') ? null : () => stubEl())),
  set: (t, k, v) => { t[k] = v; return true; },
});
globalThis.document = {
  createElement: stubEl, createElementNS: stubEl,
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
  'ui', 'gallery', 'map', 'pairing', 'theme', 'analysis', 'lifeplan', 'sales',
  'analytics-view', 'lifeplan-view', 'views', 'main',
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

console.log(bad ? `\n${bad} 件の問題` : '\n✅ すべて通過');
process.exit(bad ? 1 : 0);
