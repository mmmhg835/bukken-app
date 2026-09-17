// 起動・ルーティング・自動保存
import { store } from './store.js';
import { $, $$, toast, debounce, preserveFocus } from './util.js';
import {
  route, bindRouter, renderList, renderBuilding, renderRoom,
  renderCompare, renderMap, renderSettings,
} from './views.js';
import { initLightbox } from './gallery.js';
import { renderLifeplan } from './lifeplan-view.js';
import { renderViewing } from './viewing-view.js';
import { renderMarket } from './market-view.js';
import { parsePairing } from './pairing.js';
import { applyTheme, watchSystemTheme, themeButton } from './theme.js';
import { applySkin } from './skin.js';

const main = $('#main');

/** 画面の割り当て。古いリンクの付け替えを smoke から確かめられるように出している */
export function parseHash() {
  const [view = 'list', id = null] = location.hash.replace(/^#\/?/, '').split('/');
  // 分析タブは相場に統合した。古いリンクを踏んでも迷子にならないようにする
  if (view === 'analysis') return { view: 'market', id: null };
  // 指値は内見からライフプランへ移した。古いリンクはそのまま指値に飛ばす
  if (view === 'viewing' && id === 'offer') return { view: 'plan', id: 'offer' };
  // 内見のサブタブ（チェック・記録）は1画面にまとめた
  if (view === 'viewing') return { view: 'viewing', id: null };
  const known = ['list', 'b', 'r', 'compare', 'plan', 'viewing', 'market', 'map', 'settings', 'setup'];
  return { view: known.includes(view) ? view : 'list', id };
}

function go(view, id) {
  location.hash = `#/${view}${id ? `/${id}` : ''}`;
}

let lastKey = null;

function render() {
  Object.assign(route, parseHash());
  // 同じ画面の再描画（画像追加後など）ではスクロール位置を保つ
  const key = `${route.view}/${route.id ?? ''}`;
  const keepScroll = key === lastKey ? window.scrollY : 0;
  lastKey = key;
  // 建物・部屋の詳細は「一覧」タブの配下として扱う
  const tabOf = { b: 'list', r: 'list' }[route.view] || route.view;
  $$('#tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === tabOf));

  // QR から来た設定リンクは画面を描く前に取り込む（起動済みのアプリで踏まれた場合もここを通る）
  if (route.view === 'setup') {
    if (route.id && !consuming) consumePairing(route.id);
    return;
  }
  else if (route.view === 'compare') renderCompare(main);
  else if (route.view === 'plan') renderLifeplan(main, render, route.id || 'plan');
  else if (route.view === 'viewing') renderViewing(main, render);
  else if (route.view === 'market') renderMarket(main, render, route.id || 'overview');
  else if (route.view === 'map') renderMap(main);
  else if (route.view === 'settings') renderSettings(main);
  else if (route.view === 'b' && route.id) renderBuilding(main, route.id);
  else if (route.view === 'r' && route.id) renderRoom(main, route.id);
  else renderList(main);

  window.scrollTo(0, keepScroll);
  paintStatus();
}

function paintStatus() {
  const badge = $('#syncBadge');
  const map = {
    unconfigured: ['未接続', 'badge-muted'],
    idle: ['待機', 'badge-muted'],
    syncing: ['同期中…', 'badge-muted'],
    ok: [store.dirty || store.marketDirty.size ? '未保存' : '同期済',
      store.dirty || store.marketDirty.size ? 'badge-warn' : 'badge-ok'],
    error: ['エラー', 'badge-warn'],
  };
  const [text, cls] = map[store.syncState] || map.idle;
  badge.textContent = text;
  badge.className = `badge ${cls}`;
  badge.title = store.lastError || '';
  $('#btnSave').hidden = !store.dirty && !store.marketDirty.size;
}

// 変更から少し経ったら自動でコミットする（明示保存ボタンも残す）
const autosave = debounce(async () => {
  if (!store.configured) return;
  try {
    if (store.dirty) await store.save();
    // 相場は建物ごとの別ファイル。触った建物だけ書き戻す
    for (const id of [...store.marketDirty]) await store.saveMarket(id);
    toast('GitHub に保存しました');
  } catch (e) { toast(e.message, true); }
}, 4000);

store.addEventListener('change', () => {
  paintStatus();
  if (store.dirty || store.marketDirty.size) autosave();
});

// 参考建物・売り出し・成約・相場は、画面を描いたあとから届く。
// 届いた時点で描き直さないと、画面は「まだ何も無かったとき」のままになる。
// 相場を開いた直後の建物名の候補に自分の建物しか出ない、という形で表に出ていた。
// 1フレームにまとめるのは、次々に届くたびに描き直すと重くなるため。
// 打ちかけの欄は preserveFocus で戻す（候補を打っている最中に届くことがある）
let repaint = 0;
store.addEventListener('loaded', () => {
  if (repaint) return;
  // タイマーで待つ。requestAnimationFrame は画面が裏に回っていると止まるので、
  // 裏で読み終わったデータがそのまま反映されないことがある
  repaint = setTimeout(() => { repaint = 0; preserveFocus(render); }, 16);
});

$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) go(tab.dataset.view);
});

$('#btnSave').addEventListener('click', async () => {
  try {
    if (store.dirty) await store.save();
    for (const id of [...store.marketDirty]) await store.saveMarket(id);
    toast('GitHub に保存しました');
  } catch (e) { toast(e.message, true); }
});

window.addEventListener('hashchange', render);
window.addEventListener('beforeunload', (e) => {
  if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
});

bindRouter(go, render);
initLightbox();
applySkin();
applyTheme();
watchSystemTheme();
$('#syncBadge').before(themeButton(() => render()));

/**
 * 別端末から QR で渡された設定を取り込む。
 * トークンが履歴に残らないよう、読み取り後すぐ URL から消す。
 */
let consuming = false;

async function consumePairing(payload) {
  consuming = true;
  const cfg = parsePairing(payload);
  history.replaceState(null, '', location.pathname + '#/settings');
  if (!cfg) {
    consuming = false;
    toast('設定リンクが壊れています。もう一度 QR を表示してください。', true);
    location.hash = '#/settings';
    return;
  }
  store.saveConfig(cfg);
  try {
    const info = await store.repo.check();
    await store.sync();
    toast(`接続しました: ${info.fullName}`);
    location.hash = '#/list';
  } catch (e) {
    toast(e.message, true);
  } finally {
    consuming = false;
    if (route.view === 'setup') render();
  }
}

(async () => {
  await store.init();
  if (!location.hash) location.hash = store.configured ? '#/list' : '#/settings';
  render();
  if (!store.configured) toast('まず「設定」で GitHub リポジトリを接続してください');
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js')
    .then((reg) => {
      reg.update();                              // 起動のたびに新版を確認する
      setInterval(() => reg.update(), 30 * 60e3);
    })
    .catch(() => { /* 任意機能なので失敗は無視 */ });

  let firstControl = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 初回登録時は更新ではないので黙って通す
    if (firstControl) { firstControl = false; return; }
    toast('新しいバージョンを取得しました。再読み込みします…');
    setTimeout(() => location.reload(), 1200);
  });
}
