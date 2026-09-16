// 画面描画。すべて store の状態から組み立てる。
import { store } from './store.js';
import { el, fmt, derive, toast, mount, preserveFocus, STATUSES, debounce, APP_VERSION } from './util.js';
import { labeled, select, kv, field, ratingPicker, statusBadge, section, tagPicker, segmented, toggle } from './ui.js';
import { gallerySection } from './gallery.js';
import { calcLoan, METHODS, DEFAULT_TERMS } from './loan.js';
import { geocode, drawMap, distanceMeters, walkMinutes, googleMapsUrls } from './map.js';
import { pairingUrl, renderQr } from './pairing.js';
import { QUALITY_PRESETS } from './image.js';
import { THEMES, currentTheme, setTheme } from './theme.js';
import { SKINS, currentSkin, setSkin } from './skin.js';
import { salesSection } from './sales.js';
import { BUILDING_FORM, SPEC_GROUPS, RENOVATION } from './spec.js';
import { areaOf } from './analysis.js';
import { analyze, LISTING_STATUS, CLOSED_STATUS, formatDate } from './price.js';
import { stepChart, chartLegend, SERIES_COLORS } from './chart.js';

export const route = { view: 'list', id: null };
export let go = () => {};
export let rerender = () => {};
export function bindRouter(goFn, rerenderFn) { go = goFn; rerender = rerenderFn; }

const touch = debounce(() => store.markDirty(), 300);
const mark = () => touch();

/* =========================================================
   一覧（建物カード）
   ========================================================= */
const listUI = {
  mode: 'building', sort: 'price', status: 'all',
  // 募集状況の既定は「募集中」。終わった部屋まで並べると、比較もライフプランも意味が薄れる
  listing: 'open',
  area: 'all', price: 'all', layout: 'all', age: 'all', more: false, equip: [],
};

const ROOM_SORTS = [
  ['price', '価格が安い順'], ['tsubo', '坪単価が安い順'], ['area', '広い順'],
  ['monthly', '月額が安い順'], ['rating', '評価が高い順'], ['floor', '高層階順'],
  ['discount', '値下げ幅が大きい順'], ['days', '販売期間が長い順'],
];
const BUILDING_SORTS = [
  ['price', '最安の部屋が安い順'], ['tsubo', '坪単価が安い順'],
  ['age', '築年が新しい順'], ['rooms', '部屋数が多い順'], ['name', '名前順'],
];
const PRICE_BANDS = [
  ['all', 'すべて'], ['-8000', '8,000万円以下'], ['8000-12000', '8,000〜1.2億'],
  ['12000-15000', '1.2億〜1.5億'], ['15000-', '1.5億以上'],
];
const AGE_BANDS = [
  ['all', 'すべて'], ['-10', '築10年以内'], ['-20', '築20年以内'],
  ['-30', '築30年以内'], ['30-', '築30年超'],
];

export function renderList(root) {
  const byRoom = listUI.mode === 'room';
  if (byRoom && !ROOM_SORTS.some(([k]) => k === listUI.sort)) listUI.sort = 'price';
  if (!byRoom && !BUILDING_SORTS.some(([k]) => k === listUI.sort)) listUI.sort = 'price';

  const rooms = allRooms();
  const shown = rooms.filter(matchesFilters);

  mount(root,
    pageHead(),
    filterBar(rooms, shown, byRoom),
    byRoom ? roomListing(shown) : buildingListing(shown),
    selectionBar(rooms),
  );
}

function pageHead() {
  return el('div', { class: 'pagehead' },
    el('h2', {}, '検討中の物件'),
    el('p', {}, '気になる物件を集めて、比較・分析・将来のライフプランまで、納得のいく住まい選びをサポートします。'),
  );
}

function allRooms() {
  return store.rooms
    .map((r) => ({ r, b: store.building(r.buildingId) }))
    .filter((x) => x.b);
}

/* ===== 絞り込み ===== */
function matchesFilters({ r, b }) {
  if (listUI.status !== 'all' && r.status !== listUI.status) return false;
  if (listUI.listing !== 'all') {
    const closed = CLOSED_STATUS.includes(r.listingStatus);
    if (listUI.listing === 'open' && closed) return false;
    if (listUI.listing === 'closed' && !closed) return false;
  }
  if (listUI.area !== 'all' && areaOf(b).town !== listUI.area) return false;
  if (listUI.layout !== 'all' && r.layout !== listUI.layout) return false;
  if (listUI.equip.length) {
    const tags = [...(r.roomEquipmentTags || []), ...(b.equipmentTags || []), ...(b.facilityTags || [])];
    if (!listUI.equip.every((t) => tags.includes(t))) return false;
  }
  if (listUI.price !== 'all') {
    const [lo, hi] = listUI.price.split('-').map((v) => (v === '' ? null : Number(v)));
    if (lo != null && (r.price ?? 0) < lo) return false;
    if (hi != null && (r.price ?? 0) > hi) return false;
  }
  if (listUI.age !== 'all') {
    const age = derive(r, b).ageYears;
    if (age == null) return false;
    const [lo, hi] = listUI.age.split('-').map((v) => (v === '' ? null : Number(v)));
    if (lo != null && age < lo) return false;
    if (hi != null && age > hi) return false;
  }
  return true;
}

function filterBar(all, shown, byRoom) {
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort();
  const areas = uniq(all.map((x) => areaOf(x.b).town));
  const layouts = uniq(all.map((x) => x.r.layout));
  const pick = (key, options) => select(listUI[key], options, (v) => { listUI[key] = v; rerender(); }, 'fsel');

  const equipOptions = [...new Set(store.buildings.flatMap((b) => [...(b.equipmentTags || []), ...(b.facilityTags || [])])
    .concat(store.rooms.flatMap((r) => r.roomEquipmentTags || [])))].sort();

  return el('div', { class: 'filterbar' },
    el('div', { class: 'filterbar-row' },
      segmented(listUI.mode, [['building', '建物ごと'], ['room', '部屋ごと']],
        (v) => { listUI.mode = v; rerender(); }),
      el('div', { class: 'fgroup' }, el('label', {}, 'エリア'),
        pick('area', [['all', 'すべて'], ...areas.map((a) => [a, a])])),
      el('div', { class: 'fgroup' }, el('label', {}, '価格'), pick('price', PRICE_BANDS)),
      el('div', { class: 'fgroup' }, el('label', {}, '間取り'),
        pick('layout', [['all', 'すべて'], ...layouts.map((l) => [l, l])])),
      el('div', { class: 'fgroup' }, el('label', {}, '築年数'), pick('age', AGE_BANDS)),
      el('div', { class: 'fgroup' }, el('label', {}, '募集状況'),
        pick('listing', [['open', '募集中'], ['closed', '募集終了'], ['all', 'すべて']])),
      el('div', { class: 'fgroup' }, el('label', {}, '検討状態'),
        pick('status', [['all', 'すべて'], ...STATUSES.map((x) => [x, x])])),
      equipOptions.length
        ? el('button', {
          class: 'btn btn-sm' + (listUI.more ? ' btn-primary' : ''),
          onclick: () => { listUI.more = !listUI.more; rerender(); },
        }, `設備で絞る${listUI.equip.length ? ` (${listUI.equip.length})` : ''}`)
        : null,
      el('div', { class: 'spacer' }),
      el('span', { class: 'fcount' }, `${shown.length}件の${byRoom ? '部屋' : '物件'}`),
      el('div', { class: 'fgroup' },
        select(listUI.sort, byRoom ? ROOM_SORTS : BUILDING_SORTS,
          (v) => { listUI.sort = v; rerender(); }, 'fsel')),
      el('button', { class: 'btn btn-add', onclick: () => go('import') }, '貼り付けて取り込む'),
      el('button', {
        class: 'btn btn-primary btn-add',
        onclick: () => { const b = store.addBuilding(); go('b', b.id); },
      }, '＋ 物件を追加'),
    ),
    listUI.more
      ? el('div', { class: 'filterbar-more' },
        el('div', { class: 'tagwrap' }, equipOptions.map((t) => el('button', {
          class: 'tag' + (listUI.equip.includes(t) ? ' is-on' : ''),
          onclick: () => {
            const i = listUI.equip.indexOf(t);
            if (i >= 0) listUI.equip.splice(i, 1); else listUI.equip.push(t);
            rerender();
          },
        }, t))),
        listUI.equip.length
          ? el('button', { class: 'btn btn-sm', onclick: () => { listUI.equip = []; rerender(); } }, '解除')
          : null)
      : null,
  );
}

