// 家計シミュレーション。物件を選ぶと住居費が差し替わり、月次収支がどう動くかを見る。
import { derive } from './util.js';

/**
 * 初期値はスライド「1.18億円の住宅購入 家計シミュレーション」の内訳。
 * saving: true の項目は消費ではなく資産形成・目的別積立として扱い、貯蓄率に算入する。
 */
export function defaultLifeplan() {
  return {
    income: [
      { id: 'i1', name: '夫 手取り', amount: 80 },
      { id: 'i2', name: '妻 手取り', amount: 40 },
    ],
    // 賞与は計画に含めない前提。実績は上振れバッファとして記録だけしておく
    bonus: { annual: 65.9, include: false, note: '2026年1〜8月の実績。基本計画には0円として扱う' },
    groups: [
      { id: 'g_asset', name: '資産形成', kind: 'saving', items: [
        { id: 'a1', name: 'NISA＋現金貯蓄', amount: 20, saving: true },
      ] },
      { id: 'g_housing', name: '住居費', kind: 'housing', items: [
        { id: 'h1', name: '住宅ローン＋管理・修繕等', amount: 33 },
      ] },
      { id: 'g_car', name: '車関連', kind: 'expense', items: [
        { id: 'c1', name: '駐車場', amount: 2.5 },
        { id: 'c2', name: '車ローン', amount: 8.0, temporary: true, note: '5年ローン。完済後は不要' },
        { id: 'c3', name: '維持費', amount: 3.0 },
      ] },
      { id: 'g_husband', name: '夫の生活費', kind: 'expense', items: [
        { id: 'h_food', name: '食費', amount: 2.5 },
        { id: 'h_soc', name: '交際費・外食', amount: 4.5 },
        { id: 'h_cloth', name: '衣類', amount: 2.0 },
        { id: 'h_tob', name: 'タバコ', amount: 1.6 },
        { id: 'h_sub', name: 'サブスク', amount: 1.3 },
        { id: 'h_phone', name: '携帯（端末代込）', amount: 1.1 },
        { id: 'h_gym', name: 'ジム', amount: 1.1 },
        { id: 'h_hair', name: '美容院', amount: 1.0 },
        { id: 'h_loan', name: '奨学金', amount: 2.0, temporary: true },
        { id: 'h_ins', name: '積立型生命保険', amount: 2.5, saving: true },
        { id: 'h_fur', name: '家具家電積立', amount: 2.0, saving: true },
        { id: 'h_trip', name: '旅行積立', amount: 3.0, saving: true },
        { id: 'h_util', name: '光熱費', amount: 2.5 },
        { id: 'h_kids', name: '子供用品・日用品', amount: 1.0 },
        { id: 'h_work', name: '仕事用品', amount: 0.5 },
        { id: 'h_ec', name: 'オンライン注文', amount: 0.5 },
      ] },
      { id: 'g_wife', name: '妻の生活費', kind: 'expense', items: [
        { id: 'w_food', name: '食費', amount: 9.5 },
        { id: 'w_kids', name: '子供用品・日用品', amount: 4.5 },
        { id: 'w_soc', name: '交際費・外食', amount: 3.0 },
        { id: 'w_hosp', name: '病院', amount: 2.0 },
        { id: 'w_cloth', name: '衣類', amount: 1.0 },
        { id: 'w_phone', name: '携帯（端末代込）', amount: 1.5 },
        { id: 'w_ins', name: '積立型生命保険', amount: 1.5, saving: true },
        { id: 'w_trans', name: '交通費', amount: 0.5 },
      ] },
    ],
    selectedRoomId: null,   // null なら住居費の手入力値を使う
  };
}

const sum = (list, f = (x) => x.amount) =>
  list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/**
 * 家計を計算する。
 * @param {object} plan settings.lifeplan
 * @param {object|null} room 選択中の部屋
 * @param {object|null} building その建物
 * @param {object} terms ローン共通条件
 * @param {object} opts { excludeTemporary: 期限付き支出（車ローン等）を除く }
 */
export function calcPlan(plan, room, building, terms, opts = {}) {
  const { excludeTemporary = false } = opts;
  const income = sum(plan.income) + (plan.bonus?.include ? (plan.bonus.annual || 0) / 12 : 0);

  const housingFromRoom = room ? housingCost(room, building, terms) : null;

  const groups = plan.groups.map((g) => {
    const items = g.items.filter((it) => !(excludeTemporary && it.temporary));
    if (g.kind === 'housing' && housingFromRoom) {
      return { ...g, items: housingFromRoom.items, total: housingFromRoom.total, fromRoom: true };
    }
    return { ...g, items, total: sum(items) };
  });

  const expense = sum(groups, (g) => g.total);
  const saving = sum(groups.flatMap((g) => g.items.filter((it) => it.saving)));
  const balance = income - expense;

  return {
    income, expense, balance, saving,
    // 先取り分に月次の残りを足したものが、実際に積み上がる額
    totalLeft: saving + balance,
    savingRate: income ? (saving / income) * 100 : 0,
    totalLeftRate: income ? ((saving + balance) / income) * 100 : 0,
    yearlyBalance: balance * 12,
    yearlySaving: (saving + balance) * 12,
    groups,
    housingFromRoom,
  };
}

/** 選んだ部屋の住居費。ローン返済・管理費・修繕積立金に分けて返す */
export function housingCost(room, building, terms) {
  const d = derive(room, building, terms);
  const items = [
    { id: 'loan', name: '住宅ローン返済', amount: round1(d.loanMonthly) },
    { id: 'kanri', name: '管理費', amount: Number(room.kanrihi) || 0 },
    { id: 'shuzen', name: '修繕積立金', amount: Number(room.shuzen) || 0 },
  ];
  return { items, total: sum(items), derived: d };
}

const round1 = (v) => (v == null ? 0 : Math.round(v * 10) / 10);

/**
 * 月次収支がちょうど 0 になる購入価格を二分探索で求める。
 * 「いくらまでなら買えるか」を条件から逆算するため。
 */
export function affordablePrice(plan, room, building, terms) {
  const base = calcPlan(plan, null, null, terms);
  const nonHousing = base.expense - sum(plan.groups.find((g) => g.kind === 'housing').items);
  const budget = base.income - nonHousing;              // 住居費に回せる上限（万円/月）
  const running = (Number(room?.kanrihi) || 0) + (Number(room?.shuzen) || 0);
  const loanBudget = budget - running;
  if (loanBudget <= 0) return { budget, loanBudget, price: 0 };

  let lo = 0, hi = 100000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const m = derive({ price: mid, kanrihi: 0, shuzen: 0 }, building, terms).loanMonthly ?? 0;
    if (m > loanBudget) hi = mid; else lo = mid;
  }
  return { budget, loanBudget, price: lo };
}
