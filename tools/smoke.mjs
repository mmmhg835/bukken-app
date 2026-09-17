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
  // 一括出力は描き終わってから印刷を呼ぶ。テストでは呼ばれても何もしない
  print() {},
};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.indexedDB = { open: () => ({}) };
globalThis.CSS = { escape: (s) => s };
Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: null }, configurable: true });
Object.defineProperty(globalThis, 'location', {
  value: { hash: '', pathname: '/', origin: 'http://x', protocol: 'http:' }, configurable: true,
});

const FILES = [
  'util', 'loan', 'spec', 'price', 'chart', 'idb', 'image', 'github', 'migrate', 'store',
  'ui', 'gallery', 'map', 'pairing', 'theme', 'analysis', 'lifeplan', 'sales', 'sale', 'market', 'units', 'unit-filter',
  'lifeplan-view', 'sale-view', 'viewing-view', 'market-view', 'views', 'main',
];

let bad = 0;
const mods = {};
for (const f of FILES) {
  try { mods[f] = await import(new URL(`../js/${f}.js`, import.meta.url).href); }
  catch (e) { bad++; console.log(`❌ ${f}.js : ${e.message}`); }
}

// 画面描画の入口が実際に呼べるか（未定義参照はここで露見する）
const checks = [
  ['migrate', () => {
    const { migrate, CURRENT_SCHEMA } = mods.migrate;
    const d = migrate({ schemaVersion: 1, properties: [] });
    if (d.schemaVersion !== CURRENT_SCHEMA) throw new Error('スキーマ番号が一致しない');
    for (const key of ['loan', 'places', 'lifeplan']) {
      if (!d.settings[key]) throw new Error(`settings.${key} が初期化されていない`);
    }
  }],
  ['lifeplan', () => {
    const { defaultLifeplan, calcPlan, waterfall } = mods.lifeplan;
    const res = calcPlan(defaultLifeplan(), null, null, mods.loan.DEFAULT_TERMS);
    const w = waterfall(res);
    const sum = res.saving + res.housingTotal + res.carTotal + res.fixed + res.variable;
    if (Math.abs(sum - res.expense) > 1e-9) {
      throw new Error(`区分の合計 ${sum} が支出合計 ${res.expense} と一致しない`);
    }
    if (w.steps.length !== 5) throw new Error('段階表の段数が想定と違う');
    if (Math.abs(w.rest - res.balance) > 1e-9) throw new Error('段階表の最後の残りが毎月の残りと合わない');
    // 段階表の最後の残りが、変動費に回せる額と一致すること
    if (Math.abs(w.variableBudget - res.variableBudget) > 1e-9) {
      throw new Error('段階表と変動費予算が食い違う');
    }
  }],
  ['手取りの集計', () => {
    const { defaultLifeplan, netIncomeByWho, calcPlan, incomePatterns } = mods.lifeplan;
    const plan = defaultLifeplan();
    const base = netIncomeByWho(plan);
    if (base.primary !== 960) throw new Error(`本人の手取りが 960 でない (${base.primary})`);
    if (base.secondary !== 480) throw new Error(`配偶者の手取りが 480 でない (${base.secondary})`);
    if (base.shared !== 0) throw new Error('計画に含めない賞与が入っている');

    // OFF にした収入は入らない
    plan.income[0].enabled = false;
    if (netIncomeByWho(plan).primary !== 0) throw new Error('OFF にした収入が集計に残っている');
    plan.income[0].enabled = true;

    // 賞与を ON にすると共通に乗る
    plan.bonus.include = true;
    if (netIncomeByWho(plan).shared !== plan.bonus.annual) throw new Error('賞与が反映されていない');
    plan.bonus.include = false;

    // 共通の収入は、どの見方（本人だけ／配偶者も含めて）にも入る
    plan.income[2].enabled = true;
    plan.income[2].amount = 3;
    const res = calcPlan(plan, { price: 13200, area: 80, kanrihi: 2, shuzen: 2 }, null, mods.loan.DEFAULT_TERMS);
    const rows = incomePatterns(plan, { price: 13200 }, res);
    if (rows[0].net.annual !== 960 + 36) throw new Error('本人のみの手取りに共通が入っていない');
    if (rows[2].net.annual !== 960 + 480 + 36) throw new Error('配偶者込みの手取りが合わない');
    plan.income[2].enabled = false;
  }],
  ['incomePatterns', () => {
    const { defaultLifeplan, calcPlan, incomePatterns } = mods.lifeplan;
    const plan = defaultLifeplan();
    const room = { price: 13200, area: 80, kanrihi: 2, shuzen: 2 };
    const res = calcPlan(plan, room, null, mods.loan.DEFAULT_TERMS);
    const rows = incomePatterns(plan, room, res);
    if (rows.length !== 3) throw new Error('年収パターンが3つでない');
    for (const base of ['gross', 'net']) {
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1][base], cur = rows[i][base];
        if (!(cur.annual > prev.annual)) throw new Error(`${base}: 年収の並びが不正`);
        if (!(cur.loan < prev.loan)) throw new Error(`${base}: 返済負担率の並びが不正`);
        if (!(cur.multiple < prev.multiple)) throw new Error(`${base}: 年収倍率の並びが不正`);
      }
      for (const r of rows) {
        if (!(r[base].housing > r[base].loan)) throw new Error(`${base}: 住居費込みがローンのみを下回っている`);
      }
    }
    // 手取りは額面より小さいので、負担率は必ず手取りベースの方が高くなる
    for (const r of rows) {
      if (!(r.net.loan > r.gross.loan)) throw new Error('手取りベースの負担率が額面ベースを上回っていない');
    }
  }],
  ['loan', () => {
    const { calcLoan } = mods.loan;
    const r = calcLoan(10000, { rate: 1, years: 35 });
    if (!(r.monthly > 0 && r.totalPayment > r.principal)) throw new Error('返済額が不正');
  }],
  ['spec', () => {
    const { SPEC_GROUPS } = mods.spec;
    for (const [key, g] of Object.entries(SPEC_GROUPS)) {
      if (!g.options?.length) throw new Error(`${key} に選択肢がない`);
      if (new Set(g.options).size !== g.options.length) throw new Error(`${key} に重複がある`);
    }
  }],
  ['numberInput', () => {
    const { sanitizeNumeric, numOrNull } = mods.util;
    const cases = [
      ['1.5', '1.5'], ['1.', '1.'], ['0.', '0.'], ['.5', '.5'],
      ['１．５', '1.5'],                 // 全角で打たれても通す
      ['1.2.3', '1.23'],                // 2つ目以降の小数点は落とす
      ['12a3', '123'], ['-3', '-3'],
      ['3-4', '34'],                    // 途中で打たれたマイナスは押し間違いとみなして捨てる
      ['', ''],
    ];
    for (const [input, want] of cases) {
      const got = sanitizeNumeric(input);
      if (got !== want) throw new Error(`sanitize ${JSON.stringify(input)} → ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`);
    }
    if (sanitizeNumeric('2.5', { integer: true }) !== '25') throw new Error('整数欄で小数点が残っている');
    // 入力途中でも壊れないこと（ここで null を返すと打った小数点が消える）
    if (numOrNull('1.') !== 1) throw new Error('「1.」を読めていない');
    if (numOrNull('') !== null || numOrNull('-') !== null || numOrNull('.') !== null) {
      throw new Error('未入力を null として扱えていない');
    }
    if (numOrNull('0') !== 0) throw new Error('0 を null にしてしまっている');
    if (numOrNull('1.5') !== 1.5) throw new Error('小数を読めていない');
  }],
  ['指値', () => {
    const { defaultLifeplan, calcPlan, housingCost } = mods.lifeplan;
    const plan = defaultLifeplan();
    const terms = mods.loan.DEFAULT_TERMS;
    const room = { price: 16500, area: 100, kanrihi: 2, shuzen: 2 };
    const offer = { ...room, price: 15000 };
    const a = calcPlan(plan, room, null, terms);
    const b = calcPlan(plan, offer, null, terms);
    if (!(b.housingTotal < a.housingTotal)) throw new Error('指値で住居費が下がっていない');
    if (!(b.balance > a.balance)) throw new Error('指値で毎月の残りが増えていない');
    // 管理費・修繕は価格に連動しないので、差はローン返済だけのはず
    const dLoan = housingCost(room, null, terms).items[0].amount - housingCost(offer, null, terms).items[0].amount;
    if (Math.abs((a.housingTotal - b.housingTotal) - dLoan) > 0.15) {
      throw new Error('住居費の差がローン返済の差と合わない');
    }
    // 元の部屋を書き換えていないこと（一覧や分析の現在価格が変わってしまう）
    if (room.price !== 16500) throw new Error('元の部屋の価格を書き換えている');
  }],
  ['売却', () => {
    const { saleResult, saleSchedule, breakEvenYear, DEFAULT_SALE } = mods.sale;
    const terms = mods.loan.DEFAULT_TERMS;
    const room = { price: 16500, kanrihi: 2.3, shuzen: 2.1 };
    const sale = { ...DEFAULT_SALE, years: 10, price: 17000 };
    const r = saleResult(room, terms, sale);
    if (Math.abs(r.cashBack - (r.netProceeds - r.balance)) > 1e-9) throw new Error('手残りの式が合わない');
    if (Math.abs(r.netCost - (r.upfront + r.paidTotal - r.cashBack)) > 1e-9) throw new Error('実質負担の式が合わない');
    // 同じ価格なら、年が経つほど残債が減って手残りは増える
    const rows = saleSchedule(room, terms, sale, 30);
    for (let i = 1; i < rows.length; i++) {
      if (!(rows[i].cashBack > rows[i - 1].cashBack)) throw new Error('手残りが年々増えていない');
    }
    if (breakEvenYear(rows) == null) throw new Error('手残りが0以上になる年を出せていない');
  }],
  ['market', () => {
    const m = mods.market;
    const row = { listedYM: '2026-05', closedYM: '2026-08', area: 75.67, price: 9698,
      priceHistory: [{ ym: '2026-08', price: 9998 }, { ym: '2026-09', price: 9698 }] };
    if (Math.abs(m.tsuboOf(row) - 9698 / (75.67 / 3.305785)) > 1e-6) throw new Error('坪単価が合わない');
    if (m.monthsOf(row) !== 3) throw new Error('販売期間の月数が合わない');
    if (!(m.cutOf(row) < 0)) throw new Error('値下げを負の値にできていない');
    if (m.ymLabel('2026-08') !== '2026/08') throw new Error('年月の表記が不正');
    // 「販売中」と「終了年月の記録が無い」を取り違えない
    if (!m.isOpen({ listedYM: '2026-05', open: true })) throw new Error('販売中を判定できていない');
    if (m.isOpen({ listedYM: '2009-01', open: false })) throw new Error('記録なしを販売中に数えている');
    if (m.monthsOf({ listedYM: '2009-01', open: false }) !== null) throw new Error('記録なしの販売期間を出している');
    // open を持たない古いデータは終了年月の有無で見る
    if (!m.isOpen({ listedYM: '2026-05' })) throw new Error('古い形の販売中を判定できていない');
    // 価格変更履歴があれば、その本数ぶん点を打つ
    if (m.pricePoints([row]).length !== 2) throw new Error('価格変更のぶん点が出ていない');
    const s = m.summary([row]);
    if (s.count !== 1 || s.open !== 0) throw new Error('まとめの件数が合わない');
    // 賃貸は円のまま。マンレビの表示（坪13,768円）と合うこと
    const rent = { ym: '2026-05', area: 67.23, rent: 280000 };
    if (Math.round(m.rentTsuboOf(rent)) !== 13768) throw new Error('賃料の坪単価が掲載と合わない');
    if (Math.round(m.rentSqmOf(rent)) !== 4165) throw new Error('賃料の㎡単価が掲載と合わない');
    // 新築は売買と同じ万円
    if (Math.round(m.newTsuboOf({ price: 3850, area: 75.95 })) !== 168) throw new Error('新築の坪単価が合わない');
    // 表面利回り＝年間賃料÷売買価格。坪単価どうしで割る
    const y = m.grossYield(590, m.rentTsuboOf(rent));
    if (Math.abs(y - 2.80) > 0.01) throw new Error('表面利回りが合わない');
    if (Math.abs(m.vsNew(590, 168) - 3.51) > 0.02) throw new Error('新築比が合わない');
  }],
  ['相場の軸の定義', () => {
    const m = mods.market;
    for (const [name, set] of [['MARKET_METRICS', m.MARKET_METRICS],
      ['MARKET_ATTRS', m.MARKET_ATTRS], ['MARKET_GROUPS', m.MARKET_GROUPS]]) {
      for (const [k, def] of Object.entries(set)) {
        if (typeof def.get !== 'function' || !def.label) throw new Error(`${name}.${k} の定義が不正`);
      }
    }
  }],
  ['住所・駅徒歩・築年の読み取り', () => {
    const a = mods.analysis;
    const town = a.areaOf({ address: '神奈川県川崎市中原区小杉町3丁目1-1' });
    if (town.pref !== '神奈川県' || !town.town.includes('小杉町')) throw new Error('住所を分けられていない');
    if (a.areaOf({ address: '京都府京都市中京区' }).pref !== '京都府') throw new Error('京都府を切り違えている');
    if (a.walkMinutesOf({ walk: '辰巳7分・東雲12分' }) !== 7) throw new Error('最短の徒歩分が取れない');
    if (Math.abs(a.builtYearOf({ builtYM: '2007/02' }) - 2007.083) > 0.01) throw new Error('築年月が小数年になっていない');
  }],
];