/* ===== 部屋ごと ===== */
function roomListing(shown) {
  const rooms = [...shown].sort(roomSorter(listUI.sort));
  if (!rooms.length) return el('div', { class: 'empty' }, '条件に合う部屋がありません');
  return el('div', { class: 'grid' }, rooms.map(({ r, b }) => propertyCard(r, b)));
}

function roomSorter(key) {
  const d = (x) => derive(x.r, x.b, store.loanTerms);
  const a = (x) => analyze(x.r);
  const by = {
    price: (x, y) => (x.r.price ?? Infinity) - (y.r.price ?? Infinity),
    tsubo: (x, y) => (d(x).tsuboPrice ?? Infinity) - (d(y).tsuboPrice ?? Infinity),
    area: (x, y) => (y.r.area ?? -1) - (x.r.area ?? -1),
    monthly: (x, y) => (d(x).monthly ?? Infinity) - (d(y).monthly ?? Infinity),
    rating: (x, y) => (y.r.rating ?? 0) - (x.r.rating ?? 0),
    floor: (x, y) => (y.r.floor ?? -1) - (x.r.floor ?? -1),
    discount: (x, y) => (a(x).totalChange ?? 0) - (a(y).totalChange ?? 0),
    days: (x, y) => (a(y).salesDays ?? -1) - (a(x).salesDays ?? -1),
  };
  return by[key] || by.price;
}

/* ===== 建物ごと ===== */
function buildingListing(shown) {
  const byBuilding = new Map();
  for (const x of shown) {
    if (!byBuilding.has(x.b.id)) byBuilding.set(x.b.id, { b: x.b, rooms: [] });
    byBuilding.get(x.b.id).rooms.push(x.r);
  }
  const items = [...byBuilding.values()].sort(buildingSorter(listUI.sort));
  if (!items.length) return el('div', { class: 'empty' }, '条件に合う物件がありません');
  return el('div', { class: 'grid' }, items.map(({ b, rooms }) => buildingCard(b, rooms)));
}

function buildingSorter(key) {
  const minPrice = (rooms) => Math.min(...rooms.map((r) => r.price ?? Infinity), Infinity);
  const minTsubo = (rooms) => Math.min(...rooms.map((r) => derive(r).tsuboPrice ?? Infinity), Infinity);
  const by = {
    price: (x, y) => minPrice(x.rooms) - minPrice(y.rooms),
    tsubo: (x, y) => minTsubo(x.rooms) - minTsubo(y.rooms),
    age: (x, y) => String(y.b.builtYM).localeCompare(String(x.b.builtYM)),
    rooms: (x, y) => y.rooms.length - x.rooms.length,
    name: (x, y) => String(x.b.name).localeCompare(String(y.b.name), 'ja'),
  };
  return by[key] || by.price;
}

/* ===== カード ===== */
function coverImage(owner, alt) {
  const img = owner.cover || owner.coverThumb
    ? el('img', { src: owner.coverThumb || '', alt, loading: 'lazy' })
    : null;
  if (img && owner.cover) store.imageUrl(owner.cover).then((u) => { img.src = u; }).catch(() => {});
  return img || el('div', { class: 'ph' }, '写真なし');
}

function pickBox(ids) {
  const on = ids.every((id) => isPicked(id)) && ids.length > 0;
  return el('label', {
    class: 'pickbox' + (on ? ' is-on' : ''),
    onclick: (e) => { e.stopPropagation(); ids.forEach((id) => togglePick(id, !on)); rerender(); },
  }, el('span', { class: 'pickbox-mark' }, on ? '✓' : ''), '比較に追加');
}

const ICON = {
  train: 'M6 3h8a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2zM4 8h12M7 17l-2 2M13 17l2 2',
  leaf: 'M16 4C9 4 5 8 5 14c0 1 0 2 1 2 6 0 10-5 10-12zM6 16c2-4 5-6 8-7',
  cal: 'M4 5h12v12H4zM4 8h12M8 3v3M12 3v3',
  yen: 'M6 4l4 5 4-5M10 9v7M7 12h6M7 15h6',
};

function featureTag(icon, text) {
  return el('span', { class: 'ftag' },
    el('svg', { viewBox: '0 0 20 20', class: 'ftag-ico', html: `<path d="${ICON[icon]}"/>` }),
    text);
}

/** 部屋1室のカード。参考画面と同じ並びにしている */
function propertyCard(r, b) {
  const c = derive(r, b, store.loanTerms);
  const t = { ...store.loanTerms, ...(r.loan || {}) };

  return el('article', { class: 'card pcard', onclick: () => go('r', r.id) },
    el('div', { class: 'pcard-top' },
      pickBox([r.id]),
      statusBadge(r.status),
    ),
    el('div', { class: 'pcard-img' },
      coverImage(r, r.label),
      r.images?.length ? el('span', { class: 'imgcount' }, `${r.images.length}枚`) : null,
    ),
    el('div', { class: 'pcard-body' },
      el('div', { class: 'pcard-name' }, b.name),
      el('div', { class: 'pcard-addr' }, b.address || b.stations || ''),
      el('div', { class: 'pcard-spec' },
        el('span', {}, `${r.floor ?? '—'}階・${r.layout || '—'}`),
        el('i', {}, '|'),
        el('span', {}, `${fmt.sqm(r.area)}（${fmt.n(c.tsubo, 2)}坪）`),
      ),
      el('div', { class: 'pcard-pricerow' },
        el('div', { class: 'pcard-price' }, fmt.man1(r.price), el('small', {}, '万円')),
        r.rating ? el('div', { class: 'pcard-rate' }, el('span', { class: 'stars' }, '★'), r.rating.toFixed(1)) : null,
      ),
      el('dl', { class: 'pcard-kv' },
        el('dt', {}, '坪単価'), el('dd', {}, `約${fmt.n(c.tsuboPrice, 0)}万円/坪`),
        el('dt', {}, '月々の支払い'),
        el('dd', {}, `約${fmt.n(c.monthly, 1)}万円`,
          el('small', {}, `（年${t.rate}%・${t.years}年）`)),
      ),
      el('div', { class: 'ftags' },
        b.walk ? featureTag('train', b.walk) : null,
        c.ageYears != null ? featureTag('cal', `築${c.ageYears}年`) : null,
        r.renovation && r.renovation !== 'なし' ? featureTag('leaf', r.renovation) : null,
      ),
    ),
  );
}

/** 建物のカード。配下の部屋をまとめて表す */
function buildingCard(b, rooms) {
  const cover = b.cover ? b : (rooms.find((r) => r.cover) || b);
  const prices = rooms.map((r) => r.price).filter((v) => v != null);
  const c = derive(rooms[0] || {}, b, store.loanTerms);
  const imageCount = (b.images?.length || 0) + rooms.reduce((n, r) => n + (r.images?.length || 0), 0);

  return el('article', { class: 'card pcard', onclick: () => go('b', b.id) },
    el('div', { class: 'pcard-top' },
      pickBox(rooms.map((r) => r.id)),
      el('span', { class: 'badge badge-ok' }, `${rooms.length}部屋`),
    ),
    el('div', { class: 'pcard-img' },
      coverImage(cover, b.name),
      imageCount ? el('span', { class: 'imgcount' }, `${imageCount}枚`) : null,
    ),
    el('div', { class: 'pcard-body' },
      el('div', { class: 'pcard-name' }, b.name || '(名称未設定)'),
      el('div', { class: 'pcard-addr' }, b.address || b.stations || ''),
      el('div', { class: 'pcard-spec' },
        el('span', {}, `${b.totalFloors ?? '—'}階建`),
        el('i', {}, '|'),
        el('span', {}, b.builtYM || '築年月未設定'),
      ),
      prices.length
        ? el('div', { class: 'pcard-pricerow' },
          el('div', { class: 'pcard-price' }, fmt.man1(Math.min(...prices)),
            prices.length > 1
              ? el('small', {}, `〜 ${fmt.man1(Math.max(...prices))} 万円`)
              : el('small', {}, '万円')))
        : el('div', { class: 'muted tiny' }, '価格未入力'),
      el('div', { class: 'roomchips' }, rooms.map((r) =>
        // 指値を入れてある部屋は一覧の段階で分かるようにする。
        // どこまで検討が進んでいるかが、開かないと分からなかったため。
        el('span', { class: 'roomchip' + (r.status === '本命' ? ' is-top' : '') },
          `${r.label}・${fmt.man1(r.price)}万`,
          r.offerPrice != null && r.offerPrice !== r.price
            ? el('span', { class: 'roomchip-offer' }, `指値 ${fmt.man1(r.offerPrice)}`)
            : null))),
      el('div', { class: 'ftags' },
        b.walk ? featureTag('train', b.walk) : null,
        c.ageYears != null ? featureTag('cal', `築${c.ageYears}年`) : null,
      ),
    ),
  );
}

