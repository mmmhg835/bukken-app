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

/**
 * 文字列の配列を切り替えるチェックリスト。
 * 自由記述だと表記ゆれで比較できないため、設備はタグで持つ。
 */
export function tagPicker(obj, key, options, onChange, sections = null) {
  obj[key] ||= [];
  // 選択肢を絞り込んだ後も、以前に選んだ値が消えないよう末尾に残す
  const extras = obj[key].filter((v) => !options.includes(v));

  // 項目が多いものは小見出しで束ねる。並びだけで探すのは辛いため
  if (sections) {
    const groups = [...sections, ...(extras.length ? [['その他', extras]] : [])];
    return el('div', {},
      groups.map(([title, list]) => el('div', { class: 'tagsub' },
        el('div', { class: 'tagsub-title' }, title),
        el('div', { class: 'tagwrap' }, list.map((opt) => tagChip(obj, key, opt, onChange))))));
  }

  const chips = [...options, ...extras].map((opt) => {
    const on = obj[key].includes(opt);
    const chip = el('button', {
      type: 'button', class: 'tag' + (on ? ' is-on' : ''),
      onclick: () => {
        const i = obj[key].indexOf(opt);
        if (i >= 0) obj[key].splice(i, 1); else obj[key].push(opt);
        chip.classList.toggle('is-on');
        onChange();
      },
    }, opt);
    return chip;
  });
  return el('div', { class: 'tagwrap' }, chips);
}

function tagChip(obj, key, opt, onChange) {
  const chip = el('button', {
    type: 'button', class: 'tag' + (obj[key].includes(opt) ? ' is-on' : ''),
    onclick: () => {
      const i = obj[key].indexOf(opt);
      if (i >= 0) obj[key].splice(i, 1); else obj[key].push(opt);
      chip.classList.toggle('is-on');
      onChange();
    },
  }, opt);
  return chip;
}

/**
 * 連結型のセグメント切り替え。
 * 独立したピルを並べるより、ひとかたまりの中で選択が動くほうが
 * 「同じ軸の選択肢」だと伝わりやすい。
 */
export function segmented(value, options, onChange) {
  const box = el('div', { class: 'segctl' },
    options.map(([key, label]) => el('button', {
      type: 'button',
      class: 'segctl-item' + (String(key) === String(value) ? ' is-on' : ''),
      onclick: () => onChange(key),
    }, label)));
  return el('div', { class: 'segscroll' }, box);
}

/** 軸ごとの操作行。ラベル幅を揃えて、選択肢の並びを縦に揃える */
export function controlRow(icon, label, control) {
  return el('div', { class: 'ctlrow' },
    el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, icon), label),
    control);
}

/** チェックボックスより指で押しやすく、状態も見て分かるトグル */
export function toggle(label, checked, onChange) {
  const input = el('input', {
    type: 'checkbox', checked,
    onchange: (e) => onChange(e.target.checked),
  });
  return el('label', { class: 'switch' }, input, el('span', { class: 'track' }), el('span', {}, label));
}

export function section(title, ...children) {
  return el('div', { class: 'section' }, title ? el('h3', {}, title) : null, ...children);
}
