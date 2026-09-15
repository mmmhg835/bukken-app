// 配色の切り替え。端末設定に従う「システム」を既定に、明示指定も選べるようにする。
const KEY = 'bukken.theme.v1';
export const THEMES = [['system', '端末の設定に従う'], ['light', 'ライト'], ['dark', 'ダーク']];

export function currentTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.some(([k]) => k === v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme = currentTheme()) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  // iOS のステータスバーやブラウザ UI の色も合わせる
  const dark = theme === 'dark'
    || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme:dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1117' : '#ffffff');
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* 保存できなくても表示は変える */ }
  applyTheme(theme);
}

/** システム設定のまま使っている場合に、OS 側の変更へ追従する */
export function watchSystemTheme() {
  window.matchMedia?.('(prefers-color-scheme:dark)')
    .addEventListener?.('change', () => { if (currentTheme() === 'system') applyTheme('system'); });
}

/** 押すたびに システム → ライト → ダーク と切り替わるボタン */
export function themeButton(onChange = () => {}) {
  const btn = document.createElement('button');
  btn.className = 'themebtn';
  btn.type = 'button';
  const paint = () => {
    const t = currentTheme();
    btn.textContent = t === 'light' ? '☀' : t === 'dark' ? '☾' : '◐';
    btn.title = `配色: ${THEMES.find(([k]) => k === t)[1]}（クリックで切り替え）`;
    btn.setAttribute('aria-label', btn.title);
  };
  btn.addEventListener('click', () => {
    const order = THEMES.map(([k]) => k);
    setTheme(order[(order.indexOf(currentTheme()) + 1) % order.length]);
    paint();
    onChange();
  });
  paint();
  return btn;
}
