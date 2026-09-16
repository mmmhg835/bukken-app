// 相場タブ。マンションレビューから写した売り出し・賃貸・新築を、建物をまたいで見る。
//
// 分析タブ（登録済みの部屋20室が対象だった）をここに統合した。数万件の実際の
// 売り出しに対して同じことをするほうが、相場の話としては筋が通るため。
// 単位は売買が万円、賃貸が円。混ぜないこと。
import { store } from './store.js';
import { el, mount, fmt, derive, toast } from './util.js';
import { select, segmented, toggle, controlRow, numberInput, combo } from './ui.js';
import {
  scatterChart, chartLegend, histogramChart, thin,
  SERIES_COLORS, SERIES_MUTED, BAND_COLORS,
} from './chart.js';
import { linearFit, areaOf } from './analysis.js';
import {
  unitUI, draft as unitDraft, applyDraft, resetDraft, clearDraft, draftDirty,
  OWN_OPTIONS, inRange, activeUnitConditions,
} from './unit-filter.js';
import {
  AGE_BANDS, WALK_BANDS, FIRM_KEYS, FIRM_LABEL,
  stationsOf, ageOf, walkOf, inBand, options, layoutLabel, nameHit,
  allUnits, promote,
} from './units.js';
import { RENOVATION } from './spec.js';
import {
  sortRows, summary, pricePoints, tsuboOf, sqmOf, monthsOf, cutOf, isOpen, ymLabel, ymToNum, median,
  sortRents, rentSummary, rentTsuboOf, rentSqmOf,
  sortNewPrices, newSummary, newTsuboOf, grossYield, vsNew, recent,
  MARKET_METRICS, MARKET_ATTRS, MARKET_GROUPS, yearly, groupBy, bands, nowYear, minMax,
} from './market.js';

const SUBTABS = [
  ['overview', '概況'], ['sale', '売出'], ['trend', '推移'], ['supply', '供給'],
  ['dist', '分布'], ['group', '建物別'], ['rent', '賃貸'], ['new', '新築'],
];

/** 一度に読みに行く建物の上限。これを超えたら条件を絞ってもらう */
// 一度に読む建物の上限。1棟ずつ別ファイルなので、増やすほど待ち時間が伸びる。
// 2回目からは手元の控えから出るので、この数はあくまで初回の目安。
const LOAD_LIMIT = 400;



/** 画面の状態。保存する値ではないので、smoke から作れるように出しておく */
const ui = {
  // 相場だけの条件。建物ひとつを選ぶ・売り出し年・募集状況
  building: 'all', from: 'all', to: 'all', listing: 'all',
  metric: 'tsubo', attr: 'year', group: 'ageBand', group2: 'none',
  fit: true, names: true, more: false,
  // 同じ部屋が出し直されるたびに点が増えるので、既定では最新の1件だけ描く
  latestOnly: true,
  // 推移の粒度と、点にまとめる下限の件数。押した点は pick に覚える
  step: 'month', minCount: 3, pick: null, span: 7,
  // 凡例を押して消した分類。線が重なって読めないときに落とす
  hide: [],
  // 一括出力から来たときは、描き終わってから保存の画面を出す
  autoPrint: false,
  // 上限を超えていても読み込むか。押したときだけ立てる
  loadAll: false,
};
export const marketUI = ui;

/** 凡例を押したときに、その分類の線を消す／戻す */
const hiddenSet = () => new Set(ui.hide);
function toggleSeries(name, rerender) {
  const set = hiddenSet();
  if (set.has(name)) set.delete(name);
  else set.add(name);
  ui.hide = [...set];
  // 消した分類の点を押したままだと、下の一覧だけが残ってしまう
  if (ui.pick && set.has(ui.pick.key)) ui.pick = null;
  rerender();
}

/** 凡例のうしろに出す「全部表示」。消したまま忘れないようにする */
const showAllButton = (rerender) => (ui.hide.length
  ? el('button', {
    class: 'btn btn-sm',
    onclick: () => { ui.hide = []; rerender(); },
  }, `全部表示（${ui.hide.length}件を戻す）`)
  : null);

/**
 * 入力中の条件。検索を押すまでグラフには効かない。
 * 選ぶそばから結果が入れ替わると、何を変えたのか分からなくなるため。
 * 表示の仕方（表示単位・色分けの軸・物件名を出すか）は即座に効かせる。
 */
// 相場だけの条件。ほかは一覧・比較と共通（unit-filter）
const SEARCH_KEYS = ['building', 'from', 'to', 'listing'];
export const marketDraft = {};

/** いまの条件で何棟・何行が対象かを返す。検証と smoke から使う */
export function marketCounts() {
  const targets = targetBuildings();
  return { buildings: targets.length, rows: saleRows(targets).length };
}
const copy = (to, from) => { for (const k of SEARCH_KEYS) to[k] = from[k]; };
copy(marketDraft, ui);
const marketDirty = () => SEARCH_KEYS.some((k) => String(ui[k]) !== String(marketDraft[k]))
  || draftDirty();
// 「リセット」で戻す先
const MARKET_DEFAULTS = JSON.parse(JSON.stringify(ui));

