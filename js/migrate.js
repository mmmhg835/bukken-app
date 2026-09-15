// properties.json のスキーマ移行。
// v1 は「物件」の平坦な配列だったが、同じ建物の別部屋が重複して登録されるため
// v2 で「建物（buildings）」と「部屋（rooms）」に分けた。
import { DEFAULT_TERMS } from './loan.js';
import { buildingDefaults, SPEC_GROUPS, BUILDING_EQUIPMENT } from './spec.js';
import { defaultLifeplan, categoryOf } from './lifeplan.js';

export const CURRENT_SCHEMA = 13;

export function migrate(data) {
  let d = structuredClone(data);
  if (!d.schemaVersion || d.schemaVersion < 2) d = v1ToV2(d);
  if (d.schemaVersion < 3) d = v2ToV3(d);
  if (d.schemaVersion < 4) d = v3ToV4(d);
  if (d.schemaVersion < 5) d = v4ToV5(d);
  if (d.schemaVersion < 6) d = v5ToV6(d);
  if (d.schemaVersion < 7) d = v6ToV7(d);
  if (d.schemaVersion < 8) d = v7ToV8(d);
  if (d.schemaVersion < 9) d = v8ToV9(d);
  if (d.schemaVersion < 10) d = v9ToV10(d);
  if (d.schemaVersion < 11) d = v10ToV11(d);
  if (d.schemaVersion < 12) d = v11ToV12(d);
  if (d.schemaVersion < 13) d = v12ToV13(d);
  d.settings ||= {};
  d.settings.loan = { ...DEFAULT_TERMS, ...(d.settings.loan || {}) };
  d.settings.places ||= [];   // 職場・駅など、地図上の参照地点
  d.schemaVersion = CURRENT_SCHEMA;
  return d;
}

/**
 * v3: 募集状況と価格推移を追加。
 * 値下げの経緯や販売期間を残せないと、指値の判断材料にならないため。
 */
function v2ToV3(d) {
  for (const r of d.rooms || []) {
    r.listingStatus ??= '募集中';
    r.listedAt ??= null;      // 掲載開始日
    r.closedAt ??= null;      // 募集終了日
    // 価格が入っていれば、日付未定の1点として履歴の起点にする
    r.priceHistory ??= [];
  }
  d.schemaVersion = 3;
  return d;
}

/**
 * v4: 建物のスペック項目と、設備のチェックリストを追加。
 * 共用施設や構造は後から調べ直すのが面倒で、内見の記憶も薄れるため記録できるようにした。
 */
function v3ToV4(d) {
  for (const b of d.buildings || []) {
    const def = buildingDefaults();
    for (const [k, v] of Object.entries(def)) if (b[k] === undefined) b[k] = v;
    // v2 の自由記述だった共用施設はチェックリストに置き換わったため、内容だけメモへ退避する
    if ('amenities' in b) {
      if (b.amenities) b.memo = [b.memo, b.amenities].filter(Boolean).join('\n');
      delete b.amenities;
    }
  }
  for (const r of d.rooms || []) {
    for (const [key, g] of Object.entries(SPEC_GROUPS)) if (g.on === 'room') r[key] ??= [];
  }
  d.schemaVersion = 4;
  return d;
}

/**
 * v5: ローンの既定条件を 0.7%/35年 から 1.275%/50年 へ。
 * 触っていない（初期値のままの）場合だけ載せ替え、自分で設定した値は尊重する。
 */
function v4ToV5(d) {
  const old = { downPayment: 0, rate: 0.7, years: 35, method: 'equal', costRate: 7 };
  const cur = d.settings?.loan || {};
  const untouched = Object.entries(old).every(([k, v]) => cur[k] === v);
  if (untouched) d.settings.loan = { ...DEFAULT_TERMS };
  d.schemaVersion = 5;
  return d;
}

/** v6: 家計シミュレーションの項目を追加。初期値はスライドの内訳をそのまま入れる */
function v5ToV6(d) {
  d.settings ||= {};
  d.settings.lifeplan ||= defaultLifeplan();
  d.schemaVersion = 6;
  return d;
}

/**
 * v7: 家計の項目に ON/OFF と 積立・固定・変動 の区分を追加。
 * 旧 saving フラグは区分 'saving' に読み替える。
 */
function v6ToV7(d) {
  const plan = d.settings?.lifeplan;
  if (plan) {
    for (const g of plan.groups || []) {
      for (const it of g.items || []) {
        it.enabled ??= true;
        if (!it.category) it.category = it.saving ? 'saving' : 'fixed';
        delete it.saving;
      }
    }
    for (const it of plan.income || []) it.enabled ??= true;
  }
  d.schemaVersion = 7;
  return d;
}

/**
 * v8: 部屋にリノベ区分を追加。
 * 既存のリフォーム記述から推定して埋める（「全室」「全面」があればフルリノベ）。
 */
function v7ToV8(d) {
  for (const r of d.rooms || []) {
    if (r.renovation) continue;
    const t = String(r.reform || '');
    r.renovation = !t || /既存|なし/.test(t) ? 'なし'
      : /全室|全面|フルリノベ|スケルトン/.test(t) ? 'フルリノベ'
      : '一部リノベ';
  }
  d.schemaVersion = 8;
  return d;
}

/**
 * v9: 旧「共用設備」（オートロック・宅配ボックス等）を共用施設へ移す。
 * equipmentTags は建物固有の4項目に絞り直したため、それ以外の値が行き場を失っていた。
 */
