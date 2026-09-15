// 画像ギャラリーと全画面ビューワ。建物にも部屋にも同じものを使う。
import { store } from './store.js';
import { $, el, toast, CATEGORIES } from './util.js';
import { labeled, select } from './ui.js';

/**
 * @param {object} owner 建物または部屋
 * @param {Function} rerender 追加・削除後に画面を描き直す
 * @param {string} title 見出し。建物の写真と部屋の写真を取り違えないよう明示する
 */
export function gallerySection(owner, rerender, title = '画像') {
  let category = CATEGORIES[0];

  const input = el('input', {
    type: 'file', accept: 'image/*', multiple: true, style: 'display:none',
    onchange: (e) => { upload(e.target.files); e.target.value = ''; },
  });

  const zone = el('div', { class: 'dropzone' },
    el('div', {}, '画像をここにドラッグ、またはタップして選択'),

  );
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('over');
    upload(e.dataTransfer.files);
  });

  async function upload(files) {
    if (!files?.length) return;
    try {
      zone.classList.add('busy');
      const n = await store.addImages(owner.id, files, category,
        (i, total, name, phase) => toast(
          phase === 'アップロード中'
            ? `${total}枚をGitHubへ送信中…`
            : `画像を変換中 ${i}/${total}… ${name}`));
      toast(`${n}枚を1コミットで保存しました`);
      rerender();
    } catch (e) {
      toast(e.message, true);
    } finally {
      zone.classList.remove('busy');
    }
  }

  const groups = el('div');
  const byCat = new Map(CATEGORIES.map((c) => [c, []]));
  for (const im of owner.images || []) {
    if (!byCat.has(im.category)) byCat.set(im.category, []);
    byCat.get(im.category).push(im);
  }
  groups.replaceChildren(...[...byCat.entries()].filter(([, v]) => v.length).map(([cat, ims]) =>
    el('div', { class: 'gal-group' },
      el('h4', {}, `${cat}（${ims.length}）`),
      el('div', { class: 'gal' }, ims.map((im) => thumb(owner, im, rerender))),
    )));

  return el('div', { class: 'section' },
    el('h3', {}, `${title}　${owner.images?.length || 0}枚`),
    el('div', { class: 'toolbar' },
      labeled('追加先カテゴリ', select(category, CATEGORIES.map((x) => [x, x]), (v) => { category = v; }))),
    zone, input, groups,
  );
}

function thumb(owner, im, rerender) {
  const img = el('img', { alt: im.caption || im.name || '', loading: 'lazy' });
  const fig = el('figure', {},
    img,
    owner.cover === im.path ? el('span', { class: 'cover-tag' }, 'カバー') : null,
    el('div', { class: 'tools' },
      el('button', {
        onclick: async (e) => {
          e.stopPropagation();
          try { await store.setCover(owner.id, im.path); toast('カバーに設定'); rerender(); }
          catch (err) { toast(err.message, true); }
        },
      }, 'カバー'),
      el('button', {
        onclick: async (e) => {
          e.stopPropagation();
          if (!confirm('この画像を削除します。よろしいですか？')) return;
          try { await store.deleteImage(owner.id, im.path); toast('削除しました'); rerender(); }
          catch (err) { toast(err.message, true); }
        },
      }, '削除'),
    ),
  );
  fig.addEventListener('click', () => openLightbox(owner, im.path));
  // 格子は軽いサムネ、拡大時に本体を読む（古い画像はサムネが無いので本体で代用）
  store.imageUrl(im.thumbPath || im.path)
    .then((u) => { img.src = u; })
    .catch(() => store.imageUrl(im.path).then((u) => { img.src = u; }))
    .catch(() => { fig.style.opacity = .4; });
  return fig;
}

/* ===== ライトボックス ===== */
let lbState = null;

function openLightbox(owner, path = null) {
  const list = owner.images || [];
  if (!list.length) return;
  const i = path ? list.findIndex((im) => im.path === path) : 0;
  lbState = { list, i: Math.max(0, i) };
  $('#lightbox').hidden = false;
  paint();
}

async function paint() {
  if (!lbState) return;
  const { list, i } = lbState;
  $('#lbCount').textContent = `${i + 1} / ${list.length}`;
  $('#lbCap').textContent = list[i]?.caption || list[i]?.name || '';
  $('#lbImg').src = await store.imageUrl(list[i].path);
}

export function initLightbox() {
  const lb = $('#lightbox');
  const close = () => { lb.hidden = true; lbState = null; };
  const step = (d) => {
    if (!lbState) return;
    lbState.i = (lbState.i + d + lbState.list.length) % lbState.list.length;
    paint();
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

export { openLightbox };