export function renderMarket(root, rerender, view = 'overview') {
  // 参考建物（相場だけ見る建物）はここで初めて読む
  store.ensureRefs();
  const targets = targetBuildings();
  const ids = targets.map((b) => b.id);
  if (ids.length && (ids.length <= LOAD_LIMIT || ui.loadAll)) store.ensureMarkets(ids);
  const loaded = targets.filter((b) => store.marketOf(b.id));
  const rows = saleRows(loaded);
  // 間取りや広さは部屋の条件なので、相場を読むまで建物は減らない。
  // 読み終わった分については、実際に該当する部屋がある建物だけを数える
  const hitBuildings = loaded.filter((b) => saleRows([b]).length);

  const head = view === 'report' ? null : el('div', {},
    subTabs(view),
    buildingFilter(targets, loaded, rows, rerender, hitBuildings),
  );

  if (!store.allBuildings.length) {
    mount(root, el('div', { class: 'empty' },
      store.refsReady ? '建物を登録すると相場を貯められます' : '読み込み中'));
    return;
  }
  if (ids.length > LOAD_LIMIT && !ui.loadAll) {
    mount(root, head, el('div', { class: 'empty' },
      el('p', {}, `${ids.length.toLocaleString('ja-JP')}棟が条件に合っています。`),
      el('p', { class: 'tiny muted' },
        '相場は建物ごとに別のファイルなので、読み込みに時間がかかります。'
        + '条件を絞るか、このまま全部読み込んでください（2回目からは手元の控えから出ます）。'),
      el('div', { style: 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap' },
        el('button', {
          class: 'btn btn-primary',
          // よく使う入口。自分が検討している建物だけならすぐ出せる
          onclick: () => {
            unitUI.own = '検討中'; unitDraft.own = '検討中';
            ui.loadAll = false; rerender();
          },
        }, '検討中の建物だけ見る'),
        el('button', {
          class: 'btn',
          onclick: () => { ui.loadAll = true; rerender(); },
        }, `${ids.length.toLocaleString('ja-JP')}棟をすべて読み込む`))));
    return;
  }
  if (!loaded.length) {
    mount(root, head, el('div', { class: 'empty' },
      ids.length ? '読み込み中' : '条件に合う建物がありません'));
    return;
  }

  const body = view === 'report' ? reportView(rows, loaded, rerender)
    : view === 'rent' ? rentView(loaded)
      : view === 'new' ? newView(loaded)
        : view === 'trend' ? trendView(rows, rerender)
          : view === 'supply' ? supplyView(rows, loaded, rerender)
            : view === 'dist' ? distView(rows, rerender)
              : view === 'group' ? groupView(rows, rerender)
                : view === 'sale' ? saleView(rows, loaded, rerender)
                  : overview(rows, loaded);

  mount(root, head, body);
}

function subTabs(current) {
  return el('nav', { class: 'subtabs' },
    SUBTABS.map(([key, label]) =>
      el('button', {
        class: 'subtab' + (key === current ? ' is-active' : ''),
        onclick: () => { location.hash = key === 'overview' ? '#/market' : `#/market/${key}`; },
      }, label)),
    el('div', { class: 'spacer' }),
    // タブの右端に置く。絞り込みの中にあると、条件の一部だと思われる
    el('button', {
      class: 'btn btn-sm subtab-out',
      title: 'いまの条件のまま、すべてのタブを並べてPDFにします',
      onclick: () => { ui.autoPrint = true; location.hash = '#/market/report'; },
    }, '一括出力（PDF）'));
}

/* =========================================================
   絞り込み
   ========================================================= */

/**
 * 条件に合う建物。相場はここで決まった建物ぶんだけ読む。
 * except を渡すと、その条件だけ外して数える。選択肢を作るときに使う
 * （エリアを絞ったら、建物の選択肢もそのエリアの建物だけになる）。
 */
/**
 * 条件に合う建物。
 *
 * 建物名・検討・エリア・住所・築年数・駅徒歩・事業者は、一覧や比較と同じ
 * 条件（unit-filter）をそのまま使う。タブごとに別の絞り方があると探せない。
 * 相場だけの条件（建物ひとつを選ぶ・売り出し年・募集状況）はここで持つ。
 *
 * @param {string|null} except この条件だけ外して数える（選択肢を作るとき用）
 * @param {object} f  相場だけの条件
 * @param {object} u  共有の条件
 */
export function targetBuildings(except = null, f = ui, u = unitUI) {
  const on = (key) => key !== except;
  return store.allBuildings.filter((b) => {
    if (on('own') && u.own !== 'all') {
      const rooms = store.roomsOf(b.id);
      if (!rooms.some((r) => r.status === u.own)) return false;
    }
    if (on('name') && u.name && !nameHit(b, u.name)) return false;
    if (on('building') && f.building !== 'all' && b.id !== f.building) return false;
    if (on('area') && u.area !== 'all' && !stationsOf(b).includes(u.area)) return false;
    if (on('town') && u.town !== 'all' && areaOf(b).town !== u.town) return false;
    for (const k of FIRM_KEYS) {
      if (on(k) && u[k] !== 'all' && (b[k] || '').trim() !== u[k]) return false;
    }
    if (on('age') && !inBand(u.age, ageOf(b))) return false;
    if (on('walk') && !inBand(u.walk, walkOf(b))) return false;
    return true;
  });
}

/**
 * 売り出しの行。期間・募集状況・間取り・広さで絞る。except は選択肢を作るとき用。
 * 並べ替えはしない（数万件を選択肢の数だけ並べ直すのは無駄なので、必要な画面で行う）。
 */
export function saleRows(buildings, except = null, f = ui, u = unitUI) {
  const on = (key) => key !== except;
  const from = f.from === 'all' ? null : Number(f.from);
  const to = f.to === 'all' ? null : Number(f.to);
  const out = [];
  for (const b of buildings) {
    for (const x of store.listingsOf(b.id)) {
      const y = ymToNum(x.listedYM);
      if (on('year') && from != null && (y == null || y < from)) continue;
      if (on('year') && to != null && (y == null || y >= to + 1)) continue;
      if (on('listing') && f.listing === 'open' && !isOpen(x)) continue;
      if (on('listing') && f.listing === 'closed' && isOpen(x)) continue;
      if (on('layout') && u.layout !== 'all' && layoutLabel(x.layout) !== u.layout) continue;
      if (on('size') && !inRange(x.area, u.areaMin, u.areaMax)) continue;
      if (on('price') && !inRange(x.price, u.priceMin, u.priceMax)) continue;
      out.push(x);
    }
  }
  return out;
}

const buildingOf = (id) => store.building(id);

function buildingFilter(targets, loaded, rows, rerender, hitBuildings = null) {
  const d = marketDraft;             // 相場だけの条件
  const u = unitDraft;               // 一覧・比較と共通の条件
  // 選択肢が多い条件は、打って絞れる入力欄にする（建物は1,400件あり選べない）
  const COMBO_FROM = 12;
  const pick = (key, list) => (list.length >= COMBO_FROM
    ? combo(d[key], list, (v) => { d[key] = v; rerender(); }, 'fsel fcombo-in', `m-${key}`)
    : select(d[key], [['all', 'すべて'], ...list], (v) => { d[key] = v; rerender(); }, 'fsel'));
  const band = (key, list) =>
    select(d[key], list, (v) => { d[key] = v; rerender(); }, 'fsel');
  // 共通の条件はこちら。unit-filter の入力中の値を読み書きする
  const uPick = (key, list) => (list.length >= COMBO_FROM
    ? combo(u[key], list, (v) => { u[key] = v; rerender(); }, 'fsel fcombo-in', `mu-${key}`)
    : select(u[key], [['all', 'すべて'], ...list], (v) => { u[key] = v; rerender(); }, 'fsel'));
  const uBand = (key, list) =>
    select(u[key], list, (v) => { u[key] = v; rerender(); }, 'fsel');
  const uRange = (minKey, maxKey, unitLabel) => el('div', { class: 'frange' },
    numberInput({ value: u[minKey] ?? '', fkey: `m-${minKey}`, cls: 'fnum', placeholder: '下限',
      onInput: (v) => { u[minKey] = v; } }),
    el('span', {}, '〜'),
    numberInput({ value: u[maxKey] ?? '', fkey: `m-${maxKey}`, cls: 'fnum', placeholder: '上限',
      onInput: (v) => { u[maxKey] = v; } }),
    el('span', { class: 'tiny muted' }, unitLabel));
  const group = (label, ctrl) => el('div', { class: 'fgroup' }, el('label', {}, label), ctrl);

  // 選択肢は「その条件だけ外した結果」から作る。1つ選ぶと他の選択肢も連動して減る
  const pool = (key) => targetBuildings(key, marketDraft, unitDraft);
  const rowsFor = (key) => saleRows(loaded, key, marketDraft, unitDraft);
  // 建物名は id で選ぶ。同じ名前の建物があっても取り違えない
  const buildingOptions = [...pool('building')]
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
    .map((b) => [b.id, b.name]);
  const areaOptions = options(pool('area').flatMap(stationsOf));
  const townOptions = options(pool('town').map((b) => areaOf(b).town));
  const firmOptions = (k) => options(pool(k).map((b) => (b[k] || '').trim()));
  const yearOptions = options(rowsFor('year').map((x) => {
    const y = ymToNum(x.listedYM);
    return y == null ? null : String(Math.floor(y));
  }), (v) => `${v}年`).sort((a, b) => b[0].localeCompare(a[0]));
  const layoutOptions = options(rowsFor('layout').map((x) => layoutLabel(x.layout)));

  const loading = store.marketLoadingCount;
  const dirty = marketDirty();
  // よく使う条件だけ出し、残りは「条件を増やす」の中へ。並べすぎると探す画面になる
  const open = ui.more;
  const extra = ['town', 'walk', ...FIRM_KEYS].filter((k) => unitDraft[k] !== 'all').length;
  return el('div', { class: 'filterbar' + (dirty ? ' is-dirty' : '') },
    el('div', { class: 'filterbar-row' },
      group('建物名', el('input', {
        class: 'ftext', type: 'search', placeholder: '建物名・住所・駅',
        value: u.name, 'data-fkey': 'market-name',
        oninput: (e) => { u.name = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter') { applyAll(); rerender(); } },
      })),
      group('検討', uBand('own', OWN_OPTIONS)),
      group('エリア（最寄駅）', uPick('area', areaOptions)),
      group('建物', pick('building', buildingOptions)),
      group('築年数', uBand('age', AGE_BANDS)),
      group('間取り', uPick('layout', layoutOptions)),
      group('広さ', uRange('areaMin', 'areaMax', '㎡')),
      el('button', {
        class: 'btn btn-sm fmore' + (open ? ' is-on' : ''),
        onclick: () => { ui.more = !open; rerender(); },
      }, `${open ? '条件を隠す' : '条件を増やす'}${extra ? `（${extra}）` : ''}`),
      searchButton(rerender),
    ),
    el('div', { class: 'filterbar-row' },
      group('価格', uRange('priceMin', 'priceMax', '万円')),
      group('売り出し年', el('div', { class: 'frange' },
        pick('from', yearOptions), el('span', {}, '〜'), pick('to', yearOptions))),
      // 相場は履歴を見る画面なので、既定は終了した分も含める
      group('募集状況', band('listing',
        [['all', 'すべて（履歴も）'], ['open', '販売中だけ'], ['closed', '終了だけ']])),
      el('div', { class: 'spacer' }),
      el('span', { class: 'fcount' },
        `${(hitBuildings ? hitBuildings.length : targets.length).toLocaleString('ja-JP')}棟`
        + `　売り出し ${rows.length.toLocaleString('ja-JP')}件`),
      loading
        ? el('span', { class: 'tiny muted' },
          `${targets.length - loading}/${targets.length}棟 読み込み中…`)
        : null,
      store.refsReady ? null : el('span', { class: 'tiny muted' }, '建物を読み込み中'),
    ),
    open
      ? el('div', { class: 'filterbar-row is-more' },
        group('住所', uPick('town', townOptions)),
        group('駅徒歩', uBand('walk', WALK_BANDS)),
        FIRM_KEYS.map((k) => group(FIRM_LABEL[k], uPick(k, firmOptions(k)))),
      )
      : null);
}

/** 入力中の条件をまとめて効かせる（共通の分と相場だけの分の両方） */
function applyAll() {
  applyDraft();
  copy(ui, marketDraft);
  // 条件が変われば、押していた点や棒の中身も変わる。選びっぱなしにしない
  ui.pick = null;
  ui.hide = [];
}

/** 検索ボタン。条件を選んだ時点ではグラフを変えず、これを押して初めて効かせる */
function searchButton(rerender) {
  const dirty = marketDirty();
  return el('div', { class: 'fsearch' },
    dirty ? el('span', { class: 'tiny', style: 'color:var(--warn)' }, '条件が未反映') : null,
    el('button', {
      class: 'btn btn-sm' + (dirty ? ' btn-primary' : ''),
      onclick: () => { applyAll(); rerender(); },
    }, 'この条件で検索'),
    el('button', {
      class: 'btn btn-sm',
      onclick: () => {
        if (dirty) { copy(marketDraft, ui); resetDraft(); }   // 直している途中なら元に戻す
        else {
          copy(marketDraft, MARKET_DEFAULTS); copy(ui, MARKET_DEFAULTS);
          clearDraft();
          ui.pick = null;
        }
        rerender();
      },
    }, dirty ? '戻す' : 'リセット'),
  );
}

const cell = (k, v, sub = null) =>
  el('div', {}, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v),
    sub ? el('div', { class: 'tiny muted' }, sub) : null);

/* =========================================================
   概況
   ========================================================= */
function overview(rows, buildings) {
  const rent = buildings.flatMap((b) => store.rentsOf(b.id));
  const news = buildings.flatMap((b) => store.newPricesOf(b.id));
  const s = summary(recent(rows)), r = rentSummary(recent(rent, 1, 'ym')), n = newSummary(news);
  const all = summary(rows), allR = rentSummary(rent);
  const y = grossYield(s.tsuboMed, r.tsuboMed);
  const mult = vsNew(s.tsuboMed, n.tsuboMed);
  const yr = yearly(rows);

  if (!rows.length && !rent.length && !news.length) {
    return el('div', { class: 'empty' }, '条件に合う相場がありません');
  }
  const span = (a) => (a.count ? `全${a.count.toLocaleString('ja-JP')}件では ${fmt.n(a.tsuboMed, 0)}` : null);

  return el('div', {},
    el('div', { class: 'section' },
      el('h3', {}, '坪単価　直近1年'),
      el('div', { class: 'calcgrid calcgrid-3' },
        cell('売り出し 中央', s.tsuboMed != null ? `${fmt.n(s.tsuboMed, 0)}万` : '—',
          s.count ? `${s.count}件　${span(all) ?? ''}` : 'データなし'),
        cell('賃料 中央', r.tsuboMed != null ? `${fmt.n(r.tsuboMed, 0)}円/月` : '—',
          r.count ? `${r.count}件　${span(allR) ?? ''}` : 'データなし'),
        cell('新築時 中央', n.tsuboMed != null ? `${fmt.n(n.tsuboMed, 0)}万` : '—',
          n.count ? `${n.count}件` : 'データなし'),
      )),
    el('div', { class: 'section' },
      el('h3', {}, '突き合わせ'),
      el('div', { class: 'calcgrid calcgrid-3' },
        cell('表面利回り', y != null ? `${fmt.n(y, 2)}%` : '—',
          y != null ? '年間賃料 ÷ 売り出し価格' : '売出と賃貸の両方が要る'),
        cell('新築時から', mult != null ? `${fmt.n(mult, 2)}倍` : '—',
          mult != null && n.tsuboMed ? `新築 ${fmt.n(n.tsuboMed, 0)}万/坪` : '売出と新築の両方が要る'),
        cell('年平均の伸び', yr.cagr != null ? `${yr.cagr > 0 ? '+' : ''}${fmt.n(yr.cagr, 2)}%` : '—',
          yr.list.length > 1 ? `${yr.list[0].year}年〜${yr.list[yr.list.length - 1].year}年` : null),
      )),
    onSaleNow(rows, buildings),
    myRooms(buildings, s, r),
  );
}

/**
 * いま出ている数。総戸数に対する割合が高いほど、売りたい人が多いということ。
 * 掲載期間は募集中の行だけで見る（終わった行を混ぜると「売れるまでの早さ」になる）。
 */
function onSaleNow(rows, buildings) {
  const open = rows.filter(isOpen);
  if (!open.length) return null;
  const months = open.map(monthsOf).filter(Number.isFinite);
  const units = buildings.reduce((s, b) => s + (b.totalUnits || 0), 0) || null;
  const ratio = units ? (open.length / units) * 100 : null;
  const longest = months.length ? Math.max(...months) : null;
  return el('div', { class: 'section' },
    el('h3', {}, 'いま出ている数'),
    el('div', { class: 'calcgrid calcgrid-3' },
      cell('募集中', `${open.length}件`, units ? `総戸数 ${units.toLocaleString('ja-JP')}戸` : '総戸数が未入力'),
      cell('総戸数に対して', ratio != null ? `${fmt.n(ratio, 1)}%` : '—',
        ratio != null ? (ratio >= 5 ? '多め' : ratio >= 2 ? '並み' : '少なめ') : null),
      cell('掲載期間 中央', months.length ? `${median(months)}か月` : '—',
        longest != null ? `一番長い ${longest}か月` : null),
    ));
}

/** 検討中の部屋を相場の中に置く。買おうとしている値がどのあたりか */
function myRooms(buildings, s, r) {
  const rooms = buildings.flatMap((b) => store.roomsOf(b.id).map((x) => ({ b, x })))
    .filter(({ b, x }) => derive(x, b, store.loanTerms).tsuboPrice);
  if (!rooms.length) return null;
  return el('div', { class: 'section' },
    el('h3', {}, '検討中の部屋'),
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp markettbl' },
        el('thead', {}, el('tr', {},
          ['部屋', '坪単価', '売出中央との差', '想定賃料', '表面利回り'].map((c, i) =>
            el('th', { class: i === 0 ? 'lab' : null }, c)))),
        el('tbody', {}, rooms.map(({ b, x }) => {
          const t = derive(x, b, store.loanTerms).tsuboPrice;
          const diff = s.tsuboMed != null ? t - s.tsuboMed : null;
          const tsubo = x.area ? x.area / 3.305785 : null;
          const rentGuess = r.tsuboMed != null && tsubo ? r.tsuboMed * tsubo : null;
          const y = grossYield(t, r.tsuboMed);
          return el('tr', {},
            el('td', { class: 'lab' }, `${b.name} ${x.label}`),
            el('td', {}, `${fmt.n(t, 0)}万`),
            el('td', { class: diff != null && diff > 0 ? 'worse' : null },
              diff != null ? `${diff > 0 ? '+' : ''}${fmt.n(diff, 0)}万` : '—'),
            el('td', {}, rentGuess != null ? `${fmt.n(rentGuess, 0)}円/月` : '—'),
            el('td', {}, y != null ? `${fmt.n(y, 2)}%` : '—'));
        })))));
}