/* ===== 下部の選択バー ===== */
function selectionBar(all) {
  const count = all.filter((x) => isPicked(x.r.id)).length;
  return el('div', { class: 'selbar' + (count ? ' is-on' : '') },
    el('div', { class: 'selbar-in' },
      el('div', {},
        el('div', { class: 'selbar-count' }, `${count} 室を選択中`),
        el('div', { class: 'tiny muted' },
          count ? '比較して検討できます' : '気になる部屋を選んで、比較してみましょう。'),
      ),
      el('button', {
        class: 'btn btn-primary', disabled: !count,
        onclick: () => go('compare'),
      }, `比較する（${count}室）`),
    ));
}

/* =========================================================
   建物詳細
   ========================================================= */
export function renderBuilding(root, id) {
  const b = store.building(id);
  if (!b) { go('list'); return; }
  const rooms = store.roomsOf(b.id);

  const head = el('div', { class: 'detail-head' },
    el('h2', { id: 'detailName' }, b.name || '(名称未設定)'),
    el('button', {
      class: 'btn btn-sm btn-danger',
      onclick: async () => {
        if (!confirm(`「${b.name}」と、配下の ${rooms.length} 部屋をすべて削除します。よろしいですか？`)) return;
        await store.deleteBuilding(b.id); go('list'); toast('削除しました');
      },
    }, '建物を削除'),
  );

  const forms = BUILDING_FORM.map(([title, fields]) =>
    el('div', { class: 'section' },
      el('h3', {}, title),
      el('div', { class: 'card form' },
        fields.map((spec) => field(b, spec, (key) => {
          if (key === 'name') document.getElementById('detailName').textContent = b.name || '(名称未設定)';
          mark();
        }))),
      title === '基本情報' ? locationBox(b) : null,
    ));

  mount(root,
    el('button', { class: 'back', onclick: () => go('list') }, '‹ 一覧へ戻る'),
    head,
    section(`部屋（${rooms.length}）`, roomList(b, rooms)),
    specSection(b, 'building'),
    ...forms,
    gallerySection(b, rerender, '建物の写真（外観・エントランス・共用部）'),
    mrPhotos(b),
  );
}

/**
 * マンションレビューに載っている写真。
 * 画像そのものは取り込まない（第三者が権利を持つため、規約でも転載を断っている）。
 * URL だけ持って、向こうから読んで出す。
 */
function mrPhotos(b) {
  const list = b.photos || [];
  if (!list.length) return null;
  return el('div', { class: 'section' },
    el('h3', {}, 'マンションレビューの写真'),
    el('div', { class: 'mrpics' }, list.map((src) =>
      el('a', { href: b.url || src, target: '_blank', rel: 'noreferrer' },
        el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })))));
}

/** 設備のチェックリスト。建物と部屋で対象グループを切り替える */
function specSection(owner, on) {
  const groups = Object.entries(SPEC_GROUPS).filter(([, g]) => g.on === on);
  return el('div', { class: 'section' },
    el('h3', {}, on === 'building' ? '建物の設備・施設' : '専有設備'),
    el('div', { class: 'card', style: 'padding:14px' },
      groups.map(([key, g]) => el('div', { class: 'specgroup' },
        el('h4', {}, `${g.label}（${(owner[key] || []).length}）`),
        tagPicker(owner, key, g.options, mark, g.sections),
      ))),
  );
}

function roomList(b, rooms) {
  const wrap = el('div', { class: 'grid grid-rooms' },
    rooms.map((r) => roomCard(r, b)),
    el('button', {
      class: 'card addcard',
      onclick: () => { const r = store.addRoom(b.id); go('r', r.id); },
    }, '＋ 部屋を追加'),
  );
  return wrap;
}

function roomCard(r, b, showBuilding = false) {
  const c = derive(r, b, store.loanTerms);
  const img = r.cover || r.coverThumb ? el('img', { src: r.coverThumb || '', alt: r.label, loading: 'lazy' }) : null;
  if (img && r.cover) store.imageUrl(r.cover).then((u) => { img.src = u; }).catch(() => {});

  return el('article', { class: 'card rcard', onclick: () => go('r', r.id) },
    el('div', { class: 'rcard-img' }, img || el('div', { class: 'ph' }, '—')),
    el('div', { class: 'rcard-body' },
      showBuilding ? el('div', { class: 'tiny muted', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, b.name) : null,
      el('div', { class: 'pcard-top' },
        el('div', { class: 'pcard-name' }, r.label || '(部屋)'),
        statusBadge(r.status),
      ),
      el('div', { class: 'pcard-price' }, fmt.man1(r.price), el('small', {}, '万円')),
      el('div', { class: 'kvrow' },
        el('span', {}, `${fmt.sqm(r.area)}・${r.layout || '—'}`),
        el('span', {}, `坪 ${fmt.n(c.tsuboPrice, 1)}万`),
      ),
      el('div', { class: 'kvrow' }, el('span', {}, `月額 ${fmt.yen万(c.monthly)}`)),
      r.rating ? el('div', { class: 'stars' }, fmt.stars(r.rating)) : null,
    ),
  );
}

/** 住所 → 緯度経度 と、参照地点からの距離 */
function locationBox(b) {
  const status = el('div', { class: 'tiny muted', style: 'margin-top:8px' },
    b.lat != null ? `位置: ${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}` : '位置が未設定です');
  const mapBox = el('div', { class: 'minimap' });

  const paintMap = () => {
    if (b.lat == null) return;
    drawMap(mapBox, [{ ...b, roomSummary: `${store.roomsOf(b.id).length}部屋` }], store.places)
      .catch((e) => { mapBox.textContent = e.message; });
  };
  paintMap();

  const btn = el('button', {
    class: 'btn btn-sm',
    onclick: async () => {
      if (!b.address) { toast('先に住所を入力してください', true); return; }
      btn.disabled = true;
      status.textContent = '住所を検索しています…';
      try {
        const hit = await geocode(b.address);
        if (!hit) { status.textContent = '住所が見つかりませんでした。番地まで入れると精度が上がります。'; return; }
        b.lat = hit.lat; b.lng = hit.lng;
        store.markDirty();
        status.textContent = `位置を設定しました（${hit.title}）`;
        paintMap();
      } catch (e) {
        status.textContent = e.message;
      } finally { btn.disabled = false; }
    },
  }, '住所から地図上の位置を取得');

  // Googleマップは埋め込まずに開くだけにしてある。API キーも課金も要らず、
  // 写真・口コミ・ストリートビュー・経路はあちらのほうが揃っているため。
  const g = googleMapsUrls(b);
  const ext = (href, label) => el('a', {
    href, target: '_blank', rel: 'noopener', class: 'btn btn-sm',
  }, label);

  const dists = store.places.filter((p) => b.lat != null).map((p) => {
    const m = distanceMeters(b, p);
    return el('div', {},
      `${p.name} まで 約${(m / 1000).toFixed(2)}km（徒歩約${walkMinutes(m)}分）`,
      g && (p.address || p.name)
        ? el('a', {
          href: g.dirTo(p.address || p.name), target: '_blank', rel: 'noopener',
          class: 'tiny', style: 'margin-left:8px',
        }, '経路')
        : null);
  });

  return el('div', { style: 'margin-top:12px' },
    btn, status,
    g
      ? el('div', { class: 'toolbar', style: 'margin:10px 0 0' },
        ext(g.search, 'Googleマップで開く'),
        g.pano ? ext(g.pano, 'ストリートビュー') : null)
      : null,
    dists.length ? el('div', { class: 'tiny muted', style: 'margin-top:8px;line-height:1.9' }, dists) : null,
    mapBox,
  );
}

/* =========================================================
   部屋詳細
   ========================================================= */
const ROOM_FIELDS = [
  ['label', '部屋の呼び名（例 19階 角住戸）', 'text', true],
  ['price', '価格（万円）', 'number'],
  ['area', '専有面積（㎡）', 'number'],
  ['layout', '間取り', 'text'],
  ['floor', '所在階', 'number'],
  ['balcony', 'バルコニー（㎡）', 'number'],
  ['kanrihi', '管理費（万円/月）', 'number'],
  ['shuzen', '修繕積立金（万円/月）', 'number'],
  ['url', '掲載ページのURL', 'text', true],
  ['viewNote', '眺望・住戸特徴', 'textarea'],
  ['roomNote', '間取り・室内メモ', 'textarea'],
  ['memo', '自由メモ', 'textarea'],
];

export function renderRoom(root, id) {
  const r = store.room(id);
  if (!r) { go('list'); return; }
  const b = store.building(r.buildingId);

  const calcBox = el('div', { class: 'calcgrid calcgrid-6' });
  const loanBox = el('div');
  const paint = () => { paintCalc(calcBox, r, b); paintLoan(loanBox, r, b, paint); };
  paint();

  const head = el('div', { class: 'detail-head' },
    el('div', { style: 'flex:1;min-width:200px' },
      el('div', { class: 'tiny muted' }, b?.name || ''),
      el('h2', { id: 'detailName' }, r.label || '(部屋)'),
    ),
    select(r.status, STATUSES.map((s) => [s, s]), (v) => { r.status = v; mark(); }),
    ratingPicker(r, mark),
    el('button', {
      class: 'btn btn-sm btn-danger',
      onclick: async () => {
        if (!confirm(`「${r.label}」を削除します。画像ファイルはリポジトリに残ります。よろしいですか？`)) return;
        await store.deleteRoom(r.id); go('b', b.id); toast('削除しました');
      },
    }, '削除'),
  );

  const form = el('div', { class: 'card form' },
    ROOM_FIELDS.map((spec) => field(r, spec, (key) => {
      if (key === 'label') document.getElementById('detailName').textContent = r.label || '(部屋)';
      paint();
      mark();
    })),
  );

  const buildingPicker = store.buildings.length > 1
    ? el('div', { class: 'toolbar' }, labeled('所属する建物',
      select(r.buildingId, store.buildings.map((x) => [x.id, x.name]), (v) => {
        store.moveRoom(r.id, v); toast('建物を変更しました'); go('b', v);
      })))
    : null;

  mount(root,
    el('button', { class: 'back', onclick: () => go('b', r.buildingId) }, '‹ 一覧へ戻る'),
    head,
    buildingLink(b),
    section(null, calcBox),
    salesSection(r, () => { paint(); }),
    section('資金計画', loanBox),
    section('リノベーション', renovationRow(r)),
    section('部屋情報', buildingPicker, form),
    specSection(r, 'room'),
    gallerySection(r, rerender, '部屋の写真（室内・間取り図・眺望）'),
  );
}

/** リノベの有無は価格差の理由になるので、自由記述とは別に区分として持つ */
function renovationRow(r) {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-controls' },
      el('div', { class: 'ctlrow' },
        el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '✦'), 'リノベ区分'),
        segmented(r.renovation || 'なし', RENOVATION.map((x) => [x, x]),
          (v) => { r.renovation = v; mark(); rerender(); })),
      el('div', { class: 'ctlrow' },
        el('span', { class: 'ctllabel' }, el('i', { class: 'ctlicon' }, '✎'), '内容'),
        el('textarea', {
          class: 'renotext', rows: 2, placeholder: '例: 2026/06完了（水回り・壁床・全室・建具等）',
          oninput: (e) => { r.reform = e.target.value; mark(); },
        }, r.reform ?? '')),
    ));
}

