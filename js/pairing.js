// Mac の設定を iPhone へ引き継ぐための QR 生成・読み取り。
// 設定はハッシュ（#）に載せる。ハッシュはサーバーに送信されないため、クエリ文字列より安全。
const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';

const b64urlEncode = (str) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

/** 設定を埋め込んだセットアップ用 URL を作る */
export function pairingUrl(config) {
  const payload = b64urlEncode(JSON.stringify({
    o: config.owner, r: config.repo, b: config.branch, t: config.token,
  }));
  return `${location.origin}${location.pathname}#/setup/${payload}`;
}

/** セットアップ URL のペイロードを設定に戻す。壊れていれば null */
export function parsePairing(payload) {
  try {
    const j = JSON.parse(b64urlDecode(payload));
    if (!j.o || !j.r || !j.t) return null;
    return { owner: j.o, repo: j.r, branch: j.b || 'main', token: j.t };
  } catch {
    return null;
  }
}

let libPromise;
function loadQrLib() {
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      if (window.qrcode) return resolve(window.qrcode);
      const s = document.createElement('script');
      s.src = QR_LIB;
      s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('QR ライブラリを読み込めません')));
      s.onerror = () => reject(new Error('QR ライブラリを読み込めません'));
      document.head.append(s);
    });
  }
  return libPromise;
}

/** QR を描画した <img> を返す。誤り訂正レベル M、型番は自動選択 */
export async function renderQr(text, sizePx = 340) {
  const qrcode = await loadQrLib();
  let qr;
  for (let type = 6; type <= 20; type++) {
    try {
      qr = qrcode(type, 'M');
      qr.addData(text);
      qr.make();
      break;
    } catch { qr = null; }
  }
  if (!qr) throw new Error('設定が長すぎて QR にできません');
  const cells = qr.getModuleCount();
  // 画面越しに iPhone で読み取るため、1セルは最低4pxを確保する
  const scale = Math.max(4, Math.floor(sizePx / (cells + 8)));
  const img = new Image();
  img.src = qr.createDataURL(scale, scale * 4);
  img.width = img.height = (cells + 8) * scale;
  img.alt = '設定用QRコード';
  img.style.cssText = 'border-radius:10px;background:#fff;padding:10px;image-rendering:pixelated;max-width:100%;height:auto';
  return img;
}
