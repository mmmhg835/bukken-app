// 「何年後にいくらで売れたらどうなるか」の試算。
//
// 買うときの試算だけでは、途中で手放す選択肢を金額で比べられない。
// 元本がどれだけ減っているかと、売却価格・売却諸費用を突き合わせて手残りを出す。
// 画面には触らない純関数だけを置き、tools/verify-sale.mjs から直接検証する。
import { calcLoan, scheduleAt } from './loan.js';

/**
 * 売却の前提。購入時の諸費用（settings.loan.costRate）とは別に持つ。
 * 買うときは仲介手数料・登記・税、売るときは仲介手数料・印紙・抵当権抹消と中身が違う。
 */
export const DEFAULT_SALE = {
  years: 10,          // 何年後に売るか
  costRate: 3.3,      // 仲介手数料（売買価格の3%＋6万円）の税込み相当
  costFixed: 10,      // 印紙税・抵当権抹消・その他の定額分（万円）
  priceMode: 'flat',  // flat: 入力した価格のまま / decline: 年ごとに下がる
  declineRate: 1,     // priceMode が decline のときの年あたり下落率（％）
};

/** 何年後の想定売却価格か。下落率を入れている場合はその分を織り込む */
export function priceAtYear(basePrice, sale, years) {
  const p = Number(basePrice) || 0;
  if (sale.priceMode !== 'decline') return p;
  const rate = (Number(sale.declineRate) || 0) / 100;
  return p * (1 - rate) ** Math.max(0, years);
}

/**
 * n年後に売ったときの結果。
 *
 * @param {object} room 部屋（price・kanrihi・shuzen を見る）
 * @param {object} terms ローンの共通条件
 * @param {object} sale DEFAULT_SALE と同じ形 ＋ price（想定売却価格・万円）
 * @param {number} [years] 省略時は sale.years
 */
export function saleResult(room, terms, sale, years = null) {
  const y = Number(years ?? sale.years) || 0;
  const months = Math.round(y * 12);
  const buyPrice = Number(room?.price) || 0;
  const loan = calcLoan(buyPrice, terms);
  const at = scheduleAt(buyPrice, terms, months);

  const salePrice = priceAtYear(sale.price ?? buyPrice, sale, y);
  const saleCost = salePrice > 0
    ? salePrice * ((Number(sale.costRate) || 0) / 100) + (Number(sale.costFixed) || 0)
    : 0;
  const netProceeds = salePrice - saleCost;        // 仲介手数料などを引いた売却の手取り
  const cashBack = netProceeds - at.balance;       // 残債を返した後に手元へ残る額

  // 住んでいる間に出ていった額。ローン返済に管理費・修繕積立金を足す
  const running = ((Number(room?.kanrihi) || 0) + (Number(room?.shuzen) || 0)) * months;
  const paidTotal = at.paidTotal + running;
  // 購入時に用意した現金（頭金と、借入に含めない場合の諸費用）
  const upfront = loan.cash;
  // 実質いくら払って住んだことになるか。売って戻る分を差し引く
  const netCost = upfront + paidTotal - cashBack;

  return {
    years: y, months,
    buyPrice, salePrice, saleCost, netProceeds,
    balance: at.balance,
    paidPrincipal: at.paidPrincipal,
    paidInterest: at.paidInterest,
    paidLoan: at.paidTotal,
    paidRunning: running,
    paidTotal,
    upfront,
    cashBack,
    netCost,
    monthlyCost: months ? netCost / months : null,
    // 残債より高く売れるか。売り時の判断はまずここで決まる
    underwater: cashBack < 0,
  };
}

/** 年ごとの推移。元本の減りと、売ったときの手残りを並べて見るために使う */
export function saleSchedule(room, terms, sale, maxYears = 35) {
  const rows = [];
  for (let y = 1; y <= maxYears; y++) rows.push(saleResult(room, terms, sale, y));
  return rows;
}

/**
 * 手残りがはじめて 0 以上になる年。
 * 「何年住めば売っても損をしないか」がこの1点で決まる。
 */
export function breakEvenYear(rows) {
  const hit = rows.find((r) => r.cashBack >= 0);
  return hit ? hit.years : null;
}
