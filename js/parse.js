// 掲載ページから貼り付けたテキストを、建物・部屋の項目に起こす。
//
// 手入力が続くと結局データが埋まらないため、掲載ページの表をそのままコピーして
// 貼れば大半の項目が入る状態にする。DOM には触らない純関数だけを置き、
// tools/verify-parse.mjs から直接呼んで検証できるようにしている。
import { BUILDING_EQUIPMENT, BUILDING_STRUCTURE, SHARED_FACILITIES, ROOM_EQUIPMENT } from './spec.js';

/* =========================================================
   値の読み取り
   ========================================================= */

/**
 * 全角を半角に、表記ゆれを吸収する。
 * NFKC は ㎡ を m2、１ を 1 に直してくれるので、単位や数字の分岐を減らせる。
 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[〜～]/g, '~')
    .replace(/[ \t　]+$/gm, '');
}

/** 「1億6,500万円」「9800万円」「16500」→ 万円 */
export function parseMan(s) {
  const t = String(s).replace(/,/g, '');
  if (/(未定|応談|要問|non|—|ー)/i.test(t) && !/\d/.test(t)) return null;
  const oku = t.match(/([\d.]+)\s*億/);
  const man = t.match(/([\d.]+)\s*万/);
  if (oku || man) return round2((oku ? Number(oku[1]) * 10000 : 0) + (man ? Number(man[1]) : 0));
  const yen = t.match(/([\d,]*[\d.]+)\s*円/);
  if (yen) return round2(Number(yen[1]) / 10000);
  const bare = t.match(/([\d.]+)/);
  return bare ? round2(Number(bare[1])) : null;   // 単位が無ければ万円とみなす
}

/**
 * 管理費・修繕積立金。単位が無いときは「円」とみなす。
 * 価格と逆の既定にしているのは、掲載ページで管理費が円表記のことが多いため。
 */
export function parseFee(s) {
  const t = String(s).replace(/,/g, '');
  const man = t.match(/([\d.]+)\s*万/);
  if (man) return round2(Number(man[1]));
  const yen = t.match(/([\d.]+)/);
  if (!yen) return null;
  const v = Number(yen[1]);
  return round2(/円/.test(t) || v >= 1000 ? v / 10000 : v);
}

/** 「113.02m2（壁芯）」→ 113.02 */
export function parseNum(s) {
  const m = String(s).replace(/,/g, '').match(/-?[\d.]+/);
  if (!m) return null;
  const v = Number(m[0]);
  return isNaN(v) ? null : v;
}

/** 「2005年2月」「2005/2」→ '2005/02' */
export function parseYM(s) {
  const t = String(s).replace(/,/g, '');
  const m = t.match(/(\d{4})\s*[年/.\-]\s*(\d{1,2})/);
  if (m) return `${m[1]}/${String(Number(m[2])).padStart(2, '0')}`;
  const y = t.match(/(\d{4})\s*年/);
  return y ? `${y[1]}/01` : null;
}

/** 「2026年5月24日」「2026/5/24」→ '2026-05-24' */
export function parseDate(s) {
  const m = String(s).match(/(\d{4})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})/);
  if (!m) return null;
  const pad = (v) => String(Number(v)).padStart(2, '0');
  return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
}

/** 「3LDK」「2SLDK」「ワンルーム」 */
export function parseLayout(s) {
  const t = normalize(s);
  if (/ワンルーム/.test(t)) return '1R';
  const m = t.match(/(\d+)\s*([SLDKR]{1,4})/i);
  return m ? `${m[1]}${m[2].toUpperCase()}` : null;
}

/** 「45階建」「地上45階地下1階建」→ 45 */
export function parseTotalFloors(s) {
  const t = String(s);
  const m = t.match(/(?:地上)?(\d+)\s*階\s*(?:地下\s*\d+\s*階)?\s*建/);
  return m ? Number(m[1]) : null;
}

/** 「39階/45階建」→ 39。総階数の側を所在階と取り違えないよう、区切りの手前だけを見る */
export function parseFloor(s) {
  const head = String(s).split(/[/／]/)[0];
  if (/地上|地下/.test(head)) return null;
  const m = head.match(/(-?\d+)\s*階/);
  return m ? Number(m[1]) : null;
}

