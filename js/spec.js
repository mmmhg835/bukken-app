// 建物・部屋のスペック項目。チェックだけで記録できるようにして、内見後の記憶頼みを避ける。

/** 建物の構造。耐震性能は後から調べ直すのが面倒なので建物側に持たせる */
export const BUILDING_STRUCTURE = [
  '免震', '制震', '耐震', '二重床', '二重天井', 'アウトフレーム設計', '断熱構造', '外壁タイル貼り',
];

/** 共用施設（使える場所） */
export const SHARED_FACILITIES = [
  '機械式駐車場', '平置き駐車場', '来客用駐車場', '身障者用駐車場', '駐輪場', 'バイク置場',
  'ゲストルーム', 'パーティールーム', 'キッチンルーム', 'バー', 'ラウンジ',
  'ジム', 'プール', 'スパ', 'サウナ', '温泉', 'セラピールーム',
  'キッズルーム', 'スタディルーム', 'コンビニ', 'カフェ',
];

/** 共用設備（建物の備え） */
export const SHARED_EQUIPMENT = [
  'オートロック', 'ダブルオートロック', 'トリプルオートロック', 'セキュリティシステム',
  '宅配ボックス', '防犯カメラ', '24時間対応ゴミ置場', '24時間有人管理',
  'コンシェルジュ', '内廊下', '免震ラウンジ', '非常用発電機', 'EV用充電器',
];

/**
 * 専有設備は部屋側に持たせる。
 * リフォーム済みの住戸だけ食洗機がある、といった差が実際に出るため。
 */
export const ROOM_EQUIPMENT = [
  '複層ガラス', 'ハイサッシ', 'フラットフロア', '床暖房', 'ビルトインエアコン',
  'ディスポーザー', '食洗機', 'カウンターキッチン', 'ミストサウナ',
  '浴室暖房乾燥機', '浴室乾燥機', 'オートバスシステム', '追い焚き',
  'モニター付インターホン', 'トランクルーム',
  'ウォークインクローゼット', 'シューズインクローゼット', '24時間換気',
  '角住戸', 'ルーフバルコニー', '専用庭', '納戸', '和室',
];

export const SPEC_GROUPS = {
  structureTags: { label: '建物構造', options: BUILDING_STRUCTURE, on: 'building' },
  facilityTags: { label: '共用施設', options: SHARED_FACILITIES, on: 'building' },
  equipmentTags: { label: '共用設備', options: SHARED_EQUIPMENT, on: 'building' },
  roomEquipmentTags: { label: '専有設備', options: ROOM_EQUIPMENT, on: 'room' },
};

/** 建物の入力欄。見出しごとにまとめて表示する */
export const BUILDING_FORM = [
  ['基本情報', [
    ['name', '建物名', 'text', true],
    ['address', '住所', 'text', true],
    ['transport', '交通（路線・駅・徒歩分）', 'textarea'],
    ['stations', '最寄駅', 'text'],
    ['walk', '駅徒歩', 'text'],
    ['url', '参考URL（マンションレビュー等）', 'text', true],
  ]],
  ['規模・構造', [
    ['builtYM', '築年月（例 2008/12）', 'text'],
    ['totalFloors', '建物階数', 'number'],
    ['floorsNote', '階建て（例 地下1階付33階建）', 'text'],
    ['totalUnits', '総戸数', 'number'],
    ['structureNote', '構造（例 RC一部S）', 'text'],
    ['ceilingHeight', '天井高（例 約210〜370cm）', 'text'],
    ['direction', '主方位', 'text'],
    ['siteArea', '敷地面積（㎡）', 'number'],
    ['totalFloorArea', '延床面積（㎡）', 'number'],
    ['buildingCoverage', '建ぺい率', 'text'],
    ['floorAreaRatio', '容積率', 'text'],
    ['parkingCount', '駐車場数', 'number'],
  ]],
  ['管理・権利', [
    ['managementType', '管理方式（例 日勤）', 'text'],
    ['managementCompany', '管理会社', 'text'],
    ['kanrihiRef', '管理費の目安（円/70㎡）', 'number'],
    ['shuzenRef', '修繕積立金の目安（円/70㎡）', 'number'],
    ['landRight', '土地権利（例 所有権）', 'text'],
    ['zoning', '用途地域', 'text'],
  ]],
  ['事業者', [
    ['developer', '分譲会社', 'text'],
    ['builder', '施工会社', 'text'],
    ['designer', '設計会社', 'text'],
    ['brand', 'ブランド', 'text'],
  ]],
  ['周辺・学区', [
    ['elementarySchool', '小学校区', 'text'],
    ['juniorHighSchool', '中学校区', 'text'],
    ['hazardNote', 'ハザードマップ・地盤メモ', 'textarea'],
    ['surroundings', '周辺施設（スーパー・病院・公園など）', 'textarea'],
    ['memo', '建物メモ', 'textarea'],
  ]],
];

/** 建物に新しく増えた項目の初期値 */
export function buildingDefaults() {
  const d = {};
  for (const [, fields] of BUILDING_FORM) {
    for (const [key, , type] of fields) d[key] ??= type === 'number' ? null : '';
  }
  for (const [key, g] of Object.entries(SPEC_GROUPS)) if (g.on === 'building') d[key] = [];
  return d;
}
