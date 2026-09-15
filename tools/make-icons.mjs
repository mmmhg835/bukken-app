// 依存パッケージなしで PWA 用アイコン PNG を生成する。
// 使い方: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit / RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/** タワーマンションを模したアイコンを描く */
function icon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const R = size * 0.22;                       // 角丸半径
  const put = (x, y, r, g, b, a = 255) => {
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 角丸の外側は透明
      const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
      if (cx < R && cy < R && Math.hypot(R - cx, R - cy) > R) { put(x, y, 0, 0, 0, 0); continue; }
      const t = y / size;
      put(x, y, lerp(0x2d, 0x0f, t), lerp(0x5d, 0x23, t), lerp(0xf2, 0x5c, t));
    }
  }

  // 2棟のタワー
  const towers = [
    { x0: 0.24, x1: 0.46, y0: 0.30, cols: 3 },
    { x0: 0.52, x1: 0.76, y0: 0.20, cols: 3 },
  ];
  const yBase = 0.80;
  for (const t of towers) {
    const X0 = Math.round(t.x0 * size), X1 = Math.round(t.x1 * size);
    const Y0 = Math.round(t.y0 * size), Y1 = Math.round(yBase * size);
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) put(x, y, 255, 255, 255, 235);

    // 窓（背景色を透かせた矩形）
    const w = X1 - X0, h = Y1 - Y0;
    const cw = w / (t.cols * 2 + 1), rowH = h / 9;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < t.cols; c++) {
        const wx0 = Math.round(X0 + cw * (c * 2 + 1)), wx1 = Math.round(wx0 + cw);
        const wy0 = Math.round(Y0 + rowH * (r + 0.6)), wy1 = Math.round(wy0 + rowH * 0.55);
        for (let y = wy0; y < wy1; y++) for (let x = wx0; x < wx1; x++) {
          const tt = y / size;
          put(x, y, lerp(0x2d, 0x0f, tt), lerp(0x5d, 0x23, tt), lerp(0xf2, 0x5c, tt));
        }
      }
    }
  }
  // 地面のライン
  const gy0 = Math.round(yBase * size), gy1 = gy0 + Math.max(2, Math.round(size * 0.022));
  for (let y = gy0; y < gy1; y++) {
    for (let x = Math.round(size * 0.16); x < Math.round(size * 0.84); x++) put(x, y, 255, 255, 255, 235);
  }
  return png(size, size, buf);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [180, 192, 512]) {
  const out = new URL(`../icons/icon-${size}.png`, import.meta.url);
  writeFileSync(out, icon(size));
  console.log(`icons/icon-${size}.png`);
}
