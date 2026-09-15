// 画面描画。すべて store の状態から組み立てる。
import { store } from './store.js';
import { $, el, fmt, derive, toast, STATUSES, CATEGORIES, debounce } from './util.js';

export const route = { view: 'list', id: null };

/* =========================================================
   一覧
   ========================================================= */
const listUI = { sort: 'no', status: 'all' };

export function renderList(root) {
  const bar = el('div', { class: 'toolbar' },
    labeled('並び替え', select(listUI.sort, [
      ['no', '登録順'], ['price', '価格が安い順'], ['tsubo', '坪単価が安い順'],
      ['area', '広い順'], ['monthly', '月額が安い順'], ['rating', '評価が高い順'],
    ], (v) => { listUI.sort = v; rerender(); })),
    labeled('状態', select(listUI.status, [['all', 'すべて'], ...STATUSES.map((s) => [s, s])],
      (v) => { listUI.status = v; rerender(); })),
    el('div', { class: 'spacer' }),
    el('button', {
      class: 'btn btn-primary', onclick: () => {
        const p = store.addProperty();
        go('detail', p.id);
      },
    }, '＋ 物件を追加'),
  );

  let items = store.properties.slice();
  if (listUI.status !== 'all') items = items.filter((p) => p.status === listUI.status);
  items.sort(sorter(listUI.sort));

  const grid = el('div', { class: 'grid' }, items.map(card));
  root.replaceChildren(bar,
    items.length ? grid : el('div', { class: 'empty' }, '物件がありません。「＋ 物件を追加」から登録してください。'));
}

function sorter(key) {
  const d = (p) => derive(p);
  const by = {
    no: (a, b) => (a.no ?? 999) - (b.no ?? 999),
    price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
    tsubo: (a, b) => (d(a).tsuboPrice ?? Infinity) - (d(b).tsuboPrice ?? Infinity),
    area: (a, b) => (b.area ?? -1) - (a.area ?? -1),
    monthly: (a, b) => (d(a).monthly ?? Infinity) - (d(b).monthly ?? Infinity),
    rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  };
  return by[key] || by.no;
}

function card(p) {
  const c = derive(p);
  const imgBox = el('div', { class: 'pcard-img' },
    p.coverThumb
      ? el('img', { src: p.coverThumb, alt: p.name, loading: 'lazy' })
      : el('div', { class: 'ph' }, '画像なし'),
    p.images?.length ? el('span', { class: 'imgcount' }, `${p.images.length}枚`) : null,
  );
  return el('article', { class: 'card pcard', onclick: () => go('detail', p.id) },
    imgBox,
    el('div', { class: 'pcard-body' },
      el('div', { class: 'pcard-top' },
        el('div', { class: 'pcard-name' }, p.name || '(名称未設定)'),
        el('span', { class: 'badge ' + (p.status === '本命' ? 'badge-ok' : 'badge-muted') }, p.status || '検討中'),
      ),
      el('div', { class: 'pcard-price' }, fmt.man1(p.price), el('small', {}, '万円')),
      el('div', { class: 'kvrow' },
        el('span', {}, `${fmt.sqm(p.area)}・${p.layout || '—'}`),
        el('span', {}, `${p.floor ?? '—'}/${p.totalFloors ?? '—'}階`),
      ),
      el('div', { class: 'kvrow' },
        el('span', {}, `坪単価 ${fmt.n(c.tsuboPrice, 1)}万`),
        el('span', {}, `月額 ${fmt.yen万(c.monthly)}`),
      ),
      el('div', { class: 'kvrow tiny' }, el('span', {}, p.walk || p.stations || '')),
      p.rating ? el('div', { class: 'stars' }, fmt.stars(p.rating)) : null,
    ),
  );
}

/* =========================================================
   比較（物件を列、項目を行にした表）
   ========================================================= */