const round2 = (v) => (v == null || isNaN(v) ? null : Math.round(v * 1e4) / 1e4);

/* =========================================================
   交通（路線・駅・徒歩分）
   ========================================================= */

/**
 * 「東京メトロ有楽町線「辰巳」徒歩7分」から駅名と分数を取り出す。
 * 分析側（walkMinutesOf）が「辰巳7分・東雲12分」の形を読むので、それに合わせて組み立てる。
 */
export function parseTransport(text) {
  const t = normalize(text);
  const hits = [];
  const push = (name, min) => {
    const n = name.replace(/駅$/, '').trim();
    if (n && !hits.some((h) => h.name === n)) hits.push({ name: n, min: Number(min) });
  };
  // 「東雲」駅 徒歩10分 のように、括弧の後ろに「駅」や空白が入る書き方もある
  for (const m of t.matchAll(/「([^」]{1,12})」\s*駅?\s*(?:より|から)?\s*(?:徒歩|歩)\s*(\d+)\s*分/g)) push(m[1], m[2]);
  for (const m of t.matchAll(/([^\s/／「」・,、]{1,12}?)駅\s*(?:より|から)?\s*(?:徒歩|歩)\s*(\d+)\s*分/g)) push(m[1], m[2]);
  if (!hits.length) return null;
  return {
    stations: hits.map((h) => h.name).join(' / '),
    walk: hits.map((h) => `${h.name}${h.min}分`).join('・'),
  };
}

/* =========================================================
   項目の定義
   ========================================================= */

/**
 * 掲載ページの見出し → 保存先。
 * label は完全一致で引くので、サイトごとの言い回しをすべて並べる。
 * 同じ保存先に複数の見出しが向くのは想定どおり（先に見つかったものを採る）。
 */
