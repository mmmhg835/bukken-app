// 絞り込んだ条件に合うものが、どの画面でも「全部」出ているかを確かめる。
//
// 「絞ったのにグラフに出てこない」「消したら別のが増える」といった食い違いは、
// 画面ごとに間引きの決まりがばらばらだと起きる。ここで突き合わせておく。
// 使い方: node tools/verify-filter.mjs
import { readFileSync, readdirSync } from 'node:fs';
const DATA = '/Users/tatsuyoshi/Desktop/ライフプランシミュレーション/bukken-data';
const APP = new URL('..', import.meta.url).pathname;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.indexedDB = { open: () => ({}) };
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, append() {} }) };
const j = (p) => JSON.parse(readFileSync(`${DATA}/${p}`, 'utf8'));

const { store } = await import(`${APP}js/store.js`);
const mk = await import(`${APP}js/market.js`);
const mv = await import(`${APP}js/market-view.js`);
const uf = await import(`${APP}js/unit-filter.js`);
const units = await import(`${APP}js/units.js`);
const an = await import(`${APP}js/analysis.js`);

store.data = j('properties.json');
const refs = []; for (const f of j('refs/index.json').files) refs.push(...j(f));
store.setRefs(refs); store.setOnsale(j('onsale.json'));
try { store.setDeals(j('deals.json')); } catch { store.setDeals({ rows: [] }); }
for (const f of readdirSync(`${DATA}/market`)) store.setMarket(f.slice(0, -5), j(`market/${f}`));