// 非同期の検査もあるので await する。await しないと落ちても素通りする
for (const [name, fn] of checks) {
  try { await fn(); console.log(`✅ ${name}`); }
  catch (e) { bad++; console.log(`❌ ${name} : ${e.message}`); }
}

/* ===== 画面を実際に描いてみる =====
   モジュールを読み込むだけでは、関数の中で未定義を参照していても気づけない。
   ブロック単位の書き換えで隣の関数を消す事故が4回起きているため、
   すべての画面の入口を呼び出して確認する。 */
const { store } = mods.store;
store.data = mods.migrate.migrate({
  schemaVersion: 1,
  properties: [
    { id: 'p1', name: 'テストタワー', price: 12000, area: 80, layout: '3LDK',
      floor: 20, totalFloors: 40, builtYM: '2010/04', stations: 'A駅 / B駅',
      walk: 'A駅5分・B駅9分', balcony: 12, kanrihi: 2, shuzen: 1.8,
      monthlyTotal: 30, reform: '水回り・全室', viewNote: '', roomNote: '',
      imageRange: '', memo: '', images: [] },
  ],
});
store.data.buildings[0].address = '東京都江東区東雲1-9-10';
store.data.buildings[0].lat = 35.6; store.data.buildings[0].lng = 139.8;
// マンレビの写真はURLだけ持つ。建物詳細で描く経路を通す
store.data.buildings[0].photos = ['https://www.mansion-review.jp/image/mansion/1/2-600.jpg'];
// 中身が空の部屋も1つ混ぜる。アプリで「部屋を追加」した直後がこの状態で、
// 価格も面積も無いまま全画面が描かれる。坪単価などが null になる経路を通す。
store.addRoom(store.data.buildings[0].id);

const room = store.data.rooms[0];
room.listedAt = '2026-01-10';
room.priceHistory = [
  { date: '2026-01-10', price: 12800 },
  { date: '2026-05-01', price: 12000 },
];

// 一覧・比較・ライフプランは販売中の物件（onsale.json）が主役。
// 自分が登録した部屋と、まだ登録していない売り出しの両方を通す。
store.setOnsale({
  buildings: {
    b9: { name: '相場タワー', address: '東京都江東区東雲2-2-2', stations: '東雲 / 辰巳',
      walk: '東雲5分・辰巳9分', builtYM: '2016/03', totalUnits: 200, url: 'https://www.mansion-review.jp/mansion/999999.html', photo: null,
      brand: 'シティタワー', developer: '住友不動産', builder: '鹿島建設', designer: '鹿島建設' },
  },
  rows: [
    // 自分の部屋と同じ建物・階・面積。指値などが引き継がれる側
    { id: 'os1', buildingId: store.data.buildings[0].id, listedYM: '2026-08', open: true,
      floor: 20, layout: '3LDK', direction: '南', feature: '角部屋・リフォーム',
      area: 80, balcony: 10, price: 12000, priceHistory: [{ ym: '2026-08', price: 12000 }],
      kanrihi: 2, shuzen: 1.8 },
    // まだ登録していない売り出し。別の建物
    { id: 'os2', buildingId: 'b9', listedYM: '2026-09', open: true,
      url: 'https://www.mansion-review.jp/chuko/1234567890123.html',
      floor: 15, layout: '2LDK', direction: '東', feature: '', area: 70, balcony: 9,
      price: 9800, priceHistory: [], kanrihi: 1.6, shuzen: 1.3 },
    // 階も面積も無い行。写し損ねでこの形になりうる
    { id: 'os3', buildingId: 'b9', listedYM: '2026-07', open: true, priceHistory: [] },
  ],
});

