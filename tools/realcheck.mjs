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
// 手元の本物のデータ（private リポジトリ）を読み込んで全画面を描き、
// 例外が出ないかと、描画にかかる時間を見る。
// smoke.mjs は作り物の小さなデータで通るので、件数が増えて初めて出る不具合は
// こちらでしか見つからない。
// 使い方: node tools/realcheck.mjs   （bukken-data が隣にあるときだけ動く）
import { readFileSync, readdirSync } from 'node:fs';
const DATA = '/Users/tatsuyoshi/Desktop/ライフプランシミュレーション/bukken-data';
const APP = '/Users/tatsuyoshi/Desktop/ライフプランシミュレーション/bukken-app';
const j = (p) => JSON.parse(readFileSync(`${DATA}/${p}`, 'utf8'));

const { store } = await import(`${APP}/js/store.js`);
const views = await import(`${APP}/js/views.js`);
const market = await import(`${APP}/js/market-view.js`);
const lifeplan = await import(`${APP}/js/lifeplan-view.js`);
const uf = await import(`${APP}/js/unit-filter.js`);

store.data = j('properties.json');
const refs = [];
for (const f of j('refs/index.json').files) refs.push(...j(f));
store.setRefs(refs);
store.setOnsale(j('onsale.json'));
// 手持ちの部屋がある建物の相場を入れる
for (const b of store.data.buildings) {
  try { store.setMarket(b.id, j(`market/${b.id}.json`)); } catch {}
}
console.log(`建物 ${store.allBuildings.length} / 部屋 ${store.rooms.length} / 売り出し ${store.onsaleRows.length}`);

let fail = 0;
const run = (name, fn) => {
  const t = Date.now();
  try { fn(); console.log(`✅ ${name} (${Date.now() - t}ms)`); }
  catch (e) { fail++; console.log(`❌ ${name}: ${e.message}\n${(e.stack || '').split('\n')[1] || ''}`); }
};
run('一覧（建物ごと）', () => views.renderList(stubEl()));
run('一覧（部屋ごと・すべて）', () => {
  Object.assign(uf.unitUI, { listing: 'all', own: 'all' });
  views.renderList(stubEl());
});
run('比較', () => views.renderCompare(stubEl()));
run('ライフプラン', () => lifeplan.renderLifeplan(stubEl(), () => {}));
for (const tab of ['overview', 'sale', 'trend', 'dist', 'group', 'rent', 'new']) {
  run(`相場 ${tab}`, () => market.renderMarket(stubEl(), () => {}, tab));
}
run('相場（全建物・築年数で色分け）', () => {
  Object.assign(market.marketUI, { mine: 'all', group: 'ageBand', attr: 'area', metric: 'tsubo' });
  market.renderMarket(stubEl(), () => {}, 'sale');
});
for (const r of store.rooms) run(`部屋 ${store.building(r.buildingId).name} ${r.label}`, () => views.renderRoom(stubEl(), r.id));
for (const b of store.data.buildings.slice(0, 5)) run(`建物 ${b.name}`, () => views.renderBuilding(stubEl(), b.id));
console.log(fail ? `\n${fail} 件の問題` : '\nすべて描画できた');