const FIELDS = [
  // ===== 部屋 =====
  ['価格', 'room', 'price', '価格（万円）', parseMan],
  ['販売価格', 'room', 'price', '価格（万円）', parseMan],
  ['物件価格', 'room', 'price', '価格（万円）', parseMan],
  ['専有面積', 'room', 'area', '専有面積（㎡）', parseNum],
  ['面積', 'room', 'area', '専有面積（㎡）', parseNum],
  ['間取り', 'room', 'layout', '間取り', parseLayout],
  ['間取', 'room', 'layout', '間取り', parseLayout],
  ['バルコニー面積', 'room', 'balcony', 'バルコニー（㎡）', parseNum],
  ['バルコニー', 'room', 'balcony', 'バルコニー（㎡）', parseNum],
  ['管理費', 'room', 'kanrihi', '管理費（万円/月）', parseFee],
  ['修繕積立金', 'room', 'shuzen', '修繕積立金（万円/月）', parseFee],
  ['修繕積立費', 'room', 'shuzen', '修繕積立金（万円/月）', parseFee],
  // SUUMO・at home は所在階と構造・階建てを1つの見出しにまとめている
  ['所在階/構造・階建', 'room', 'floor', '所在階', parseFloor],
  ['所在階/構造・階建て', 'room', 'floor', '所在階', parseFloor],
  ['所在階/階数', 'room', 'floor', '所在階', parseFloor],
  ['所在階', 'room', 'floor', '所在階', parseFloor],
  ['階', 'room', 'floor', '所在階', parseFloor],
  ['情報公開日', 'room', 'listedAt', '登録日', parseDate],
  ['情報登録日', 'room', 'listedAt', '登録日', parseDate],
  ['情報提供日', 'room', 'listedAt', '登録日', parseDate],
  ['登録日', 'room', 'listedAt', '登録日', parseDate],
  ['掲載日', 'room', 'listedAt', '登録日', parseDate],
  ['リフォーム', 'room', 'reform', 'リフォーム', String],
  ['リフォーム・リノベーション', 'room', 'reform', 'リフォーム', String],
  ['部屋番号', 'room', 'label', '部屋の呼び名', String],

  // ===== 建物 =====
  ['物件名', 'building', 'name', '建物名', String],
  ['マンション名', 'building', 'name', '建物名', String],
  ['建物名', 'building', 'name', '建物名', String],
  ['名称', 'building', 'name', '建物名', String],
  ['所在地', 'building', 'address', '住所', String],
  ['住所', 'building', 'address', '住所', String],
  ['交通', 'building', 'transport', '交通', String],
  ['交通機関', 'building', 'transport', '交通', String],
  ['アクセス', 'building', 'transport', '交通', String],
  ['最寄駅', 'building', 'transport', '交通', String],
  ['築年月', 'building', 'builtYM', '築年月', parseYM],
  ['完成時期', 'building', 'builtYM', '築年月', parseYM],
  ['完成年月', 'building', 'builtYM', '築年月', parseYM],
  ['竣工', 'building', 'builtYM', '築年月', parseYM],
  ['竣工年月', 'building', 'builtYM', '築年月', parseYM],
  ['建築年月', 'building', 'builtYM', '築年月', parseYM],
  ['総戸数', 'building', 'totalUnits', '総戸数', parseNum],
  ['構造・階建て', 'building', 'structureNote', '構造', String],
  ['構造・階建', 'building', 'structureNote', '構造', String],
  ['構造', 'building', 'structureNote', '構造', String],
  ['建物構造', 'building', 'structureNote', '構造', String],
  ['階建て', 'building', 'floorsNote', '階建て', String],
  ['階建', 'building', 'floorsNote', '階建て', String],
  ['管理会社', 'building', 'managementCompany', '管理会社', String],
  ['管理形態', 'building', 'managementType', '管理方式', String],
  ['管理方式', 'building', 'managementType', '管理方式', String],
  ['管理員', 'building', 'managementType', '管理方式', String],
  ['土地権利', 'building', 'landRight', '土地権利', String],
  ['権利形態', 'building', 'landRight', '土地権利', String],
  ['敷地の権利形態', 'building', 'landRight', '土地権利', String],
  ['用途地域', 'building', 'zoning', '用途地域', String],
  ['敷地面積', 'building', 'siteArea', '敷地面積（㎡）', parseNum],
  ['延床面積', 'building', 'totalFloorArea', '延床面積（㎡）', parseNum],
  ['建ぺい率', 'building', 'buildingCoverage', '建ぺい率', String],
  ['容積率', 'building', 'floorAreaRatio', '容積率', String],
  ['天井高', 'building', 'ceilingHeight', '天井高', String],
  ['分譲会社', 'building', 'developer', '分譲会社', String],
  ['売主', 'building', 'developer', '分譲会社', String],
  ['事業主', 'building', 'developer', '分譲会社', String],
  ['施工会社', 'building', 'builder', '施工会社', String],
  ['施工', 'building', 'builder', '施工会社', String],
  ['設計会社', 'building', 'designer', '設計会社', String],
  ['小学校区', 'building', 'elementarySchool', '小学校区', String],
  ['中学校区', 'building', 'juniorHighSchool', '中学校区', String],
];

const FIELD_BY_LABEL = new Map();
for (const [label, on, key, title, parse] of FIELDS) {
  if (!FIELD_BY_LABEL.has(label)) FIELD_BY_LABEL.set(label, { on, key, title, parse });
}

/** 見出しの並び順。長い見出しを先に試して「階」が「階建て」を食うのを防ぐ */
const LABELS = [...FIELD_BY_LABEL.keys()].sort((a, b) => b.length - a.length);

/* =========================================================
   設備タグ
   ========================================================= */

/**
 * 掲載ページの言い回し → spec.js のタグ。
 * 自由記述で持つと表記ゆれで比較できなくなるため、必ずタグに寄せる。
 */
