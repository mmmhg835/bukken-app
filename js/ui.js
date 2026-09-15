// 画面をまたいで使う小さな部品。
import { el, fmt } from './util.js';

export function labeled(label, node) {
  return el('label', { class: 'tiny muted', style: 'display:flex;gap:6px;align-items:center' }, label, node);
}

export function select(value, options, onchange, cls = null) {
  return el('select', { class: cls, onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(value) }, t)));
}

export function kv(k, v, sub = null) {
  return el('div', {}, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v),
    sub ? el('div', { class: 'k', style: 'margin-top:2px' }, sub) : null);
}

/**
 * オブジェクトの1項目を編集する入力欄。
 * @param {object} obj 対象
 * @param {[string,string,string,boolean]} spec [キー, ラベル, type, 横幅いっぱいか]
 * @param {Function} onChange
 */
export function field(obj, [key, label, type = 'text', wide = false], onChange) {
  const isNum = type === 'number';
  const input = type === 'textarea'
    ? el('textarea', { oninput: (e) => { obj[key] = e.target.value; onChange(key); } }, obj[key] ?? '')
    : el('input', {
      type, value: obj[key] ?? '', step: isNum ? 'any' : null, inputmode: isNum ? 'decimal' : null,
      oninput: (e) => {
        const raw = e.target.value;
        obj[key] = isNum ? (raw === '' ? null : Number(raw)) : raw;
        onChange(key);
      },
    });
  return el('div', { class: 'field' + (wide || type === 'textarea' ? ' wide' : '') },
    el('label', {}, label), input);
}

export function ratingPicker(obj, onChange) {
  const box = el('div', { class: 'stars', style: 'cursor:pointer;font-size:19px;user-select:none' });
  const paint = () => { box.textContent = fmt.stars(obj.rating); };
  box.addEventListener('click', () => { obj.rating = ((obj.rating || 0) + 1) % 6; paint(); onChange(); });
  paint();
  return box;
}

export function statusBadge(status) {
  const cls = status === '本命' ? 'badge-ok' : status === '見送り' ? 'badge-muted' : 'badge-muted';
  return el('span', { class: `badge ${cls}` }, status || '検討中');
}

export function section(title, ...children) {
  return el('div', { class: 'section' }, title ? el('h3', {}, title) : null, ...children);
}
