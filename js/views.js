// 画面描画。すべて store の状態から組み立てる。
import { store } from './store.js';
import { el, fmt, derive, toast, mount, STATUSES, debounce } from './util.js';
import { labeled, select, kv, field, ratingPicker, statusBadge, section } from './ui.js';
import { gallerySection } from './gallery.js';
import { calcLoan, METHODS, DEFAULT_TERMS } from './loan.js';
import { geocode, drawMap, distanceMeters, walkMinutes } from './map.js';
import { pairingUrl, renderQr } from './pairing.js';
import { QUALITY_PRESETS } from './image.js';

export const route = { view: 'list', id: null };
export let go = () => {};
export let rerender = () => {};
export function bindRouter(goFn, rerenderFn) { go = goFn; rerender = rerenderFn; }

const touch = debounce(() => store.markDirty(), 300);
const mark = () => touch();

/* =========================================================
   一覧（建物カード）
   ========================================================= */
const listUI = { sort: 'price', status: 'all' };

export function renderList(root) {
  const bar = el('div', { class: 'toolbar' },
    labeled('並び替え', select(listUI.sort, [
      ['price', '最安の部屋が安い順'], ['tsubo', '坪単価が安い順'],
      ['age', '築年が新しい順'], ['rooms', '部屋数が多い順'], ['name', '名前順'],
    ], (v) => { listUI.sort = v; rerender(); })),
    labeled('状態', select(listUI.status, [['all', 'すべて'], ...STATUSES.map((s) => [s, s])],
      (v) => { listUI.status = v; rerender(); })),
    el('div', { class: 'spacer' }),
    el('button', {
      class: 'btn btn-primary',
      onclick: () => { const b = store.addBuilding(); go('b', b.id); },
    }, '＋ 建物を追加'),
  );

  const items = store.buildings
    .map((b) => ({ b, rooms: visibleRooms(b) }))
    .filter(({ rooms }) => listUI.status === 'all' || rooms.length)
    .sort(buildingSorter(listUI.sort));

  mount(root, bar,
    items.length
      ? el('div', { class: 'grid' }, items.map(({ b, rooms }) => buildingCard(b, rooms)))
      : el('div', { class: 'empty' }, '建物がありません。「＋ 建物を追加」から登録してください。'));
}

