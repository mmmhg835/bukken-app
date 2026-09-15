// 売却試算の検証。ローン残高は閉じた式で出しているので、
// 1か月ずつ回した返済表と突き合わせる。
// 使い方: node tools/verify-sale.mjs
const { calcLoan, scheduleAt } = await import(new URL('../js/loan.js', import.meta.url).href);
const { saleResult, saleSchedule, breakEvenYear, priceAtYear, DEFAULT_SALE } =
  await import(new URL('../js/sale.js', import.meta.url).href);

let bad = 0;
const chk = (name, a, b, tol = 0.01) => {
  const ok = Math.abs(a - b) < tol;
  if (!ok) { bad++; console.log(`❌ ${name}: 実装 ${a} / 期待 ${b}`); }
  else console.log(`✅ ${name}: ${typeof a === 'number' ? a.toFixed(2) : a}`);
};

/** 返済表を1か月ずつ回して、k か月後の残高と支払額を出す */
function simulate(principal, ratePct, months, monthly, method, n) {
  const r = ratePct / 100 / 12;
  let bal = principal, paid = 0, interest = 0;
  const base = principal / n;
  for (let i = 0; i < months; i++) {
    const int = bal * r;
    const pay = method === 'principal' ? base + int : monthly;
    interest += int;
    paid += pay;
    bal = bal + int - pay;
  }
  return { balance: Math.max(0, bal), paid, interest };
}

console.log('■ ローン残高（閉じた式 vs 返済表）\n');
for (const [price, rate, years, method] of [
  [16500, 1.275, 50, 'equal'], [16500, 0.7, 35, 'equal'],
  [10980, 1.275, 50, 'principal'], [12000, 0, 30, 'equal'],
]) {
  const terms = { rate, years, method };
  const c = calcLoan(price, terms);
  for (const y of [1, 5, 10, 25]) {
    const k = y * 12;
    if (k > c.months) continue;
    const s = scheduleAt(price, terms, k);
    const sim = simulate(c.principal, rate, k, c.monthly, method, c.months);
    chk(`${price}万 ${rate}% ${years}年 ${method} ${y}年後の残高`, s.balance, sim.balance, 0.02);
    chk(`  同 支払総額`, s.paidTotal, sim.paid, 0.02);
    chk(`  同 支払利息`, s.paidInterest, sim.interest, 0.02);
  }
}

console.log('\n■ 境界\n');
const terms = { rate: 1.275, years: 50, method: 'equal' };
const c0 = calcLoan(16500, terms);
chk('0か月後の残高 = 借入額', scheduleAt(16500, terms, 0).balance, c0.principal);
chk('完済後の残高 = 0', scheduleAt(16500, terms, 600).balance, 0, 0.02);
chk('返済年数を超えても 0 のまま', scheduleAt(16500, terms, 900).balance, 0, 0.02);
chk('元本の減り＋残高 = 借入額',
  scheduleAt(16500, terms, 120).paidPrincipal + scheduleAt(16500, terms, 120).balance, c0.principal);

console.log('\n■ 売却\n');
const room = { price: 16500, kanrihi: 2.3, shuzen: 2.1 };
const sale = { ...DEFAULT_SALE, years: 10, price: 17000 };
const r = saleResult(room, terms, sale);

chk('売却諸費用 = 価格×3.3% + 10', r.saleCost, 17000 * 0.033 + 10);
chk('売却の手取り = 価格 - 諸費用', r.netProceeds, 17000 - r.saleCost);
chk('手残り = 手取り - 残債', r.cashBack, r.netProceeds - r.balance);
chk('管理＋修繕の累計 = (2.3+2.1)×120', r.paidRunning, 4.4 * 120);
chk('実質負担 = 購入時現金 + 支払総額 - 手残り', r.netCost, r.upfront + r.paidTotal - r.cashBack);
chk('月あたりの実質負担', r.monthlyCost, r.netCost / 120);

// 下落率を入れると、年を追うごとに想定売却価格が下がる
const dec = { ...DEFAULT_SALE, priceMode: 'decline', declineRate: 1, price: 17000 };
chk('下落率1%・0年後', priceAtYear(17000, dec, 0), 17000);
chk('下落率1%・10年後', priceAtYear(17000, dec, 10), 17000 * 0.99 ** 10);

// 残債より安くしか売れないなら手残りはマイナス
const low = saleResult(room, terms, { ...DEFAULT_SALE, years: 3, price: 12000 });
if (!low.underwater) { bad++; console.log('❌ 残債割れを検出できていない'); }
else console.log(`✅ 残債割れの判定: 3年後に12000万で売ると手残り ${low.cashBack.toFixed(0)}万円`);

// 年を追うごとに残債は減るので、同じ価格なら手残りは必ず増える
const rows = saleSchedule(room, terms, { ...DEFAULT_SALE, price: 17000 }, 30);
for (let i = 1; i < rows.length; i++) {
  if (!(rows[i].cashBack > rows[i - 1].cashBack)) {
    bad++; console.log(`❌ ${rows[i].years}年後の手残りが前年より増えていない`);
    break;
  }
}
console.log(`✅ 手残りは年々増える（1年後 ${rows[0].cashBack.toFixed(0)} → 30年後 ${rows[29].cashBack.toFixed(0)}万円）`);

const be = breakEvenYear(rows);
console.log(`✅ 手残りが0以上になるのは ${be ?? '—'}年後`);
if (be != null && rows[be - 2] && rows[be - 2].cashBack >= 0) {
  bad++; console.log('❌ もっと早い年でも0以上になっている');
}

console.log(bad ? `\n${bad} 件の問題` : '\n✅ すべて通過');
process.exit(bad ? 1 : 0);
