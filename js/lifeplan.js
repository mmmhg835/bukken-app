// 家計シミュレーション。物件を選ぶと住居費が差し替わり、月次収支がどう動くかを見る。
import { derive } from './util.js';

/**
 * 支出の区分。「収入 → 資産形成 → 住居費 → 固定費 → 変動費」の順に差し引くため、
 * 積立・固定・変動を排他の3択にしている。
 */
export const CATEGORIES = {
  saving:   { label: '積立', full: '資産形成・積立', order: 1 },
  fixed:    { label: '固定', full: '固定費', order: 3 },
  variable: { label: '変動', full: '変動費', order: 4 },
};

/**
 * 初期値はスライド「1.18億円の住宅購入 家計シミュレーション」の内訳。
 * saving: true の項目は消費ではなく資産形成・目的別積立として扱い、貯蓄率に算入する。
 */
export function defaultLifeplan() {
  return {
    income: [
      { id: 'i1', name: '夫 手取り', amount: 80, who: 'primary' },
      { id: 'i2', name: '妻 手取り', amount: 40, who: 'secondary' },
      // 使うときだけ ON にする枠。毎回追加せずに済ませる
      { id: 'i3', name: 'その他収入', amount: 0, enabled: false, who: 'shared' },
    ],
    // 賞与は計画に含めない前提。実績は上振れバッファとして記録だけしておく
    bonus: { annual: 65.9, include: false, note: '2026年1〜8月の実績。基本計画には0円として扱う' },
    groups: [
      { id: 'g_asset', name: '資産形成', kind: 'saving', items: [
        { id: 'a1', name: 'NISA＋現金貯蓄', amount: 20, category: 'saving' },
      ] },
      { id: 'g_housing', name: '住居費', kind: 'housing', items: [
        { id: 'h1', name: '住宅ローン＋管理・修繕等', amount: 33, category: 'fixed' },
      ] },
      { id: 'g_car', name: '車関連', kind: 'car', items: [
        { id: 'c1', name: '駐車場', amount: 2.5, category: 'fixed' },
        { id: 'c2', name: '車ローン', amount: 8.0, category: 'fixed', temporary: true, remainingYears: 5 },
        { id: 'c3', name: '維持費', amount: 3.0, category: 'fixed', note: '保険・ガソリン・車検など' },
      ] },
      { id: 'g_husband', name: '夫の生活費', kind: 'expense', items: [
        { id: 'h_food', name: '食費', amount: 2.5, category: 'variable' },
        { id: 'h_soc', name: '交際費・外食', amount: 4.5, category: 'variable' },
        { id: 'h_cloth', name: '衣類', amount: 2.0, category: 'variable' },
        { id: 'h_tob', name: 'タバコ', amount: 1.6, category: 'variable' },
        { id: 'h_sub', name: 'サブスク', amount: 1.3, category: 'fixed' },
        { id: 'h_phone', name: '携帯（端末代込）', amount: 1.1, category: 'fixed' },
        { id: 'h_gym', name: 'ジム', amount: 1.1, category: 'fixed' },
        { id: 'h_hair', name: '美容院', amount: 1.0, category: 'variable' },
        { id: 'h_loan', name: '奨学金', amount: 2.0, category: 'fixed', temporary: true, remainingYears: 10 },
        { id: 'h_ins', name: '積立型生命保険', amount: 2.5, category: 'saving' },
        { id: 'h_fur', name: '家具家電積立', amount: 2.0, category: 'saving' },
        { id: 'h_trip', name: '旅行積立', amount: 3.0, category: 'saving' },
        { id: 'h_util', name: '光熱費', amount: 2.5, category: 'variable' },
        { id: 'h_kids', name: '子供用品・日用品', amount: 1.0, category: 'variable' },
        { id: 'h_work', name: '仕事用品', amount: 0.5, category: 'variable' },
        { id: 'h_ec', name: 'オンライン注文', amount: 0.5, category: 'variable' },
      ] },
      { id: 'g_wife', name: '妻の生活費', kind: 'expense', items: [
        { id: 'w_food', name: '食費', amount: 9.5, category: 'variable' },
        { id: 'w_kids', name: '子供用品・日用品', amount: 4.5, category: 'variable' },
        { id: 'w_soc', name: '交際費・外食', amount: 3.0, category: 'variable' },
        { id: 'w_hosp', name: '病院', amount: 2.0, category: 'variable' },
        { id: 'w_cloth', name: '衣類', amount: 1.0, category: 'variable' },
        { id: 'w_phone', name: '携帯（端末代込）', amount: 1.5, category: 'fixed' },
        { id: 'w_ins', name: '積立型生命保険', amount: 1.5, category: 'saving' },
        { id: 'w_trans', name: '交通費', amount: 0.5, category: 'variable' },
      ] },
    ],
    // 返済負担率と年収倍率は「額面」で見るのが慣行なので、額面だけここに持つ。
    // 手取りは income から集計する（同じ数字を2か所に置くと必ず食い違うため）
    grossIncome: {
      primary: { name: '夫', annual: 1230 },
      secondary: { name: '妻', annual: 615 },
    },
    selectedRoomId: null,   // null なら住居費の手入力値を使う
  };
}