/** 部屋から建物へ一手で戻れるようにする。写真を交互に見るとき往復が多いため */
function buildingLink(b) {
  if (!b) return null;
  const img = el('img', { class: 'blink-img', src: b.coverThumb || '', alt: '' });
  if (b.cover) store.imageUrl(b.cover).then((u) => { img.src = u; }).catch(() => {});
  const rooms = store.roomsOf(b.id);
  return el('button', { class: 'blink', onclick: () => go('b', b.id) },
    img,
    el('div', { class: 'blink-body' },
      el('div', { class: 'tiny muted' }, '建物の情報・外観写真を見る'),
      el('div', { class: 'blink-name' }, b.name),
      el('div', { class: 'tiny muted' },
        `${b.builtYM || '—'}・${b.totalFloors ?? '—'}階建・${rooms.length}部屋`
        + `　写真${b.images?.length || 0}枚`),
    ),
    el('span', { class: 'blink-arrow' }, '›'),
  );
}

function paintCalc(box, r, b) {
  const d = derive(r, b, store.loanTerms);
  mount(box,
    kv('坪単価', `${fmt.n(d.tsuboPrice, 1)}万円`, `${fmt.n(d.tsubo, 2)}坪`),
    kv('ローン返済', `${fmt.yen万(d.loanMonthly)}/月`),
    kv('管理＋修繕', `${fmt.yen万(d.kanriShuzen)}/月`),
    kv('月額合計', `${fmt.yen万(d.monthly)}/月`, d.refMonthly != null ? `掲載値 ${fmt.yen万(d.refMonthly)}` : null),
    kv('年額合計', `${fmt.yen万(d.yearly)}/年`),
    kv('築年数', d.ageYears != null ? `${d.ageYears}年` : '—'),
  );
}

/** 資金計画。共通条件を使うか、この部屋だけ別条件にするかを切り替えられる */
function paintLoan(box, r, b, repaint) {
  const usingOwn = !!r.loan;
  const terms = { ...store.loanTerms, ...(r.loan || {}) };
  const loan = calcLoan(r.price, terms);

  const editable = usingOwn ? r.loan : store.loanTerms;
  // 金利や頭金を1文字打つたびに入力欄ごと組み直すので、フォーカスを明示的に保つ
  const onEdit = () => { store.markDirty(); preserveFocus(repaint); };

  const inputs = el('div', { class: 'card form' },
    field(editable, ['downPayment', '頭金（万円）', 'number'], onEdit),
    field(editable, ['rate', '金利（年利％）', 'number'], onEdit),
    field(editable, ['years', '返済年数', 'number'], onEdit),
    el('div', { class: 'field' },
      el('label', {}, '返済方式'),
      select(terms.method, Object.entries(METHODS), (v) => { editable.method = v; onEdit(); })),
    field(editable, ['costRate', '諸費用（価格の％）', 'number'], onEdit),
    field(editable, ['costFixed', '諸費用の定額分（万円）', 'number'], onEdit),
  );

  const result = el('div', { class: 'calcgrid calcgrid-6' },
    kv('諸費用', fmt.man(Math.round(loan.fees)),
      `価格の${terms.costRate}%${terms.costFixed ? ` ＋ ${terms.costFixed}万` : ''}`),
    kv('購入時の現金', fmt.man(Math.round(loan.cash)),
      terms.includeFees !== false ? '頭金のみ' : '頭金＋諸費用'),
    kv('借入額', fmt.man(Math.round(loan.principal)),
      terms.includeFees !== false ? '諸費用を含む' : '物件価格のみ'),
    kv('毎月返済', `${fmt.yen万(loan.monthly)}`,
      terms.method === 'principal' ? `初回。最終回 ${fmt.yen万(loan.monthlyLast)}` : null),
    kv('総返済額', fmt.man(Math.round(loan.totalPayment))),
    kv('うち利息', fmt.man(Math.round(loan.totalInterest))),
    kv('初回の内訳', `元金 ${fmt.yen万(loan.firstPrincipal)}`, `利息 ${fmt.yen万(loan.firstInterest)}`),
  );

  mount(box,
    el('div', { class: 'toolbar' },
      el('label', { class: 'tiny muted', style: 'display:flex;gap:6px;align-items:center' },
        el('input', {
          type: 'checkbox', checked: usingOwn,
          onchange: (e) => {
            r.loan = e.target.checked ? { ...store.loanTerms } : null;
            store.markDirty(); repaint();
          },
        }),
        'この部屋だけ別条件にする'),
      el('div', { class: 'spacer' }),
      el('span', { class: 'tiny muted' },
        usingOwn ? 'この部屋の条件' : '共通条件（設定タブで変更）'),
    ),
    result,
    usingOwn ? inputs : null,
  );
}

/* =========================================================
   比較（部屋を列にした表）
   ========================================================= */
/** 比較対象に選んだ部屋の id。一覧のチェックと比較タブで共有する */
const selection = new Set();
let pickerOpen = true;

export const isPicked = (id) => selection.has(id);
export function togglePick(id, on) {
  if (on ?? !selection.has(id)) selection.add(id); else selection.delete(id);
}

