// 画面をまたいで使う小さな部品。
import { el, fmt, sanitizeNumeric, numOrNull, isRestoringFocus } from './util.js';

export function labeled(label, node) {
  return el('label', { class: 'tiny muted', style: 'display:flex;gap:6px;align-items:center' }, label, node);
}

export function select(value, options, onchange, cls = null) {
  return el('select', { class: cls, onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(value) }, t)));
}

export function kv(k, v, sub = null) {
  return el('div', {},
    k ? el('div', { class: 'k' }, k) : null,
    el('div', { class: 'v' }, v),
    sub ? el('div', { class: 'k', style: 'margin-top:2px' }, sub) : null);
}

/**
 * 数値の入力欄。
 *
 * `type="number"` は使わない。入力途中の「1.」や「0.」を value から読み取れず
 * 空文字が返るため、1文字ごとに描き直す画面では打った小数点がその場で消える。
 * text + inputmode=decimal にして、打っている文字列をそのまま持たせる。
 * data-raw は「打ちかけの文字列を保つ欄」の目印で、preserveFocus が見る。
 *
 * @param {object} o
 * @param {number|null} o.value 現在値
 * @param {Function} o.onInput (数値|null, 文字列) を受け取る
 * @param {boolean} [o.integer] 小数点を受け付けない欄（年数など）
 */
export function numberInput({ value, onInput, fkey = null, integer = false, cls = null, placeholder = null }) {
  const input = el('input', {
    type: 'text', class: cls, placeholder,
    inputmode: integer ? 'numeric' : 'decimal',
    autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
    'data-raw': '', 'data-fkey': fkey,
    value: value ?? '',
    // タップしたら全選択する。既存の数字を消してから打ち直す手間をなくすため
    onfocus: (e) => {
      if (isRestoringFocus()) return;
      const t = e.target;
      setTimeout(() => { try { t.select(); } catch { /* noop */ } }, 0);
    },
    oninput: (e) => {
      const t = e.target;
      const before = t.value;
      const after = sanitizeNumeric(before, { integer });
      if (after !== before) {
        // 弾いた文字のぶんだけカーソルを戻す（末尾へ飛ぶのを防ぐ）
        const pos = Math.max(0, (t.selectionStart ?? after.length) - (before.length - after.length));
        t.value = after;
        try { t.setSelectionRange(pos, pos); } catch { /* noop */ }
      }
      onInput(numOrNull(after), after);
    },
  });
  return input;
}

/**
 * オブジェクトの1項目を編集する入力欄。
 * @param {object} obj 対象
 * @param {[string,string,string,boolean]} spec [キー, ラベル, type, 横幅いっぱいか]
 * @param {Function} onChange
 */
export function field(obj, [key, label, type = 'text', wide = false], onChange) {
  const input = type === 'number'
    ? numberInput({
      value: obj[key], fkey: `f-${key}`,
      onInput: (num) => { obj[key] = num; onChange(key); },
    })
    : type === 'textarea'
      ? el('textarea', { oninput: (e) => { obj[key] = e.target.value; onChange(key); } }, obj[key] ?? '')
      : el('input', {
        type, value: obj[key] ?? '',
        oninput: (e) => { obj[key] = e.target.value; onChange(key); },
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
  // 申し込みが入っている部屋は目立たせる。動くなら急ぐ必要があるため
  const cls = status === '本命' ? 'badge-ok'
    : status === '申込有' ? 'badge-warn' : 'badge-muted';
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