/* =========================================================
   売出（散布図：軸を選べる）
   ========================================================= */
function saleView(rows, buildings, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');
  const s = summary(rows);
  const span = s.span ? `${ymLabel(s.span.from)}〜${ymLabel(s.span.to)}` : '—';

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('件数', `${s.count.toLocaleString('ja-JP')}件`, `販売中 ${s.open}件`),
        cell('期間', span),
        cell('坪単価 中央', s.tsuboMed != null ? `${fmt.n(s.tsuboMed, 0)}万` : '—',
          s.tsuboMin != null ? `${fmt.n(s.tsuboMin, 0)}〜${fmt.n(s.tsuboMax, 0)}万` : null),
        cell('販売期間 中央', s.monthsMed != null ? `${s.monthsMed}か月` : '—'),
        cell('値下げした割合', s.cutRate != null ? `${fmt.n(s.cutRate, 0)}%` : '—'),
        cell('値下げ幅 平均', s.cutAvg != null ? `${fmt.n(s.cutAvg, 1)}%` : '—'),
        cell('最安', s.tsuboMin != null ? `${fmt.n(s.tsuboMin, 0)}万/坪` : '—'),
        cell('最高', s.tsuboMax != null ? `${fmt.n(s.tsuboMax, 0)}万/坪` : '—'),
      )),
    axisControls(rerender, { attr: true, group: true, fit: true }),
    scatterSection(rows, buildings, rerender),
    saleTable(sortRows(rows).slice(0, 400), rows.length, rerender),
  );
}

/**
 * 軸の操作。画面によって効く軸が違うので、効くものだけ出す。
 * 使えない操作を並べると、押しても何も起きない欄が増える。
 */
function axisControls(rerender, { attr = false, group = false, groupLabel = '色分け', fit = false } = {}) {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-controls' },
      controlRow('↕', '表示単位',
        segmented(ui.metric, Object.entries(MARKET_METRICS).map(([k, v]) => [k, v.label]),
          (k) => { ui.metric = k; rerender(); })),
      attr ? controlRow('↔', '物件属性',
        segmented(ui.attr, Object.entries(MARKET_ATTRS).map(([k, v]) => [k, v.label]),
          (k) => { ui.attr = k; rerender(); })) : null,
      group ? controlRow('◍', groupLabel,
        el('div', { style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap' },
          select(ui.group, Object.entries(MARKET_GROUPS).map(([k, v]) => [k, v.label]),
            (k) => { ui.group = k; ui.hide = []; rerender(); }, 'picksel'),
          el('span', { class: 'tiny muted' }, '×'),
          select(ui.group2, group2Options(),
            (k) => { ui.group2 = k; ui.hide = []; rerender(); }, 'picksel'),
          fit ? toggle('近似直線と相場の幅', ui.fit, (v) => { ui.fit = v; rerender(); }) : null,
          fit ? toggle('物件名を出す', ui.names, (v) => { ui.names = v; rerender(); }) : null,
          // 出し直した分まで並べると、同じ部屋が何個も点になる
          fit ? toggle('同じ部屋は最新だけ', ui.latestOnly,
            (v) => { ui.latestOnly = v; rerender(); }) : null)) : null,
    ));
}

/**
 * いま選んでいる分類。2つ選ぶと「エリア × 間取り」のように掛け合わせる。
 *
 * 「豊洲の3LDKだけがどう動いたか」は、エリアだけ・間取りだけでは出てこない。
 * 掛け合わせると分類は増えるが、線は多い順に8本までなので画面は破綻しない。
 */
function activeGroup() {
  const g1 = MARKET_GROUPS[ui.group] || MARKET_GROUPS.none;
  const g2 = MARKET_GROUPS[ui.group2];
  if (!g2 || ui.group2 === 'none' || ui.group === 'none' || ui.group2 === ui.group) return g1;
  return {
    label: `${g1.label} × ${g2.label}`,
    // 掛け合わせると帯の順序は意味を失うので、色は通常の系列色に戻す
    get: (x, b) => `${g1.get(x, b) ?? '不明'}・${g2.get(x, b) ?? '不明'}`,
  };
}

/** 掛け合わせに出す選択肢。同じ分類どうしは選べない */
const group2Options = () => [['none', '掛け合わせなし'],
  ...Object.entries(MARKET_GROUPS)
    .filter(([k]) => k !== 'none' && k !== ui.group)
    .map(([k, v]) => [k, v.label])];