export function renderCompare(root) {
  const ps = store.properties.slice().sort(sorter('no'));
  if (!ps.length) { root.replaceChildren(el('div', { class: 'empty' }, '比較する物件がありません。')); return; }
  const ds = ps.map(derive);

  // best: 'min' | 'max' | null（その行で最も条件が良い値を強調する）
  const rows = [
    ['価格', (p) => fmt.man1(p.price) + '万円', (p) => p.price, 'min'],
    ['坪単価', (p, c) => fmt.n(c.tsuboPrice, 1) + '万円', (p, c) => c.tsuboPrice, 'min'],
    ['専有面積', (p) => fmt.sqm(p.area), (p) => p.area, 'max'],
    ['間取り', (p) => p.layout || '—'],
    ['所在階 / 総階数', (p) => `${p.floor ?? '—'} / ${p.totalFloors ?? '—'}階`, (p) => p.floor, 'max'],
    ['築年月（築年数）', (p, c) => `${p.builtYM || '—'}${c.ageYears != null ? `（${c.ageYears}年）` : ''}`,
      (p, c) => c.ageYears, 'min'],
    ['最寄駅', (p) => p.stations || '—'],
    ['駅徒歩', (p) => p.walk || '—'],
    ['バルコニー', (p) => fmt.sqm(p.balcony), (p) => p.balcony, 'max'],
    ['管理費', (p) => fmt.yen万(p.kanrihi) + '/月'],
    ['修繕積立金', (p) => fmt.yen万(p.shuzen) + '/月'],
    ['管理＋修繕', (p, c) => fmt.yen万(c.kanriShuzen) + '/月', (p, c) => c.kanriShuzen, 'min'],
    ['ローン元金', (p) => fmt.yen万(p.loanPrincipal) + '/月'],
    ['ローン金利分', (p) => fmt.yen万(p.loanInterest) + '/月'],
    ['月額合計', (p, c) => fmt.yen万(c.monthly) + '/月', (p, c) => c.monthly, 'min'],
    ['年額合計', (p, c) => fmt.yen万(c.yearly) + '/年', (p, c) => c.yearly, 'min'],
    ['リフォーム', (p) => p.reform || '—', null, null, true],
    ['眺望・住戸特徴', (p) => p.viewNote || '—', null, null, true],
    ['間取り・室内メモ', (p) => p.roomNote || '—', null, null, true],
    ['メモ', (p) => p.memo || '—', null, null, true],
    ['評価', (p) => fmt.stars(p.rating), (p) => p.rating, 'max'],
    ['状態', (p) => p.status || '—'],
    ['画像', (p) => `${p.images?.length || 0}枚`],
  ];

  const thead = el('thead', {}, el('tr', {},
    el('th', { class: 'lab' }, '項目'),
    ps.map((p) => el('th', {}, el('div', { class: 'colhead' },
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); go('detail', p.id); } }, p.name || '(未設定)'),
      el('span', { class: 'badge badge-muted' }, p.status || '検討中'),
    ))),
  ));

  const tbody = el('tbody', {}, rows.map(([label, render, pick, dir, isNote]) => {
    let bestVal = null;
    if (pick && dir) {
      const vals = ps.map((p, i) => pick(p, ds[i])).filter((v) => v != null && !isNaN(v));
      if (vals.length > 1) bestVal = dir === 'min' ? Math.min(...vals) : Math.max(...vals);
    }
    return el('tr', {},
      el('td', { class: 'lab' }, label),
      ps.map((p, i) => {
        const v = pick ? pick(p, ds[i]) : null;
        const cls = [isNote ? 'note' : '', bestVal != null && v === bestVal ? 'best' : ''].filter(Boolean).join(' ');
        return el('td', { class: cls || null }, render(p, ds[i]));
      }),
    );
  }));

  root.replaceChildren(
    el('div', { class: 'toolbar' },
      el('span', { class: 'muted tiny' }, '緑字＝その項目で最も条件が良い値'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn-sm', onclick: () => go('list') }, '一覧へ'),
    ),
    el('div', { class: 'tablewrap' }, el('table', { class: 'cmp' }, thead, tbody)),
  );
}

/* =========================================================
   詳細
   ========================================================= */