export function renderCompare(root) {
  const all = [];
  for (const b of store.buildings) {
    for (const r of store.roomsOf(b.id)) all.push({ b, r });
  }
  if (!all.length) { mount(root, el('div', { class: 'empty' }, '比較する部屋がありません。')); return; }

  const ids = new Set(all.map((x) => x.r.id));
  for (const id of [...selection]) if (!ids.has(id)) selection.delete(id);   // 削除済みを掃除

  // 未選択なら全件を対象にする。比較タブを開いた直後に何も出ないのを避ける
  const picked = selection.size ? all.filter((x) => selection.has(x.r.id)) : all;
  const rows = picked.map((x) => ({ ...x, c: derive(x.r, x.b, store.loanTerms), a: analyze(x.r) }));

  mount(root,
    picker(all),
    rows.length
      ? el('div', {}, priceChart(rows), compareTable(rows))
      : el('div', { class: 'empty' }, '比較する部屋を選んでください。上のパネルからタップで選べます。'),
  );
}

/**
 * 比較対象の選択。
 * 建物ごとにまとめ、価格と広さを出したまま選べるようにする
 * （名前だけのチェックボックスでは、どれを外すべきか判断できないため）。
 */
function picker(all) {
  const total = all.length;
  const count = selection.size;

  const act = (label, fn) => el('button', {
    class: 'btn btn-sm',
    onclick: (e) => { e.stopPropagation(); fn(); rerender(); },
  }, label);

  const head = el('div', { class: 'picker-head', onclick: () => { pickerOpen = !pickerOpen; rerender(); } },
    el('span', { class: 'picker-title' }, '比較する部屋'),
    el('span', { class: 'badge badge-ok' }, count ? `${count} / ${total} 件` : `全 ${total} 件`),
    el('div', { class: 'spacer' }),
    act('すべて', () => all.forEach((x) => selection.add(x.r.id))),
    act('解除', () => selection.clear()),
    act('募集中のみ', () => {
      selection.clear();
      all.filter((x) => !CLOSED_STATUS.includes(x.r.listingStatus)).forEach((x) => selection.add(x.r.id));
    }),
    el('span', { class: 'picker-caret' + (pickerOpen ? ' is-open' : '') }, '▾'),
  );

  if (!pickerOpen) {
    return el('div', { class: 'card picker' }, head,
      el('div', { class: 'picker-summary' },
        all.filter((x) => selection.has(x.r.id)).map((x) =>
          el('span', { class: 'roomchip is-top' }, `${x.b.name} ${x.r.label}`))));
  }

  const groups = store.buildings.map((b) => {
    const rooms = all.filter((x) => x.b.id === b.id);
    if (!rooms.length) return null;
    const onCount = rooms.filter((x) => selection.has(x.r.id)).length;
    const allOn = onCount === rooms.length;

    return el('div', { class: 'bgroup' },
      el('div', { class: 'bgroup-head' },
        el('button', {
          class: 'btn btn-sm' + (allOn ? ' btn-primary' : ''),
          onclick: () => {
            rooms.forEach((x) => (allOn ? selection.delete(x.r.id) : selection.add(x.r.id)));
            rerender();
          },
        }, allOn ? '✓ 棟すべて' : '棟すべて'),
        el('span', { class: 'bgroup-name' }, b.name),
        el('span', { class: 'tiny muted' }, `${onCount}/${rooms.length}`),
      ),
      el('div', { class: 'rtiles' }, rooms.map(({ r }) => roomTile(r, b))),
    );
  });

  return el('div', { class: 'card picker' }, head, el('div', { class: 'picker-body' }, groups));
}

/**
 * 選択の1行。3行のカードを敷き詰めると、数字が縦に揃わず探すのに目が滑る。
 * 1行に固定幅の列で並べて、価格・面積・坪単価が列として読めるようにする。
 */
function roomTile(r, b) {
  const on = selection.has(r.id);
  const c = derive(r, b, store.loanTerms);
  const closed = CLOSED_STATUS.includes(r.listingStatus);

  return el('button', {
    class: 'rtile' + (on ? ' is-on' : '') + (closed ? ' is-closed' : ''),
    onclick: () => { if (on) selection.delete(r.id); else selection.add(r.id); rerender(); },
  },
    el('span', { class: 'rtile-check' }, on ? '✓' : ''),
    el('span', { class: 'rtile-name' }, r.label || '(部屋)'),
    el('span', { class: 'rtile-price' }, `${fmt.man1(r.price)}万`),
    el('span', { class: 'rtile-area' }, r.area != null ? `${r.area}㎡` : '—'),
    el('span', { class: 'rtile-tsubo' }, c.tsuboPrice != null ? `坪${fmt.n(c.tsuboPrice, 0)}` : '—'),
  );
}

/** 選んだ部屋の価格推移を重ねる */
function priceChart(rows) {
  const series = rows
    .filter((x) => x.a.history.length)
    .map((x, i) => ({
      name: `${x.b.name} ${x.r.label}`,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      points: x.a.history.map((h) => ({ date: h.date, price: h.price })),
      open: !x.a.closed,
    }));

  if (!series.length) {
    return el('div', { class: 'card', style: 'padding:16px;margin-bottom:14px' },
      el('h3', { style: 'margin-bottom:6px' }, '価格の推移'),
      el('div', { class: 'empty' }, '価格の推移が登録されていません'));
  }

  return el('div', { class: 'section' },
    el('h3', {}, '価格の推移'),
    el('div', { class: 'chartwrap' }, stepChart(series, { height: 300 }), chartLegend(series)),

  );
}

/* ===== 比較表の項目定義 =====
   [見出し, 値の文字列, 数値(強調用), 'min'|'max', 長文か]
   セクションに分けて折りたたみ、既定では差がある項目だけを出す。
   項目を全部並べると縦に長くなりすぎ、違いを探すのに向かないため。 */
/** 相場の出どころ。内見タブの指値表と同じ並びにしてある */
const MARKET_COLS = [['marketIsoge', 'ISOGE'], ['marketMrev', 'マンレビ']];

/** 相場坪単価 − 指値の坪単価。＋ほど相場より安く買えるという向き */
function marketGap(x, key) {
  const m = x.r[key] ?? null;
  if (m == null || x.r.offerPrice == null || !x.c.tsubo) return null;
  return m - x.r.offerPrice / x.c.tsubo;
}