/**
 * 系列の色を決める。
 *
 * 渡すのは「実際に描く系列」だけにする。建物のように分類が90件もあるとき、
 * 全部を並べてから色を配ると、描く8本がどれも色あふれの灰色になってしまう。
 * 築年数や駅徒歩のように順序のある区分は、並び順どおりに濃さが変わる色を当てる。
 */
function colorOf(names, group = null) {
  const map = new Map();
  if (group?.order) {
    // 4段までなら濃さが順に変わる色を当てる。それより細かく刻むと、
    // 濃さの差が小さすぎて線を見分けられないので、通常の系列色を順番どおりに当てる
    const ramp = group.order.length <= BAND_COLORS.length ? BAND_COLORS : SERIES_COLORS;
    group.order.forEach((k, i) => map.set(k, ramp[Math.min(i, ramp.length - 1)]));
    return map;
  }
  names.forEach((k, i) => map.set(k, i < SERIES_COLORS.length ? SERIES_COLORS[i] : null));
  return map;
}

/**
 * 点を2回押したときに、その部屋を開く。
 *
 * グラフで見つけた部屋をそのまま検討に載せたい、という流れを繋ぐ。
 * 登録済みならその部屋へ。まだなら、いま売り出しに出ている行から登録して開く。
 * 売り出しが終わっている過去の行は登録しても中身が古いだけなので、建物を開く。
 */
function openRoomFromRow(row, b) {
  if (!b) return;
  const same = (r) => r.floor === row.floor
    && r.area != null && row.area != null && Math.abs(r.area - row.area) < 0.05;
  const unit = allUnits().find((x) => x.b?.id === b.id && same(x.r));
  if (!unit) {
    toast(`${b.name} のこの部屋はいま売り出しに出ていません。建物を開きます`);
    location.hash = `#/b/${b.id}`;
    return;
  }
  const r = unit.r.fromListing ? promote(unit) : unit.r;
  if (unit.r.fromListing) toast(`${b.name} ${r.label} を登録しました`);
  location.hash = `#/r/${r.id}`;
}

/**
 * 同じ部屋の売り出しを、いちばん新しい1件にまとめる。
 *
 * 売れずに引っ込めて出し直すと、そのたびに別の行になる。ガレリアグランデの
 * 20階は7回出し直していて、点が7つ並んでいた。同じ階に別の部屋があるように
 * 見えるうえ、近似直線も1部屋を7回数えてしまう。
 *
 * 同じ部屋かどうかは、建物・階・専有面積・向き・間取りで見る。間取りまで見るのは、
 * この5つが揃っていて別の部屋ということはまず無い一方、向きまでしか見ないと
 * 同じ階・同じ広さ・同じ向きで間取りの違う部屋（1,533組あった）を1つに潰して
 * しまうため。掲載ごとの 2SLDK / 2LDK のような書き方の揺れは layoutLabel が均す。
 */
function latestPerRoom(rows) {
  const best = new Map();
  for (const x of rows) {
    const key = [x.buildingId, x.floor ?? '', x.area == null ? '' : x.area.toFixed(2),
      x.direction || '', layoutLabel(x.layout)].join('|');
    const cur = best.get(key);
    if (!cur || String(x.listedYM || '') > String(cur.listedYM || '')) best.set(key, x);
  }
  return [...best.values()];
}

function scatterSection(rows, buildings, rerender) {
  const metric = MARKET_METRICS[ui.metric], attr = MARKET_ATTRS[ui.attr];
  const group = activeGroup();
  const plotted = ui.latestOnly ? latestPerRoom(rows) : rows;
  const pts = [];
  for (const x of plotted) {
    const b = buildingOf(x.buildingId);
    const xv = attr.get(x, b), yv = metric.get(x, b);
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    pts.push({ x: xv, y: yv, key: group.get(x, b), row: x, b });
  }
  if (!pts.length) return el('div', { class: 'empty' }, `${attr.label} と ${metric.label} が揃った行がありません`);

  // 点の中身（建物名や価格の文字列）を組み立てる前に間引く
  const shownPts = thin(pts);
  // 色は点の多い分類から配る。出てきた順に配ると、ほとんどの点が灰色になる
  const tally = new Map();
  for (const p of shownPts) tally.set(p.key, (tally.get(p.key) || 0) + 1);
  const order = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const colors = colorOf(order, group);
  const OTHER = 'その他';
  const byKey = new Map();
  for (const p of shownPts) {
    const k = colors.get(p.key) ? p.key : OTHER;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({
      x: p.x, y: p.y, row: p.row, b: p.b,
      label: `${p.b?.name ?? ''} ${p.row.floor != null ? `${p.row.floor}階` : ''}`.trim(),
      info: [
        [p.row.layout, p.row.area ? fmt.sqm(p.row.area) : null, p.row.feature || null]
          .filter(Boolean).join('・'),
        `${fmt.man(p.row.price)}　坪 ${fmt.n(tsuboOf(p.row), 0)}万`,
        isOpen(p.row) ? '販売中' : `${ymLabel(p.row.listedYM)}〜${ymLabel(p.row.closedYM)}`,
      ].filter(Boolean),
    });
  }
  const rank = (name) => {
    if (name === OTHER) return 999;
    const i = group.order ? group.order.indexOf(name) : -1;
    return i < 0 ? 900 : i;
  };
  const allSeries = [...byKey.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([name, points]) => ({ name, points, color: name === OTHER ? SERIES_MUTED : colors.get(name) }));
  // 凡例で消した分類は描かない。凡例には残す（戻せなくなるため）
  const hidden = hiddenSet();
  const series = allSeries.filter((x) => !hidden.has(x.name));
  if (!series.length) {
    return el('div', { class: 'section' },
      el('div', { class: 'empty' }, 'すべての分類を消しています'),
      el('div', { class: 'legendrow' },
        chartLegend(allSeries, null, { hidden, onToggle: (name) => toggleSeries(name, rerender) }),
        showAllButton(rerender)));
  }

  const fit = ui.fit ? linearFit(pts) : null;
  const chart = scatterChart(series, {
    xLabel: `${attr.label}（${attr.unit}）`, yLabel: `${metric.label}（${metric.unit}）`,
    xTick: attr.tick, height: 360, fit, labels: ui.names,
    onOpen: (p) => openRoomFromRow(p.row, p.b),
  });
  return el('div', { class: 'section' },
    el('div', { class: 'panel-chart-head' },
      el('span', { class: 'panel-chart-title' }, metric.label, el('small', {}, '×'), attr.label),
      fit ? el('div', { class: 'fitbadge' },
        el('span', {}, `${attr.label}+1${attr.unit} → `,
          el('b', {}, `${fit.slope > 0 ? '+' : ''}${fmt.n(fit.slope, 1)}${metric.unit}`)),
        el('span', {}, '相場の幅 ', el('b', {}, `±${fmt.n(fit.sd, 1)}`)),
        el('span', {}, el('b', {}, `${fit.n.toLocaleString('ja-JP')}点`)),
      ) : null),
    el('div', { class: 'chartwrap' }, chart),
    allSeries.length > 1
      ? el('div', { class: 'legendrow' },
        chartLegend(allSeries, chart, { hidden, onToggle: (name) => toggleSeries(name, rerender) }),
        showAllButton(rerender))
      : null,
    el('p', { class: 'tiny muted' }, '点を2回押すと、その部屋を開きます'),
    scatterFoot(pts, shownPts.length, rows.length));
}

/** グラフの下に出す要約。点の散らばりを字面でも押さえられるようにする */
function scatterFoot(pts, drawn = pts.length, total = pts.length) {
  const rows = pts.map((p) => p.row);
  // 全件（数万件）を相手にするので、Math.min(...配列) は使えない（引数として展開されて落ちる）
  const range = (vals, f) => {
    const v = vals.filter(Number.isFinite);
    if (!v.length) return null;
    const avg = v.reduce((s, x) => s + x, 0) / v.length;
    const [lo, hi] = minMax(v);
    return `${f(lo)}〜${f(hi)}（平均 ${f(avg)}）`;
  };
  const price = range(rows.map((r) => r.price), (x) => fmt.n(x, 0));
  const area = range(rows.map((r) => r.area), (x) => fmt.n(x, 1));
  const tsubo = range(rows.map((r) => tsuboOf(r)), (x) => fmt.n(x, 0));
  return el('div', { class: 'chart-foot' },
    el('span', {}, '表示中 ', el('b', {}, `${pts.length.toLocaleString('ja-JP')}件`)),
    ui.latestOnly && total > pts.length
      ? el('span', { class: 'tiny muted' },
        `同じ部屋の出し直し ${(total - pts.length).toLocaleString('ja-JP')}件をまとめています`)
      : null,
    drawn < pts.length
      ? el('span', { class: 'tiny muted' },
        `点は${drawn.toLocaleString('ja-JP')}件に間引き（数字は全件）`)
      : null,
    price ? el('span', {}, `価格 ${price} 万円`) : null,
    area ? el('span', {}, `面積 ${area} ㎡`) : null,
    tsubo ? el('span', {}, `坪単価 ${tsubo} 万円`) : null,
  );
}

/* =========================================================
   推移（分類ごと・点を押すと中身が出る）
   ========================================================= */
/**
 * 「上がっている・下がっている」だけでは判断できない。その値を作っている
 * 部屋を見ないと、たまたま広い部屋が出ただけの月に引きずられる。
 * 点を押したら、その期間の売り出しを下に並べる。
 */