function visibleRooms(b) {
  const rooms = store.roomsOf(b.id);
  return listUI.status === 'all' ? rooms : rooms.filter((r) => r.status === listUI.status);
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

function buildingCard(b, rooms) {
  const cover = b.cover || rooms.find((r) => r.cover)?.cover;
  const coverThumb = b.coverThumb || rooms.find((r) => r.coverThumb)?.coverThumb;
  const img = cover || coverThumb ? el('img', { src: coverThumb || '', alt: b.name, loading: 'lazy' }) : null;
  if (img && cover) store.imageUrl(cover).then((u) => { img.src = u; }).catch(() => {});

  const prices = rooms.map((r) => r.price).filter((v) => v != null);
  const imageCount = (b.images?.length || 0) + rooms.reduce((n, r) => n + (r.images?.length || 0), 0);
  const c = derive(rooms[0] || {}, b, store.loanTerms);

  return el('article', { class: 'card pcard', onclick: () => go('b', b.id) },
    el('div', { class: 'pcard-img' },
      img || el('div', { class: 'ph' }, '画像なし'),
      imageCount ? el('span', { class: 'imgcount' }, `${imageCount}枚`) : null,
    ),
    el('div', { class: 'pcard-body' },
      el('div', { class: 'pcard-top' },
        el('div', { class: 'pcard-name' }, b.name || '(名称未設定)'),
        el('span', { class: 'badge badge-ok' }, `${rooms.length}部屋`),
      ),
      prices.length
        ? el('div', { class: 'pcard-price' },
          fmt.man1(Math.min(...prices)),
          prices.length > 1 ? el('small', {}, `〜 ${fmt.man1(Math.max(...prices))} 万円`) : el('small', {}, '万円'))
        : el('div', { class: 'muted tiny' }, '価格未入力'),
      el('div', { class: 'kvrow' },
        el('span', {}, `築${b.builtYM || '—'}${c.ageYears != null ? `（${c.ageYears}年）` : ''}`),
        el('span', {}, `${b.totalFloors ?? '—'}階建`),
      ),
      el('div', { class: 'kvrow tiny' }, el('span', {}, b.walk || b.stations || '')),
      el('div', { class: 'roomchips' }, rooms.map((r) =>
        el('span', { class: 'roomchip' + (r.status === '本命' ? ' is-top' : '') },
          `${r.label}・${fmt.man1(r.price)}万`))),
    ),
  );
}

/* =========================================================
   建物詳細
   ========================================================= */
const BUILDING_FIELDS = [
  ['name', '建物名', 'text', true],
  ['address', '住所', 'text', true],
  ['builtYM', '築年月（例 2005/02）', 'text'],
  ['totalFloors', '建物階数', 'number'],
  ['stations', '最寄駅', 'text'],
  ['walk', '駅徒歩', 'text'],
  ['amenities', '共用施設・特徴', 'textarea'],
  ['memo', '建物メモ', 'textarea'],
];

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

  const form = el('div', { class: 'card form' },
    BUILDING_FIELDS.map((spec) => field(b, spec, (key) => {
      if (key === 'name') document.getElementById('detailName').textContent = b.name || '(名称未設定)';
      mark();
    })),
  );

  mount(root,
    el('button', { class: 'back', onclick: () => go('list') }, '‹ 一覧へ戻る'),
    head,
    section('部屋', roomList(b, rooms)),
    section('建物情報', form, locationBox(b)),
    gallerySection(b, rerender),
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

function roomCard(r, b) {
  const c = derive(r, b, store.loanTerms);
  const img = r.cover || r.coverThumb ? el('img', { src: r.coverThumb || '', alt: r.label, loading: 'lazy' }) : null;
  if (img && r.cover) store.imageUrl(r.cover).then((u) => { img.src = u; }).catch(() => {});

  return el('article', { class: 'card rcard', onclick: () => go('r', r.id) },
    el('div', { class: 'rcard-img' }, img || el('div', { class: 'ph' }, '—')),
    el('div', { class: 'rcard-body' },
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

  const dists = store.places.filter((p) => b.lat != null).map((p) => {
    const m = distanceMeters(b, p);
    return el('div', {}, `${p.name} まで 約${(m / 1000).toFixed(2)}km（徒歩約${walkMinutes(m)}分）`);
  });

  return el('div', { style: 'margin-top:12px' },
    btn, status,
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
  ['reform', 'リフォーム', 'textarea'],
  ['viewNote', '眺望・住戸特徴', 'textarea'],
  ['roomNote', '間取り・室内メモ', 'textarea'],
  ['memo', '自由メモ', 'textarea'],
];

export function renderRoom(root, id) {
  const r = store.room(id);
  if (!r) { go('list'); return; }
  const b = store.building(r.buildingId);

  const calcBox = el('div', { class: 'calcgrid' });
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
    el('button', { class: 'back', onclick: () => go('b', r.buildingId) }, `‹ ${b?.name || '建物'} へ戻る`),
    head,
    section(null, calcBox),
    section('資金計画', loanBox),
    section('部屋情報', buildingPicker, form),
    gallerySection(r, rerender),
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
  const onEdit = () => { store.markDirty(); repaint(); };

  const inputs = el('div', { class: 'card form' },
    field(editable, ['downPayment', '頭金（万円）', 'number'], onEdit),
    field(editable, ['rate', '金利（年利％）', 'number'], onEdit),
    field(editable, ['years', '返済年数', 'number'], onEdit),
    el('div', { class: 'field' },
      el('label', {}, '返済方式'),
      select(terms.method, Object.entries(METHODS), (v) => { editable.method = v; onEdit(); })),
    field(editable, ['costRate', '諸費用の目安（価格の％）', 'number'], onEdit),
  );

  const result = el('div', { class: 'calcgrid' },
    kv('借入額', fmt.man(Math.round(loan.principal))),
    kv('毎月返済', `${fmt.yen万(loan.monthly)}`,
      terms.method === 'principal' ? `初回。最終回 ${fmt.yen万(loan.monthlyLast)}` : null),
    kv('総返済額', fmt.man(Math.round(loan.totalPayment))),
    kv('うち利息', fmt.man(Math.round(loan.totalInterest))),
    kv('初回の内訳', `元金 ${fmt.yen万(loan.firstPrincipal)}`, `利息 ${fmt.yen万(loan.firstInterest)}`),
    kv('諸費用の目安', fmt.man(Math.round(loan.fees)), '仲介手数料・登記・税など'),
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
export function renderCompare(root) {
  const rows = [];
  for (const b of store.buildings) {
    for (const r of store.roomsOf(b.id)) rows.push({ b, r, c: derive(r, b, store.loanTerms) });
  }
  if (!rows.length) { mount(root, el('div', { class: 'empty' }, '比較する部屋がありません。')); return; }

  const defs = [
    ['価格', (x) => fmt.man1(x.r.price) + '万円', (x) => x.r.price, 'min'],
    ['坪単価', (x) => fmt.n(x.c.tsuboPrice, 1) + '万円', (x) => x.c.tsuboPrice, 'min'],
    ['専有面積', (x) => fmt.sqm(x.r.area), (x) => x.r.area, 'max'],
    ['間取り', (x) => x.r.layout || '—'],
    ['所在階 / 総階数', (x) => `${x.r.floor ?? '—'} / ${x.b.totalFloors ?? '—'}階`, (x) => x.r.floor, 'max'],
    ['築年月（築年数）', (x) => `${x.b.builtYM || '—'}${x.c.ageYears != null ? `（${x.c.ageYears}年）` : ''}`,
      (x) => x.c.ageYears, 'min'],
    ['最寄駅', (x) => x.b.stations || '—'],
    ['駅徒歩', (x) => x.b.walk || '—'],
    ['バルコニー', (x) => fmt.sqm(x.r.balcony), (x) => x.r.balcony, 'max'],
    ['管理＋修繕', (x) => fmt.yen万(x.c.kanriShuzen) + '/月', (x) => x.c.kanriShuzen, 'min'],
    ['ローン返済', (x) => fmt.yen万(x.c.loanMonthly) + '/月', (x) => x.c.loanMonthly, 'min'],
    ['月額合計', (x) => fmt.yen万(x.c.monthly) + '/月', (x) => x.c.monthly, 'min'],
    ['年額合計', (x) => fmt.yen万(x.c.yearly) + '/年', (x) => x.c.yearly, 'min'],
    ['総返済額', (x) => fmt.man1(Math.round(x.c.loan?.totalPayment ?? 0)) + '万円',
      (x) => x.c.loan?.totalPayment, 'min'],
    ['うち利息', (x) => fmt.man1(Math.round(x.c.loan?.totalInterest ?? 0)) + '万円',
      (x) => x.c.loan?.totalInterest, 'min'],
    ['リフォーム', (x) => x.r.reform || '—', null, null, true],
    ['眺望・住戸特徴', (x) => x.r.viewNote || '—', null, null, true],
    ['間取り・室内メモ', (x) => x.r.roomNote || '—', null, null, true],
    ['メモ', (x) => x.r.memo || '—', null, null, true],
    ['評価', (x) => fmt.stars(x.r.rating), (x) => x.r.rating, 'max'],
    ['状態', (x) => x.r.status || '—'],
    ['画像', (x) => `${x.r.images?.length || 0}枚`],
  ];

  const thead = el('thead', {}, el('tr', {},
    el('th', { class: 'lab' }, '項目'),
    rows.map((x) => el('th', {}, el('div', { class: 'colhead' },
      el('span', { class: 'tiny muted' }, x.b.name),
      el('a', { href: '#', onclick: (e) => { e.preventDefault(); go('r', x.r.id); } }, x.r.label),
      statusBadge(x.r.status),
    ))),
  ));

  const tbody = el('tbody', {}, defs.map(([label, render, pick, dir, isNote]) => {
    let best = null;
    if (pick && dir) {
      const vals = rows.map(pick).filter((v) => v != null && !isNaN(v));
      if (vals.length > 1) best = dir === 'min' ? Math.min(...vals) : Math.max(...vals);
    }
    return el('tr', {},
      el('td', { class: 'lab' }, label),
      rows.map((x) => {
        const v = pick ? pick(x) : null;
        const cls = [isNote ? 'note' : '', best != null && v === best ? 'best' : ''].filter(Boolean).join(' ');
        return el('td', { class: cls || null }, render(x));
      }),
    );
  }));

  mount(root,
    el('div', { class: 'toolbar' },
      el('span', { class: 'muted tiny' }, '緑字＝その項目で最も条件が良い値。ローンは共通条件で計算'),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn btn-sm', onclick: () => go('settings') }, 'ローン条件を変更'),
    ),
    el('div', { class: 'tablewrap' }, el('table', { class: 'cmp' }, thead, tbody)),
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
      el('span', { class: 'muted tiny' }, '青ピン＝建物、★＝参照地点（職場・駅など）'),
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
    field(t, ['costRate', '諸費用の目安（価格の％）', 'number'], onEdit),
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
    el('div', { class: 'help', style: 'margin-bottom:10px' },
      '職場や駅などを登録すると、地図に★で表示され、各建物からの距離が出ます。'),
    list,
    el('div', { class: 'form', style: 'padding:0;margin-top:10px' },
      el('div', { class: 'field' }, el('label', {}, '名前'), name),
      el('div', { class: 'field' }, el('label', {}, '住所'), addr),
      el('div', { class: 'field' }, el('label', {}, ' '), add),
    ),
    msg,
  );
}

function qualitySettings() {
  return el('div', { class: 'section card', style: 'padding:16px' },
    el('h3', {}, '画像の保存画質'),
    el('div', { class: 'help', style: 'margin-bottom:10px' },
      'アップロード時にこの画質へ変換してから保存します。既にある画像は変わりません。'),
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
