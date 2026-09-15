// 汎用ユーティリティ（表示整形・自動計算・DOM補助）
export const TSUBO_SQM = 3.305785;          // 1坪 = 3.305785㎡
export const STATUSES = ['検討中', '内見済', '本命', '申込検討', '見送り'];
export const CATEGORIES = ['概要', '間取り', '眺望', 'LDK・居室', '水回り', '収納', 'その他'];

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));

/** 物件の派生値（坪単価・管理費合計・月額合計）を計算する */
export function derive(p) {
  const price = num(p.price), area = num(p.area);
  const kanri = num(p.kanrihi) ?? 0, shuzen = num(p.shuzen) ?? 0;
  const principal = num(p.loanPrincipal) ?? 0, interest = num(p.loanInterest) ?? 0;
  const kanriShuzen = kanri + shuzen;
  // 月額合計はシート入力値を優先し、無ければ ローン + 管理費 + 修繕積立金 で算出
  const monthly = num(p.monthlyTotal) ?? (principal + interest + kanriShuzen || null);
  return {
    tsubo: area ? area / TSUBO_SQM : null,
    tsuboPrice: price && area ? price / (area / TSUBO_SQM) : null,
    kanriShuzen: kanriShuzen || null,
    monthly,
    yearly: monthly != null ? monthly * 12 : null,
    ageYears: ageFromYM(p.builtYM),
  };
}

function ageFromYM(ym) {
  if (!ym) return null;
  const m = String(ym).match(/(\d{4})[/\-.年]?\s*(\d{1,2})?/);
  if (!m) return null;
  const built = new Date(Number(m[1]), (Number(m[2] || 1) - 1), 1);
  return Math.max(0, Math.floor((Date.now() - built) / (365.25 * 864e5)));
}

export const fmt = {
  man: (v) => (v == null ? '—' : Number(v).toLocaleString('ja-JP') + '万円'),
  man1: (v) => (v == null ? '—' : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 1 })),
  n: (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: d })),
  sqm: (v) => (v == null ? '—' : `${Number(v).toFixed(2)}㎡`),
  yen万: (v) => (v == null ? '—' : `${Number(v).toFixed(1)}万`),
  stars: (n) => '★'.repeat(n || 0) + '☆'.repeat(Math.max(0, 5 - (n || 0))),
};

export function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 2600);
}

export const uid = (prefix = 'x') =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