function trendView(rows, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');
  const metric = MARKET_METRICS[ui.metric];
  const group = activeGroup();

  // 見る期間。17年ぶんを1枚に描くと、いまの動きが潰れて読めない
  const from = ui.span === 'all' ? -Infinity : nowYear() - Number(ui.span);
  const target = rows.filter((x) => (ymToNum(x.listedYM) ?? -Infinity) >= from);
  if (!target.length) {
    return el('div', {}, trendControls(rerender),
      el('div', { class: 'empty' }, 'この期間に売り出しがありません'));
  }

  // 期間ごと・分類ごとにまとめる
  const cells = new Map();
  for (const x of target) {
    const p = periodOf(x);
    if (p == null) continue;
    const key = group.get(x, buildingOf(x.buildingId)) ?? '不明';
    const id = `${key}|${p}`;
    if (!cells.has(id)) cells.set(id, { key, period: p, rows: [] });
    cells.get(id).rows.push(x);
  }
  if (!cells.size) return el('div', { class: 'empty' }, 'まとめられる行がありません');

  // 系列ごとの点。件数の少ない期間は中央値と呼べないので落とす
  // 下限を満たす点が1つも無ければ、下限を下げて描く。
  // 条件を絞り込むと「1件だけの月」ばかりになり、空のグラフが出ていた
  let floor = ui.minCount;
  const enough = (n) => [...cells.values()].some((c) => c.rows.length >= n);
  while (floor > 1 && !enough(floor)) floor = floor === 10 ? 5 : floor === 5 ? 3 : 1;

  const byKey = new Map();
  for (const c of cells.values()) {
    const vals = c.rows.map((x) => metric.get(x, buildingOf(x.buildingId))).filter(Number.isFinite);
    if (vals.length < floor) continue;
    if (!byKey.has(c.key)) byKey.set(c.key, []);
    byKey.get(c.key).push({
      x: c.period, y: median(vals), key: c.key,
      label: `${periodLabel(c.period)}　${c.key}`,
      info: [`中央 ${fmt.n(median(vals), 1)}${metric.unit}　${vals.length}件`, '押すと下に一覧が出ます'],
    });
  }
  // 線が多すぎると読めないので、件数の多い順に SERIES_COLORS のぶんだけ描く。
  // 色は「描くと決まった系列」に配る（全分類に配ると、描く線が灰色ばかりになる）
  const drawnKeys = [...byKey.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, SERIES_COLORS.length);
  const colors = colorOf(drawnKeys.map(([name]) => name), group);
  // 築年数のように順序のある区分は、凡例も新しい順に並べる（件数順だと読めない）
  if (group.order) {
    const rank = (name) => {
      const i = group.order.indexOf(name);
      return i < 0 ? 999 : i;
    };
    drawnKeys.sort((a, b) => rank(a[0]) - rank(b[0]));
  }
  const all = drawnKeys.map(([name, points]) => ({
    name, points: points.sort((a, b) => a.x - b.x),
    color: colors.get(name) || SERIES_MUTED,
  }));
  // 凡例で消した分類は描かない。凡例からは消さない（戻せなくなるため）
  const hidden = hiddenSet();
  const series = all.filter((s) => !hidden.has(s.name));
  if (!all.length) {
    return el('div', {}, trendControls(rerender),
      el('div', { class: 'empty' }, 'まとめられる期間がありません'));
  }
  if (!series.length) {
    return el('div', {}, trendControls(rerender),
      el('div', { class: 'section' },
        el('div', { class: 'empty' }, 'すべての分類を消しています'),
        chartLegend(all, null, { hidden, onToggle: (name) => toggleSeries(name, rerender) }),
        showAllButton(rerender)));
  }

  const fit = ui.fit ? linearFit(series.flatMap((s) => s.points)) : null;
  const chart = scatterChart(series, {
    xLabel: ui.step === 'month' ? '売り出した月' : '売り出した年',
    yLabel: `${metric.label}（${metric.unit}）`,
    xTick: (v) => periodLabel(v, true),
    height: 340, fit, line: true,
    onPick: (p) => { ui.pick = p ? { key: p.key, period: p.x } : null; rerender(); },
  });

  const picked = ui.pick
    ? [...cells.values()].find((c) => c.key === ui.pick.key && c.period === ui.pick.period)
    : null;

  const { list, cagr } = yearly(target, ui.metric);
  return el('div', {},
    list.length
      ? el('div', { class: 'section' },
        el('div', { class: 'calcgrid calcgrid-4' },
          cell('年平均の伸び', cagr != null ? `${cagr > 0 ? '+' : ''}${fmt.n(cagr, 2)}%` : '—',
            `${list[0].year}年〜${list[list.length - 1].year}年`),
          cell('最初の年', `${fmt.n(list[0].median, 0)}${metric.unit}`,
            `${list[0].year}年　${list[0].count}件`),
          cell('最後の年', `${fmt.n(list[list.length - 1].median, 0)}${metric.unit}`,
            `${list[list.length - 1].year}年　${list[list.length - 1].count}件`),
          cell('この間の倍率', list[0].median
            ? `${fmt.n(list[list.length - 1].median / list[0].median, 2)}倍` : '—'),
        ))
      : null,
    trendControls(rerender),
    el('div', { class: 'section' },
      el('div', { class: 'chartwrap' }, chart),
      all.length > 1
        ? el('div', { class: 'legendrow' },
          chartLegend(all, chart, { hidden, onToggle: (name) => toggleSeries(name, rerender) }),
          showAllButton(rerender))
        : null,
      el('p', { class: 'tiny muted' },
        all.length > 1 ? '凡例を押すと、その分類の線を消せます。' : '',
        floor < ui.minCount
          ? `${ui.minCount}件以上まとまる期間が無いため、${floor}件以上で描いています。`
          : '',
        'グラフの点を押すと、その期間の売り出しが下に並びます')),
    ui.group === 'none' || series.length < 2 ? null : growthSection(target, series, metric),
    picked
      ? el('div', { class: 'section' },
        el('div', { class: 'pickhead' },
          el('b', {}, `${periodLabel(picked.period)}　${picked.key}`),
          el('span', { class: 'tiny muted' }, `${picked.rows.length}件`),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn btn-sm', onclick: () => { ui.pick = null; rerender(); } }, 'クリア')),
        saleTable(sortRows(picked.rows).slice(0, 200), picked.rows.length, rerender))
      : null,
    el('div', { class: 'section' },
      el('h3', {}, '年ごとの数字'),
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {},
            ['年', '件数', `中央（${metric.unit}）`, '前年から', '平均', '最安', '最高']
              .map((c, i) => el('th', { class: i === 0 ? 'lab' : null }, c)))),
          el('tbody', {}, [...list].reverse().map((r) => el('tr', {},
            el('td', { class: 'lab' }, `${r.year}年`),
            el('td', {}, r.count.toLocaleString('ja-JP')),
            el('td', {}, fmt.n(r.median, 1)),
            el('td', { class: r.diff == null ? null : r.diff >= 0 ? 'up' : 'down' },
              r.diff == null ? '—' : `${r.diff > 0 ? '+' : ''}${fmt.n(r.diff, 1)}%`),
            el('td', {}, fmt.n(r.avg, 1)),
            el('td', {}, fmt.n(r.min, 0)),
            el('td', {}, fmt.n(r.max, 0)))))))));
}

/**
 * 分類ごとの伸び。エリア別に並べて、どこがいちばん上がったかを字面で見る。
 *
 * 線の高さ（いくらか）はグラフで分かるが、傾きの差（どれだけ上がったか）は
 * 目では比べにくい。同じ期間・同じ表示単位で、年平均の伸びを並べて出す。
 * グラフは線が多いと読めないので8本までだが、表はその外の分類も載せる。
 */
const GROWTH_MIN = 10;     // これ未満の件数は、伸び率が跳ねるので順位づけに使わない
const GROWTH_ROWS = 30;

function growthSection(target, series, metric) {
  const group = activeGroup();
  const byKey = new Map();
  for (const x of target) {
    const k = group.get(x, buildingOf(x.buildingId)) ?? '不明';
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(x);
  }
  const drawn = new Map(series.map((x) => [x.name, x.color]));
  const all = [...byKey.entries()].map(([name, rows]) => {
    const { list: years, cagr } = yearly(rows, ui.metric);
    const first = years[0] || null;
    const last = years.length > 1 ? years[years.length - 1] : null;
    return {
      name, rows: rows.length, cagr, first, last,
      color: drawn.get(name) || null,
      times: first && last && first.median ? last.median / first.median : null,
    };
  }).sort((a, b) => (b.cagr ?? -Infinity) - (a.cagr ?? -Infinity));

  const list = all.slice(0, GROWTH_ROWS);
  // 件数の少ない分類は伸び率が跳ねるので、いちばん上／下の判定からは外す
  const rated = all.filter((r) => r.cagr != null && r.rows >= GROWTH_MIN);
  const top = rated[0], bottom = rated[rated.length - 1];
  const pct = (v) => `${v > 0 ? '+' : ''}${fmt.n(v, 2)}%`;

  return el('div', { class: 'section' },
    el('h3', {}, `${group.label}ごとの伸び`),
    rated.length > 1
      ? el('div', { class: 'chart-foot' },
        el('span', {}, 'いちばん上がった ', el('b', {}, top.name), ' ', pct(top.cagr)),
        el('span', {}, 'いちばん低い ', el('b', {}, bottom.name), ' ', pct(bottom.cagr)),
        el('span', {}, '差 ', el('b', {}, `${fmt.n(top.cagr - bottom.cagr, 2)}ポイント`)),
        el('span', { class: 'tiny muted' },
          `${ui.span === 'all' ? '全期間' : `直近${ui.span}年`}・${metric.label}の中央値`
          + `　${GROWTH_MIN}件以上の${group.label} ${rated.length}件から`))
      : null,
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp markettbl' },
        el('thead', {}, el('tr', {},
          ['', group.label, '件数', '期間', `最初（${metric.unit}）`, `最後（${metric.unit}）`,
            '年平均の伸び', '倍率'].map((c, i) =>
            el('th', { class: i === 1 ? 'lab' : null }, c)))),
        el('tbody', {}, list.map((r) => el('tr', {},
          el('td', {}, el('i', {
            class: 'seriesdot' + (r.color ? '' : ' is-off'),
            style: r.color ? `background:${r.color}` : null,
          })),
          el('td', { class: 'lab' }, r.name),
          el('td', {}, r.rows.toLocaleString('ja-JP')),
          el('td', {}, r.first ? `${r.first.year}年〜${(r.last || r.first).year}年` : '—'),
          el('td', {}, r.first ? fmt.n(r.first.median, 1) : '—'),
          el('td', {}, r.last ? fmt.n(r.last.median, 1) : '—'),
          el('td', { class: r.cagr == null ? null : r.cagr >= 0 ? 'up' : 'down' },
            r.cagr == null ? '—' : pct(r.cagr)),
          el('td', {}, r.times == null ? '—' : `${fmt.n(r.times, 2)}倍`),
        ))))),
    el('p', { class: 'tiny muted' },
      '年平均の伸びは、最初の年と最後の年の中央値から出した複利の伸び率です。'
      + '1年ぶんしか記録が無い分類は「—」になります。'
      + `色が付いているのがグラフに出ている${group.label}です。`
      + (all.length > list.length
        ? `　${all.length.toLocaleString('ja-JP')}件のうち伸びの高い順に${GROWTH_ROWS}件を出しています。`
        : '')));
}

