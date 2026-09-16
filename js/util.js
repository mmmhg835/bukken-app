// 汎用ユーティリティ（表示整形・自動計算・DOM補助）
import { calcLoan, DEFAULT_TERMS } from './loan.js';

/** 表示用の版数。更新が届いているかを設定画面で確認できるようにしている */
export const APP_VERSION = 'v112';

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

/**
 * 部屋の派生値を計算する。
 * 保存はせず常にここで算出するため、条件を変えれば全物件に即反映される。
 * @param {object} r 部屋
 * @param {object} [building] 建物（築年数の算出に使う）
 * @param {object} [terms] ローン共通条件。部屋側に loan があればそちらが優先
 */
export function derive(r, building = null, terms = null) {
  const price = num(r.price), area = num(r.area);
  const kanri = num(r.kanrihi) ?? 0, shuzen = num(r.shuzen) ?? 0;
  const kanriShuzen = kanri + shuzen;

  const applied = { ...(terms || DEFAULT_TERMS), ...(r.loan || {}) };
  const loan = price != null ? calcLoan(price, applied) : null;
  const loanMonthly = loan ? loan.monthly : null;
  const monthly = loanMonthly != null ? loanMonthly + kanriShuzen : (kanriShuzen || null);

  return {
    tsubo: area ? area / TSUBO_SQM : null,
    tsuboPrice: price && area ? price / (area / TSUBO_SQM) : null,
    kanriShuzen: kanriShuzen || null,
    loan,
    loanMonthly,
    monthly,
    yearly: monthly != null ? monthly * 12 : null,
    // 掲載サイトの表示値（転記）。自前計算との差を確認するために残している
    refMonthly: num(r.refMonthly),
    ageYears: ageFromYM(building?.builtYM ?? r.builtYM),
    usesOwnTerms: !!r.loan,
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

/**
 * replaceChildren は null を文字列 "null" として描画してしまうため、
 * 条件付きの子要素を渡すときは必ずこちらを使う。
 */
export function mount(node, ...children) {
  node.replaceChildren(
    ...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}

/**
 * 全角の数字・記号を半角にし、数値として成り立たない文字を落とす。
 * 入力途中の「1.」「-」はそのまま残す。ここで捨てると打っている最中に消えてしまう。
 */
export function sanitizeNumeric(raw, { integer = false } = {}) {
  let s = String(raw ?? '').normalize('NFKC').replace(/[^\d.\-]/g, '');
  if (integer) s = s.replace(/\./g, '');
  const neg = s.startsWith('-');
  s = s.replace(/-/g, '');                       // マイナスは先頭の1つだけ
  const dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  return (neg ? '-' : '') + s;
}

/** 入力途中（''・'-'・'.'・'1.'）でも壊れない数値の読み取り */
export function numOrNull(s) {
  const t = String(s ?? '').trim();
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const v = Number(t);
  return isNaN(v) ? null : v;
}

/**
 * 再描画のあと、元の欄へ自動でフォーカスを戻している最中かどうか。
 * 数値欄はタップ時に全選択するが、この戻しでは選択し直さない
 * （1文字打つたびに全選択されてしまうため）。
 */
let restoringFocus = false;
export const isRestoringFocus = () => restoringFocus;

/**
 * 再描画をまたいで入力欄のフォーカス・カーソル位置・打ちかけの文字列を保つ。
 * 金額を1文字打つたびに描き直す画面では、これが無いと続けて入力できない。
 * 対象の要素には data-fkey で安定した識別子を付けておく。
 *
 * 打ちかけの文字列まで戻すのは、「1.」のように数値として未完成な状態を
 * 描き直しで正規化すると、打った小数点がその場で消えてしまうため。
 */
export function preserveFocus(render) {
  const active = document.activeElement;
  const key = active?.dataset?.fkey;
  const start = active?.selectionStart ?? null;
  const end = active?.selectionEnd ?? null;
  const typed = active?.dataset?.raw != null ? active.value : null;
  render();
  if (!key) return;
  const next = document.querySelector(`[data-fkey="${CSS.escape(key)}"]`);
  if (!next) return;
  restoringFocus = true;
  try {
    next.focus();
    if (typed != null) next.value = typed;
    if (start != null) next.setSelectionRange(start, end);
  } catch { /* type によっては選択範囲を扱えないので無視してよい */ }
  restoringFocus = false;
}

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
