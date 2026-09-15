// ローン計算の検証。閉じた式の結果を、1か月ずつ回した返済表と突き合わせる。
// 使い方: node tools/verify-loan.mjs
// 返済表を1か月ずつ回して、閉じた式の結果が正しいかを独立に検証する
const { calcLoan } = await import(new URL('../js/loan.js', import.meta.url).href);

function simulate(P, ratePct, years, monthly) {
  const r = ratePct / 100 / 12, n = years * 12;
  let bal = P, totalInterest = 0;
  for (let i = 0; i < n; i++) {
    const interest = bal * r;
    totalInterest += interest;
    bal = bal + interest - monthly;
  }
  return { finalBalance: bal, totalInterest };
}

console.log('■ 元利均等：毎月返済額で n 回返したとき、残高がちょうど 0 になるか\n');
for (const [P, rate, years] of [[16500,0.7,35],[16500,1.275,50],[10980,1.275,50],[13900,1.275,50],[5000,2.5,20]]) {
  const c = calcLoan(P, { rate, years, method: 'equal' });
  const s = simulate(P, rate, years, c.monthly);
  const ok = Math.abs(s.finalBalance) < 1e-6;
  console.log(`${String(P).padStart(6)}万 ${String(rate).padStart(5)}% ${String(years).padStart(2)}年`
    + ` → 毎月 ${c.monthly.toFixed(4)}万`
    + ` / 残高 ${s.finalBalance.toExponential(2)} ${ok ? '✅' : '❌'}`
    + ` / 総利息 式 ${c.totalInterest.toFixed(2)} vs 実測 ${s.totalInterest.toFixed(2)}`
    + ` ${Math.abs(c.totalInterest - s.totalInterest) < 0.01 ? '✅' : '❌'}`);
}

console.log('\n■ 元金均等：初回・最終回・総利息が理論値と一致するか\n');
for (const [P, rate, years] of [[16500,0.7,50],[10980,1.275,50]]) {
  const c = calcLoan(P, { rate, years, method: 'principal' });
  const r = rate/100/12, n = years*12, base = P/n;
  const theoFirst = base + P*r;
  const theoLast  = base + base*r;                 // 最終月の残高は base のみ
  const theoInt   = P*r*(n+1)/2;                   // 残高が等差で減るので利息は等差数列の和
  const chk = (a,b)=>Math.abs(a-b)<0.01?'✅':'❌';
  console.log(`${P}万 ${rate}% ${years}年`);
  console.log(`  初回  実装 ${c.monthlyFirst.toFixed(4)} / 理論 ${theoFirst.toFixed(4)} ${chk(c.monthlyFirst,theoFirst)}`);
  console.log(`  最終回 実装 ${c.monthlyLast.toFixed(4)} / 理論 ${theoLast.toFixed(4)} ${chk(c.monthlyLast,theoLast)}`);
  console.log(`  総利息 実装 ${c.totalInterest.toFixed(2)} / 理論 ${theoInt.toFixed(2)} ${chk(c.totalInterest,theoInt)}`);
}

console.log('\n■ 境界値\n');
const z = calcLoan(12000, { rate: 0, years: 30 });
console.log(`金利0%: 毎月 ${z.monthly.toFixed(4)}万 / 期待 ${(12000/360).toFixed(4)} ${Math.abs(z.monthly-12000/360)<1e-9?'✅':'❌'}`);
const d = calcLoan(10000, { rate: 1, years: 35, downPayment: 3000 });
console.log(`頭金3000万: 借入 ${d.principal}万 / 期待 7000 ${d.principal===7000?'✅':'❌'}`);
const n0 = calcLoan(0, { rate: 1, years: 35 });
console.log(`価格0: 毎月 ${n0.monthly} / 総額 ${n0.totalPayment} ${n0.monthly===0?'✅':'❌'}`);
const over = calcLoan(3000, { rate: 1, years: 35, downPayment: 5000 });
console.log(`頭金 > 価格: 借入 ${over.principal} 毎月 ${over.monthly} ${over.principal===0&&over.monthly===0?'✅':'❌'}`);