// ライフプランは物件を選んでいないと住居費・段階表・指値の比較まで届かない。
// 選ばないまま検査していたため、その配下が未定義参照でも気づけなかった。
store.data.settings.lifeplan.selectedRoomId = room.id;

const lifeplanTabs = ['plan', 'burden', 'graph', 'sale'];
// 相場タブは4つのサブタブすべてを通す
const marketTabs = (prefix) => ['overview', 'sale', 'trend', 'dist', 'group', 'rent', 'new'].map((tab) =>
  [`${prefix}/${tab}`, () => mods['market-view'].renderMarket(stubEl(), () => {}, tab)]);
const lp = (tab) => () => mods['lifeplan-view'].renderLifeplan(stubEl(), () => {}, tab);

const screens = [
  ['一覧', () => mods.views.renderList(stubEl())],
  ['比較', () => mods.views.renderCompare(stubEl())],
  ['建物詳細', () => mods.views.renderBuilding(stubEl(), store.data.buildings[0].id)],
  ['部屋詳細', () => mods.views.renderRoom(stubEl(), room.id)],
  ['設定', () => mods.views.renderSettings(stubEl())],
  ['地図', () => mods.views.renderMap(stubEl())],
  ['ライフプラン', lp('plan')],
  ['返済負担比率', lp('burden')],
  ['金利と価格', lp('matrix')],
  ['グラフ', lp('graph')],
  ['売却', lp('sale')],
  // 指値を入れると元値との2組を描く経路に入る。ここも必ず通す
  ['ライフプラン（指値あり）', () => { room.offerPrice = Math.round(room.price * 0.93); lp('plan')(); }],
  ['返済負担比率（指値あり）', lp('burden')],
  ['金利と価格（指値あり）', lp('matrix')],
  ['試算金利を上げた状態', () => {
    const v = mods['lifeplan-view'];
    v.lifeplanUI.rateBump = 0.5;
    for (const tab of lifeplanTabs) lp(tab)();
    v.lifeplanUI.rateBump = 0;
  }],
  ['グラフ（指値あり）', lp('graph')],
  ['売却（指値あり）', () => { lp('sale')(); room.offerPrice = null; }],
  ['内見（チェックと記録）', () => mods['viewing-view'].renderViewing(stubEl(), () => {})],
  ['指値', lp('offer')],
  ['指値（部屋を選んだ状態）', () => {
    for (const x of store.data.rooms.slice(0, 2)) mods.views.togglePick(x.r?.id ?? x.id, true);
    lp('offer')();
  }],
  ['比較（指値・相場つき）', () => mods.views.renderCompare(stubEl())],
  // 相場タブ。3種類とも0件の状態と、入っている状態の両方を通す
  ...marketTabs('相場（データなし）'),
  ['相場のデータを入れる', () => {
    const b = store.data.buildings[0];
    // 参考建物（部屋が無く、相場だけ見る建物）。properties.json には入らない
    store.setRefs([{ id: 'ref1', name: '参考タワー', address: '東京都江東区東雲2-1-1',
      builtYM: '2015/06', totalUnits: 300, walk: '東雲4分', developer: '長谷工',
      equipmentTags: [], structureTags: [], facilityTags: [] }]);
    store.setMarket('ref1', { sale: [{ id: 'mr1', buildingId: 'ref1', listedYM: '2026-07',
      closedYM: null, open: true, floor: 10, layout: '2LDK', area: 70, price: 9000,
      priceHistory: [], kanrihi: 1.5, shuzen: 1.2 }], rent: [], new: [] });
    // 相場は建物ごとの別ファイル。読み込み済みとして差し込んでから足す
    store.setMarket(b.id, {});
    store.addListing(b.id, { listedYM: '2026-05', closedYM: '2026-08', floor: 4, layout: '3LDK',
      direction: '東', feature: 'リフォーム', area: 75.67, balcony: 12.7, price: 9698,
      priceHistory: [{ ym: '2026-08', price: 9998 }, { ym: '2026-09', price: 9698 }],
      kanrihi: 1.184, shuzen: 1.984 });
    // 終了年月も販売中の印も無い行。マンレビの古い行がこの形
    store.addListing(b.id, { listedYM: '2009-01', floor: 26, area: 68.12, price: 4380 });
    // 募集中の行。ここから「部屋にする」ボタンを描く経路を通す
    store.addListing(b.id, { listedYM: '2026-08', open: true, floor: 9, layout: '2LDK',
      direction: '南西', feature: '角部屋・リフォーム', area: 80.14, balcony: 9.63, price: 12480,
      priceHistory: [{ ym: '2026-08', price: 12980 }, { ym: '2026-09', price: 12480 }],
      kanrihi: 2.13, shuzen: 1.732 });
    store.addRent(b.id, { ym: '2026-05', floor: 13, layout: '1SLDK', direction: '北東',
      area: 67.23, rent: 280000, kanrihi: 20000, deposit: 560000, keyMoney: 280000, guarantee: 0 });
    store.addNewPrice(b.id, { floor: 4, direction: '南西', layout: '1LDK',
      area: 75.95, balcony: 13.52, price: 3850 });
    // 中身がほとんど無い行も混ぜる。写し間違いでこの形になりうる
    store.addListing(b.id, { listedYM: '2025-11' });
    store.addRent(b.id, { ym: '2025-04' });
    store.addNewPrice(b.id, {});
  }],
  ...marketTabs('相場'),
  // 相場の絞り込み。条件を変えると通る経路が変わるので、代表的な組み合わせを通す
  ['衝突したらリモートの控えを取る', async () => {
    // 取り込みの最中にアプリから保存すると、数万行が消えることがあった。
    // 上書きする前に、ぶつかった相手を控えに残しているかを見る
    const saved = { sha: store.sha, dirty: store.dirty };
    let stashed = null;
    store.sha = 'old';
    store.dirty = true;
    // repo は設定から毎回作られるので、その場だけ差し替える
    const fake = {
      configured: true,
      putJson: () => { const e = new Error('conflict'); e.status = 409; throw e; },
      getJson: async () => ({ sha: 'new', data: { rooms: [1, 2, 3], buildings: [] } }),
    };
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(store), 'repo');
    Object.defineProperty(store, 'repo', { get: () => fake, configurable: true });
    const idb = mods.idb.idb;   // 名前空間ではなく中身の入れ物
    const origSet = idb.set;
    idb.set = async (st, key, val) => { if (key === 'conflict') stashed = val; };
    try {
      await store.save('test').catch(() => {});
      if (!stashed) throw new Error('控えを取っていない');
      if (stashed.sha !== 'new' || stashed.data.rooms.length !== 3) throw new Error('控えの中身が違う');
      if (!store.lastError.includes('控え')) throw new Error('控えたことを伝えていない');
    } finally {
      idb.set = origSet;
      delete store.repo;
      if (desc) Object.defineProperty(Object.getPrototypeOf(store), 'repo', desc);
      Object.assign(store, saved);
      store.lastError = '';
    }
  }],
  ['相場：条件を押したぶんだけ対象が減る', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    const f = mods['unit-filter'];
    const shared = { ...f.unitUI };
    // 相場だけの条件は marketUI、それ以外は一覧と共通の unitUI
    const set = ({ market = {}, common = {} }) => {
      Object.assign(u, saved, market);
      Object.assign(v.marketDraft, u);
      Object.assign(f.unitUI, shared, { listing: 'all' }, common);
      f.resetDraft();
      return v.marketCounts();
    };
    try {
      const all = set({ common: { own: 'all' } });
      if (!all.buildings || !all.rows) throw new Error('全建物で何も出ていない');
      const one = set({ market: { building: 'ref1' }, common: { own: 'all' } });
      if (one.buildings !== 1) throw new Error('建物を選んでも1棟に絞れていない');
      if (one.rows >= all.rows) throw new Error('1棟に絞ったのに行が減っていない');
      const layout = set({ common: { own: 'all', layout: '2LDK' } });
      if (layout.rows >= all.rows) throw new Error('間取りで行が減っていない');
      const open = set({ market: { listing: 'open' }, common: { own: 'all' } });
      if (open.rows >= all.rows) throw new Error('募集状況で行が減っていない');
      const none = set({ common: { own: 'all', name: '存在しない建物' } });
      if (none.buildings !== 0) throw new Error('当たらない名前でも建物が残っている');
      // 一覧で絞った条件が相場にもそのまま効く
      const mine = set({ common: { own: '検討中' } });
      if (mine.buildings >= all.buildings) throw new Error('検討の条件が相場に効いていない');
    } finally {
      Object.assign(u, saved);
      Object.assign(v.marketDraft, saved);
      Object.assign(f.unitUI, shared);
      f.resetDraft();
    }
  }],
  ['検討ステータスで絞ると、登録した部屋がすべて出る', () => {
    const f = mods['unit-filter'];
    const u = mods.units;
    const saved = { ...f.unitUI };
    try {
      // 「登録した部屋」という選択肢は無くした。ステータスだけで選ぶ
      const labels = f.OWN_OPTIONS.map(([v]) => v);
      if (labels.includes('mine')) throw new Error('「登録した部屋」が選択肢に残っている');
      const all = u.allUnits();
      const registered = all.filter((x) => !x.r.fromListing);
      let hit = 0;
      for (const st of labels.filter((v) => v !== 'all')) {
        Object.assign(f.unitUI, saved, { listing: 'all', own: st });
        hit += all.filter((x) => f.unitMatches(x)).length;
      }
      if (hit !== registered.length) {
        throw new Error(`ステータスで拾えるのが ${hit}室、登録は ${registered.length}室`);
      }
      // 売り出しのままの部屋は、どのステータスでも出ない
      Object.assign(f.unitUI, saved, { listing: 'all', own: '検討中' });
      if (all.filter((x) => f.unitMatches(x)).some((x) => x.r.fromListing)) {
        throw new Error('登録していない売り出しがステータスで出ている');
      }
    } finally {
      Object.assign(f.unitUI, saved);
      f.resetDraft();
    }
  }],
  ['一括出力：条件のままレポートを組み立てる', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const f = mods['unit-filter'];
    const saved = { ...u };
    const shared = { ...f.unitUI };
    try {
      // 一括出力から来たとき（描き終わってから印刷を呼ぶ）
      Object.assign(u, saved, { autoPrint: true });
      v.renderMarket(stubEl(), () => {}, 'report');
      if (u.autoPrint) throw new Error('印刷の予約が消えていない（何度も出てしまう）');
      // 条件を付けた状態でも組み立てられる。共通の絞り込みの分も見出しに出る
      Object.assign(f.unitUI, shared,
        { own: 'all', layout: '3LDK', age: '-20', areaMin: 60, areaMax: 90 });
      f.resetDraft();
      Object.assign(u, saved, { listing: 'all' });
      v.renderMarket(stubEl(), () => {}, 'report');
      const cond = v.activeConditions().map(([k, val]) => `${k}：${val}`).join(' / ');
      for (const want of ['間取り：3LDK', '築年数：築20年以内', '広さ：60〜90㎡']) {
        if (!cond.includes(want)) throw new Error(`レポートの条件に ${want} が出ていない（${cond}）`);
      }
    } finally {
      Object.assign(u, saved);
      Object.assign(f.unitUI, shared);
      f.resetDraft();
    }
  }],
  ['供給：分類ごとの折れ線と、点を押して中身を見る', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    try {
      for (const group of ['station', 'ward', 'layout', 'ageBand']) {
        for (const step of ['year', 'half', 'quarter', 'month']) {
          Object.assign(u, saved, { group, group2: 'none', step, pick: null, hide: [], pin: [] });
          v.renderMarket(stubEl(), () => {}, 'supply');
        }
      }
      // 掛け合わせ、点を押した状態、当たらない点、消した分類
      Object.assign(u, saved, { group: 'station', group2: 'ward', pick: null, hide: [], pin: [] });
      v.renderMarket(stubEl(), () => {}, 'supply');
      u.pick = { key: '存在しない', period: 1990 };
      v.renderMarket(stubEl(), () => {}, 'supply');
      Object.assign(u, saved, { group: 'layout', group2: 'none', pick: null, hide: ['2LDK'], pin: ['3LDK'] });
      v.renderMarket(stubEl(), () => {}, 'supply');
      // 凡例で消しても、対象の行そのものは減らない（表示から外すだけ）
      Object.assign(u, saved, { group: 'layout', group2: 'none', hide: [], pin: [] });
      const before = v.marketCounts().rows;
      Object.assign(u, saved, { group: 'layout', group2: 'none', hide: ['2LDK'], pin: [] });
      if (v.marketCounts().rows !== before) throw new Error('消したら対象の行まで減っている');
      for (const tab of ['trend', 'supply']) v.renderMarket(stubEl(), () => {}, tab);
    } finally {
      Object.assign(u, saved);
    }
  }],
  ['供給：棒を押してその期間の売り出しを見る', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    try {
      for (const step of ['year', 'half', 'quarter', 'month']) {
        for (const span of [3, 'all']) {
          Object.assign(u, saved, { mine: 'all', step, span, pick: null });
          v.renderMarket(stubEl(), () => {}, 'supply');
        }
      }
      // 棒を押した状態でも描ける
      Object.assign(u, saved, { mine: 'all', step: 'year', span: 'all' });
      u.pick = { key: '供給', period: 2026 };
      v.renderMarket(stubEl(), () => {}, 'supply');
      u.pick = { key: '供給', period: 1990 };      // 該当なしでも落ちない
      v.renderMarket(stubEl(), () => {}, 'supply');
    } finally {
      Object.assign(u, saved);
    }
  }],
  ['推移：分類ごとの線と、点を押して中身を見る', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    try {
      // 分類はどれを選んでも描ける（エリア別・住所別を足したときに落ちた経験がある）
      for (const group of Object.keys(mods.market.MARKET_GROUPS)) {
        for (const step of ['year', 'half', 'quarter', 'month']) {
          Object.assign(u, saved, { mine: 'all', group, step, minCount: 1, pick: null });
          v.renderMarket(stubEl(), () => {}, 'trend');
        }
      }
      // 点を押した状態でも描ける（押した期間の一覧が出る）
      Object.assign(u, saved, { mine: 'all', group: 'layout', step: 'year', minCount: 1 });
      u.pick = { key: '2LDK', period: 2026 };
      v.renderMarket(stubEl(), () => {}, 'trend');
      // 該当しない点を押したままでも落ちない
      u.pick = { key: '存在しない', period: 1990 };
      v.renderMarket(stubEl(), () => {}, 'trend');
      // 下限を上げて点が無くなる場合
      Object.assign(u, saved, { mine: 'all', minCount: 10000, pick: null });
      v.renderMarket(stubEl(), () => {}, 'trend');
    } finally {
      Object.assign(u, saved);
    }
  }],
  ['推移：分類を掛け合わせる／凡例を押して線を消す', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    try {
      // エリア × 間取り、エリア × 築年数。売出・建物別も同じ分類で描く
      for (const group2 of ['layout', 'ageBand', 'none']) {
        Object.assign(u, saved, { group: 'station', group2, minCount: 1, pick: null, hide: [] });
        for (const tab of ['trend', 'sale', 'group']) v.renderMarket(stubEl(), () => {}, tab);
      }
      // 同じ分類どうしを掛けても落ちない（掛け合わせを無視する）
      Object.assign(u, saved, { group: 'station', group2: 'station', minCount: 1, hide: [] });
      v.renderMarket(stubEl(), () => {}, 'trend');
      // 表から選んだ分類は、件数の順に関わらず必ず線にする
      Object.assign(u, saved, { group: 'station', group2: 'none', minCount: 1, hide: [], pin: [] });
      v.renderMarket(stubEl(), () => {}, 'trend');
      u.pin = ['存在しないエリア'];
      v.renderMarket(stubEl(), () => {}, 'trend');
      // 消した分類と選んだ分類が同時に指定されていても落ちない
      u.hide = ['2LDK']; u.pin = ['2LDK'];
      v.renderMarket(stubEl(), () => {}, 'trend');
      Object.assign(u, saved, { hide: [], pin: [] });
      // 凡例で消した分類は線から外れる。全部消しても落ちない
      Object.assign(u, saved, { group: 'layout', group2: 'none', minCount: 1, hide: ['2LDK'] });
      v.renderMarket(stubEl(), () => {}, 'trend');
      u.hide = ['1LDK', '2LDK', '3LDK', '4LDK', '1DK', '2DK', '3DK', '1K', '1R', '不明'];
      v.renderMarket(stubEl(), () => {}, 'trend');
    } finally {
      Object.assign(u, saved);
    }
  }],
  ['売出：同じ部屋の出し直しを1件にまとめる', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    try {
      for (const attr of ['year', 'area', 'floor', 'age']) {
        Object.assign(u, saved, { attr, latestOnly: true });
        v.renderMarket(stubEl(), () => {}, 'sale');
        Object.assign(u, saved, { attr, latestOnly: false });
        v.renderMarket(stubEl(), () => {}, 'sale');
      }
      // まとめたあとの件数が、まとめる前より増えることはない
      const rows = store.allBuildings.flatMap((b) => store.listingsOf(b.id));
      const key = (x) => [x.buildingId, x.floor ?? '',
        x.area == null ? '' : x.area.toFixed(2), x.direction || '',
        mods.units.layoutLabel(x.layout)].join('|');
      const keys = new Set(rows.map(key));
      if (keys.size > rows.length) throw new Error('まとめたのに件数が増えている');
      // 同じ鍵の行は、いちばん新しい掲載だけが残る
      const groups = new Map();
      for (const x of rows) {
        const k = key(x);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(x);
      }
      const many = [...groups.values()].find((g) => g.length > 1);
      if (!many) return;   // 出し直しが1件も無いデータなら見るものが無い
      const newest = many.reduce((a, b) => (String(a.listedYM) > String(b.listedYM) ? a : b));
      if (many.some((x) => String(x.listedYM) > String(newest.listedYM))) {
        throw new Error('残した行がいちばん新しくない');
      }
    } finally {
      Object.assign(u, saved);
    }
  }],
  ['選択肢の多い条件は打って絞れる', () => {
    const { comboMatch } = mods.ui;
    const opts = [['川崎', '川崎（352）'], ['川崎新町', '川崎新町（33）'],
      ['武蔵小杉', '武蔵小杉（257）'], ['元住吉', '元住吉（48）']];
    const want = {
      武蔵小杉: '武蔵小杉',            // 正式名そのまま
      ' 武蔵小杉（257）': '武蔵小杉',   // 候補から選んだ形（件数つき・前後の空白）
      '武蔵小杉（999）': '武蔵小杉',   // 他の条件で件数が動いたあとの古い表示
      元住: '元住吉',                  // 打ちかけでも1つに絞れる
      川崎: '川崎',                    // 川崎新町もあるが、正式名は正式名として当てる
      '': 'all',                       // 空にしたら「すべて」
      新町: '川崎新町',                // 後ろの方だけでも当てる
    };
    for (const [text, expect] of Object.entries(want)) {
      const got = comboMatch(text, opts);
      if (got !== expect) throw new Error(`「${text}」が ${got}（${expect} のはず）`);
    }
    // 決められないものは null。黙って全件に戻したり、勝手に選んだりしない
    for (const text of ['ZZZ', '崎']) {
      if (comboMatch(text, opts) !== null) throw new Error(`「${text}」で勝手に選んでいる`);
    }
    // 実際の駅でも、いちばん多い駅を正式名で選べる
    const stations = mods.units.options(store.allBuildings.flatMap(mods.units.stationsOf));
    if (stations.length) {
      const [first] = stations[0];
      if (comboMatch(first, stations) !== first) throw new Error(`${first} を選べない`);
    }
  }],
  ['駅と区はいくつでも選べる／徒歩は選んだ駅までで見る', () => {
    const f = mods['unit-filter'];
    const u = mods.units;
    const a = mods.analysis;
    const saved = { ...f.unitUI };
    const all = u.allUnits();
    const hit = (o) => {
      Object.assign(f.unitUI, saved,
        { listing: 'all', own: 'all', walk: 'all', station: [], ward: [] }, o);
      return all.filter((x) => f.unitMatches(x)).length;
    };
    try {
      const stations = [...new Set(store.allBuildings.flatMap(u.stationsOf))];
      const [s1, s2] = stations;
      if (s1 && s2) {
        const a1 = hit({ station: [s1] });
        const a2 = hit({ station: [s2] });
        const both = hit({ station: [s1, s2] });
        // 複数選んだら「どれかに当たれば残す」。片方だけより必ず増える
        if (both < Math.max(a1, a2)) throw new Error('複数選んだのに減っている');
        if (both > a1 + a2) throw new Error('複数選んだ結果が足し算を超えている');
      }
      const wards = [...new Set(store.allBuildings.map(a.wardOf).filter(Boolean))];
      if (wards.length > 1) {
        const w1 = hit({ ward: [wards[0]] });
        const w2 = hit({ ward: [wards[0], wards[1]] });
        if (w2 <= w1) throw new Error('区を足したのに増えていない');
      }
      // 徒歩は「選んだ駅まで」で見る。隣の駅が近いという理由で残らないこと
      const b = { walk: '辰巳6分・東雲8分・豊洲15分' };
      if (a.walkMinutesOf(b) !== 6) throw new Error('駅を選ばないときは最短で見ていない');
      if (a.walkMinutesOf(b, ['豊洲']) !== 15) throw new Error('選んだ駅までの分になっていない');
      if (a.walkMinutesOf(b, ['東雲', '豊洲']) !== 8) throw new Error('選んだ駅のうち近いほうを見ていない');
      if (a.walkMinutesOf(b, ['存在しない駅']) !== 6) throw new Error('記載に無い駅で落としている');
    } finally {
      Object.assign(f.unitUI, saved);
      f.resetDraft();
    }
  }],
  ['表は見出しを押すと並び替わる', () => {
    const { sortableTable } = mods.ui;
    const rows = [
      { name: 'い', n: 3 }, { name: 'あ', n: 1 }, { name: 'う', n: null }, { name: 'え', n: 2 },
    ];
    // cell が呼ばれた順で、実際に並んだ順を見る
    const order = (key, dir) => {
      const seen = [];
      sortableTable(`t-${key}-${dir}`, [
        { key: 'name', label: '名前', asc: true, get: (r) => r.name },
        { key: 'n', label: '数', get: (r) => r.n, cell: (r) => { seen.push(r.name); return ''; } },
      ], rows, () => {}, { sort: { key, dir } });
      return seen.join('');
    };
    // 値の無い行（う）は、昇順でも降順でも末尾に送る
    if (order('n', 'desc') !== 'いえあう') throw new Error(`多い順が ${order('n', 'desc')}`);
    if (order('n', 'asc') !== 'あえいう') throw new Error(`少ない順が ${order('n', 'asc')}`);
    // 文字は五十音順（localeCompare）
    if (order('name', 'asc') !== 'あいうえ') throw new Error(`名前の昇順が ${order('name', 'asc')}`);
    if (order('name', 'desc') !== 'えういあ') throw new Error(`名前の降順が ${order('name', 'desc')}`);
    // 元の配列は壊さない（呼ぶ側が別の用途で使っている）
    if (rows[0].name !== 'い') throw new Error('渡した配列を並べ替えてしまっている');
  }],
  ['検索条件を名前を付けて残せる', () => {
    const f = mods['unit-filter'];
    const saved = { ...f.unitUI };
    const before = store.searches.length;
    try {
      Object.assign(f.unitUI, saved,
        { listing: 'all', own: 'all', layout: '3LDK', station: ['豊洲'], areaMin: 70 });
      const filter = {};
      for (const k of Object.keys(f.unitUI)) {
        if (k === 'more') continue;
        filter[k] = Array.isArray(f.unitUI[k]) ? [...f.unitUI[k]] : f.unitUI[k];
      }
      const entry = store.saveSearch('テスト条件', filter);
      if (store.searches.length !== before + 1) throw new Error('保存されていない');
      // 同じ名前で保存し直しても増えない（上書き）
      store.saveSearch('テスト条件', filter);
      if (store.searches.length !== before + 1) throw new Error('同じ名前で増えている');
      // 条件を変えてから呼び出すと、保存した中身に戻る
      Object.assign(f.unitUI, saved, { layout: 'all', station: [], areaMin: null });
      const got = store.searches.find((x) => x.id === entry.id);
      for (const [k, v] of Object.entries(got.filter)) {
        f.unitUI[k] = Array.isArray(v) ? [...v] : v;
      }
      if (f.unitUI.layout !== '3LDK') throw new Error('呼び出しても間取りが戻らない');
      if (f.unitUI.station.join() !== '豊洲') throw new Error('呼び出しても駅が戻らない');
      if (f.unitUI.areaMin !== 70) throw new Error('呼び出しても広さが戻らない');
      // 保存した条件が並んでいる状態でも、どの画面も描ける
      for (const render of [() => mods.views.renderList(stubEl()),
        () => mods.views.renderCompare(stubEl()),
        () => mods['viewing-view'].renderViewing(stubEl(), () => {}),
        () => mods['market-view'].renderMarket(stubEl(), () => {}, 'sale')]) render();
      store.removeSearch(entry.id);
      if (store.searches.length !== before) throw new Error('消せていない');
    } finally {
      Object.assign(f.unitUI, saved);
      f.resetDraft();
    }
  }],
  ['タワーと総戸数で絞れる／分類できる', () => {
    const f = mods['unit-filter'];
    const u = mods.units;
    const a = mods.analysis;
    const saved = { ...f.unitUI };
    const all = u.allUnits();
    const hit = (o) => {
      Object.assign(f.unitUI, saved,
        { listing: 'all', own: 'all', tower: false, unitsMin: null, unitsMax: null }, o);
      return all.filter((x) => f.unitMatches(x)).length;
    };
    try {
      if (!a.isTower({ totalFloors: a.TOWER_FLOORS })) throw new Error('20階がタワーになっていない');
      if (a.isTower({ totalFloors: a.TOWER_FLOORS - 1 })) throw new Error('19階をタワーにしている');
      if (a.isTower({})) throw new Error('階建が無いのにタワーにしている');
      const base = hit({});
      const tower = hit({ tower: true });
      if (tower > base) throw new Error('タワーだけのほうが多い');
      // 絞った結果がすべて20階以上であること
      const bad = all.filter((x) => f.unitMatches(x)).find((x) => !a.isTower(x.b));
      if (bad) throw new Error(`タワーでない建物が残っている（${bad.b.name}）`);
      // 総戸数の範囲
      const big = hit({ unitsMin: 500 });
      const mid = hit({ unitsMin: 100, unitsMax: 300 });
      if (big > base || mid > base) throw new Error('範囲で絞ったのに増えている');
      const over = all.filter((x) => f.unitMatches(x)).find((x) => {
        const n = Number(x.b.totalUnits) || 0;
        return n < 100 || n > 300;
      });
      if (over) throw new Error(`総戸数の範囲外が残っている（${over.b.totalUnits}戸）`);
      // 分類としても使える
      const g = mods.market.MARKET_GROUPS;
      if (!g.tower || !g.unitsBand) throw new Error('分類にタワー／総戸数が無い');
      if (g.tower.get(null, { totalFloors: 40 }) === g.tower.get(null, { totalFloors: 5 })) {
        throw new Error('タワーとそれ以外が同じ分類になっている');
      }
      if (g.unitsBand.get(null, { totalUnits: 600 }) !== '500戸以上') throw new Error('総戸数の帯が合わない');
      if (g.unitsBand.get(null, {}) !== '不明') throw new Error('総戸数が無いときに不明にならない');
    } finally {
      Object.assign(f.unitUI, saved);
      f.resetDraft();
    }
  }],
  ['まとめ方の刻みは、年・半年・3か月・月の4通り', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    try {
      // 同じ月が、刻みごとに正しい区切りへ寄ること
      const want = {
        year: { '2026-01': '2026年', '2026-12': '2026年' },
        half: { '2026-01': '2026年 上期', '2026-06': '2026年 上期', '2026-07': '2026年 下期', '2026-12': '2026年 下期' },
        quarter: { '2026-01': '2026年1〜3月', '2026-04': '2026年4〜6月', '2026-10': '2026年10〜12月' },
        month: { '2026-01': '2026年1月', '2026-08': '2026年8月' },
      };
      for (const [step, cases] of Object.entries(want)) {
        u.step = step;
        for (const [ym, label] of Object.entries(cases)) {
          const got = v.periodLabelOf({ listedYM: ym });
          if (got !== label) throw new Error(`${step} の ${ym} が「${got}」（「${label}」のはず）`);
        }
      }
      // 粗い刻みほど点は少なくなる（同じ期間をまとめるので）
      const counts = {};
      for (const step of ['year', 'half', 'quarter', 'month']) {
        Object.assign(u, saved, { step, group: 'none', minCount: 1, pick: null });
        counts[step] = v.periodCountOf();
      }
      if (!(counts.year <= counts.half && counts.half <= counts.quarter
        && counts.quarter <= counts.month)) {
        throw new Error(`刻みと点の数が噛み合わない ${JSON.stringify(counts)}`);
      }
    } finally {
      Object.assign(u, saved);
    }
  }],
  ['凡例で消した分類は、下の表からも消える', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    try {
      const rows = store.allBuildings.flatMap((b) => store.listingsOf(b.id));
      Object.assign(u, saved, { group: 'layout', group2: 'none', hide: [], pin: [] });
      const before = v.growthRowsOf(rows);
      if (before.length < 2) return;               // 分類が1つなら見るものが無い
      const target = before[0];
      Object.assign(u, saved, { group: 'layout', group2: 'none', hide: [target], pin: [] });
      const after = v.growthRowsOf(rows);
      if (after.includes(target)) throw new Error(`消した「${target}」が表に残っている`);
      if (after.length !== before.length - 1) throw new Error('消した数と合わない');
      // 表の行を押したときは、いま線なら消す・線でないなら出す
      Object.assign(u, saved, { group: 'layout', group2: 'none', hide: [], pin: [] });
      v.toggleRowForTest(target, true, () => {});
      if (!u.hide.includes(target)) throw new Error('線になっている行を押しても消えない');
      if (v.growthRowsOf(rows).includes(target)) throw new Error('押したのに表に残っている');
      v.toggleRowForTest(target, false, () => {});
      if (u.hide.includes(target)) throw new Error('もう一度押しても戻らない');
      if (!u.pin.includes(target)) throw new Error('戻したのに線に選ばれていない');
    } finally {
      Object.assign(u, saved);
    }
  }],
  ['成約：タブと指値の列', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    const b = store.data.buildings[0];
    try {
      // 成約が無いときも描ける
      store.setDeals({ rows: [] });
      Object.assign(u, saved, { loadAll: true });
      v.renderMarket(stubEl(), () => {}, 'deal');
      lp('offer')();
      // 入っているとき
      store.setDeals({ source: 'テスト', importedAt: '2026-09-17', rows: [
        { id: 'd1', buildingId: b.id, closedAt: '2026-06-30', area: 60.97, price: 9000,
          tsuboPrice: 488, sqmPrice: 147.7, kanrihi: 16031, layout: '2LDK', deal: '専任' },
        { id: 'd2', buildingId: b.id, closedAt: '2026-03-21', area: 60.48, price: 9800,
          tsuboPrice: 535.7, sqmPrice: 162.1, kanrihi: 15931, layout: '2LDK', deal: '専任' },
        { id: 'd3', buildingId: b.id, closedAt: '2026-03-20', area: 60.25, price: 9900,
          tsuboPrice: 543.2, sqmPrice: 164.4, kanrihi: 15931, layout: '2LDK', deal: '専属' },
      ] });
      v.renderMarket(stubEl(), () => {}, 'deal');
      lp('offer')();
      // 成約を重ねた状態で、推移・売出のどの軸でも描ける
      for (const withDeals of [true, false]) {
        for (const attr of ['year', 'area', 'floor', 'age']) {
          Object.assign(u, saved, { withDeals, attr, metric: 'tsubo', minCount: 1, loadAll: true });
          v.renderMarket(stubEl(), () => {}, 'sale');
        }
        for (const metric of ['tsubo', 'sqm', 'price', 'months']) {
          Object.assign(u, saved, { withDeals, metric, minCount: 1, loadAll: true });
          v.renderMarket(stubEl(), () => {}, 'trend');
        }
      }
      // まとめの数字が合っているか
      const s2 = mods.market.dealSummary(store.dealsOf(b.id));
      if (s2.count !== 3) throw new Error('件数が合わない');
      if (Math.round(s2.tsuboMin) !== 488) throw new Error(`最安が ${s2.tsuboMin}`);
      if (Math.round(s2.tsuboMed) !== 536) throw new Error(`中央が ${s2.tsuboMed}`);
      if (Math.round(s2.tsuboMax) !== 543) throw new Error(`最高が ${s2.tsuboMax}`);
      if (Math.round(s2.tsuboAvg) !== 522) throw new Error(`平均が ${s2.tsuboAvg}`);
      if (s2.from !== '2026-03-20' || s2.to !== '2026-06-30') throw new Error('期間が合わない');
      // 別の建物には混ざらない
      if (store.dealsOf('存在しない').length) throw new Error('別の建物に混ざっている');
    } finally {
      Object.assign(u, saved);
      store.setDeals({ rows: [] });
    }
  }],
  ['相場（絞り込み）', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    for (const patch of [
      { scope: 'all' },
      { building: 'b1' },
      { firm: '長谷工' },
      { station: ['東雲'] },
      { ward: ['江東区'] },
      { station: ['東雲', '辰巳'], ward: ['江東区', '中央区'] },
      { town: '東京都江東区東雲' },
      { age: '-20' },
      { age: '40-' },
      { walk: '-10' },
      { layout: '3LDK' },
      { size: '70-80' },
      { size: '100-' },
      { from: '2026', to: '2026' },
      { listing: 'open' },
      { listing: 'closed' },
      { roomStatus: '検討中' },
      { roomStatus: '本命' },
      { scope: 'all', roomStatus: '内見済' },
      { metric: 'price', attr: 'age', group: 'layout' },
      { metric: 'months', attr: 'floor', group: 'status' },
      { metric: 'sqm', attr: 'area', group: 'none', fit: false },
      { building: '該当しないid' },
    ]) {
      Object.assign(u, saved, patch);
      for (const tab of ['overview', 'sale', 'trend', 'supply', 'dist', 'group', 'report']) {
        v.renderMarket(stubEl(), () => {}, tab);
      }
    }
    Object.assign(u, saved);
  }],
  ['販売中の物件が一覧に出る', () => {
    const u = mods.units;
    const list = u.allUnits();
    if (!list.some((x) => x.r.id === 'os2')) throw new Error('売り出しの行が一覧に出ていない');
    // 同じ建物・階・面積の自分の部屋があれば、そちらが使われる（指値が消えないこと）
    const room = store.data.rooms[0];
    room.floor = 20; room.area = 80; room.offerPrice = 11000;
    const merged = u.allUnits().find((x) => x.r.floor === 20 && x.r.area === 80);
    if (!merged || merged.r.fromListing) throw new Error('自分の部屋より売り出しが優先されている');
    if (merged.r.offerPrice !== 11000) throw new Error('指値が引き継がれていない');
    // 売り出しの行を開くと自分の部屋になる
    const before = store.data.rooms.length;
    const unit = u.allUnits().find((x) => x.r.id === 'os2');
    const made = u.promote(unit);
    if (store.data.rooms.length !== before + 1) throw new Error('部屋が作られていない');
    if (made.price !== 9800 || made.floor !== 15) throw new Error('売り出しの中身が移っていない');
    if (u.promote({ r: made, listing: null }) !== made) throw new Error('二重に作っている');
    // カードから開くリンク。部屋の募集ページがあればそれ、無ければ建物のページ
    const withUrl = u.allUnits().find((x) => x.listing?.id === 'os2');
    if (!u.unitUrl(withUrl).includes('/chuko/')) throw new Error('部屋の募集ページが使われていない');
    const noUrl = u.allUnits().find((x) => x.listing?.id === 'os3');
    if (u.unitUrl(noUrl) !== store.building('b9').url) throw new Error('建物のページに落ちていない');
  }],
  ['同じ階・同じ広さの部屋を取り違えない', () => {
    const u = mods.units;
    const rows = [
      { id: 'c1', buildingId: 'b9', floor: 30, area: 80, layout: '3LDK', direction: '南東', price: 14980, open: true },
      { id: 'c2', buildingId: 'b9', floor: 30, area: 80, layout: '3LDK', direction: '南東', price: 13980, feature: 'リフォーム', open: true },
      { id: 'c3', buildingId: 'b9', floor: 31, area: 80, layout: '4LDK', direction: '北', price: 12000, open: true },
    ];
    // 価格まで一致すれば決まる
    const hit = u.matchListing({ floor: 30, area: 80, layout: '3LDK', price: 13980 }, rows);
    if (hit.listing?.id !== 'c2') throw new Error('価格で絞れていない');
    // 間取りが違えば別の部屋
    const other = u.matchListing({ floor: 31, area: 80, layout: '3LDK' }, rows);
    if (other.listing) throw new Error('間取りが違う部屋に当てている');
    // 決め手が無ければ、どれかに決めつけない
    const amb = u.matchListing({ floor: 30, area: 80, layout: '3LDK' }, rows);
    if (amb.listing || amb.ambiguous?.length !== 2) throw new Error('曖昧なまま結びつけている');
    // 同じ部屋が2社から出ているだけなら、迷わず1件として扱う
    const dup = [{ ...rows[0] }, { ...rows[0], id: 'c1b' }];
    if (!u.matchListing({ floor: 30, area: 80, layout: '3LDK' }, dup).listing) {
      throw new Error('同じ内容の重複掲載で迷っている');
    }
  }],
  ['同じ広さの売り出し履歴', () => {
    const u = mods.units;
    const b = store.data.buildings[0];
    const room = store.addRoom(b.id, { label: '4階', floor: 4, area: 75.67, layout: '3LDK' });
    const hist = u.unitHistory(room);
    if (!hist.length) throw new Error('同じ広さの履歴が拾えていない');
    if (!hist.every((x) => Math.abs(x.area - 75.67) <= 1)) throw new Error('広さの違う部屋が混ざっている');
    if (!hist.some((x) => (x.priceHistory || []).length)) throw new Error('値動きが残っていない');
    // 同じ階には印が付く（同じ部屋の可能性が高いもの）
    if (!hist.some((x) => x.sameFloor && x.floor === 4)) throw new Error('同じ階に印が付いていない');
    // 別の階でも、広さが同じなら事例として出る
    const other = store.addRoom(b.id, { label: '9階', floor: 9, area: 75.67, layout: '3LDK' });
    const o = u.unitHistory(other);
    if (!o.length) throw new Error('別の階から見たときに事例が出ていない');
    if (o.some((x) => x.sameFloor)) throw new Error('別の階なのに同じ部屋の印が付いている');
    // 広さが違えば入らない
    const far = store.addRoom(b.id, { label: '3階', floor: 3, area: 40, layout: '1LDK' });
    if (u.unitHistory(far).some((x) => Math.abs(x.area - 40) > 1)) throw new Error('広さで絞れていない');
    // 部屋ページが履歴つきで描けること
    mods.views.renderRoom(stubEl(), room.id);
    store.data.rooms = store.data.rooms.filter(
      (x) => x.id !== room.id && x.id !== other.id && x.id !== far.id);
  }],
  ['募集状況をマンレビと突き合わせる', () => {
    const u = mods.units;
    const b = store.data.buildings[0];
    const room = store.data.rooms[0];
    const savedStatus = room.listingStatus;
    room.floor = 20; room.area = 80;                  // os1（売り出し中）と同じ部屋
    if (u.listingHint(room).state !== 'open') throw new Error('売り出し中を拾えていない');

    // 売り出しに無く、同じ階・面積の終了した行だけがある部屋
    const gone = store.addRoom(b.id, { label: '4階', floor: 4, area: 75.67 });
    gone.listingStatus = '募集中';
    const hint = u.listingHint(gone);
    if (hint.state !== 'closed') throw new Error('募集終了を拾えていない');
    if (hint.ym !== '2026-08') throw new Error('最後の掲載月が取れていない');
    if (!u.listingMismatches().some((d) => d.r.id === gone.id && d.want === '募集終了')) {
      throw new Error('食い違いとして出ていない');
    }
    // 自分で付けた「商談中」は勝手に戻さない
    gone.listingStatus = '商談中';
    if (u.listingMismatches().some((d) => d.r.id === gone.id)) throw new Error('商談中を上書きしようとしている');
    // 相場を取り込んでいない建物は判定しない
    const unknown = store.addRoom('b9', { label: '3階', floor: 3, area: 55 });
    if (u.listingHint(unknown).state !== 'unknown') throw new Error('根拠なく判定している');

    // 片付け。deleteRoom は保存まで走るので、ここでは配列から外すだけにする
    store.data.rooms = store.data.rooms.filter((x) => x.id !== gone.id && x.id !== unknown.id);
    room.listingStatus = savedStatus;
  }],
  ['絞り込みがどのタブにもある', () => {
    const f = mods['unit-filter'];
    const saved = { ...f.unitUI };
    try {
      // 条件を変えると、内見と地図の中身も一緒に絞られる
      Object.assign(f.unitUI, saved, { listing: 'all', own: '検討中', station: ['存在しない駅'] });
      f.resetDraft();
      mods['viewing-view'].renderViewing(stubEl(), () => {});
      mods.views.renderMap(stubEl());
      Object.assign(f.unitUI, saved, { listing: 'all', own: 'all' });
      f.resetDraft();
      mods['viewing-view'].renderViewing(stubEl(), () => {});
      mods.views.renderMap(stubEl());
    } finally {
      Object.assign(f.unitUI, saved);
      f.resetDraft();
    }
  }],
  ['建物名でも絞れる', () => {
    const f = mods['unit-filter'];
    const u = mods.units;
    const saved = { ...f.unitUI };
    try {
      const all = u.allUnits();
      Object.assign(f.unitUI, saved, { listing: 'all', name: '相場タワー' });
      const hit = all.filter((x) => f.unitMatches(x));
      if (!hit.length || !hit.every((x) => x.b.name.includes('相場'))) throw new Error('建物名で絞れていない');
      // 空白や大文字小文字、全角半角の違いは無視する
      Object.assign(f.unitUI, saved, { listing: 'all', name: '相場 タワー' });
      if (f.unitMatches(hit[0]) !== true) throw new Error('空白入りで当たらない');
      // 住所や駅名でも当たる
      Object.assign(f.unitUI, saved, { listing: 'all', name: '東雲' });
      if (!all.some((x) => f.unitMatches(x))) throw new Error('住所・駅名で当たらない');
      Object.assign(f.unitUI, saved, { listing: 'all', name: '存在しない建物' });
      if (all.some((x) => f.unitMatches(x))) throw new Error('当たらないはずの名前で出ている');
      // 相場タブでも同じように効く
      const v = mods['market-view'];
      const ms = { ...v.marketUI };
      Object.assign(v.marketUI, ms, { mine: 'all', name: '相場' });
      v.renderMarket(stubEl(), () => {}, 'overview');
      Object.assign(v.marketUI, ms);
    } finally {
      Object.assign(f.unitUI, saved);
      f.resetDraft();
    }
  }],
  ['条件は検索を押して初めて効く', () => {
    const f = mods['unit-filter'];
    const v = mods.views;
    const saved = { ...f.unitUI };
    try {
      f.resetDraft();
      if (f.draftDirty()) throw new Error('入力中と適用中がずれている');
      f.draft.listing = 'closed';
      if (!f.draftDirty()) throw new Error('変更に気づいていない');
      if (f.unitUI.listing === 'closed') throw new Error('押す前に効いてしまっている');
      v.renderList(stubEl());                 // 未反映の印つきで描ける
      f.applyDraft();
      if (f.unitUI.listing !== 'closed') throw new Error('検索しても効かない');
      if (f.draftDirty()) throw new Error('押したのに未反映のまま');
      // 戻す
      f.draft.listing = 'all';
      f.resetDraft();
      if (f.draft.listing !== 'closed') throw new Error('戻せていない');
      // リセットは既定に戻す
      f.clearDraft();
      if (f.unitUI.listing !== 'open' || f.draftDirty()) throw new Error('リセットできていない');
    } finally {
      Object.assign(f.unitUI, saved);
      f.resetDraft();
    }
  }],
  ['価格と広さを自分で指定できる／高い順にも並べられる', () => {
    const v = mods.views;
    const f = mods['unit-filter'];
    const saved = { ...f.unitUI };
    try {
      if (!f.inRange(80, null, null)) throw new Error('未指定で外している');
      if (f.inRange(null, 50, null)) throw new Error('値が無いのに範囲に入れている');
      if (!f.inRange(80, 70, 90) || f.inRange(95, 70, 90)) throw new Error('範囲の判定が違う');
      Object.assign(f.unitUI, saved, { listing: 'all', priceMin: 12000 });
      const all = mods.units.allUnits();
      if (all.filter((x) => f.unitMatches(x)).some((x) => (x.r.price ?? 0) < 12000)) {
        throw new Error('下限が効いていない');
      }
      Object.assign(f.unitUI, saved, { listing: 'all' });
      // 高い順・安い順の両方で描ける
      for (const sort of ['price', 'price-', 'area-', 'tsubo-']) {
        v.listUI.sort = sort;
        v.renderList(stubEl());
      }
      v.listUI.mode = 'building';
      for (const sort of ['price-', 'age-']) { v.listUI.sort = sort; v.renderList(stubEl()); }
    } finally {
      Object.assign(f.unitUI, saved);
      v.listUI.sort = 'price'; v.listUI.mode = 'building';
    }
  }],
  ['絞り込みが一覧・比較・ライフプランで揃う', () => {
    const v = mods.views;
    const f = mods['unit-filter'];
    const saved = { ...f.unitUI };
    const b = store.building('b9');
    const all = mods.units.allUnits();
    try {
      // 事業者はブランドと会社を分けて選ぶ
      Object.assign(f.unitUI, saved, { listing: 'all', developer: (b.developer || '').trim() });
      if (!all.filter((x) => f.unitMatches(x)).every((x) => x.b.id === 'b9')) {
        throw new Error('分譲会社で絞れていない');
      }
      Object.assign(f.unitUI, saved, { listing: 'all', developer: '存在しない会社' });
      if (all.some((x) => f.unitMatches(x))) throw new Error('効かない条件が素通りしている');
      // 同じ条件が比較・ライフプランにも効く
      v.renderCompare(stubEl());
      mods['lifeplan-view'].renderLifeplan(stubEl(), () => {});
      // 登録した部屋だけに絞る
      Object.assign(f.unitUI, saved, { listing: 'all', own: '検討中' });
      if (all.filter((x) => f.unitMatches(x)).some((x) => x.r.fromListing)) {
        throw new Error('売り出しの行が「登録した部屋」に混ざっている');
      }
      v.renderList(stubEl());
    } finally {
      Object.assign(f.unitUI, saved);
      f.resetDraft();
    }
  }],
  ['参考建物', () => {
    const v = mods['market-view'];
    const u = v.marketUI;
    const saved = { ...u };
    Object.assign(u, saved, { mine: 'all' });
    v.renderMarket(stubEl(), () => {}, 'overview');
    v.renderMarket(stubEl(), () => {}, 'sale');
    if (!store.allBuildings.some((b) => b.id === 'ref1')) throw new Error('参考建物が相場に出ていない');
    if (store.buildings.some((b) => b.id === 'ref1')) throw new Error('参考建物が検討中に混ざっている');
    // 部屋を足したら検討中へ移る
    store.addRoom('ref1', { label: '10階' });
    if (!store.buildings.some((b) => b.id === 'ref1')) throw new Error('部屋を足しても検討中へ移っていない');
    if (store.refs.some((b) => b.id === 'ref1')) throw new Error('参考側に残っている');
    Object.assign(u, saved);
  }],
  ['指値（絞り込み）', () => {
    const v = mods['lifeplan-view'];
    v.lifeplanUI.offer.filter = { status: '検討中', offerOnly: true };
    lp('offer')();
    v.lifeplanUI.offer.filter = { status: '', offerOnly: false };
  }],
  ['申込検討は本命にまとまっている', () => {
    const { STATUSES } = mods.util;
    if (STATUSES.includes('申込検討')) throw new Error('申込検討が残っている');
    const { migrate } = mods.migrate;
    const out = migrate({ schemaVersion: 23, rooms: [{ status: '申込検討' }] });
    if (out.rooms[0].status !== '本命') throw new Error('申込検討が本命に移っていない');
    if (store.rooms.some((r) => !STATUSES.includes(r.status))) {
      throw new Error('選択肢に無いステータスの部屋が残っている');
    }
  }],
  ['古いリンクを踏んでも迷子にならない', () => {
    const { parseHash } = mods.main;
    const at = (hash) => { location.hash = hash; return parseHash(); };
    const offer = at('#/viewing/offer');
    if (offer.view !== 'plan' || offer.id !== 'offer') {
      throw new Error(`指値が ${offer.view}/${offer.id} に行っている`);
    }
    for (const hash of ['#/viewing/check', '#/viewing/note', '#/viewing']) {
      const r = at(hash);
      if (r.view !== 'viewing' || r.id !== null) throw new Error(`${hash} が ${r.view}/${r.id}`);
    }
    if (at('#/analysis').view !== 'market') throw new Error('分析が相場に飛んでいない');
    location.hash = '';
  }],
];

mods.views.bindRouter(() => {}, () => {});
for (const [name, fn] of screens) {
  try { await fn(); console.log(`✅ 描画 ${name}`); }
  catch (e) { bad++; console.log(`❌ 描画 ${name} : ${e.message}`); }
}

console.log(bad ? `\n${bad} 件の問題` : '\n✅ すべて通過');
process.exit(bad ? 1 : 0);
