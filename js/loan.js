// 住宅ローンの試算。SUUMO 等の表示値を転記するのではなく、同じ条件で物件間を比較するために自前で計算する。

export const DEFAULT_TERMS = {
  downPayment: 0,     // 頭金（万円）
  rate: 1.275,        // 年利（%）
  years: 50,          // 返済年数
  method: 'equal',    // equal: 元利均等 / principal: 元金均等
  costRate: 7,        // 諸費用（物件価格に対する％の目安）
  costFixed: 0,       // 諸費用のうち定額で見込む分（万円）
  includeFees: true,  // 諸費用も借入に含めるか
};

export const METHODS = {
  equal: '元利均等（毎月同額）',
  principal: '元金均等（元金が一定・初回が高い）',
};

/**
 * 返済計画を計算する。
 * @param {number} price 物件価格（万円）
 * @param {object} terms DEFAULT_TERMS と同じ形
 * @returns 月々の返済額・総返済額・総利息など（すべて万円）
 */
export function calcLoan(price, terms) {
  const t = { ...DEFAULT_TERMS, ...terms };
  const p = Number(price) || 0;
  // 仲介手数料・登記・税など。物件価格に対する割合と定額の合計で見込む
  const fees = p ? (p * (Number(t.costRate) || 0)) / 100 + (Number(t.costFixed) || 0) : 0;
  const needed = p + (t.includeFees ? fees : 0);
  const principal = Math.max(0, needed - (Number(t.downPayment) || 0));
  const n = Math.max(1, Math.round(t.years * 12));
  const r = (Number(t.rate) || 0) / 100 / 12;

  if (principal <= 0) return { ...zero(principal, n, t), fees, cash: Math.min(needed, Number(t.downPayment) || 0) };

  // 頭金で払いきれなかった分が借入。諸費用を含めない設定なら現金で用意する
  const cash = (Number(t.downPayment) || 0) + (t.includeFees ? 0 : fees);

  if (t.method === 'principal') {
    // 元金均等：元金は毎月一定、利息は残高に応じて減る
    const base = principal / n;
    let balance = principal, total = 0;
    let first = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const interest = balance * r;
      const pay = base + interest;
      if (i === 0) first = pay;
      if (i === n - 1) last = pay;
      total += pay;
      balance -= base;
    }
    return {
      principal, months: n,
      monthly: first,          // 初回（最大）を代表値にする
      monthlyFirst: first, monthlyLast: last,
      totalPayment: total, totalInterest: total - principal,
      firstPrincipal: base, firstInterest: principal * r,
      fees, cash, terms: t,
    };
  }

  // 元利均等：毎月同額。金利0%なら単純な等分
  const monthly = r === 0 ? principal / n : (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1);
  const totalPayment = monthly * n;
  const firstInterest = principal * r;
  return {
    principal, months: n,
    monthly, monthlyFirst: monthly, monthlyLast: monthly,
    totalPayment, totalInterest: totalPayment - principal,
    firstPrincipal: monthly - firstInterest, firstInterest,
    fees, cash, terms: t,
  };
}

/**
 * k か月返したあとの状態。売却時の手残りを出すには、そのときの残債が要る。
 * 返済表を回さず閉じた式で出す（40年分を毎回ループすると画面が重くなるため）。
 *
 * @returns {{balance, paidTotal, paidPrincipal, paidInterest, months}} すべて万円
 */
export function scheduleAt(price, terms, months) {
  const c = calcLoan(price, terms);
  const t = { ...DEFAULT_TERMS, ...terms };
  const n = c.months;
  const k = Math.max(0, Math.min(Math.round(months), n));
  const P = c.principal;
  const r = (Number(t.rate) || 0) / 100 / 12;
  if (P <= 0 || k === 0) {
    return { balance: P, paidTotal: 0, paidPrincipal: 0, paidInterest: 0, months: k };
  }

  if (t.method === 'principal') {
    // 元金均等：元金は毎月一定。利息は残高に比例するので等差数列の和になる
    const base = P / n;
    const balance = Math.max(0, P - base * k);
    const interest = r * (k * P - base * (k * (k - 1)) / 2);
    const paidPrincipal = P - balance;
    return { balance, paidTotal: paidPrincipal + interest, paidPrincipal, paidInterest: interest, months: k };
  }

  // 元利均等：B_k = P(1+r)^k - M((1+r)^k - 1)/r
  const M = c.monthly;
  const balance = r === 0
    ? Math.max(0, P - M * k)
    : Math.max(0, P * (1 + r) ** k - M * ((1 + r) ** k - 1) / r);
  const paidTotal = M * k;
  const paidPrincipal = P - balance;
  return { balance, paidTotal, paidPrincipal, paidInterest: paidTotal - paidPrincipal, months: k };
}

function zero(principal, n, t) {
  return {
    principal, months: n, monthly: 0, monthlyFirst: 0, monthlyLast: 0,
    totalPayment: 0, totalInterest: 0, firstPrincipal: 0, firstInterest: 0, fees: 0, cash: 0, terms: t,
  };
}

/** 年収に対する返済負担率（％）。無理のない目安は25%以下とされる */
export function burdenRate(monthlyMan, annualIncomeMan) {
  if (!annualIncomeMan) return null;
  return (monthlyMan * 12) / annualIncomeMan * 100;
}
