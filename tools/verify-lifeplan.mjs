// 家計シミュレーションの初期値が、元にしたスライドの数字と一致するかを確認する。
// 使い方: node tools/verify-lifeplan.mjs
const { defaultLifeplan, calcPlan } = await import(new URL('../js/lifeplan.js', import.meta.url).href);
const { DEFAULT_TERMS } = await import(new URL('../js/loan.js', import.meta.url).href);
const p = defaultLifeplan();
const r = calcPlan(p, null, null, DEFAULT_TERMS);
console.log('=== スライドの数字と突き合わせ ===');
console.log('収入合計       ', r.income.toFixed(1), '万円  （スライド 120）');
for (const g of r.groups) console.log(`  ${g.name.padEnd(8)} ${g.total.toFixed(1)} 万円`);
console.log('支出合計       ', r.expense.toFixed(1), '万円  （スライド 119.1）');
console.log('毎月の残り     ', r.balance.toFixed(1), '万円  （スライド +0.9）');
console.log('資産形成（先取り）', r.saving.toFixed(1), '万円  （スライド 24 + 積立5 = 29）');
console.log('貯蓄率         ', r.savingRate.toFixed(1), '%');
console.log('残りを含む合計 ', r.totalLeft.toFixed(1), '万円  （スライド 24.9 + 積立5）');