function compareSections() {
  const tag = (key) => (x) => {
    const list = (x.r[key] ?? x.b[key] ?? []);
    return list.length ? list.join('・') : '—';
  };
  return [
    ['価格', true, [
      ['現在価格', (x) => fmt.man1(x.r.price) + '万円', (x) => x.r.price, 'min'],
      ['当初価格', (x) => (x.a.initial != null ? fmt.man1(x.a.initial) + '万円' : '—')],
      ['値下げ額', (x) => (x.a.totalChange ? `${fmt.man1(Math.round(x.a.totalChange))}万円（${x.a.changeRate.toFixed(1)}%）` : '—'),
        (x) => x.a.totalChange, 'min'],
      ['諸費用', (x) => fmt.man1(Math.round(x.c.loan?.fees ?? 0)) + '万円', (x) => x.c.loan?.fees, 'min'],
      ['価格＋諸費用', (x) => fmt.man1(Math.round((x.r.price ?? 0) + (x.c.loan?.fees ?? 0))) + '万円',
        (x) => (x.r.price != null ? x.r.price + (x.c.loan?.fees ?? 0) : null), 'min'],
      ['坪単価', (x) => fmt.n(x.c.tsuboPrice, 1) + '万円', (x) => x.c.tsuboPrice, 'min'],
      ['㎡単価', (x) => (x.r.price && x.r.area ? fmt.n(x.r.price / x.r.area, 2) + '万円' : '—'),
        (x) => (x.r.price && x.r.area ? x.r.price / x.r.area : null), 'min'],
    ]],
    ['指値・相場', true, [
      ['指値', (x) => (x.r.offerPrice != null ? fmt.man1(x.r.offerPrice) + '万円' : '—'),
        (x) => x.r.offerPrice, 'min'],
      ['値引き率', (x) => (x.r.offerPrice != null && x.r.price
        ? `${((1 - x.r.offerPrice / x.r.price) * 100).toFixed(1)}%` : '—'),
      (x) => (x.r.offerPrice != null && x.r.price ? 1 - x.r.offerPrice / x.r.price : null), 'max'],
      ['指値の坪単価', (x) => (x.r.offerPrice != null && x.c.tsubo
        ? fmt.n(x.r.offerPrice / x.c.tsubo, 1) + '万円' : '—'),
      (x) => (x.r.offerPrice != null && x.c.tsubo ? x.r.offerPrice / x.c.tsubo : null), 'min'],
      ...MARKET_COLS.flatMap(([key, label]) => [
        [`${label} 相場坪`, (x) => (x.r[key] != null ? fmt.n(x.r[key], 1) + '万円' : '—'),
          (x) => x.r[key], 'max'],
        [`${label}との差`, (x) => {
          const g = marketGap(x, key);
          return g == null ? '—' : `${g >= 0 ? '+' : '▲'}${fmt.n(Math.abs(g), 0)}万円/坪`;
        }, (x) => marketGap(x, key), 'max'],
      ]),
    ]],
    ['毎月の支払い', true, [
      ['管理費', (x) => fmt.yen万(x.r.kanrihi) + '/月', (x) => x.r.kanrihi, 'min'],
      ['修繕積立金', (x) => fmt.yen万(x.r.shuzen) + '/月', (x) => x.r.shuzen, 'min'],
      ['管理＋修繕', (x) => fmt.yen万(x.c.kanriShuzen) + '/月', (x) => x.c.kanriShuzen, 'min'],
      ['ランニング㎡単価', (x) => (x.c.kanriShuzen && x.r.area ? `${Math.round(x.c.kanriShuzen * 10000 / x.r.area)}円/㎡` : '—'),
        (x) => (x.c.kanriShuzen && x.r.area ? x.c.kanriShuzen * 10000 / x.r.area : null), 'min'],
      ['ローン返済', (x) => fmt.yen万(x.c.loanMonthly) + '/月', (x) => x.c.loanMonthly, 'min'],
      ['月額合計', (x) => fmt.yen万(x.c.monthly) + '/月', (x) => x.c.monthly, 'min'],
      ['年額合計', (x) => fmt.yen万(x.c.yearly) + '/年', (x) => x.c.yearly, 'min'],
    ]],
    ['資金計画', false, [
      ['総返済額', (x) => fmt.man1(Math.round(x.c.loan?.totalPayment ?? 0)) + '万円', (x) => x.c.loan?.totalPayment, 'min'],
      ['うち利息', (x) => fmt.man1(Math.round(x.c.loan?.totalInterest ?? 0)) + '万円', (x) => x.c.loan?.totalInterest, 'min'],
      ['借入額', (x) => fmt.man1(Math.round(x.c.loan?.principal ?? 0)) + '万円', (x) => x.c.loan?.principal, 'min'],
      ['購入時の現金', (x) => fmt.man1(Math.round(x.c.loan?.cash ?? 0)) + '万円', (x) => x.c.loan?.cash, 'min'],
      ['ローン条件', (x) => {
        const t = { ...store.loanTerms, ...(x.r.loan || {}) };
        return `${t.rate}% ${t.years}年${x.c.usesOwnTerms ? '（個別）' : ''}`;
      }],
      ['掲載サイトの月額', (x) => (x.c.refMonthly != null ? fmt.yen万(x.c.refMonthly) + '/月' : '—')],
    ]],
    ['広さ・間取り', true, [
      ['専有面積', (x) => fmt.sqm(x.r.area), (x) => x.r.area, 'max'],
      ['間取り', (x) => x.r.layout || '—'],
      ['バルコニー', (x) => fmt.sqm(x.r.balcony), (x) => x.r.balcony, 'max'],
      ['所在階', (x) => (x.r.floor != null ? `${x.r.floor}階` : '—'), (x) => x.r.floor, 'max'],
    ]],
    ['販売活動', true, [
      ['募集状況', (x) => x.r.listingStatus || '募集中'],
      ['登録日', (x) => formatDate(x.a.listedAt)],
      ['販売期間', (x) => (x.a.salesDays != null ? `${x.a.salesDays}日` : '—'), (x) => x.a.salesDays, 'max'],
      ['価格改定回数', (x) => `${x.a.changeCount}回`, (x) => x.a.changeCount, 'max'],
      ['初回改定まで', (x) => (x.a.firstChange ? `${x.a.firstChange.days}日 / ${fmt.man1(Math.round(x.a.firstChange.amount))}万円` : '—')],
    ]],
    ['建物', false, [
      ['建物名', (x) => x.b.name || '—'],
      ['築年月（築年数）', (x) => `${x.b.builtYM || '—'}${x.c.ageYears != null ? `（${x.c.ageYears}年）` : ''}`,
        (x) => x.c.ageYears, 'min'],
      ['総階数', (x) => (x.b.totalFloors != null ? `${x.b.totalFloors}階建` : '—'), (x) => x.b.totalFloors, 'max'],
      ['総戸数', (x) => (x.b.totalUnits != null ? `${x.b.totalUnits}戸` : '—'), (x) => x.b.totalUnits, 'max'],
      ['最寄駅', (x) => x.b.stations || '—'],
      ['駅徒歩', (x) => x.b.walk || '—'],
      ['住所', (x) => x.b.address || '—', null, null, true],
      ['構造', (x) => x.b.structureNote || '—'],
      ['天井高', (x) => x.b.ceilingHeight || '—'],
      ['主方位', (x) => x.b.direction || '—'],
      ['管理方式', (x) => x.b.managementType || '—'],
      ['管理会社', (x) => x.b.managementCompany || '—', null, null, true],
      ['土地権利', (x) => x.b.landRight || '—'],
      ['用途地域', (x) => x.b.zoning || '—'],
      ['駐車場数', (x) => (x.b.parkingCount != null ? `${x.b.parkingCount}台` : '—'), (x) => x.b.parkingCount, 'max'],
      ['分譲会社', (x) => x.b.developer || '—', null, null, true],
      ['施工会社', (x) => x.b.builder || '—', null, null, true],
      ['ブランド', (x) => x.b.brand || '—'],
      ['小学校区', (x) => x.b.elementarySchool || '—'],
      ['中学校区', (x) => x.b.juniorHighSchool || '—'],
    ]],
    ['設備', false, [
      ['建物の設備', tag('equipmentTags'), null, null, true],
      ['部屋の設備', tag('roomEquipmentTags'), null, null, true],
      ['建物構造', tag('structureTags'), null, null, true],
      ['共用施設', tag('facilityTags'), null, null, true],
    ]],
    ['メモ・評価', true, [
      ['リノベ区分', (x) => x.r.renovation || 'なし'],
      ['評価', (x) => fmt.stars(x.r.rating), (x) => x.r.rating, 'max'],
      ['検討状態', (x) => x.r.status || '—'],
      ['リフォーム', (x) => x.r.reform || '—', null, null, true],
      ['眺望・住戸特徴', (x) => x.r.viewNote || '—', null, null, true],
      ['間取り・室内メモ', (x) => x.r.roomNote || '—', null, null, true],
      ['メモ', (x) => x.r.memo || '—', null, null, true],
      ['画像', (x) => `${x.r.images?.length || 0}枚`],
    ]],
  ];
}

const cmpUI = { diffOnly: true, open: null };

function compareTable(rows) {
  const sections = compareSections();
  if (!cmpUI.open) cmpUI.open = new Set(sections.filter(([, def]) => def).map(([name]) => name));

  const thead = el('thead', {}, el('tr', {},
    el('th', { class: 'lab' }, '項目'),
    rows.map((x) => el('th', {}, el('div', { class: 'colhead' },
      el('span', { class: 'tiny muted' }, x.b.name),
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); go('r', x.r.id); } }, x.r.label),
      statusBadge(x.r.status),
    ))),
  ));

  const body = el('tbody');
  let hidden = 0;

  for (const [name, , defs] of sections) {
    const open = cmpUI.open.has(name);
    const visible = defs.filter(([, render]) => {
      if (!cmpUI.diffOnly) return true;
      const vals = rows.map((x) => render(x));
      return new Set(vals).size > 1;   // 全員同じ値なら比較の役に立たない
    });
    hidden += defs.length - visible.length;
    if (!visible.length && cmpUI.diffOnly) continue;

    body.append(el('tr', { class: 'secrow' },
      el('td', {
        class: 'lab secrow-lab', colspan: 1,
        onclick: () => { open ? cmpUI.open.delete(name) : cmpUI.open.add(name); rerender(); },
      },
        el('span', { class: 'sec-caret' + (open ? ' is-open' : '') }, '▸'),
        name,
        el('span', { class: 'tiny muted' }, ` ${visible.length}`)),
      rows.map(() => el('td', { class: 'secrow-fill' })),
    ));
    if (!open) continue;

    for (const [label, render, pick, dir, isNote] of visible) {
      let best = null;
      if (pick && dir) {
        const vals = rows.map(pick).filter((v) => v != null && !isNaN(v));
        const lo = Math.min(...vals), hi = Math.max(...vals);
        if (vals.length > 1 && lo !== hi) best = dir === 'min' ? lo : hi;
      }
      body.append(el('tr', {},
        el('td', { class: 'lab' }, label),
        rows.map((x) => {
          const v = pick ? pick(x) : null;
          const cls = [isNote ? 'note' : '', best != null && v === best ? 'best' : ''].filter(Boolean).join(' ');
          return el('td', { class: cls || null }, render(x));
        }),
      ));
    }
  }

  return el('div', {},
    el('div', { class: 'toolbar cmptoolbar' },
      toggle('違いのある項目だけ', cmpUI.diffOnly, (v) => { cmpUI.diffOnly = v; rerender(); }),
      cmpUI.diffOnly && hidden
        ? el('span', { class: 'tiny muted' }, `同じ値の ${hidden} 項目を非表示`)
        : null,
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-sm',
        onclick: () => {
          const all = sections.map(([n]) => n);
          if (cmpUI.open.size === all.length) cmpUI.open.clear();
          else all.forEach((n) => cmpUI.open.add(n));
          rerender();
        },
      }, cmpUI.open.size === sections.length ? 'すべて閉じる' : 'すべて開く'),
      el('button', { class: 'btn btn-sm', onclick: () => go('settings') }, 'ローン条件'),
    ),

    // 2〜3件しか選んでいないと、幅いっぱいに引き伸ばされて数字どうしが
    // 離れ、間に何も無い帯ができる。列数に見合う幅で頭打ちにする。
    el('div', {
      class: 'tablewrap',
      style: `max-width:${190 + rows.length * 215}px`,
    }, el('table', { class: 'cmp' }, thead, body)),
  );
}