let ng = 0;
const ok = (cond, msg, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${msg}${detail ? `  ${detail}` : ''}`);
  if (!cond) ng++;
};

const base = {
  listing: 'all', own: 'all', name: '', station: [], ward: [], town: 'all',
  age: 'all', walk: 'all', brand: 'all', developer: 'all', builder: 'all', designer: 'all',
  layout: 'all', tower: false, unitsMin: null, unitsMax: null,
  priceMin: null, priceMax: null, areaMin: null, areaMax: null, equip: [],
};
const mBase = { building: 'all', from: 'all', to: 'all', listing: 'all' };
const apply = (u = {}, m = {}) => {
  Object.assign(uf.unitUI, base, u);
  uf.resetDraft();
  Object.assign(mv.marketUI, mBase, { group: 'building', group2: 'none', step: 'quarter',
    span: 'all', minCount: 1, hide: [], pin: [], pick: null, loadAll: true }, m);
};

/* ===== 1. 絞り込んだ建物が、相場の対象と一致するか ===== */
console.log('--- 絞り込みが相場に効くか');
for (const [label, cond] of [
  ['駅＝豊洲', { station: ['豊洲'] }],
  ['区＝川崎市中原区', { ward: ['川崎市中原区'] }],
  ['タワーだけ', { tower: true }],
  ['総戸数 500戸以上', { unitsMin: 500 }],
  ['築20年以内', { age: '-20' }],
  ['駅徒歩10分以内', { walk: '-10' }],
  ['駅＝豊洲 かつ タワー', { station: ['豊洲'], tower: true }],
]) {
  apply(cond);
  const want = store.allBuildings.filter((b) => {
    if (cond.station?.length && !an.stationsOf(b).some((x) => cond.station.includes(x))) return false;
    if (cond.ward?.length && !cond.ward.includes(an.wardOf(b))) return false;
    if (cond.tower && !an.isTower(b)) return false;
    if (cond.unitsMin != null && !((Number(b.totalUnits) || 0) >= cond.unitsMin)) return false;
    if (cond.age && cond.age !== 'all' && !units.inBand(cond.age, units.ageOf(b))) return false;
    if (cond.walk && cond.walk !== 'all'
      && !units.inBand(cond.walk, units.walkOf(b, cond.station || []))) return false;
    return true;
  }).length;
  const got = mv.marketCounts().buildings;
  ok(got === want, label, `相場の対象 ${got}棟 / 条件に合う ${want}棟`);
}

/* ===== 2. 対象の建物が、グラフの線として全部出るか ===== */
console.log('\n--- 絞った建物が、推移のグラフに全部出るか');
for (const [label, cond] of [
  ['駅＝豊洲', { station: ['豊洲'] }],
  ['駅＝武蔵小杉 かつ タワー', { station: ['武蔵小杉'], tower: true }],
  ['区＝川崎市幸区', { ward: ['川崎市幸区'] }],
]) {
  apply(cond);
  const rows = mv.saleRows(mv.targetBuildings());
  // 建物ごとに分類したときに出るはずの数
  const want = new Set(rows.map((x) => store.building(x.buildingId)?.name || '不明')).size;
  const got = mv.growthRowsOf(rows).length;
  ok(got === want, label, `グラフ＋表 ${got}件 / 売り出しのある建物 ${want}件`);
}

/* ===== 3. 1本消しても、他が繰り上がってこないか ===== */
console.log('\n--- 消したときに別のものが増えないか');
apply({ station: ['豊洲'] });
const rows = mv.saleRows(mv.targetBuildings());
const before = mv.growthRowsOf(rows);
mv.marketUI.hide = [before[0]];
const after = mv.growthRowsOf(rows);
ok(after.length === before.length - 1, '1件消したら1件だけ減る',
  `${before.length}件 → ${after.length}件`);
ok(!after.includes(before[0]), '消したものが残っていない');
ok(after.every((x) => before.includes(x)), '消したのに知らないものが増えていない');

/* ===== 4. 一覧と相場で、同じ条件なら同じ建物を見ているか ===== */
console.log('\n--- 一覧と相場で対象がずれないか');
for (const [label, cond] of [
  ['駅＝横浜', { station: ['横浜'] }],
  ['タワー かつ 築20年以内', { tower: true, age: '-20' }],
]) {
  apply(cond);
  const listBuildings = new Set(units.allUnits().filter((x) => uf.unitMatches(x)).map((x) => x.b.id));
  const marketBuildings = new Set(mv.targetBuildings().map((b) => b.id));
  // 一覧は「売り出し中の部屋がある建物」だけなので、相場の対象に含まれていればよい
  const stray = [...listBuildings].filter((id) => !marketBuildings.has(id));
  ok(stray.length === 0, label, `一覧にあって相場に無い建物 ${stray.length}棟`);
}


/* ===== 5. 部屋を持つ建物は、参考側ではなく自分の建物側にいるか ===== */
console.log('\n--- 部屋のある建物が自分側にいるか');
{
  const own = new Set(store.buildings.map((b) => b.id));
  const stray = [...new Set(store.rooms.map((r) => r.buildingId))].filter((id) => !own.has(id));
  ok(stray.length === 0, '部屋があるのに参考側に残っている建物',
    stray.map((id) => `${store.building(id)?.name ?? id}`).join(', ') || 'なし');
  const noName = store.rooms.filter((r) => !store.building(r.buildingId)?.name);
  ok(noName.length === 0, '建物名が引けない部屋',
    noName.map((r) => r.label).join(', ') || 'なし');
}


/* ===== 6. 成約は正しい建物についているか ===== */
console.log('\n--- 成約');
{
  const rows = store.dealRows;
  if (!rows.length) {
    console.log('（成約の記録なし）');
  } else {
    const ids = new Set(store.allBuildings.map((b) => b.id));
    const stray = rows.filter((x) => !ids.has(x.buildingId));
    ok(stray.length === 0, '建物が見つからない成約', `${stray.length}件`);
    // 坪単価が価格と面積に合っているか。読み取り違いはここで出る
    const off = rows.filter((x) => x.price && x.area && x.tsuboPrice
      && Math.abs(x.price / (x.area / 3.305785) - x.tsuboPrice) > 3);
    ok(off.length === 0, '坪単価が価格÷坪数と合わない成約', `${off.length}件`);
    const future = rows.filter((x) => x.closedAt > new Date().toISOString().slice(0, 10));
    ok(future.length === 0, '成約日が未来の行', `${future.length}件`);
    console.log(`   ${rows.length}件 / ${new Set(rows.map((x) => x.buildingId)).size}棟`);
  }
}

console.log(ng ? `\n❌ ${ng}件ずれています` : '\n✅ すべて一致');
process.exit(ng ? 1 : 0);