const FIELDS = [
  ['name', '物件名', 'text', true], ['price', '価格（万円）', 'number'],
  ['area', '専有面積（㎡）', 'number'], ['layout', '間取り', 'text'],
  ['floor', '所在階', 'number'], ['totalFloors', '建物階数', 'number'],
  ['builtYM', '築年月（例 2005/02）', 'text'], ['stations', '最寄駅', 'text'],
  ['walk', '駅徒歩', 'text'], ['balcony', 'バルコニー（㎡）', 'number'],
  ['kanrihi', '管理費（万円/月）', 'number'], ['shuzen', '修繕積立金（万円/月）', 'number'],
  ['loanPrincipal', 'ローン元金（万円/月）', 'number'], ['loanInterest', 'ローン金利分（万円/月）', 'number'],
  ['monthlyTotal', '月額合計（万円/月）', 'number'], ['imageRange', '元画像ファイル範囲', 'text'],
];
const TEXTAREAS = [
  ['reform', 'リフォーム'], ['viewNote', '眺望・住戸特徴'],
  ['roomNote', '間取り・室内メモ'], ['memo', '自由メモ'],
];

export function renderDetail(root, id) {
  const p = store.find(id);
  if (!p) { go('list'); return; }
  const c = derive(p);
  const touch = debounce(() => { store.markDirty(); renderCalc(); }, 300);

  const calcBox = el('div', { class: 'calcgrid' });
  const renderCalc = () => {
    const d = derive(p);
    calcBox.replaceChildren(
      kv('坪単価', `${fmt.n(d.tsuboPrice, 1)}万円`),
      kv('専有坪数', `${fmt.n(d.tsubo, 2)}坪`),
      kv('管理＋修繕', `${fmt.yen万(d.kanriShuzen)}/月`),
      kv('月額合計', `${fmt.yen万(d.monthly)}/月`),
      kv('年額合計', `${fmt.yen万(d.yearly)}/年`),
      kv('築年数', d.ageYears != null ? `${d.ageYears}年` : '—'),
    );
  };
  renderCalc();

  const form = el('div', { class: 'card form' },
    FIELDS.map(([key, label, type, wide]) => el('div', { class: 'field' + (wide ? ' wide' : '') },
      el('label', {}, label),
      el('input', {
        type, value: p[key] ?? '', step: type === 'number' ? 'any' : null, inputmode: type === 'number' ? 'decimal' : null,
        oninput: (e) => {
          const raw = e.target.value;
          p[key] = type === 'number' ? (raw === '' ? null : Number(raw)) : raw;
          if (key === 'name') $('#detailName').textContent = raw || '(名称未設定)';
          touch();
        },
      }),
    )),
    TEXTAREAS.map(([key, label]) => el('div', { class: 'field wide' },
      el('label', {}, label),
      el('textarea', { oninput: (e) => { p[key] = e.target.value; touch(); } }, p[key] ?? ''),
    )),
  );

  const head = el('div', { class: 'detail-head' },
    el('h2', { id: 'detailName' }, p.name || '(名称未設定)'),
    select(p.status, STATUSES.map((s) => [s, s]), (v) => { p.status = v; store.markDirty(); }),
    ratingPicker(p),
    el('button', {
      class: 'btn btn-sm btn-danger', onclick: async () => {
        if (!confirm(`「${p.name}」を削除します。画像ファイルはリポジトリに残ります。よろしいですか？`)) return;
        await store.deleteProperty(p.id); go('list'); toast('削除しました');
      },
    }, '削除'),
  );

  root.replaceChildren(
    el('button', { class: 'back', onclick: () => go('list') }, '‹ 一覧へ戻る'),
    head,
    el('div', { class: 'section' }, calcBox),
    el('div', { class: 'section' }, el('h3', {}, '基本情報'), form),
    gallerySection(p),
  );
}

function kv(k, v) { return el('div', {}, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v)); }

function ratingPicker(p) {
  const box = el('div', { class: 'stars', style: 'cursor:pointer;font-size:19px' });
  const paint = () => box.textContent = fmt.stars(p.rating);
  box.addEventListener('click', () => { p.rating = ((p.rating || 0) + 1) % 6; paint(); store.markDirty(); });
  paint();
  return box;
}

