// 起動・ルーティング・自動保存
import { store } from './store.js';
import { $, $$, toast, debounce } from './util.js';
import {
  route, bindRouter, renderList, renderBuilding, renderRoom,
  renderCompare, renderMap, renderSettings,
} from './views.js';
import { initLightbox } from './gallery.js';
import { renderAnalysis } from './analytics-view.js';
import { renderLifeplan } from './lifeplan-view.js';
import { renderImport } from './import-view.js';
import { parsePairing } from './pairing.js';
import { applyTheme, watchSystemTheme, themeButton } from './theme.js';
import { applySkin } from './skin.js';

const main = $('#main');

function parseHash() {
  const [view = 'list', id = null] = location.hash.replace(/^#\/?/, '').split('/');
  const known = ['list', 'b', 'r', 'import', 'compare', 'analysis', 'plan', 'map', 'settings', 'setup'];
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
  // 建物・部屋の詳細と取り込みは「一覧」タブの配下として扱う
  const tabOf = { b: 'list', r: 'list', import: 'list' }[route.view] || route.view;
  $$('#tabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === tabOf));

  // QR から来た設定リンクは画面を描く前に取り込む（起動済みのアプリで踏まれた場合もここを通る）
  if (route.view === 'setup') {
    if (route.id && !consuming) consumePairing(route.id);
    return;
  }
  if (route.view === 'import') renderImport(main);
  else if (route.view === 'compare') renderCompare(main);
  else if (route.view === 'analysis') renderAnalysis(main, render);
  else if (route.view === 'plan') renderLifeplan(main, render, route.id || 'plan');
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
    ok: [store.dirty ? '未保存' : '同期済', store.dirty ? 'badge-warn' : 'badge-ok'],
    error: ['エラー', 'badge-warn'],
  };
  const [text, cls] = map[store.syncState] || map.idle;
  badge.textContent = text;
  badge.className = `badge ${cls}`;
  badge.title = store.lastError || '';
  $('#btnSave').hidden = !store.dirty;
}

// 変更から少し経ったら自動でコミットする（明示保存ボタンも残す）
const autosave = debounce(async () => {
  if (!store.dirty || !store.configured) return;
  try { await store.save(); toast('GitHub に保存しました'); }
  catch (e) { toast(e.message, true); }
}, 4000);

store.addEventListener('change', () => { paintStatus(); if (store.dirty) autosave(); });

$('#tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) go(tab.dataset.view);
});

$('#btnSave').addEventListener('click', async () => {
  try { await store.save(); toast('GitHub に保存しました'); }
  catch (e) { toast(e.message, true); }
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