/** 売り出した月（または年）を小数年で返す */
function periodOf(x) {
  const y = ymToNum(x.listedYM);
  if (y == null) return null;
  return ui.step === 'month' ? Math.round(y * 12) / 12 : Math.floor(y);
}

function periodLabel(v, short = false) {
  const y = Math.floor(v + 1e-6);
  if (ui.step !== 'month') return `${y}年`;
  const mo = Math.round((v - y) * 12) + 1;
  return short ? `${y}/${String(mo).padStart(2, '0')}` : `${y}年${mo}月`;
}

/** 推移の操作。分類・粒度・点にまとめる下限・トレンドライン */
function trendControls(rerender) {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-controls' },
      controlRow('↕', '表示単位',
        segmented(ui.metric, Object.entries(MARKET_METRICS).map(([k, v]) => [k, v.label]),
          (k) => { ui.metric = k; rerender(); })),
      controlRow('◍', '分類',
        el('div', { style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap' },
          select(ui.group, Object.entries(MARKET_GROUPS).map(([k, v]) => [k, v.label]),
            (k) => { ui.group = k; ui.pick = null; ui.hide = []; rerender(); }, 'picksel'),
          el('span', { class: 'tiny muted' }, '×'),
          select(ui.group2, group2Options(),
            (k) => { ui.group2 = k; ui.pick = null; ui.hide = []; rerender(); }, 'picksel'),
          segmented(ui.step, [['year', '年ごと'], ['month', '月ごと']],
            (k) => { ui.step = k; ui.pick = null; rerender(); }),
          // 期間。既定は直近7年。それ以上は線が詰まって、いまの動きが読めない
          el('label', { class: 'tiny muted' }, '期間　',
            select(String(ui.span),
              [['3', '直近3年'], ['5', '直近5年'], ['7', '直近7年'], ['10', '直近10年'], ['all', 'すべて']],
              (v) => { ui.span = v === 'all' ? 'all' : Number(v); ui.pick = null; rerender(); }, 'fsel')),
          // 1〜2件の期間は中央値と呼べず、線が跳ねて読めなくなる
          el('label', { class: 'tiny muted' }, '各点の下限　',
            select(String(ui.minCount), [['1', '1件'], ['3', '3件'], ['5', '5件'], ['10', '10件']],
              (v) => { ui.minCount = Number(v); rerender(); }, 'fsel')),
          toggle('トレンドライン', ui.fit, (v) => { ui.fit = v; rerender(); }))),
    ));
}

/* =========================================================
   供給（募集戸数の推移）
   ========================================================= */
/**
 * その建物（または条件に合う建物）から、いつ何件売りに出たか。
 *
 * 相場が上がっていても、同時に10件出ていれば買い手が選べる。
 * 逆に何年も1〜2件しか出ない建物は、出たときに動かないと買えない。
 * 棒を押すと、その月に出た部屋が下に並ぶ。
 */
function supplyView(rows, buildings, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');

  const from = ui.span === 'all' ? -Infinity : nowYear() - Number(ui.span);
  const period = (ym) => {
    const y = ymToNum(ym);
    if (y == null || y < from) return null;
    return ui.step === 'month' ? Math.round(y * 12) / 12 : Math.floor(y);
  };

  // 区間ごとに、始まった募集と終わった募集を数える
  const bins = new Map();
  const at = (p) => {
    if (!bins.has(p)) bins.set(p, { from: p, to: p, a: 0, b: 0, rows: [], closed: [] });
    return bins.get(p);
  };
  for (const x of rows) {
    const s = period(x.listedYM);
    if (s != null) { const c = at(s); c.a++; c.rows.push(x); }
    const e = period(x.closedYM);
    if (e != null) { const c = at(e); c.b++; c.closed.push(x); }
  }
  const list = [...bins.values()].sort((a, b) => a.from - b.from);
  if (!list.length) return el('div', {}, supplyControls(rerender),
    el('div', { class: 'empty' }, 'この期間に売り出しがありません'));

  // 総戸数に対してどれだけ出ているか。1棟に絞っているときがいちばん読みやすい
  const units = buildings.reduce((s, b) => s + (Number(b.totalUnits) || 0), 0);
  const open = rows.filter(isOpen);
  const lastYear = list.filter((c) => c.from >= nowYear() - 1);
  const started = lastYear.reduce((s, c) => s + c.a, 0);
  const ended = lastYear.reduce((s, c) => s + c.b, 0);

  const chart = histogramChart(list, {
    // 目盛りが「2019/09」の形なので、軸の名前は出さない（斜めの目盛りと重なる）
    xLabel: '', height: 300, fmt: (v) => periodLabel(v, true),
    legend: ['売り出し開始', '掲載終了'],
    onPick: (b) => { ui.pick = { key: '供給', period: b.from }; rerender(); },
  });
  const picked = ui.pick ? list.find((c) => c.from === ui.pick.period) : null;

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('いま出ている数', `${open.length.toLocaleString('ja-JP')}件`,
          `${buildings.length.toLocaleString('ja-JP')}棟`),
        cell('総戸数に対して', units ? `${fmt.n((open.length / units) * 100, 1)}%` : '—',
          units ? `総戸数 ${units.toLocaleString('ja-JP')}戸` : '総戸数が未登録'),
        cell('直近1年に出た数', `${started.toLocaleString('ja-JP')}件`,
          units ? `総戸数の ${fmt.n((started / units) * 100, 1)}%` : null),
        cell('直近1年に終わった数', `${ended.toLocaleString('ja-JP')}件`,
          started ? `出た数の ${fmt.n((ended / started) * 100, 0)}%` : null),
      )),
    supplyControls(rerender),
    el('div', { class: 'section' },
      el('div', { class: 'chartwrap' }, chart),
      el('div', { class: 'chart-foot' },
        el('span', {}, el('b', { style: `color:${SERIES_COLORS[0]}` }, '■'), ' 売り出し開始'),
        el('span', {}, el('b', { style: 'color:var(--text-3)' }, '■'), ' 掲載終了'),
        el('span', { class: 'tiny muted' }, '棒を押すと、その期間に売り出した部屋が下に並びます')),),
    picked
      ? el('div', { class: 'section' },
        el('div', { class: 'pickhead' },
          el('b', {}, periodLabel(picked.from)),
          el('span', { class: 'tiny muted' },
            `売り出し ${picked.rows.length}件　掲載終了 ${picked.closed.length}件`),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn btn-sm', onclick: () => { ui.pick = null; rerender(); } }, 'クリア')),
        picked.rows.length
          ? saleTable(sortRows(picked.rows).slice(0, 200), picked.rows.length, rerender)
          : el('div', { class: 'empty' }, 'この期間に売り出した部屋はありません（終了のみ）'))
      : null,
    el('div', { class: 'section' },
      el('h3', {}, '期間ごとの数字'),
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {},
            ['期間', '売り出し', '掲載終了', '差引'].map((c, i) =>
              el('th', { class: i === 0 ? 'lab' : null }, c)))),
          el('tbody', {}, [...list].reverse().slice(0, 120).map((c) => el('tr', {},
            el('td', { class: 'lab' }, periodLabel(c.from)),
            el('td', {}, c.a || '—'),
            el('td', {}, c.b || '—'),
            el('td', { class: c.a - c.b > 0 ? 'up' : c.a - c.b < 0 ? 'down' : null },
              c.a - c.b > 0 ? `+${c.a - c.b}` : String(c.a - c.b)))))))));
}

