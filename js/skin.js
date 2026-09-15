// 見た目の切り替え。旧デザインをいつでも戻せるよう、2案を同時に生かしておく。
const KEY = 'bukken.skin.v1';
export const SKINS = [['v2', '新デザイン'], ['classic', 'クラシック']];
const DEFAULT = 'v2';

export function currentSkin() {
  try {
    const v = localStorage.getItem(KEY);
    return SKINS.some(([k]) => k === v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function applySkin(skin = currentSkin()) {
  document.documentElement.setAttribute('data-skin', skin);
}

export function setSkin(skin) {
  try { localStorage.setItem(KEY, skin); } catch { /* 保存できなくても表示は変える */ }
  applySkin(skin);
}
