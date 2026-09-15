// 貼り付け取り込みの解析を検証する。
// 掲載サイトごとに見出しの言い回しと区切り方が違うため、実際のコピー形式を並べて
// 「どのサイトから貼っても同じ項目に入る」ことを確かめる。
// 使い方: node tools/verify-parse.mjs
import {
  parseListing, parseMan, parseFee, parseYM, parseDate,
  parseLayout, parseFloor, parseTotalFloors, parseTransport, detectTags, detectRenovation,
} from '../js/parse.js';

let bad = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { bad++; console.log(`❌ ${name}\n   期待 ${JSON.stringify(want)}\n   実際 ${JSON.stringify(got)}`); }
  return ok;
};

/* ===== 値の読み取り ===== */
eq('価格 1億6,500万円', parseMan('1億6,500万円'), 16500);
eq('価格 9,800万円', parseMan('9,800万円'), 9800);
eq('価格 1.65億円', parseMan('1.65億円'), 16500);
eq('価格 1億円', parseMan('1億円'), 10000);
eq('価格 単位なし', parseMan('16500'), 16500);
eq('価格 未定', parseMan('未定'), null);
eq('管理費 23,000円/月', parseFee('23,000円/月'), 2.3);
eq('管理費 2.3万円', parseFee('2.3万円'), 2.3);
eq('管理費 単位なし', parseFee('23000'), 2.3);
eq('築年月 2005年2月', parseYM('2005年2月'), '2005/02');
eq('築年月 2005/2', parseYM('2005/2'), '2005/02');
eq('登録日 2026年5月24日', parseDate('2026年5月24日'), '2026-05-24');
eq('登録日 2026/5/24', parseDate('2026/5/24'), '2026-05-24');
eq('間取り 3LDK', parseLayout('3LDK'), '3LDK');
eq('間取り 2SLDK', parseLayout('2SLDK'), '2SLDK');
eq('間取り ワンルーム', parseLayout('ワンルーム'), '1R');
// 総階数を所在階と取り違えないこと（実際に混ざりやすい）
eq('所在階 46階/RC54階地下1階建', parseFloor('46階/RC54階地下1階建'), 46);
eq('総階数 46階/RC54階地下1階建', parseTotalFloors('46階/RC54階地下1階建'), 54);
eq('所在階 地上表記は拾わない', parseFloor('地上45階地下1階建'), null);
eq('総階数 45階建', parseTotalFloors('地上45階地下1階建'), 45);
eq('交通', parseTransport('東京メトロ有楽町線「辰巳」歩7分、りんかい線「東雲」歩12分'),
  { stations: '辰巳 / 東雲', walk: '辰巳7分・東雲12分' });
eq('交通 駅名直書き', parseTransport('辰巳駅より徒歩7分'), { stations: '辰巳', walk: '辰巳7分' });
eq('リノベ フル', detectRenovation('2026年6月フルリノベーション済'), 'フルリノベ');
eq('リノベ 一部', detectRenovation('水回りリフォーム済'), '一部リノベ');
eq('リノベ なし', detectRenovation('現況渡し'), null);

/* ===== SUUMO 形式（表をコピーするとタブ区切りになる） ===== */
const suumo = `
物件名	Wコンフォートタワーズ イースト
価格	1億5,980万円
所在地	東京都江東区東雲1丁目9-10
交通	東京メトロ有楽町線「辰巳」歩7分
間取り	3LDK
専有面積	109.12m2（壁芯）
バルコニー面積	17.08m2
所在階/構造・階建	46階/RC54階地下1階建
築年月	2004年10月
管理費	23,000円/月
修繕積立金	21,000円/月
総戸数	424戸
土地権利	所有権
用途地域	準工
情報公開日	2026年5月24日
設備：オートロック、宅配ボックス、ディスポーザー、食器洗い乾燥機、床暖房
https://suumo.jp/ms/chuko/tokyo/sc_koto/nc_00000000/
`;

const a = parseListing(suumo);
const pick = (res, on, key) => res.items.find((i) => i.on === on && i.key === key)?.value ?? null;