const TAG_ALIASES = {
  '食洗機': ['食器洗い乾燥機', '食器洗浄機', '食洗器', 'ディッシュウォッシャー'],
  'SIC': ['シューズインクローゼット', 'シューズインクローク', 'シューズクローク', 'SIC'],
  '角部屋': ['角住戸', '角部屋'],
  'ビルトインエアコン': ['ビルトインエアコン', '天井埋込エアコン'],
  '24時間ゴミ出し': ['24時間ゴミ出し', '24時間ごみ出し', 'ゴミ出し24時間'],
  '各階ゴミ置き場': ['各階ゴミ置場', '各階ゴミ置き場', '各階ごみ置場'],
  '宅配ボックス': ['宅配ボックス', '宅配BOX'],
  'コンシェルジュ': ['コンシェルジュ', 'コンシェルジェ'],
  '24時間有人管理': ['24時間有人管理', '24時間管理', '住込'],
  '機械式駐車場': ['機械式駐車場', '機械式駐車'],
  '平置き駐車場': ['平置き駐車場', '平面駐車場'],
  'EV用充電器': ['EV用充電器', 'EV充電', '電気自動車充電'],
  '二重床': ['二重床'],
  '二重天井': ['二重天井'],
  'アウトフレーム設計': ['アウトフレーム'],
  '外壁タイル貼り': ['タイル貼り', 'タイル張り'],
};

const TAG_GROUPS = [
  ['room', 'roomEquipmentTags', ROOM_EQUIPMENT],
  ['building', 'equipmentTags', BUILDING_EQUIPMENT],
  ['building', 'structureTags', BUILDING_STRUCTURE],
  ['building', 'facilityTags', SHARED_FACILITIES],
];

/** 本文中に出てくる設備をタグとして拾う */
export function detectTags(text) {
  const t = normalize(text);
  const out = [];
  for (const [on, key, options] of TAG_GROUPS) {
    const found = options.filter((tag) =>
      (TAG_ALIASES[tag] || [tag]).some((alias) => t.includes(alias)));
    if (found.length) out.push({ on, key, tags: found });
  }
  return out;
}

/** リノベ区分。価格差の理由になるので、自由記述とは別に区分として持つ */
export function detectRenovation(text) {
  const t = normalize(text);
  if (/(フルリノベ|フルリフォーム|全面リノベ|全面リフォーム|スケルトン)/.test(t)) return 'フルリノベ';
  if (/(リノベーション|リフォーム済|リフォーム済み)/.test(t)) return '一部リノベ';
  return null;
}

/* =========================================================
   本文の分解
   ========================================================= */

/**
 * 「見出し 値」の組を取り出す。
 * 掲載ページの表をコピーするとタブ区切りで1行に複数組が並ぶことがあるため、
 * 行 → セル → 見出し判定 の順に降りていく。
 */
export function pairs(text) {
  const out = [];
  const add = (label, value) => {
    const v = String(value ?? '').trim().replace(/^[：:\-ー]\s*/, '');
    if (label && v && v !== '-' && v !== '—') out.push({ label: label.trim(), value: v });
  };

  for (const line of normalize(text).split('\n')) {
    const row = line.trim();
    if (!row) continue;

    // 1) タブ・全角スペース2つ以上で区切られた表形式
    const cells = row.split(/\t|　{2,}| {3,}/).map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      for (let i = 0; i < cells.length - 1; i++) {
        const label = matchLabel(cells[i]);
        if (label) { add(label, cells[i + 1]); i++; }
      }
      if (cells.some((c) => matchLabel(c))) continue;
    }

    // 2) 「見出し：値」
    const colon = row.match(/^(.{1,14}?)\s*[：:]\s*(.+)$/);
    if (colon && matchLabel(colon[1])) { add(matchLabel(colon[1]), colon[2]); continue; }

    // 3) 行頭が見出しで、そのまま値が続く（「価格 16500万円」）
    const head = LABELS.find((l) => row.startsWith(l) && row.length > l.length);
    if (head) { add(head, row.slice(head.length)); continue; }
  }
  return out;
}

/** セルが見出しそのものかを見る。「価格」「価格 」「価格：」を同じものとして扱う */
function matchLabel(cell) {
  const c = String(cell).trim().replace(/[：:]\s*$/, '');
  return FIELD_BY_LABEL.has(c) ? c : null;
}

/* =========================================================
   取り込み結果の組み立て
   ========================================================= */

/**
 * 貼り付けたテキストから取り込み候補を組み立てる。
 * 画面側が「どれを取り込むか」を選べるよう、値そのものではなく候補の配列を返す。
 *
 * @returns {{items: Array, tags: Array, url: string|null, leftovers: Array}}
 *   items … {on, key, title, value, raw}
 *   tags  … {on, key, tags}
 *   leftovers … 保存先の無い「見出し 値」。メモに送れるよう残す
 */
