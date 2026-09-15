// 建物・部屋のスペック項目。チェックだけで記録できるようにして、内見後の記憶頼みを避ける。

/** 建物の構造。耐震性能は後から調べ直すのが面倒なので建物側に持たせる */
export const BUILDING_STRUCTURE = [
  '免震', '制震', '耐震', '二重床', '二重天井', 'アウトフレーム設計', '断熱構造', '外壁タイル貼り',
];

/**
 * 共用施設・設備。建物に備わっていて、部屋によらず共通のもの。
 * 「使える場所」と「建物の備え」を1つの表にまとめている。
 * 分けても入力の手間が増えるだけで、探すときはどちらも同じ感覚で見るため。
 */
export const FACILITY_SECTIONS = [
  ['セキュリティ・管理', ['オートロック', 'ダブルオートロック', '防犯カメラ', '宅配ボックス',
    'コンシェルジュ', '24時間有人管理', '内廊下', '非常用発電機']],
  ['駐車・駐輪', ['機械式駐車場', '平置き駐車場', '来客用駐車場', '身障者用駐車場',
    '駐輪場', 'バイク置場', 'EV用充電器']],
  ['共用スペース', ['ゲストルーム', 'パーティールーム', 'キッチンルーム', 'バー', 'ラウンジ',
    'ジム', 'プール', 'スパ', 'サウナ', '温泉', 'セラピールーム',
    'キッズルーム', 'スタディルーム', 'コンビニ', 'カフェ']],
];

export const SHARED_FACILITIES = FACILITY_SECTIONS.flatMap(([, list]) => list);

/**
 * 建物の設備。建物に備わっていて、どの部屋でも同じものだけを置く。
 * 選択肢を絞っているのは、数が多いと押すのが面倒になり結局入力されないため。
 */
export const BUILDING_EQUIPMENT = [
  'ディスポーザー', '24時間ゴミ出し', '各階ゴミ置き場', 'トランクルーム',
];

/** 部屋の設備。住戸ごとに有無が変わるものだけを置く */
export const ROOM_EQUIPMENT = [
  '食洗機', '床暖房', 'ビルトインエアコン', 'SIC', '角部屋', 'ルーフバルコニー',
];

/** リノベーションの状態。部屋ごとに持つ */
export const RENOVATION = ['なし', '一部リノベ', 'フルリノベ'];

export const SPEC_GROUPS = {
  equipmentTags: { label: '建物の設備', options: BUILDING_EQUIPMENT, on: 'building' },
  structureTags: { label: '建物構造', options: BUILDING_STRUCTURE, on: 'building' },
  facilityTags: { label: '共用施設・設備', options: SHARED_FACILITIES, on: 'building', sections: FACILITY_SECTIONS },
  roomEquipmentTags: { label: '部屋の設備', options: ROOM_EQUIPMENT, on: 'room' },
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
