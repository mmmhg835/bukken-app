// 端末側で画像を縮小してからコミットする（リポジトリを軽く保つため）
const MAX_EDGE = 1600;      // 長辺の上限 px
const QUALITY = 0.82;
const THUMB_EDGE = 420;     // 一覧カード用サムネ（properties.json に data URL で埋める）

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file); } catch { /* fallthrough */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function draw(bmp, maxEdge) {
  const w = bmp.width, h = bmp.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, cw, ch);
  return c;
}

/** File -> { blob, dataUrl(サムネ), width, height } */
export async function processImage(file) {
  const bmp = await loadBitmap(file);
  const canvas = draw(bmp, MAX_EDGE);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
  const thumb = draw(bmp, THUMB_EDGE).toDataURL('image/jpeg', 0.7);
  bmp.close?.();
  return { blob, thumb, width: canvas.width, height: canvas.height };
}
