// 端末側で画像を整えてからコミットする。
// 一覧・ギャラリー用の軽いサムネと、拡大表示用の本体を作り分ける。

export const QUALITY_PRESETS = {
  standard: { label: '標準（軽い）', maxEdge: 1600, quality: 0.82 },
  high:     { label: '高画質（推奨）', maxEdge: 2560, quality: 0.88 },
  original: { label: '原寸（間取り図・資料向け）', maxEdge: Infinity, quality: 1 },
};
export const DEFAULT_PRESET = 'high';

const THUMB_EDGE = 480;   // ギャラリー格子＆一覧カードの仮表示に使う
const THUMB_QUALITY = 0.78;
// properties.json に base64 で直接埋める極小サムネ（即描画用）。
// 320px・品質0.72 だと1枚48KBあり、35枚で1.4MBになって読み込みの上限に当たる。
const COVER_EDGE = 200;

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch { /* fallthrough */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function draw(bmp, maxEdge) {
  const w = bmp.width, h = bmp.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

const toBlob = (canvas, quality) =>
  new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));

/**
 * File を「本体 + サムネ + カバー用 data URL」に変換する。
 * preset が original の場合、元ファイルが JPEG ならそのまま使い再エンコードしない。
 */
export async function processImage(file, presetKey = DEFAULT_PRESET) {
  const preset = QUALITY_PRESETS[presetKey] || QUALITY_PRESETS[DEFAULT_PRESET];
  const bmp = await loadBitmap(file);
  const isJpeg = /jpe?g/i.test(file.type);

  let full, width, height;
  if (preset.maxEdge === Infinity && isJpeg) {
    // 原寸かつ JPEG なら再圧縮による劣化を避けて元データを使う
    full = file;
    width = bmp.width; height = bmp.height;
  } else {
    const canvas = draw(bmp, preset.maxEdge);
    full = await toBlob(canvas, preset.quality);
    width = canvas.width; height = canvas.height;
  }

  const thumb = await toBlob(draw(bmp, THUMB_EDGE), THUMB_QUALITY);
  const cover = draw(bmp, COVER_EDGE).toDataURL('image/jpeg', 0.62);
  bmp.close?.();
  return { full, thumb, cover, width, height };
}

/** Blob から一覧カード用の極小 data URL を作り直す（カバー変更時に使う） */
export async function coverDataUrl(blob) {
  const bmp = await loadBitmap(blob);
  const url = draw(bmp, COVER_EDGE).toDataURL('image/jpeg', 0.62);
  bmp.close?.();
  return url;
}