/* ===== 画像ギャラリー ===== */
function gallerySection(p) {
  let category = CATEGORIES[0];

  const input = el('input', {
    type: 'file', accept: 'image/*', multiple: true, style: 'display:none',
    onchange: (e) => { upload(e.target.files); e.target.value = ''; },
  });

  const zone = el('div', { class: 'dropzone' },
    el('div', {}, '画像をここにドラッグ、またはタップして選択'),
    el('div', { class: 'tiny', style: 'margin-top:6px' }, '端末側で長辺1600pxに縮小してから GitHub にコミットします'),
  );
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('over');
    upload(e.dataTransfer.files);
  });

  const groups = el('div');
  const section = el('div', { class: 'section' },
    el('h3', {}, `画像（${p.images?.length || 0}枚）`),
    el('div', { class: 'toolbar' },
      labeled('追加先カテゴリ', select(category, CATEGORIES.map((x) => [x, x]), (v) => { category = v; })),
    ),
    zone, input, groups,
  );

  async function upload(files) {
    if (!files?.length) return;
    try {
      const n = await store.addImages(p.id, files, category,
        (i, total, name) => toast(`アップロード中 ${i}/${total}… ${name}`));
      toast(`${n}枚をコミットしました`);
      rerender();
    } catch (e) { toast(e.message, true); }
  }

  paintGroups();
  function paintGroups() {
    const byCat = new Map(CATEGORIES.map((c) => [c, []]));
    for (const im of p.images || []) {
      if (!byCat.has(im.category)) byCat.set(im.category, []);
      byCat.get(im.category).push(im);
    }
    groups.replaceChildren(...[...byCat.entries()].filter(([, v]) => v.length).map(([cat, ims]) =>
      el('div', { class: 'gal-group' },
        el('h4', {}, `${cat}（${ims.length}）`),
        el('div', { class: 'gal' }, ims.map((im) => thumb(p, im))),
      )));
  }
  return section;
}

function thumb(p, im) {
  const img = el('img', { alt: im.caption || im.name || '', loading: 'lazy' });
  const fig = el('figure', {},
    img,
    p.cover === im.path ? el('span', { class: 'cover-tag' }, 'カバー') : null,
    el('div', { class: 'tools' },
      el('button', {
        onclick: async (e) => {
          e.stopPropagation();
          try { await store.setCover(p.id, im.path); toast('カバーに設定'); rerender(); }
          catch (err) { toast(err.message, true); }
        },
      }, 'カバー'),
      el('button', {
        onclick: async (e) => {
          e.stopPropagation();
          if (!confirm('この画像を削除します。よろしいですか？')) return;
          try { await store.deleteImage(p.id, im.path); toast('削除しました'); rerender(); }
          catch (err) { toast(err.message, true); }
        },
      }, '削除'),
    ),
  );
  fig.addEventListener('click', () => openLightbox(p, im.path));
  store.imageUrl(im.path).then((u) => { img.src = u; }).catch(() => { fig.style.opacity = .4; });
  return fig;
}

/* ===== ライトボックス ===== */
let lbState = null;
function openLightbox(p, path) {
  lbState = { list: p.images.map((i) => i.path), caps: p.images, i: p.images.findIndex((i) => i.path === path) };
  $('#lightbox').hidden = false;
  paintLightbox();
}
async function paintLightbox() {
  if (!lbState) return;
  const { list, caps, i } = lbState;
  $('#lbCount').textContent = `${i + 1} / ${list.length}`;
  $('#lbCap').textContent = caps[i]?.caption || caps[i]?.name || '';
  $('#lbImg').src = await store.imageUrl(list[i]);
}
export function initLightbox() {
  const lb = $('#lightbox');
  const close = () => { lb.hidden = true; lbState = null; };
  const step = (d) => {
    if (!lbState) return;
    lbState.i = (lbState.i + d + lbState.list.length) % lbState.list.length;
    paintLightbox();
  };
  lb.querySelector('.lb-close').onclick = close;
  lb.querySelector('.lb-prev').onclick = (e) => { e.stopPropagation(); step(-1); };
  lb.querySelector('.lb-next').onclick = (e) => { e.stopPropagation(); step(1); };
  lb.addEventListener('click', (e) => { if (e.target === lb || e.target.id === 'lbImg') close(); });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  let x0 = null;
  lb.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    x0 = null;
  }, { passive: true });
}

/* =========================================================
   設定
   ========================================================= */