/* =========================================================
   地図
   ========================================================= */
export function renderMap(root) {
  const located = store.buildings.filter((b) => b.lat != null);
  const missing = store.buildings.filter((b) => b.lat == null);

  const mapBox = el('div', { class: 'bigmap' });
  if (located.length || store.places.length) {
    drawMap(mapBox,
      located.map((b) => ({ ...b, roomSummary: `${store.roomsOf(b.id).length}部屋` })),
      store.places)
      .catch((e) => { mapBox.textContent = e.message; });
  } else {
    mount(mapBox, el('div', { class: 'empty' },
      '地図に表示できる建物がありません。建物の詳細画面で住所を入れて「住所から地図上の位置を取得」を押してください。'));
  }

  const legend = el('ol', { class: 'maplegend' }, located.map((b) =>
    el('li', {},
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); go('b', b.id); } }, b.name),
      el('span', { class: 'tiny muted' }, `　${b.address || ''}`),
      store.places.length
        ? el('div', { class: 'tiny muted' }, store.places.map((p) => {
          const m = distanceMeters(b, p);
          return `${p.name} 約${(m / 1000).toFixed(2)}km（徒歩${walkMinutes(m)}分）　`;
        }).join(''))
        : null,
    )));

  mount(root,
    el('div', { class: 'toolbar' },
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn-sm', onclick: () => go('settings') }, '参照地点を追加'),
    ),
    mapBox,
    located.length ? section('建物', legend) : null,
    missing.length
      ? section('位置が未設定', el('div', { class: 'help' }, missing.map((b) =>
        el('div', {}, el('a', {
          href: '#', onclick: (e) => { e.preventDefault(); go('b', b.id); },
        }, b.name), ' … 住所を入れて位置を取得してください'))))
      : null,
  );
}

/* =========================================================
   設定
   ========================================================= */
export function renderSettings(root) {
  const cfg = { ...store.config };
  const status = el('div', { class: 'tiny muted', style: 'margin-top:8px' });

  const ghForm = el('div', { class: 'card form settings-form' },
    cfgField('owner', 'GitHub ユーザー名 / Organization', cfg, '例: mmmhg835'),
    cfgField('repo', 'データ用リポジトリ名（Private 推奨）', cfg, '例: bukken-data'),
    cfgField('branch', 'ブランチ', cfg, 'main'),
    tokenField(cfg),
    el('div', { class: 'field wide', style: 'flex-direction:row;gap:8px;flex-wrap:wrap' },
      el('button', {
        class: 'btn btn-primary', onclick: async () => {
          store.saveConfig(cfg);
          status.textContent = '接続を確認しています…';
          status.style.color = '';
          try {
            const info = await store.repo.check();
            await store.sync();
            status.textContent = `接続OK: ${info.fullName}（${info.private ? 'Private' : 'Public'}）`;
            toast('GitHub に接続しました');
            rerender();
          } catch (e) {
            status.textContent = e.message;
            status.style.color = 'var(--bad)';
            toast('接続に失敗しました。下の説明を確認してください。', true);
          }
        },
      }, '保存して接続テスト'),
      el('button', { class: 'btn', onclick: async () => { await store.sync(); toast('同期しました'); rerender(); } }, '今すぐ同期'),
      el('button', { class: 'btn', onclick: async () => { await store.clearImageCache(); toast('画像キャッシュを消去しました'); } }, '画像キャッシュ消去'),
      el('button', {
        class: 'btn', onclick: () => {
          const blob = new Blob([JSON.stringify(store.data, null, 2)], { type: 'application/json' });
          const a = el('a', { href: URL.createObjectURL(blob), download: 'properties.json' });
          document.body.append(a); a.click(); a.remove();
        },
      }, 'JSONを書き出し'),
    ),
  );

  mount(root, el('div', { class: 'settings' },
    section('ローンの共通条件', loanSettings()),
    section('参照地点', placesSettings()),
    section('GitHub 接続', ghForm, status),
    themeSettings(),
    usageSettings(),
    qualitySettings(),
    pairingSection(),
    el('div', { class: 'section card', style: 'padding:16px' },
      el('h3', {}, 'トークンの作り方'),
      el('div', {
        class: 'help', html: `
        <ol>
          <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained token の発行ページを開く</a></li>
          <li><b>Repository access</b> で データ用リポジトリ だけを選択</li>
          <li><b>Permissions → Contents</b> を <code>Read and write</code> に設定</li>
          <li>生成されたトークンを上の欄に貼り付け → 「保存して接続テスト」</li>
        </ol>
        <p>トークンはこの端末のブラウザ（localStorage）にだけ保存され、GitHub 以外には送信されません。</p>` }),
    ),
    el('div', { class: 'section card', style: 'padding:16px' },
      el('h3', {}, '同期状態'),
      el('div', { class: 'help' },
        el('div', {}, `状態: ${store.syncState}`),
        el('div', {}, `未保存の変更: ${store.dirty ? 'あり' : 'なし'}`),
        el('div', {}, `建物 ${store.buildings.length}棟 / 部屋 ${store.rooms.length}室`),
        el('div', {}, `最終更新: ${store.data.updatedAt ? new Date(store.data.updatedAt).toLocaleString('ja-JP') : '—'}`),
        el('div', {}, `アプリの版数: ${APP_VERSION}`),
        el('button', {
          class: 'btn btn-sm', style: 'margin-top:10px',
          onclick: async () => {
            toast('更新を確認しています…');
            const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
            await Promise.all(regs.map((r) => r.update()));
            location.reload();
          },
        }, '最新版を取得'),
        store.lastError ? el('div', { style: 'color:var(--bad);margin-top:6px' }, store.lastError) : null,
      )),
  ));
}

function loanSettings() {
  const t = store.loanTerms;
  const preview = el('div', { class: 'tiny muted', style: 'margin-top:10px;line-height:1.9' });
  const paint = () => {
    const rows = store.rooms.filter((r) => r.price != null && !r.loan).slice(0, 8);
    preview.replaceChildren(...rows.map((r) => {
      const l = calcLoan(r.price, t);
      const b = store.building(r.buildingId);
      return el('div', {}, `${b?.name ?? ''} ${r.label}：${fmt.man1(r.price)}万 → 毎月 ${fmt.yen万(l.monthly)}／総額 ${fmt.man1(Math.round(l.totalPayment))}万`);
    }));
  };
  const onEdit = () => { store.markDirty(); paint(); };
  paint();

  return el('div', { class: 'card form' },
    field(t, ['downPayment', '頭金（万円）', 'number'], onEdit),
    field(t, ['rate', '金利（年利％）', 'number'], onEdit),
    field(t, ['years', '返済年数', 'number'], onEdit),
    el('div', { class: 'field' },
      el('label', {}, '返済方式'),
      select(t.method, Object.entries(METHODS), (v) => { t.method = v; onEdit(); })),
    field(t, ['costRate', '諸費用（価格の％）', 'number'], onEdit),
    field(t, ['costFixed', '諸費用の定額分（万円）', 'number'], onEdit),
    el('div', { class: 'field wide' },
      el('label', {}, '諸費用の扱い'),
      toggle('諸費用も借入に含める', t.includeFees !== false, (v) => { t.includeFees = v; onEdit(); })),
    el('div', { class: 'field wide' },
      el('label', {}, 'この条件での試算'),
      preview,
      el('div', { class: 'tiny muted', style: 'margin-top:8px' },
        `既定は ${DEFAULT_TERMS.rate}％・${DEFAULT_TERMS.years}年・頭金なし。部屋ごとに別条件も設定できます。`)),
  );
}