const sum = (list, f = (x) => x.amount) =>
  list.reduce((s, x) => s + (Number(f(x)) || 0), 0);

/** 項目が計算に入るか。enabled 未設定は「入る」扱い（既存データをそのまま活かすため） */
export const isOn = (item) => item.enabled !== false;

/** 区分。未設定は固定費として扱う */
export const categoryOf = (item) => (CATEGORIES[item.category] ? item.category : 'fixed');

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
  const activeIncome = plan.income.filter(isOn);
  const income = sum(activeIncome) + (plan.bonus?.include ? (plan.bonus.annual || 0) / 12 : 0);

  const housingFromRoom = room ? housingCost(room, building, terms) : null;

  const groups = plan.groups.map((g) => {
    if (g.kind === 'housing' && housingFromRoom) {
      return { ...g, items: housingFromRoom.items, total: housingFromRoom.total, fromRoom: true };
    }
    // OFF にした項目と、完済後シナリオで除く期限付き項目を落とす
    const items = g.items.filter((it) => isOn(it) && !(excludeTemporary && it.temporary));
    return { ...g, items, total: sum(items) };
  });

  // 住居費と車関連はそれぞれ独立した段として積むので、区分の集計からは外す
  const isBucket = (g) => g.kind === 'housing' || g.kind === 'car';
  const housingTotal = sum(groups.filter((g) => g.kind === 'housing'), (g) => g.total);
  const carTotal = sum(groups.filter((g) => g.kind === 'car'), (g) => g.total);

  const rest = groups.filter((g) => !isBucket(g))
    .flatMap((g) => g.items.map((it) => ({ ...it, groupName: g.name })));
  const byCategory = {
    saving: rest.filter((it) => categoryOf(it) === 'saving'),
    fixed: rest.filter((it) => categoryOf(it) === 'fixed'),
    variable: rest.filter((it) => categoryOf(it) === 'variable'),
  };
  const saving = sum(byCategory.saving);
  const fixed = sum(byCategory.fixed);
  const variable = sum(byCategory.variable);

  const expense = sum(groups, (g) => g.total);
  const balance = income - expense;

  return {
    income, expense, balance,
    saving, fixed, variable, housingTotal, carTotal,
    byCategory,
    carItems: groups.filter((g) => g.kind === 'car').flatMap((g) => g.items),
    // 変動費に回せる上限。ここが「生活費としていくら使えるか」になる
    variableBudget: income - saving - housingTotal - carTotal - fixed,
    totalLeft: saving + balance,
    savingRate: income ? (saving / income) * 100 : 0,
    yearlyBalance: balance * 12,
    yearlySaving: (saving + balance) * 12,
    groups,
    housingFromRoom,
    // 返済負担率に使うローン返済額（管理費・修繕は含めないのが慣行）
    loanMonthly: housingFromRoom ? housingFromRoom.items[0].amount : null,
  };
}

