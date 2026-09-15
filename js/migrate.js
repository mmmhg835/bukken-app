// properties.json のスキーマ移行。
// v1 は「物件」の平坦な配列だったが、同じ建物の別部屋が重複して登録されるため
// v2 で「建物（buildings）」と「部屋（rooms）」に分けた。
import { DEFAULT_TERMS } from './loan.js';

export const CURRENT_SCHEMA = 3;

export function migrate(data) {
  let d = structuredClone(data);
  if (!d.schemaVersion || d.schemaVersion < 2) d = v1ToV2(d);
  if (d.schemaVersion < 3) d = v2ToV3(d);
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