export function parseListing(text) {
  const src = normalize(text);
  const items = [];
  const seen = new Set();

  for (const { label, value } of pairs(src)) {
    const def = FIELD_BY_LABEL.get(label);
    if (!def) continue;
    const parsed = def.parse === String ? value.trim() : def.parse(value);
    if (parsed === null || parsed === '' || parsed === undefined) continue;

    const id = `${def.on}.${def.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ on: def.on, key: def.key, title: def.title, value: parsed, raw: value });

    // 1つの記載から複数の項目が起きるもの
    if (def.key === 'transport') {
      const t = parseTransport(value);
      if (t) {
        addOnce(items, seen, { on: 'building', key: 'stations', title: '最寄駅', value: t.stations, raw: value });
        addOnce(items, seen, { on: 'building', key: 'walk', title: '駅徒歩', value: t.walk, raw: value });
      }
    }
    if (def.key === 'structureNote' || def.key === 'floorsNote') {
      const n = parseTotalFloors(value);
      if (n) addOnce(items, seen, { on: 'building', key: 'totalFloors', title: '建物階数', value: n, raw: value });
    }
    if (def.key === 'floor') {
      const n = parseTotalFloors(value);
      if (n) addOnce(items, seen, { on: 'building', key: 'totalFloors', title: '建物階数', value: n, raw: value });
      addOnce(items, seen, { on: 'room', key: 'label', title: '部屋の呼び名', value: `${parsed}階`, raw: value });
      // 「46階/RC54階地下1階建」のように、区切りの後ろは建物の構造
      const rest = value.split(/[/／]/).slice(1).join('/').trim();
      if (rest && /階建|造|RC|SRC/i.test(rest)) {
        addOnce(items, seen, { on: 'building', key: 'structureNote', title: '構造', value: rest, raw: value });
      }
    }
  }

  // 見出しに現れない情報は本文から拾う
  if (!seen.has('building.transport')) {
    const t = parseTransport(src);
    if (t) {
      addOnce(items, seen, { on: 'building', key: 'stations', title: '最寄駅', value: t.stations, raw: '本文' });
      addOnce(items, seen, { on: 'building', key: 'walk', title: '駅徒歩', value: t.walk, raw: '本文' });
    }
  }
  const reno = detectRenovation(src);
  if (reno) addOnce(items, seen, { on: 'room', key: 'renovation', title: 'リノベ区分', value: reno, raw: '本文' });

  const url = (src.match(/https?:\/\/[^\s"'<>）)]+/) || [])[0] || null;
  if (url) addOnce(items, seen, { on: 'room', key: 'url', title: '掲載ページのURL', value: url, raw: url });

  const tags = detectTags(src);
  return { items, tags, url, leftovers: leftovers(src, tags) };
}

function addOnce(items, seen, item) {
  const id = `${item.on}.${item.key}`;
  if (seen.has(id)) return;
  seen.add(id);
  items.push(item);
}

/**
 * 保存先が無い「見出し 値」。捨てずにメモへ送れるようにしておく。
 * 項目を増やすかどうかは、実際に何が余るかを見てから決めたい。
 * すでにタグとして拾った設備の行や URL は、二重に持つことになるので外す。
 */
function leftovers(text, tags = []) {
  const taken = tags.flatMap((g) => g.tags);
  const out = [];
  for (const line of text.split('\n')) {
    const row = line.trim();
    if (!row || row.length > 60) continue;
    if (/^https?:/i.test(row)) continue;
    const m = row.match(/^(.{2,12}?)\s*[：:\t]\s*(.+)$/);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    if (FIELD_BY_LABEL.has(label) || !value) continue;
    // 見出しが日本語でない行は、URL や英文の断片であることが多い
    if (!/[ぁ-んァ-ヶ一-龥]/.test(label)) continue;
    if (taken.some((t) => value.includes(t))) continue;
    if (out.some((o) => o.label === label)) continue;
    out.push({ label, value });
  }
  return out.slice(0, 20);
}