/**
 * 収入から順に差し引いていく段階表。
 * 「この物件なら生活費にいくら回せるか」を一目で追えるようにする。
 */
export function waterfall(res, roomLabel = null) {
  const steps = [
    {
      key: 'saving', label: '先取りの資産形成', amount: res.saving,
      items: res.byCategory.saving,
      note: '積立として先に確保する分',
    },
    {
      key: 'housing', label: '住居費', amount: res.housingTotal,
      items: res.housingFromRoom ? res.housingFromRoom.items : [],
      note: roomLabel || '手入力の想定額',
    },
    {
      key: 'car', label: '車関連', amount: res.carTotal,
      items: res.carItems,
      note: '駐車場・ローン・維持費',
    },
    {
      key: 'fixed', label: 'その他固定費', amount: res.fixed,
      items: res.byCategory.fixed,
      note: '毎月ほぼ決まって出る支出',
    },
  ];
  let left = res.income;
  for (const st of steps) { st.before = left; left -= st.amount; st.after = left; }
  return {
    steps,
    variableBudget: left,                       // ここが生活費に回せる額
    variableActual: res.variable,
    variableItems: res.byCategory.variable,
    rest: left - res.variable,
  };
}

/** 選んだ部屋の住居費。ローン返済・管理費・修繕積立金に分けて返す */
export function housingCost(room, building, terms) {
  const d = derive(room, building, terms);
  const items = [
    { id: 'loan', name: '住宅ローン返済', amount: round1(d.loanMonthly), category: 'fixed' },
    { id: 'kanri', name: '管理費', amount: Number(room.kanrihi) || 0, category: 'fixed' },
    { id: 'shuzen', name: '修繕積立金', amount: Number(room.shuzen) || 0, category: 'fixed' },
  ];
  // 諸費用は毎月の支出ではないので items には入れず、別に返す
  return { items, total: sum(items), derived: d, loan: d.loan };
}

const round1 = (v) => (v == null ? 0 : Math.round(v * 10) / 10);

/**
 * 月次収支がちょうど 0 になる購入価格を二分探索で求める。
 * 「いくらまでなら買えるか」を条件から逆算するため。
 */