/** 供給の操作。粒度と期間だけ。表示単位は件数なので出さない */
function supplyControls(rerender) {
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-controls' },
      controlRow('◍', 'まとめ方',
        el('div', { style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap' },
          segmented(ui.step, [['year', '年ごと'], ['month', '月ごと']],
            (k) => { ui.step = k; ui.pick = null; rerender(); }),
          el('label', { class: 'tiny muted' }, '期間　',
            select(String(ui.span),
              [['3', '直近3年'], ['5', '直近5年'], ['7', '直近7年'], ['10', '直近10年'], ['all', 'すべて']],
              (v) => { ui.span = v === 'all' ? 'all' : Number(v); ui.pick = null; rerender(); }, 'fsel')))),
    ));
}

/* =========================================================
   一括出力（レポート）
   ========================================================= */
/**
 * いま出している条件のまま、相場の各画面を1枚に並べる。
 * ブラウザの印刷から「PDFとして保存」を選べばPDFになる。
 *
 * PDFを作る部品は入れていない。入れると外から読み込むものが増えて、
 * 圏外でも開ける今の作りが崩れるため。印刷ならグラフも文字のまま出る。
 */
function reportView(rows, buildings, rerender) {
  const when = new Date();
  const stamp = `${when.getFullYear()}年${when.getMonth() + 1}月${when.getDate()}日`;
  const cond = activeConditions();

  // 3つ目は表に残す行数。グラフの大きい節は少なく、表だけの節は多く載せる
  const sections = [
    ['概況', () => overview(rows, buildings), 12],
    ['売出', () => saleView(rows, buildings, rerender), 10],
    ['推移', () => trendView(rows, rerender), 10],
    ['供給', () => supplyView(rows, buildings, rerender), 12],
    ['分布', () => distView(rows, rerender), 24],
    ['建物別', () => groupView(rows, rerender), 24],
    ['賃貸', () => rentView(buildings), 10],
    ['新築', () => newView(buildings), 10],
  ];

  // グラフを描き終えてから保存の画面を出す。すぐ呼ぶと白いまま印刷される
  if (ui.autoPrint) {
    ui.autoPrint = false;
    setTimeout(() => window.print(), 400);
  }
  return el('div', { class: 'report' },
    el('div', { class: 'report-head' },
      el('div', {},
        el('h2', {}, '相場レポート'),
        el('p', { class: 'tiny muted' },
          `${stamp}　対象 ${buildings.length.toLocaleString('ja-JP')}棟`
          + `　売り出し ${rows.length.toLocaleString('ja-JP')}件`)),
      el('div', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary noprint', onclick: () => window.print(),
      }, 'PDFとして保存'),
      el('button', {
        class: 'btn noprint',
        onclick: () => { location.hash = '#/market'; },
      }, '相場に戻る')),
    el('div', { class: 'report-cond' },
      el('b', {}, '条件'),
      cond.length
        ? cond.map(([k, v]) => el('span', { class: 'fchip' }, `${k}：${v}`))
        : el('span', { class: 'tiny muted' }, '指定なし（すべて）')),
    el('p', { class: 'tiny muted noprint' },
      '保存の画面が出たら、送信先（プリンター）で「PDFに保存」を選んでください。'
      + 'タブ1つが1ページになります。'),
    sections.map(([name, build, max]) => el('div', { class: 'report-sec' },
      el('h3', { class: 'report-sectitle' }, name),
      trimTables(build(), max))),
  );
}

/**
 * レポートの表は先頭だけ残す。
 * 画面では400行まで出しているが、そのまま紙にすると60ページになる。
 * タブ1つで1ページに収めたいので、グラフと一緒に載る分だけ残す。
 * 元の件数は下に添えるので、全部見たいときは画面に戻ってもらう。
 */
function trimTables(node, max = 10) {
  for (const body of node.querySelectorAll ? node.querySelectorAll('tbody') : []) {
    const rows = [...body.children];
    if (rows.length <= max) continue;
    for (const tr of rows.slice(max)) tr.remove();
    const cols = rows[0]?.children.length || 1;
    const more = el('tr', {}, el('td', { class: 'tiny muted', colspan: String(cols) },
      `ほか ${(rows.length - max).toLocaleString('ja-JP')}行（画面で見られます）`));
    body.append(more);
  }
  return node;
}

/** いま効いている条件を、レポートの見出しに出す形で並べる */
export function activeConditions() {
  // 建物名・エリア・間取りなどは共通の絞り込みが持っている。取りこぼすと
  // 「何で絞ったレポートか」が紙の上で分からなくなる
  const out = activeUnitConditions().map((c) => [c.name, c.value]);
  if (ui.building !== 'all') {
    out.unshift(['建物', buildingOf(ui.building)?.name ?? ui.building]);
  }
  if (ui.listing !== 'all') {
    out.push(['募集状況', ui.listing === 'open' ? '販売中' : '終了']);
  }
  if (ui.from !== 'all' || ui.to !== 'all') {
    out.push(['売り出し年',
      `${ui.from === 'all' ? '' : `${ui.from}年`}〜${ui.to === 'all' ? '' : `${ui.to}年`}`]);
  }
  return out;
}

/* =========================================================
   分布
   ========================================================= */
function distView(rows, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');
  const metric = MARKET_METRICS[ui.metric];
  const { bins } = bands(rows, ui.metric);
  return el('div', {},
    axisControls(rerender),
    el('div', { class: 'section' },
      el('h3', {}, `${metric.label}の分布`),
      el('div', { class: 'chartwrap' },
        histogramChart(bins, {
          xLabel: metric.unit, height: 300,
          fmt: (v) => fmt.n(v, 0), legend: ['販売中', '終了'],
        }))));
}

/* =========================================================
   建物別
   ========================================================= */
function groupView(rows, rerender) {
  if (!rows.length) return el('div', { class: 'empty' }, '条件に合う売り出しがありません');
  const metric = MARKET_METRICS[ui.metric];
  const stats = groupBy(rows, buildingOf,
    ui.group === 'none' ? MARKET_GROUPS.building : activeGroup(), ui.metric);
  const body = el('tbody', {}, stats.map((r) => el('tr', {},
    el('td', { class: 'lab' }, r.name),
    el('td', {}, r.count.toLocaleString('ja-JP')),
    el('td', {}, `${fmt.n(r.ratio, 1)}%`),
    el('td', {}, fmt.n(r.median, 1)),
    el('td', {}, fmt.n(r.avg, 1)),
    el('td', {}, fmt.n(r.min, 0)),
    el('td', {}, fmt.n(r.max, 0)))));
  return el('div', {},
    axisControls(rerender, { group: true, groupLabel: '区分' }),
    el('div', { class: 'section' },
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {},
            ['区分', '件数', '割合', `中央（${metric.unit}）`, '平均', '最安', '最高']
              .map((c, i) => el('th', { class: i === 0 ? 'lab' : null }, c)))),
          body))));
}

/* =========================================================
   売出の表
   ========================================================= */
const SALE_COLS = ['建物', '売り出し', '終了', '階', '間取り', '向き', '特徴', '専有', 'バルコニー',
  '価格', '価格変更', '坪単価', '㎡単価', '管理費', '修繕', ''];

function saleTable(rows, total, rerender) {
  const body = el('tbody', {}, rows.map((x) => {
    const cut = cutOf(x);
    const months = monthsOf(x);
    const b = buildingOf(x.buildingId);
    return el('tr', {},
      el('td', { class: 'lab' }, b?.name ?? '—'),
      el('td', { class: 'lab' }, ymLabel(x.listedYM)),
      el('td', { class: 'lab' },
        isOpen(x) ? el('b', { class: 'openmark' }, '販売中') : el('span', {}, ymLabel(x.closedYM)),
        months ? el('div', { class: 'tiny muted' }, `${months}か月`) : null),
      el('td', { class: 'lab' }, x.floor != null ? `${x.floor}階` : '—'),
      el('td', { class: 'lab' }, x.layout || '—'),
      el('td', { class: 'lab' }, x.direction || '—'),
      el('td', { class: 'lab' }, x.feature || '—'),
      el('td', {}, x.area != null ? fmt.n(x.area, 2) : '—'),
      el('td', {}, x.balcony != null ? fmt.n(x.balcony, 1) : '—'),
      el('td', {}, x.price != null ? fmt.n(x.price, 0) : '—'),
      el('td', { class: 'lab' },
        (x.priceHistory || []).length
          ? el('div', {}, x.priceHistory.map((h) =>
            el('div', { class: 'tiny' }, `${ymLabel(h.ym)} ${fmt.n(h.price, 0)}`)))
          : '—',
        cut != null && cut < 0 ? el('div', { class: 'tiny cutmark' }, `${fmt.n(cut, 1)}%`) : null),
      el('td', {}, tsuboOf(x) != null ? fmt.n(tsuboOf(x), 2) : '—'),
      el('td', {}, sqmOf(x) != null ? fmt.n(sqmOf(x), 2) : '—'),
      el('td', {}, x.kanrihi != null ? fmt.n(x.kanrihi, 2) : '—'),
      el('td', {}, x.shuzen != null ? fmt.n(x.shuzen, 2) : '—'),
      el('td', {},
        isOpen(x) ? roomButton(x, rerender) : null,
        el('button', {
          class: 'btn btn-sm',
          onclick: () => {
            if (!confirm(`${ymLabel(x.listedYM)} の行を消しますか`)) return;
            store.deleteListing(x.buildingId, x.id);
            rerender();
          },
        }, '削除')));
  }));
  return el('div', { class: 'section' },
    total > rows.length
      ? el('div', { class: 'filterrow' },
        el('span', { class: 'tiny muted' },
          `${total.toLocaleString('ja-JP')}件のうち新しい ${rows.length} 件`))
      : null,
    el('div', { class: 'tablewrap' },
      el('table', { class: 'cmp markettbl' },
        el('thead', {}, el('tr', {}, SALE_COLS.map((c, i) =>
          el('th', { class: i < 7 ? 'lab' : null }, c)))),
        body)));
}