function v8ToV9(d) {
  for (const b of d.buildings || []) {
    b.equipmentTags ||= [];
    b.facilityTags ||= [];
    const stay = b.equipmentTags.filter((t) => BUILDING_EQUIPMENT.includes(t));
    const move = b.equipmentTags.filter((t) => !BUILDING_EQUIPMENT.includes(t));
    b.equipmentTags = stay;
    for (const t of move) if (!b.facilityTags.includes(t)) b.facilityTags.push(t);
  }
  d.schemaVersion = 9;
  return d;
}

/**
 * v10: 車関連を住居費と並ぶ独立した段にする。金額が大きく、
 * 「車をどうするか」が月次の余裕を左右するため、他の固定費に埋もれさせない。
 * あわせて返済負担率・年収倍率のための額面年収を追加する。
 */
function v9ToV10(d) {
  const plan = d.settings?.lifeplan;
  if (!plan) { d.schemaVersion = 10; return d; }
  for (const g of plan.groups || []) {
    if (g.kind === 'expense' && (g.id === 'g_car' || /車/.test(g.name || ''))) g.kind = 'car';
  }
  plan.grossIncome ||= { primary: { name: '夫', annual: 1230 }, secondary: { name: '妻', annual: 615 } };
  d.schemaVersion = 10;
  return d;
}

/** v11: 使うときだけ ON にする「その他収入」の枠を用意する */
function v10ToV11(d) {
  const plan = d.settings?.lifeplan;
  if (plan && !plan.income?.some((i) => i.name === 'その他収入')) {
    plan.income.push({ id: 'i_other', name: 'その他収入', amount: 0, enabled: false });
  }
  d.schemaVersion = 11;
  return d;
}

/**
 * v12: 返済負担率を手取りベースでも出せるよう、手取り年収を持たせる。
 * 初期値は入力済みの手取り月額から起こす。
 */
function v11ToV12(d) {
  const plan = d.settings?.lifeplan;
  if (!plan?.grossIncome) { d.schemaVersion = 12; return d; }
  const monthly = (plan.income || []).filter((i) => i.enabled !== false);
  const fallback = { primary: 960, secondary: 480 };
  for (const [key, index] of [['primary', 0], ['secondary', 1]]) {
    const person = plan.grossIncome[key];
    if (!person || person.net != null) continue;
    person.net = monthly[index] ? Math.round((Number(monthly[index].amount) || 0) * 12) : fallback[key];
  }
  d.schemaVersion = 12;
  return d;
}

/** v13: 期限付きの支出に残り年数を持たせ、将来の推移を描けるようにする */
function v12ToV13(d) {
  const guess = { 車ローン: 5, 奨学金: 10 };
  for (const g of d.settings?.lifeplan?.groups || []) {
    for (const it of g.items || []) {
      if (it.temporary && it.remainingYears == null) it.remainingYears = guess[it.name] ?? null;
    }
  }
  d.schemaVersion = 13;
  return d;
}

/** 建物名から「（29階）」のような部屋を表す括弧書きを取り除く */
function buildingNameOf(name = '') {
  return name.replace(/[（(][^）)]*階[^）)]*[）)]/g, '').trim() || name.trim();
}

/** 同一建物の判定キー。築年月・総階数・最寄駅が揃えば同じ建物とみなす */
function buildingKeyOf(p) {
  return [p.builtYM || '', p.totalFloors ?? '', p.stations || '', buildingNameOf(p.name).slice(0, 4)].join('|');
}

function v1ToV2(d) {
  const buildings = [];
  const rooms = [];
  const byKey = new Map();

  for (const p of d.properties || []) {
    const key = buildingKeyOf(p);
    let b = byKey.get(key);
    if (!b) {
      b = {
        id: `b${buildings.length + 1}`,
        name: buildingNameOf(p.name),
        address: '', lat: null, lng: null,
        builtYM: p.builtYM || '',
        totalFloors: p.totalFloors ?? null,
        stations: p.stations || '',
        walk: p.walk || '',
        amenities: '', memo: '',
        images: [],
      };
      buildings.push(b);
      byKey.set(key, b);
    }

    rooms.push({
      id: p.id,
      buildingId: b.id,
      label: p.floor ? `${p.floor}階` : `部屋${rooms.length + 1}`,
      status: p.status || '検討中',
      rating: p.rating || 0,
      listingStatus: '募集中', listedAt: null, closedAt: null, priceHistory: [],
      price: p.price ?? null,
      area: p.area ?? null,
      layout: p.layout || '',
      floor: p.floor ?? null,
      balcony: p.balcony ?? null,
      kanrihi: p.kanrihi ?? null,
      shuzen: p.shuzen ?? null,
      // v1 のローン欄は掲載サイトの表示値だった。自前計算に移行するため参考値として残す
      refMonthly: p.monthlyTotal ?? null,
      refLoanPrincipal: p.loanPrincipal ?? null,
      refLoanInterest: p.loanInterest ?? null,
      loan: null,                 // null なら settings.loan（共通条件）を使う
      reform: p.reform || '',
      viewNote: p.viewNote || '',
      roomNote: p.roomNote || '',
      imageRange: p.imageRange || '',
      url: '',
      memo: p.memo || '',
      cover: p.cover || null,
      coverThumb: p.coverThumb || null,
      images: p.images || [],
    });
  }

  return { schemaVersion: 2, updatedAt: d.updatedAt || null, settings: {}, buildings, rooms };
}
