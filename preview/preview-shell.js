// プレビュー側の見出しだけを補う。アプリ本体の描画・保存処理には触れない。
const TITLES = {
  list: '検討中の物件',
  compare: '物件を比較',
  analysis: '相場を分析',
  plan: 'ライフプラン',
  map: '物件マップ',
  settings: '設定',
  setup: '設定',
};

function paintHeading() {
  const view = location.hash.replace(/^#\/?/, '').split('/')[0] || 'list';
  const wrap = document.getElementById('viewHeading');
  const title = document.getElementById('viewTitle');
  const label = TITLES[view];
  wrap.hidden = !label;
  if (label) title.textContent = label;
}

paintHeading();
window.addEventListener('hashchange', paintHeading);
