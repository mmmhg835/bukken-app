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
// 本物のデータを全部読み込んだ状態で、各画面の描画にかかる時間を測る。
// 件数が増えて初めて出る遅さ（件数の2乗に比例する処理など）を見つけるためのもの。
// 使い方: node tools/perf.mjs   （bukken-data が隣にあるときだけ動く）
import { readFileSync, readdirSync } from 'node:fs';
const DATA = '/Users/tatsuyoshi/Desktop/ライフプランシミュレーション/bukken-data';
const APP = '/Users/tatsuyoshi/Desktop/ライフプランシミュレーション/bukken-app';
const j = (p) => JSON.parse(readFileSync(`${DATA}/${p}`, 'utf8'));
const { store } = await import(`${APP}/js/store.js`);
const views = await import(`${APP}/js/views.js`);
const market = await import(`${APP}/js/market-view.js`);
const lifeplan = await import(`${APP}/js/lifeplan-view.js`);
const uf = await import(`${APP}/js/unit-filter.js`);
const units = await import(`${APP}/js/units.js`);
store.data = j('properties.json');
const refs = []; for (const f of j('refs/index.json').files) refs.push(...j(f));
store.setRefs(refs); store.setOnsale(j('onsale.json'));
for (const f of readdirSync(`${DATA}/market`)) store.setMarket(f.slice(0, -5), j(`market/${f}`));
views.bindRouter(() => {}, () => {});
const t = (n, fn, times = 1) => {
  const s = Date.now(); for (let i = 0; i < times; i++) fn();
  const ms = (Date.now() - s) / times;
  console.log(`${String(Math.round(ms)).padStart(6)}ms  ${n}`);
  return ms;
};
console.log(`建物 ${store.allBuildings.length} / 相場 ${readdirSync(`${DATA}/market`).length}棟 / 売り出し ${store.onsaleRows.length}`);
console.log('--- 画面');
t('一覧（建物ごと・募集中）', () => views.renderList(stubEl()));
uf.unitUI.listing = 'all'; uf.resetDraft();
t('一覧（すべて）', () => views.renderList(stubEl()));
views.listUI.mode = 'room';
t('一覧（部屋ごと・すべて）', () => views.renderList(stubEl()));
views.listUI.mode = 'building';
t('比較', () => views.renderCompare(stubEl()));
t('ライフプラン', () => lifeplan.renderLifeplan(stubEl(), () => {}));
Object.assign(market.marketUI, { mine: 'all', loadAll: true });
for (const tab of ['overview', 'sale', 'trend', 'dist', 'group', 'rent', 'new']) {
  t(`相場 ${tab}`, () => market.renderMarket(stubEl(), () => {}, tab));
}
console.log('--- 部品');
t('allUnits()', () => units.allUnits(), 5);
t('絞り込み判定 1529件', () => store.onsaleRows.map((x) => x), 5);
const all = units.allUnits();
t('unitMatches 全件', () => all.filter((x) => uf.unitMatches(x)), 5);
t('building(id) 1万回', () => { for (let i = 0; i < 10000; i++) store.building('b8'); }, 3);
console.log('--- 相場の部品');
const mk = await import(`${APP}/js/market.js`);
const allRows = store.allBuildings.flatMap((b) => store.listingsOf(b.id));
console.log('売出行', allRows.length.toLocaleString());
t('summary(全件)', () => mk.summary(allRows), 3);
t('sortRows(全件)', () => mk.sortRows(allRows), 3);
const newRows = store.allBuildings.flatMap((b) => store.newPricesOf(b.id));
console.log('新築行', newRows.length.toLocaleString());
t('sortNewPrices', () => mk.sortNewPrices(newRows), 3);
t('newSummary', () => mk.newSummary(newRows), 3);
const rentRows = store.allBuildings.flatMap((b) => store.rentsOf(b.id));
t('rentSummary', () => mk.rentSummary(rentRows), 3);
t('yearly(全件)', () => mk.yearly(allRows), 3);
t('pricePoints(全件)', () => mk.pricePoints(allRows), 3);
// 絞り込みバーの選択肢づくり。1回の描画で何度も全行をなめていないかを見る
t('targetBuildings(全件)', () => market.targetBuildings(), 5);
t('saleRows(全件)', () => market.saleRows(store.allBuildings), 3);
// 分類ごとに線を全部引いたときの重さ（絞り込みなしは最悪ケース）
market.marketUI.group = 'building'; market.marketUI.minCount = 1;
t('相場 推移（建物ごと・全件）', () => market.renderMarket(stubEl(), () => {}, 'trend'));
market.marketUI.group = 'station';
t('相場 推移（駅ごと・全件）', () => market.renderMarket(stubEl(), () => {}, 'trend'));