export function renderSettings(root) {
  const cfg = { ...store.config };
  const status = el('div', { class: 'tiny muted', style: 'margin-top:8px' });

  const form = el('div', { class: 'card form settings-form' },
    cfgField('owner', 'GitHub ユーザー名 / Organization', cfg, '例: tatsuyoshi'),
    cfgField('repo', 'データ用リポジトリ名（Private 推奨）', cfg, '例: bukken-data'),
    cfgField('branch', 'ブランチ', cfg, 'main'),
    cfgField('token', 'アクセストークン（この端末のブラウザにのみ保存）', cfg, 'github_pat_...', 'password'),
    el('div', { class: 'field wide', style: 'flex-direction:row;gap:8px;flex-wrap:wrap' },
      el('button', {
        class: 'btn btn-primary', onclick: async () => {
          store.saveConfig(cfg);
          status.textContent = '接続を確認しています…';
          try {
            const info = await store.repo.check();
            await store.sync();
            status.textContent = `接続OK: ${info.fullName}（${info.private ? 'Private' : 'Public'}）`;
            toast('GitHub に接続しました');
            rerender();
          } catch (e) { status.textContent = `接続エラー: ${e.message}`; toast(e.message, true); }
        },
      }, '保存して接続テスト'),
      el('button', { class: 'btn', onclick: async () => { await store.sync(); toast('同期しました'); rerender(); } }, '今すぐ同期'),
      el('button', {
        class: 'btn', onclick: async () => { await store.clearImageCache(); toast('画像キャッシュを消去しました'); },
      }, '画像キャッシュ消去'),
      el('button', {
        class: 'btn', onclick: () => {
          const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
          const a = el('a', { href: URL.createObjectURL(blob), download: 'properties.json' });
          document.body.append(a); a.click(); a.remove();
        },
      }, 'JSONを書き出し'),
    ),
  );

  root.replaceChildren(el('div', { class: 'settings' },
    el('div', { class: 'section' }, el('h3', {}, 'GitHub 接続'), form, status),
    el('div', { class: 'section card', style: 'padding:16px' },
      el('h3', {}, 'トークンの作り方'),
      el('div', {
        class: 'help', html: `
        <ol>
          <li>GitHub → Settings → Developer settings → <b>Personal access tokens → Fine-grained tokens</b> → Generate new token</li>
          <li><b>Repository access</b> で <code>データ用リポジトリ</code> だけを選択</li>
          <li><b>Permissions → Repository permissions → Contents</b> を <code>Read and write</code> に設定</li>
          <li>生成されたトークンを上の欄に貼り付け → 「保存して接続テスト」</li>
        </ol>
        <p>トークンはこの端末のブラウザ（localStorage）にだけ保存され、どこにも送信されません。Mac とスマホで使う場合は、それぞれの端末で一度貼り付けてください。</p>` }),
    ),
    el('div', { class: 'section card', style: 'padding:16px' },
      el('h3', {}, '同期状態'),
      el('div', { class: 'help' },
        el('div', {}, `状態: ${store.syncState}`),
        el('div', {}, `未保存の変更: ${store.dirty ? 'あり' : 'なし'}`),
        el('div', {}, `最終更新: ${store.data.updatedAt ? new Date(store.data.updatedAt).toLocaleString('ja-JP') : '—'}`),
        store.lastError ? el('div', { style: 'color:var(--bad);margin-top:6px' }, store.lastError) : null,
      )),
  ));
}

function cfgField(key, label, cfg, ph, type = 'text') {
  return el('div', { class: 'field wide' },
    el('label', {}, label),
    el('input', {
      type, value: cfg[key] ?? '', placeholder: ph, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      oninput: (e) => { cfg[key] = e.target.value.trim(); },
    }),
  );
}

/* ===== 小物 ===== */
function labeled(label, node) {
  return el('label', { class: 'tiny muted', style: 'display:flex;gap:6px;align-items:center' }, label, node);
}
function select(value, options, onchange) {
  return el('select', { onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => el('option', { value: v, selected: v === value }, t)));
}

/* ===== ルーティング（main.js から差し込まれる） ===== */
export let go = () => {};
export let rerender = () => {};
export function bindRouter(goFn, rerenderFn) { go = goFn; rerender = rerenderFn; }
