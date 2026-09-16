// 画面をまたいで使う小さな部品。
import { el, fmt, sanitizeNumeric, numOrNull, isRestoringFocus } from './util.js';

export function labeled(label, node) {
  return el('label', { class: 'tiny muted', style: 'display:flex;gap:6px;align-items:center' }, label, node);
}

export function select(value, options, onchange, cls = null) {
  return el('select', { class: cls, onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(value) }, t)));
}

/**
 * 打った文字から選択肢を1つに決める。決まらなければ null（＝選び直さない）。
 *
 * 末尾の件数「（352）」は付いていても外れていても、古い件数でも当てる。
 * 件数は他の条件で動くので、前に選んだときの件数が残っていると選び直せなくなるため。
 *
 * @returns {string|null} 選ばれた値。空文字を打ったときは 'all'
 */
export function comboMatch(text, options) {
  const norm = (t) => String(t || '').normalize('NFKC').toLowerCase()
    .replace(/\s/g, '').replace(/[（(]\d+[）)]$/, '');
  const t = norm(text);
  if (!t) return 'all';
  const exact = options.find(([v, label]) => norm(label) === t || norm(v) === t);
  if (exact) return exact[0];
  // 打ちかけでも、当てはまるものが1つに絞れていればそれにする
  const part = options.filter(([v, label]) => norm(label).includes(t) || norm(v).includes(t));
  return part.length === 1 ? part[0][0] : null;
}

/**
 * 打ちながら候補を絞れる選択欄（入力欄＋datalist）。
 *
 * 駅は90件、建物は1,400件あり、選択肢を上から探すのは現実的でない。
 * 「もとず」と打てば元住吉だけが残る、という入り方にする。
 * 部品を足さずに datalist で済ませているのは、圏外でも開ける作りを崩さないため。
 *
 * @param {string} value いま選んでいる値（'all' なら未選択）
 * @param {Array<[string,string]>} options [値, 表示名]。先頭の ['all', 'すべて'] は渡さない
 * @param {(v: string) => void} onchange 選ばれたときに呼ぶ。外したときは 'all' で呼ぶ
 */
let comboSeq = 0;
export function combo(value, options, onchange, cls = null, fkey = null) {
  const id = `dl${++comboSeq}`;
  const labelOf = (v) => (options.find(([x]) => String(x) === String(v)) || [])[1] ?? '';
  const shown = value === 'all' || value == null ? '' : labelOf(value) || String(value);
  const input = el('input', {
    type: 'search', list: id, class: cls, placeholder: 'すべて　（打つと絞れます）',
    value: shown, 'data-fkey': fkey,
    // 打つたびに効かせると、候補が出る前に画面が入れ替わる。選んだとき・離れたときだけ見る
    onchange: (e) => {
      const hit = comboMatch(e.target.value, options);
      // どれにも決まらないときは、打つ前の状態に戻す（黙って全件に戻さない）
      if (hit == null) e.target.value = shown;
      else onchange(hit);
    },
  });
  return el('div', { class: 'fcombo' },
    input,
    // 候補に出すのは表示名だけ。値（建物のidなど）は見せない
    el('datalist', { id }, options.map(([, label]) => el('option', { value: label }))));
}

/**
 * いくつでも選べる版の combo。駅や区は「川崎と横浜の両方」で見たいことが多い。
 *
 * 選んだものは入力欄の下に札で並べ、札を押すと外れる。
 * 選ぶたびに入力欄を空にするのは、続けて次を打てるようにするため。
 *
 * @param {string[]} values いま選んでいる値
 * @param {(next: string[]) => void} onChange 選び直したときに呼ぶ
 */
export function multiCombo(values, options, onChange, cls = null, fkey = null) {
  const id = `dl${++comboSeq}`;
  const chosen = values || [];
  const labelOf = (v) => (options.find(([x]) => String(x) === String(v)) || [])[1] ?? v;
  const input = el('input', {
    type: 'search', list: id, class: cls, 'data-fkey': fkey,
    placeholder: chosen.length ? '追加で選ぶ' : 'すべて　（打つと絞れます）',
    value: '',
    onchange: (e) => {
      const hit = comboMatch(e.target.value, options);
      if (hit == null) { e.target.value = ''; return; }        // どれにも決まらないときは何もしない
      if (hit === 'all') return;                               // 空打ちは「すべて」＝何も足さない
      e.target.value = '';
      if (!chosen.includes(hit)) onChange([...chosen, hit]);
    },
  });
  return el('div', { class: 'fcombo fmulti' },
    input,
    chosen.length
      ? el('div', { class: 'fchosen' }, chosen.map((v) => el('button', {
        class: 'fchip', title: '押すと外します',
        onclick: () => onChange(chosen.filter((x) => x !== v)),
      }, labelOf(v).replace(/[（(]\d+[）)]$/, ''), el('i', {}, '×'))))
      : null,
    // 候補に出すのは、まだ選んでいないものだけ
    el('datalist', { id }, options.filter(([v]) => !chosen.includes(v))
      .map(([, label]) => el('option', { value: label }))));
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