eq('SUUMO 建物名', pick(a, 'building', 'name'), 'Wコンフォートタワーズ イースト');
eq('SUUMO 価格', pick(a, 'room', 'price'), 15980);
eq('SUUMO 住所', pick(a, 'building', 'address'), '東京都江東区東雲1丁目9-10');
eq('SUUMO 最寄駅', pick(a, 'building', 'stations'), '辰巳');
eq('SUUMO 駅徒歩', pick(a, 'building', 'walk'), '辰巳7分');
eq('SUUMO 間取り', pick(a, 'room', 'layout'), '3LDK');
eq('SUUMO 専有面積', pick(a, 'room', 'area'), 109.12);
eq('SUUMO バルコニー', pick(a, 'room', 'balcony'), 17.08);
eq('SUUMO 所在階', pick(a, 'room', 'floor'), 46);
eq('SUUMO 建物階数', pick(a, 'building', 'totalFloors'), 54);
eq('SUUMO 構造', pick(a, 'building', 'structureNote'), 'RC54階地下1階建');
eq('SUUMO 築年月', pick(a, 'building', 'builtYM'), '2004/10');
eq('SUUMO 管理費', pick(a, 'room', 'kanrihi'), 2.3);
eq('SUUMO 修繕積立金', pick(a, 'room', 'shuzen'), 2.1);
eq('SUUMO 総戸数', pick(a, 'building', 'totalUnits'), 424);
eq('SUUMO 登録日', pick(a, 'room', 'listedAt'), '2026-05-24');
eq('SUUMO 部屋の呼び名', pick(a, 'room', 'label'), '46階');
eq('SUUMO URL', a.url, 'https://suumo.jp/ms/chuko/tokyo/sc_koto/nc_00000000/');

const tagOf = (res, key) => res.tags.find((t) => t.key === key)?.tags ?? [];
eq('SUUMO 建物の設備', tagOf(a, 'equipmentTags'), ['ディスポーザー']);
eq('SUUMO 部屋の設備', tagOf(a, 'roomEquipmentTags'), ['食洗機', '床暖房']);
eq('SUUMO 共用施設', tagOf(a, 'facilityTags'), ['オートロック', '宅配ボックス']);

/* ===== 「見出し：値」形式（マンションレビュー等） ===== */
const colon = `
マンション名：アップルタワー東京キャナルコート
所在地：東京都江東区東雲1-9-22
交通：りんかい線「東雲」駅 徒歩10分
築年月：2007年2月
総戸数：620戸
構造：RC造 地上44階地下1階建
管理会社：三井不動産レジデンシャルサービス
管理形態：日勤
価格：1億3,980万円
専有面積：87.55m2
間取り：3LDK
所在階：29階
管理費：19,800円
修繕積立金：15,400円
フルリノベーション済み
共用施設：ラウンジ、ジム、ゲストルーム、キッズルーム
`;

const b = parseListing(colon);
eq('コロン 建物名', pick(b, 'building', 'name'), 'アップルタワー東京キャナルコート');
eq('コロン 住所', pick(b, 'building', 'address'), '東京都江東区東雲1-9-22');
eq('コロン 最寄駅', pick(b, 'building', 'stations'), '東雲');
eq('コロン 駅徒歩', pick(b, 'building', 'walk'), '東雲10分');
eq('コロン 築年月', pick(b, 'building', 'builtYM'), '2007/02');
eq('コロン 建物階数', pick(b, 'building', 'totalFloors'), 44);
eq('コロン 管理会社', pick(b, 'building', 'managementCompany'), '三井不動産レジデンシャルサービス');
eq('コロン 管理方式', pick(b, 'building', 'managementType'), '日勤');
eq('コロン 価格', pick(b, 'room', 'price'), 13980);
eq('コロン 所在階', pick(b, 'room', 'floor'), 29);
eq('コロン 管理費', pick(b, 'room', 'kanrihi'), 1.98);
eq('コロン リノベ区分', pick(b, 'room', 'renovation'), 'フルリノベ');
// タグは本文の並びではなく spec.js の並びで返す（画面の並びと一致させるため）
eq('コロン 共用施設', tagOf(b, 'facilityTags'), ['ゲストルーム', 'ラウンジ', 'ジム', 'キッズルーム']);

/* ===== 保存先の無い項目は捨てずに残す ===== */
const left = parseListing('主要採光面：南東\n現況：空家\n引渡し：相談');
eq('取り込み先なし', left.leftovers.map((l) => l.label), ['主要採光面', '現況', '引渡し']);

/* ===== 空文字・ゴミを渡しても落ちないこと ===== */
for (const junk of ['', '   ', '\n\n', 'あいうえお', '価格', '：：：']) {
  try {
    const r = parseListing(junk);
    if (!Array.isArray(r.items)) throw new Error('items が配列でない');
  } catch (e) { bad++; console.log(`❌ 異常入力 ${JSON.stringify(junk)} : ${e.message}`); }
}

console.log(bad ? `\n${bad} 件の問題` : '\n✅ すべて通過');
process.exit(bad ? 1 : 0);