/**
 * 募集中の行から検討中の部屋を作る。
 * 掲載サイトのスクショを撮り直さずに済ませるための入口で、写して入れる項目は
 * すべてこの行に揃っている（足りないのは部屋番号と写真だけ）。
 */
function roomButton(x, rerender) {
  const b = store.building(x.buildingId);
  const dup = store.roomsOf(x.buildingId).find((r) =>
    r.floor === x.floor && r.area === x.area && r.price === x.price);
  if (dup) {
    return el('a', {
      href: '#', class: 'tiny',
      onclick: (e) => { e.preventDefault(); location.hash = `#/r/${dup.id}`; },
    }, '登録済み');
  }
  return el('button', {
    class: 'btn btn-sm btn-primary',
    onclick: () => {
      const r = store.addRoom(x.buildingId, {
        label: x.floor != null ? `${x.floor}階` : '新規の部屋',
        price: x.price, area: x.area, layout: x.layout, floor: x.floor, balcony: x.balcony,
        kanrihi: x.kanrihi, shuzen: x.shuzen,
        listingStatus: '募集中',
        listedAt: x.listedYM ? `${x.listedYM}-01` : null,
        priceHistory: (x.priceHistory || []).map((h) => ({ date: `${h.ym}-01`, price: h.price })),
        roomEquipmentTags: /角部屋/.test(x.feature || '') ? ['角部屋'] : [],
        renovation: renovationOf(x.feature),
        url: b?.url || '',
        memo: x.feature ? `マンレビの特徴：${x.feature}` : '',
      });
      if (!r.priceHistory.length && x.price != null && x.listedYM) {
        r.priceHistory = [{ date: `${x.listedYM}-01`, price: x.price }];
      }
      store.markDirty();
      rerender();
      location.hash = `#/r/${r.id}`;
    },
  }, '部屋にする');
}

/** 「リフォーム・リノベーション」からリノベ区分を決める */
function renovationOf(feature = '') {
  if (/リノベーション/.test(feature)) return RENOVATION[2];
  if (/リフォーム/.test(feature)) return RENOVATION[1];
  return RENOVATION[0];
}

/* =========================================================
   賃貸
   ========================================================= */
function rentView(buildings) {
  const rows = sortRents(buildings.flatMap((b) => store.rentsOf(b.id)));
  if (!rows.length) return el('div', { class: 'empty' }, '賃料履歴がありません');
  const r = rentSummary(rows);
  const span = r.span ? `${ymLabel(r.span.from)}〜${ymLabel(r.span.to)}` : '—';

  const pts = thin(rows.filter((x) => rentTsuboOf(x) != null && ymToNum(x.ym) != null)).map((x) => ({
    x: ymToNum(x.ym), y: rentTsuboOf(x),
    label: `${buildingOf(x.buildingId)?.name ?? ''} ${x.floor != null ? `${x.floor}階` : ''}`.trim(),
    info: [
      [x.layout, x.area ? fmt.sqm(x.area) : null, x.direction || null].filter(Boolean).join('・'),
      `${fmt.n(x.rent, 0)}円/月　坪 ${fmt.n(rentTsuboOf(x), 0)}円`,
      `${ymLabel(x.ym)}`,
    ].filter(Boolean),
  }));
  const fit = linearFit(pts);
  const chart = scatterChart([{ name: '賃料', points: pts, color: SERIES_COLORS[2] }], {
    xLabel: '募集した年', yLabel: '賃料の坪単価（円/坪・月）',
    xTick: (v) => String(Math.round(v)), height: 300, fit,
  });

  const cols = ['建物', '募集', '階', '間取り', '向き', '専有', '賃料', '坪単価', '㎡単価',
    '管理費', '敷金', '礼金', '保証金'];
  const shown = rows.slice(0, 400);
  const body = el('tbody', {}, shown.map((x) => el('tr', {},
    el('td', { class: 'lab' }, buildingOf(x.buildingId)?.name ?? '—'),
    el('td', { class: 'lab' }, ymLabel(x.ym)),
    el('td', { class: 'lab' }, x.floor != null ? `${x.floor}階` : '—'),
    el('td', { class: 'lab' }, x.layout || '—'),
    el('td', { class: 'lab' }, x.direction || '—'),
    el('td', {}, x.area != null ? fmt.n(x.area, 2) : '—'),
    el('td', {}, x.rent != null ? fmt.n(x.rent, 0) : '—'),
    el('td', {}, rentTsuboOf(x) != null ? fmt.n(rentTsuboOf(x), 0) : '—'),
    el('td', {}, rentSqmOf(x) != null ? fmt.n(rentSqmOf(x), 0) : '—'),
    el('td', {}, x.kanrihi != null ? fmt.n(x.kanrihi, 0) : '—'),
    el('td', {}, x.deposit != null ? fmt.n(x.deposit, 0) : '—'),
    el('td', {}, x.keyMoney != null ? fmt.n(x.keyMoney, 0) : '—'),
    el('td', {}, x.guarantee != null ? fmt.n(x.guarantee, 0) : '—'))));

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('件数', `${r.count.toLocaleString('ja-JP')}件`),
        cell('期間', span),
        cell('坪単価 中央', r.tsuboMed != null ? `${fmt.n(r.tsuboMed, 0)}円` : '—',
          r.tsuboMin != null ? `${fmt.n(r.tsuboMin, 0)}〜${fmt.n(r.tsuboMax, 0)}円` : null),
        cell('賃料 中央', r.rentMed != null ? `${fmt.n(r.rentMed, 0)}円/月` : '—'),
      )),
    el('div', { class: 'section' },
      el('div', { class: 'chartwrap' }, chart)),
    el('div', { class: 'section' },
      rows.length > shown.length
        ? el('div', { class: 'filterrow' },
          el('span', { class: 'tiny muted' },
            `${rows.length.toLocaleString('ja-JP')}件のうち新しい ${shown.length} 件`))
        : null,
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {}, cols.map((c, i) =>
            el('th', { class: i < 5 ? 'lab' : null }, c)))),
          body))));
}

/* =========================================================
   新築
   ========================================================= */
function newView(buildings) {
  const rows = sortNewPrices(buildings.flatMap((b) => store.newPricesOf(b.id)));
  if (!rows.length) return el('div', { class: 'empty' }, '新築分譲価格がありません');
  const n = newSummary(rows);

  // 横軸を階にする。新築時は同じ時点で一斉に売られたので、年で見ても意味がない
  const pts = thin(rows.filter((x) => newTsuboOf(x) != null && x.floor != null)).map((x) => ({
    x: x.floor, y: newTsuboOf(x),
    label: `${buildingOf(x.buildingId)?.name ?? ''} ${x.floor}階`.trim(),
    info: [
      [x.layout, x.area ? fmt.sqm(x.area) : null, x.direction || null].filter(Boolean).join('・'),
      `${fmt.man(x.price)}　坪 ${fmt.n(newTsuboOf(x), 0)}万`,
    ].filter(Boolean),
  }));
  const fit = linearFit(pts);
  const chart = scatterChart([{ name: '新築時', points: pts, color: SERIES_COLORS[1] }], {
    xLabel: '所在階', yLabel: '坪単価（万円/坪）',
    xTick: (v) => String(Math.round(v)), height: 300, fit,
  });

  const cols = ['建物', '階', '向き', '間取り', '専有', 'バルコニー', '新築時価格', '坪単価'];
  // 全部並べると数千行になり、それだけで表示が止まる。上から400行に絞る
  const shown = rows.slice(0, 400);
  const body = el('tbody', {}, shown.map((x) => el('tr', {},
    el('td', { class: 'lab' }, buildingOf(x.buildingId)?.name ?? '—'),
    el('td', { class: 'lab' }, x.floor != null ? `${x.floor}階` : '—'),
    el('td', { class: 'lab' }, x.direction || '—'),
    el('td', { class: 'lab' }, x.layout || '—'),
    el('td', {}, x.area != null ? fmt.n(x.area, 2) : '—'),
    el('td', {}, x.balcony != null ? fmt.n(x.balcony, 1) : '—'),
    el('td', {}, x.price != null ? fmt.n(x.price, 0) : '—'),
    el('td', {}, newTsuboOf(x) != null ? fmt.n(newTsuboOf(x), 2) : '—'))));

  return el('div', {},
    el('div', { class: 'section' },
      el('div', { class: 'calcgrid calcgrid-4' },
        cell('件数', `${n.count}件`),
        cell('棟数', `${new Set(rows.map((x) => x.buildingId)).size}棟`),
        cell('坪単価 中央', n.tsuboMed != null ? `${fmt.n(n.tsuboMed, 0)}万` : '—',
          n.tsuboMin != null ? `${fmt.n(n.tsuboMin, 0)}〜${fmt.n(n.tsuboMax, 0)}万` : null),
        cell('最高', n.tsuboMax != null ? `${fmt.n(n.tsuboMax, 0)}万/坪` : '—'),
      )),
    el('div', { class: 'section' },
      el('div', { class: 'chartwrap' }, chart)),
    el('div', { class: 'section' },
      rows.length > shown.length
        ? el('p', { class: 'tiny muted' },
          `${rows.length.toLocaleString('ja-JP')}件のうち階の高い ${shown.length} 件`)
        : null,
      el('div', { class: 'tablewrap' },
        el('table', { class: 'cmp markettbl' },
          el('thead', {}, el('tr', {}, cols.map((c, i) =>
            el('th', { class: i < 4 ? 'lab' : null }, c)))),
          body))));
}