export function affordablePrice(plan, room, building, terms) {
  const base = calcPlan(plan, null, null, terms);
  const nonHousing = base.expense - base.housingTotal;
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


/**
 * 額面年収に対する返済負担率と年収倍率。
 * 金融機関は手取りではなく額面で見るため、分母を分けている。
 */
/** 収入の帰属。返済負担率を「本人だけ／配偶者も含めて」で見るために要る */
export const WHO = { primary: '本人', secondary: '配偶者', shared: '共通' };

/**
 * 手取り年収（万円/年）を、ライフプランの収入から人ごとに集計する。
 * 手取りを別に入力させると、ライフプラン側と必ず食い違う。
 * OFF にした項目と、計画に含めない賞与は入らない。
 */
export function netIncomeByWho(plan) {
  const out = { primary: 0, secondary: 0, shared: 0 };
  for (const it of plan.income || []) {
    if (!isOn(it)) continue;
    const who = WHO[it.who] ? it.who : 'shared';
    out[who] += (Number(it.amount) || 0) * 12;
  }
  if (plan.bonus?.include) out.shared += Number(plan.bonus.annual) || 0;
  return out;
}

export function incomePatterns(plan, room, res) {
  const g = plan.grossIncome || {};
  const p = g.primary || { name: '本人', annual: 0 };
  const sec = g.secondary || { name: '配偶者', annual: 0 };
  const n = (v) => Number(v) || 0;
  const net = netIncomeByWho(plan);

  const patterns = [
    { label: p.name || '本人', share: 0 },
    { label: `${p.name} ＋ ${sec.name}の半分`, share: 0.5 },
    { label: `${p.name} ＋ ${sec.name}`, share: 1 },
  ];

  const yearlyLoan = res.loanMonthly != null ? res.loanMonthly * 12 : null;
  // 管理費・修繕まで含めた住居費ベース。実際に毎月出ていく額での負担を見る
  const yearlyHousing = res.housingFromRoom ? res.housingTotal * 12 : null;
  const price = room?.price ?? null;
  const rate = (num, annual) => (annual && num != null ? (num / annual) * 100 : null);
  const times = (annual) => (annual && price != null ? price / annual : null);

  return patterns.map((x) => {
    const gross = n(p.annual) + n(sec.annual) * x.share;
    // 共通の収入（その他・賞与）は誰か一方のものではないので、どの見方にも入れる
    const netAnnual = net.primary + net.secondary * x.share + net.shared;
    return {
      label: x.label,
      gross: { annual: gross, loan: rate(yearlyLoan, gross), housing: rate(yearlyHousing, gross), multiple: times(gross) },
      net: {
        annual: netAnnual,
        loan: rate(yearlyLoan, netAnnual), housing: rate(yearlyHousing, netAnnual), multiple: times(netAnnual),
      },
    };
  });
}


/**
 * 将来の収支を年単位で伸ばす。
 * 期限付きの支出は残り年数で消え、住宅ローンは返済年数で終わる。
 * 「いつ楽になるのか」を金額で見えるようにするのが目的。
 * @returns {Array<{year, income, expense, balance, saving, assets}>} すべて年額（万円）
 */
export function project(plan, room, building, terms, years = 40) {
  const applied = { ...terms, ...(room?.loan || {}) };
  const housing = room ? housingCost(room, building, terms) : null;
  const loanMonthly = housing ? housing.items[0].amount : 0;
  const runningMonthly = housing ? housing.items[1].amount + housing.items[2].amount : 0;
  const manualHousing = sum((plan.groups.find((g) => g.kind === 'housing')?.items || []).filter(isOn));

  const items = plan.groups
    .filter((g) => g.kind !== 'housing')
    .flatMap((g) => g.items.filter(isOn));

  const incomeMonthly = sum(plan.income.filter(isOn))
    + (plan.bonus?.include ? (plan.bonus.annual || 0) / 12 : 0);

  const rows = [];
  let assets = 0;
  for (let year = 1; year <= years; year++) {
    const alive = items.filter((it) =>
      !(it.temporary && Number(it.remainingYears) > 0 && year > Number(it.remainingYears)));
    const housingMonthly = housing
      ? (year <= applied.years ? loanMonthly : 0) + runningMonthly
      : manualHousing;

    const expenseMonthly = sum(alive) + housingMonthly;
    const savingMonthly = sum(alive.filter((it) => categoryOf(it) === 'saving'));
    const balanceMonthly = incomeMonthly - expenseMonthly;
    // 先取りの積立と月次の残りが、そのまま資産として積み上がる
    assets += (savingMonthly + balanceMonthly) * 12;

    rows.push({
      year,
      income: incomeMonthly * 12,
      expense: expenseMonthly * 12,
      balance: balanceMonthly * 12,
      saving: savingMonthly * 12,
      housing: housingMonthly * 12,
      assets,
    });
  }
  return rows;
}

/** 収支が変わる節目（支出が減る年）を拾う。グラフの注記に使う */
export function milestones(plan, room, terms) {
  const applied = { ...terms, ...(room?.loan || {}) };
  const marks = [];
  for (const g of plan.groups) {
    for (const it of g.items) {
      if (isOn(it) && it.temporary && Number(it.remainingYears) > 0) {
        marks.push({ year: Number(it.remainingYears), label: `${it.name} 完済` });
      }
    }
  }
  if (room) marks.push({ year: applied.years, label: '住宅ローン完済' });
  return marks.sort((a, b) => a.year - b.year);
}
