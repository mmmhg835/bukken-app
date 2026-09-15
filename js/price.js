// 価格の推移と販売活動の分析。
// 掲載開始からの値下げ履歴を持たせ、販売期間・改定回数・改定幅を算出する。
import { TSUBO_SQM } from './util.js';

export const LISTING_STATUS = ['募集中', '商談中', '募集終了', '成約'];
/** 募集が終わったとみなす状態。販売期間の終端を確定させる */
export const CLOSED_STATUS = ['募集終了', '成約'];

export const today = () => new Date().toISOString().slice(0, 10);

/** 'YYYY-MM-DD' の差を日数で返す */
export function daysBetween(from, to) {
  if (!from || !to) return null;
  const a = Date.parse(from), b = Date.parse(to);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 864e5);
}

export function formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${y}年${Number(m)}月${Number(day)}日`;
}

/** 日付順に並べた価格履歴（日付が入っている行のみ） */
export function sortedHistory(room) {
  return (room.priceHistory || [])
    .filter((h) => h.date && h.price != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 販売活動の指標をまとめて返す。
 * 履歴が無い場合も現在価格だけは埋めて、画面側で分岐を減らす。
 */
export function analyze(room) {
  const h = sortedHistory(room);
  const area = Number(room.area) || null;
  const tsubo = area ? area / TSUBO_SQM : null;
  const perTsubo = (p) => (p != null && tsubo ? p / tsubo : null);

  const initial = h.length ? h[0].price : (room.price ?? null);
  const current = h.length ? h[h.length - 1].price : (room.price ?? null);
  const closed = CLOSED_STATUS.includes(room.listingStatus);
  const endDate = closed ? (room.closedAt || null) : today();

  // 初回の値下げ（2点目）までにかかった日数と下げ幅
  const firstChange = h.length > 1
    ? { days: daysBetween(h[0].date, h[1].date), amount: h[1].price - h[0].price, date: h[1].date }
    : null;

  return {
    history: h,
    initial, current,
    initialPerTsubo: perTsubo(initial),
    currentPerTsubo: perTsubo(current),
    changeCount: Math.max(0, h.length - 1),
    totalChange: initial != null && current != null ? current - initial : null,
    changeRate: initial ? ((current - initial) / initial) * 100 : null,
    firstChange,
    listedAt: room.listedAt || (h[0]?.date ?? null),
    endDate,
    closed,
    // 募集中なら今日まで、終了していれば終了日まで
    salesDays: daysBetween(room.listedAt || h[0]?.date, endDate),
    lastUpdate: h.length ? h[h.length - 1].date : null,
  };
}

/** 履歴の最新価格を room.price に反映する（表や計算はすべて price を見ている） */
export function syncPrice(room) {
  const h = sortedHistory(room);
  if (h.length) room.price = h[h.length - 1].price;
  return room.price;
}
