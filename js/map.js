// 地図表示と住所ジオコーディング。
// 国土地理院のタイルと住所検索APIを使う。いずれも API キー不要で、日本の住所に強い。
const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
const GSI_TILE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';

/**
 * Googleマップを開くリンク。
 *
 * 地図そのものを Google に差し替えると API キーが要り、アプリ本体は公開リポジトリ
 * なのでキーを埋められない（課金の登録も必要になる）。開くだけならキーも金も要らない。
 *
 * 検索は座標ではなく「建物名＋住所」で投げる。座標だとピンが立つだけだが、
 * 名前で当たればその建物として認識され、写真・口コミ・ストリートビューまで辿れる。
 */
export function googleMapsUrls(b) {
  const q = [b?.name, b?.address].filter(Boolean).join(' ').trim();
  const at = b?.lat != null && b?.lng != null ? `${b.lat},${b.lng}` : null;
  const query = q || at;
  if (!query) return null;
  const enc = encodeURIComponent(query);
  return {
    query,
    search: `https://www.google.com/maps/search/?api=1&query=${enc}`,
    // ストリートビューは座標でしか開けない
    pano: at ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${at}` : null,
    dirTo: (dest) => `https://www.google.com/maps/dir/?api=1&origin=${enc}`
      + `&destination=${encodeURIComponent(dest)}`,
  };
}
const GSI_ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
const GSI_SEARCH = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';

let leafletPromise;
export function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      if (window.L) return resolve(window.L);
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
      document.head.append(css);
      const js = document.createElement('script');
      js.src = LEAFLET_JS;
      js.onload = () => (window.L ? resolve(window.L) : reject(new Error('地図ライブラリを読み込めませんでした')));
      js.onerror = () => reject(new Error('地図ライブラリを読み込めませんでした'));
      document.head.append(js);
    });
  }
  return leafletPromise;
}

/** 住所から緯度経度を引く。見つからなければ null */
export async function geocode(address) {
  const q = String(address || '').trim();
  if (!q) return null;
  const res = await fetch(GSI_SEARCH + encodeURIComponent(q));
  if (!res.ok) throw new Error('住所検索に失敗しました');
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return null;
  const [lng, lat] = list[0].geometry.coordinates;
  return { lat, lng, title: list[0].properties?.title || q };
}

/** 2地点の直線距離（m）。ヒュベニではなく球面近似で十分な精度 */
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 徒歩分数の目安（不動産表示の慣行にあわせ 80m/分） */
export const walkMinutes = (meters) => Math.ceil(meters / 80);

/** 番号つきの丸いピンを作る */
function pin(L, label, color) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
      background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);
      display:grid;place-items:center;">
      <span style="transform:rotate(45deg);color:#fff;font-weight:700;font-size:13px;line-height:1">${label}</span>
    </div>`,
    iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -30],
  });
}

/**
 * 地図を描く。
 * @param {HTMLElement} container
 * @param {Array} buildings 位置が入っている建物
 * @param {Array} places 参照地点（駅・職場など）
 */
export async function drawMap(container, buildings, places = []) {
  const L = await loadLeaflet();
  const map = L.map(container, { scrollWheelZoom: false });
  L.tileLayer(GSI_TILE, { attribution: GSI_ATTR, maxZoom: 18 }).addTo(map);

  const pts = [];
  buildings.forEach((b, i) => {
    const m = L.marker([b.lat, b.lng], { icon: pin(L, i + 1, '#1d4ed8') }).addTo(map);
    const g = googleMapsUrls(b);
    m.bindPopup(`<b>${escapeHtml(b.name)}</b><br>${escapeHtml(b.address || '')}<br>${b.roomSummary || ''}`
      + (g ? `<br><a href="${g.search}" target="_blank" rel="noopener">Googleマップで開く</a>` : ''));
    pts.push([b.lat, b.lng]);
  });
  places.forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: pin(L, '★', '#b45309') }).addTo(map);
    m.bindPopup(`<b>${escapeHtml(p.name)}</b><br>${escapeHtml(p.address || '')}`);
    pts.push([p.lat, p.lng]);
  });

  if (pts.length === 1) map.setView(pts[0], 16);
  else if (pts.length) map.fitBounds(pts, { padding: [40, 40] });
  else map.setView([35.6762, 139.7649], 12);

  // タブ切り替え直後は寸法が確定していないことがある
  setTimeout(() => map.invalidateSize(), 60);
  return map;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