function placesSettings() {
  const list = el('div');
  const paint = () => {
    list.replaceChildren(...store.places.map((p, i) =>
      el('div', { class: 'placerow' },
        el('span', {}, `★ ${p.name}`),
        el('span', { class: 'tiny muted' }, p.address || ''),
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => { store.removePlace(i); paint(); },
        }, '削除'),
      )));
  };
  paint();

  const name = el('input', { type: 'text', placeholder: '例: 職場 / 辰巳駅 / 小学校' });
  const addr = el('input', { type: 'text', placeholder: '住所または駅名を含む住所' });
  const msg = el('div', { class: 'tiny muted', style: 'margin-top:6px' });

  const add = el('button', {
    class: 'btn btn-primary', onclick: async () => {
      if (!name.value.trim() || !addr.value.trim()) { msg.textContent = '名前と住所の両方を入れてください'; return; }
      add.disabled = true; msg.textContent = '住所を検索しています…';
      try {
        const hit = await geocode(addr.value);
        if (!hit) { msg.textContent = '住所が見つかりませんでした'; return; }
        store.addPlace({ name: name.value.trim(), address: addr.value.trim(), lat: hit.lat, lng: hit.lng });
        name.value = ''; addr.value = '';
        msg.textContent = `追加しました（${hit.title}）`;
        paint();
      } catch (e) { msg.textContent = e.message; }
      finally { add.disabled = false; }
    },
  }, '追加');

  return el('div', { class: 'card', style: 'padding:14px' },

    list,
    el('div', { class: 'form', style: 'padding:0;margin-top:10px' },
      el('div', { class: 'field' }, el('label', {}, '名前'), name),
      el('div', { class: 'field' }, el('label', {}, '住所'), addr),
      el('div', { class: 'field' }, el('label', {}, ' '), add),
    ),
    msg,
  );
}

/** 画像の保存量。リポジトリの実用上限に対してどのくらいかを示す */
function usageSettings() {
  const u = store.usage();
  const mb = u.bytes / 1024 / 1024;
  const per = QUALITY_PRESETS[store.prefs.imageQuality];
  const avgKb = { standard: 240, high: 640, original: 3200 }[store.prefs.imageQuality] || 640;
  // GitHub はリポジトリ 1GB 以内が推奨。そこから逆算した目安
  const room = Math.max(0, Math.floor((1024 - mb) * 1024 / avgKb));

  return el('div', { class: 'section card', style: 'padding:16px' },
    el('h3', {}, '画像の保存量'),
    el('div', { class: 'calcgrid', style: 'margin:10px 0' },
      kv('保存済み', `${u.count}枚`),
      kv('概算容量', mb < 1 ? `${Math.round(u.bytes / 1024)}KB` : `${mb.toFixed(1)}MB`),
      kv('データ本体', `${Math.round(u.jsonBytes / 1024)}KB`, 'properties.json'),
      kv('あと何枚', `約${room.toLocaleString('ja-JP')}枚`, `「${per.label}」換算`),
    ),
    el('div', { class: 'help' },
      'アプリ側に枚数の上限はありません。実質的な制限は GitHub リポジトリの容量（1GB 以内が推奨）です。'
      + '「あと何枚」は現在の画質設定で 1GB に収まる概算で、画質を下げれば増えます。'),
  );
}

function themeSettings() {
  return el('div', { class: 'section card', style: 'padding:16px' },
    el('h3', {}, 'デザイン'),
    segmented(currentSkin(), SKINS, (v) => { setSkin(v); rerender(); }),
    el('div', { class: 'tiny muted', style: 'margin:10px 0 18px' },
      'クラシックは以前の見た目です。いつでも戻せます。'),
    el('h3', {}, '配色'),
    el('div', { class: 'help', style: 'margin-bottom:10px' },
      '「端末の設定に従う」なら、iPhone や Mac のダークモードに合わせて自動で切り替わります。'
      + '画面右上のボタンでも切り替えられます。'),
    select(currentTheme(), THEMES, (v) => { setTheme(v); rerender(); }),
  );
}

function qualitySettings() {
  return el('div', { class: 'section card', style: 'padding:16px' },
    el('h3', {}, '画像の保存画質'),

    select(store.prefs.imageQuality,
      Object.entries(QUALITY_PRESETS).map(([k, v]) => [k, v.label]),
      (v) => { store.savePrefs({ imageQuality: v }); toast(`画質を「${QUALITY_PRESETS[v].label}」にしました`); }),
    el('div', { class: 'tiny muted', style: 'margin-top:10px;line-height:1.8' },
      el('div', {}, '標準 … 長辺1600px（約200KB/枚）'),
      el('div', {}, '高画質 … 長辺2560px（約600KB/枚）'),
      el('div', {}, '原寸 … 変換なし。間取り図など細かい文字を読みたい資料向け（数MB/枚）'),
    ),
  );
}

function pairingSection() {
  const box = el('div', { style: 'margin-top:12px' });
  const sec = el('div', { class: 'section card', style: 'padding:16px' },
    el('h3', {}, 'スマホに設定を引き継ぐ'),
    el('div', { class: 'help' },
      'この端末の接続設定を QR コードにします。iPhone の標準カメラアプリで読み取り、'
      + '表示されるリンクを開くだけで設定が完了します。'),
    box,
  );
  if (!store.configured) {
    box.append(el('div', { class: 'tiny muted' }, '先にこの端末で接続を完了してください。'));
    return sec;
  }
  const btn = el('button', {
    class: 'btn btn-primary', style: 'margin-top:4px',
    onclick: async () => {
      btn.disabled = true;
      try {
        const img = await renderQr(pairingUrl(store.config), 340);
        box.replaceChildren(
          el('div', { style: 'display:inline-block;margin-top:10px' }, img),
          el('div', { class: 'tiny', style: 'color:var(--warn);margin-top:8px;max-width:420px;line-height:1.7' },
            '⚠ この QR にはアクセストークンが含まれています。画面共有やスクリーンショットの取り扱いに注意してください。'),
          el('button', {
            class: 'btn btn-sm', style: 'margin-top:8px',
            onclick: () => { box.replaceChildren(btn); btn.disabled = false; },
          }, 'QR を隠す'),
        );
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    },
  }, 'QR コードを表示');
  box.append(btn);
  return sec;
}

function cfgField(key, label, cfg, ph, type = 'text') {
  return el('div', { class: 'field wide' },
    el('label', {}, label),
    el('input', {
      type, value: cfg[key] ?? '', placeholder: ph, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      oninput: (e) => { cfg[key] = e.target.value.trim(); },
    }),
  );
}

function tokenField(cfg) {
  const saved = store.config.token;
  const input = el('input', {
    type: 'password', value: cfg.token ?? '', placeholder: 'github_pat_...',
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
    name: 'gh-access-token',
    oninput: (e) => { cfg.token = e.target.value.trim(); info(); },
  });
  const meta = el('div', { class: 'tiny muted' });
  const toggle = el('button', {
    class: 'btn btn-sm', type: 'button',
    onclick: () => {
      input.type = input.type === 'password' ? 'text' : 'password';
      toggle.textContent = input.type === 'password' ? '表示' : '隠す';
    },
  }, '表示');
  const info = () => {
    const v = input.value.trim();
    if (!v) {
      meta.textContent = saved ? `保存済みのトークン: …${saved.slice(-4)}（${saved.length}文字）` : 'まだトークンが保存されていません';
    } else {
      const ok = v.startsWith('github_pat_') && v.length >= 80;
      meta.textContent = `入力中: ${v.length}文字 ${ok ? '✓ 形式は正しそうです' : '⚠ github_pat_ で始まる80文字以上か確認してください'}`;
    }
  };
  info();
  return el('div', { class: 'field wide' },
    el('label', {}, 'アクセストークン（この端末のブラウザにのみ保存）'),
    el('div', { style: 'display:flex;gap:8px;align-items:center' }, input, toggle),
    meta,
  );
}
