// ローン計算の検証。閉じた式の結果を、1か月ずつ回した返済表と突き合わせる。
// 使い方: node tools/verify-loan.mjs
//
// 理論値は「物件価格」ではなく calcLoan が実際に借りる額（principal）から出す。
// 諸費用を借入に含めるようにした際、価格を前提にしたままだと全件が食い違う。
const { calcLoan } = await import(new URL('../js/loan.js', import.meta.url).href);

let bad = 0;
const chk = (a, b, tol = 0.01) => {
  const ok = Math.abs(a - b) < tol;
  if (!ok) bad++;
  return ok ? '✅' : '❌';
};

/** 返済表を1か月ずつ回して、閉じた式の結果が正しいかを独立に検証する */
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
for (const [P, rate, years] of [[16500, 0.7, 35], [16500, 1.275, 50], [10980, 1.275, 50], [13900, 1.275, 50], [5000, 2.5, 20]]) {
  const c = calcLoan(P, { rate, years, method: 'equal' });
  const s = simulate(c.principal, rate, years, c.monthly);
  console.log(`${String(P).padStart(6)}万 ${String(rate).padStart(5)}% ${String(years).padStart(2)}年`
    + ` → 借入 ${c.principal.toFixed(0)}万 / 毎月 ${c.monthly.toFixed(4)}万`
    + ` / 残高 ${s.finalBalance.toExponential(2)} ${chk(s.finalBalance, 0, 1e-6)}`
    + ` / 総利息 式 ${c.totalInterest.toFixed(2)} vs 実測 ${s.totalInterest.toFixed(2)}`
    + ` ${chk(c.totalInterest, s.totalInterest)}`);
}

console.log('\n■ 元金均等：初回・最終回・総利息が理論値と一致するか\n');
for (const [P, rate, years] of [[16500, 0.7, 50], [10980, 1.275, 50]]) {
  const c = calcLoan(P, { rate, years, method: 'principal' });
  const r = rate / 100 / 12, n = years * 12, base = c.principal / n;
  const theoFirst = base + c.principal * r;
  const theoLast = base + base * r;                    // 最終月の残高は base のみ
  const theoInt = c.principal * r * (n + 1) / 2;       // 残高が等差で減るので利息は等差数列の和
  console.log(`${P}万 ${rate}% ${years}年（借入 ${c.principal.toFixed(0)}万）`);
  console.log(`  初回  実装 ${c.monthlyFirst.toFixed(4)} / 理論 ${theoFirst.toFixed(4)} ${chk(c.monthlyFirst, theoFirst)}`);
  console.log(`  最終回 実装 ${c.monthlyLast.toFixed(4)} / 理論 ${theoLast.toFixed(4)} ${chk(c.monthlyLast, theoLast)}`);
  console.log(`  総利息 実装 ${c.totalInterest.toFixed(2)} / 理論 ${theoInt.toFixed(2)} ${chk(c.totalInterest, theoInt)}`);
}

console.log('\n■ 諸費用\n');
// fees = 価格 × costRate% + costFixed。既定は借入に含める
const f = calcLoan(10000, { rate: 1, years: 35, costRate: 7, costFixed: 50 });
console.log(`諸費用 ${f.fees}万 / 期待 750 ${chk(f.fees, 750)}`);
console.log(`借入 ${f.principal}万 / 期待 10750 ${chk(f.principal, 10750)}`);
console.log(`購入時の現金 ${f.cash}万 / 期待 0（頭金なし・諸費用は借入） ${chk(f.cash, 0)}`);

console.log('\n■ 境界値\n');
// 金利だけを見たいので諸費用は 0 にする（既定のままだと借入に 7% 乗る）
const z = calcLoan(12000, { rate: 0, years: 30, costRate: 0, costFixed: 0 });
console.log(`金利0%: 毎月 ${z.monthly.toFixed(4)}万 / 期待 ${(12000 / 360).toFixed(4)} ${chk(z.monthly, 12000 / 360, 1e-9)}`);
// 諸費用を借入に含めるのが既定（借入 = 価格 + 諸費用 - 頭金）
const d = calcLoan(10000, { rate: 1, years: 35, downPayment: 3000, costRate: 7 });
console.log(`頭金3000万・諸費用込: 借入 ${d.principal}万 / 期待 7700 ${chk(d.principal, 7700)}`);
const d2 = calcLoan(10000, { rate: 1, years: 35, downPayment: 3000, costRate: 7, includeFees: false });
console.log(`頭金3000万・諸費用別: 借入 ${d2.principal}万 / 期待 7000 ${chk(d2.principal, 7000)}`);
console.log(`  そのときの現金 ${d2.cash}万 / 期待 3700 ${chk(d2.cash, 3700)}`);
const n0 = calcLoan(0, { rate: 1, years: 35 });
console.log(`価格0: 毎月 ${n0.monthly} / 総額 ${n0.totalPayment} ${chk(n0.monthly, 0)}`);
const over = calcLoan(3000, { rate: 1, years: 35, downPayment: 5000 });
console.log(`頭金 > 価格: 借入 ${over.principal} 毎月 ${over.monthly} ${chk(over.principal, 0)}${chk(over.monthly, 0)}`);

console.log(bad ? `\n${bad} 件の問題` : '\n✅ すべて通過');
process.exit(bad ? 1 : 0);
