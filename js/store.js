// アプリの状態管理。実体は GitHub のプライベートリポジトリ、IndexedDB はオフライン用キャッシュ。
import { GitHubRepo, blobToB64, utf8ToB64 } from './github.js';
import { idb } from './idb.js';
import { processImage, coverDataUrl, DEFAULT_PRESET, QUALITY_PRESETS } from './image.js';
import { migrate, CURRENT_SCHEMA } from './migrate.js';
import { DEFAULT_TERMS } from './loan.js';
import { defaultLifeplan } from './lifeplan.js';
import { buildingDefaults, SPEC_GROUPS } from './spec.js';
import { uid } from './util.js';

const CFG_KEY = 'bukken.config.v1';
const PREF_KEY = 'bukken.prefs.v1';
const DATA_PATH = 'properties.json';
// 相場は建物ごとの別ファイルにする。1棟で数千行になり、まとめると
// GitHub Contents API が中身を返す上限（1MB）を超えて読めなくなる。
const marketPath = (buildingId) => `market/${buildingId}.json`;
const emptyMarket = () => ({ sale: [], rent: [], new: [] });
// 相場だけ見る「参考建物」は properties.json に入れない。
// 1棟2KBあり、駅ひとつで数百棟入るので、まとめると読み込みの上限（1MB）に当たる。
const REFS_INDEX = 'refs/index.json';
// 販売中の行だけを取り出したファイル。一覧・比較・ライフプランはここだけを読む。
// 相場は436ファイル13MBあり、全部読むのは無理なので取り出し済みの形を用意してある。
const ONSALE = 'onsale.json';
const DEALS = 'deals.json';

/**
 * 初期データ。項目を直接並べず migrate() に通して作る。
 * スキーマに項目を足したとき、ここへの追記漏れで新規データだけ壊れるのを防ぐ。
 */
const emptyData = () => migrate({ schemaVersion: 1, properties: [] });

class Store extends EventTarget {
  config = { owner: 'mmmhg835', repo: 'bukken-data', branch: 'main', token: '' };
  prefs = { imageQuality: DEFAULT_PRESET };
  data = emptyData();
  sha = null;
  dirty = false;
  syncState = 'idle';   // idle | syncing | ok | error | unconfigured
  lastError = '';
  #urls = new Map();
  // 相場は建物ごとに遅延読み込みする。読んだものだけここに載る
  #market = new Map();
  #marketLoading = new Set();
  marketDirty = new Set();
  // 参考建物。相場タブを開いたときにまとめて読む
  #refs = new Map();
  #refsState = 'idle';   // idle | loading | ready
  // 販売中の物件。行と、その建物の最小限の情報
  #onsale = null;
  #onsaleState = 'idle';
  #deals = null;
  #dealsState = 'idle';

  emit() { this.dispatchEvent(new Event('change')); }

  /**
   * 背景で読んだデータ（参考建物・売り出し・成約・相場）が届いた合図。
   * 最初の描画のあとに届くので、これを受けて描き直さないと、
   * 画面は「まだ読めていなかったとき」の中身のままになる
   * （建物名の候補に自分の建物しか出ない、など）。
   */
  emitLoaded() { this.dispatchEvent(new Event('loaded')); this.emit(); }

  get repo() { return new GitHubRepo(this.config); }
  get configured() { return this.repo.configured; }

  // ===== 起動 =====
  async init() {
    try { Object.assign(this.config, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); }
    catch { /* 破損時は既定値のまま */ }
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      if (QUALITY_PRESETS[p.imageQuality]) this.prefs.imageQuality = p.imageQuality;
    } catch { /* 既定値のまま */ }

    const cached = await idb.get('kv', 'data');
    if (cached) {
      this.data = migrate(cached.data);
      this.sha = cached.sha;
      this.dirty = !!cached.dirty;
    }

    this.syncState = this.configured ? 'idle' : 'unconfigured';
    this.emit();
    if (this.configured) await this.sync();
  }

  saveConfig(cfg) {
    Object.assign(this.config, cfg);
    localStorage.setItem(CFG_KEY, JSON.stringify(this.config));
    this.syncState = this.configured ? 'idle' : 'unconfigured';
    this.emit();
  }

  savePrefs(patch) {
    Object.assign(this.prefs, patch);
    localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
    this.emit();
  }

  async #cache() {
    await idb.set('kv', 'data', { data: this.data, sha: this.sha, dirty: this.dirty });
  }

  // ===== 同期 =====
  async sync() {
    if (!this.configured) { this.syncState = 'unconfigured'; this.emit(); return; }
    this.syncState = 'syncing'; this.emit();
    try {
      const got = await this.repo.getJson(DATA_PATH);
      if (!got) {
        const res = await this.repo.putJson(DATA_PATH, this.data, 'init: properties.json を作成');
        this.sha = res.sha;
      } else if (this.dirty && got.sha !== this.sha) {
        this.syncState = 'error';
        this.lastError = 'リモートが別の端末で更新されています。「保存」で上書きするか、リロードして取り込んでください。';
        this.emit();
        return;
      } else if (!this.dirty) {
        const wasVersion = got.data.schemaVersion || 1;
        this.data = migrate(got.data);
        this.sha = got.sha;
        // 旧スキーマを読み込んだ場合は、その場で新形式に書き戻す
        if (wasVersion < CURRENT_SCHEMA) {
          await this.save(`refactor: 建物と部屋を分離（スキーマ v${wasVersion} → v${CURRENT_SCHEMA}）`);
        }
      }
      this.syncState = 'ok'; this.lastError = '';
      await this.#cache();
    } catch (e) {
      this.syncState = 'error'; this.lastError = e.message;
    }
    this.emit();
  }

  markDirty() { this.dirty = true; this.emit(); this.#cache(); }

  /** 衝突したときに控えたリモートの内容。無ければ null */
  async conflictBackup() { return idb.get('kv', 'conflict').catch(() => null); }

  async save(message = 'update: 物件データを更新') {
    if (!this.configured) throw new Error('GitHub 接続が未設定です（設定タブ）');
    this.syncState = 'syncing'; this.emit();
    try {
      this.data.updatedAt = new Date().toISOString();
      const res = await this.repo.putJson(DATA_PATH, this.data, message, this.sha ?? undefined);
      this.sha = res.sha;
      this.dirty = false;
      this.syncState = 'ok'; this.lastError = '';
      await this.#cache();
    } catch (e) {
      if (e.status === 409 || e.status === 422) {
        // ぶつかった相手（リモートの中身）を控えに取ってから上書きできるようにする。
        // 取り込みの最中にアプリから保存すると、数万行の相場が消えることがあったため。
        const got = await this.repo.getJson(DATA_PATH).catch(() => null);
        if (got) {
          this.sha = got.sha;
          await idb.set('kv', 'conflict', {
            at: new Date().toISOString(), sha: got.sha, data: got.data,
          }).catch(() => {});
        }
        const mine = this.data?.rooms?.length ?? 0;
        const theirs = got?.data?.rooms?.length ?? '?';
        this.lastError = `他の端末の変更とぶつかりました（手元 ${mine}室 / リモート ${theirs}室）。`
          + 'リモートの内容は控えに取りました（設定タブから書き出せます）。'
          + 'もう一度「保存」を押すと手元の内容で上書きします。';
      } else {
        this.lastError = e.message;
      }
      this.syncState = 'error';
      this.emit();
      throw new Error(this.lastError);
    }
    this.emit();
  }

  // ===== 建物 =====
  // buildings は検討している建物（部屋があるか、手で作ったもの）。
  // 相場だけ見る参考建物は refs 側にあり、相場タブでだけ混ぜる。
  get buildings() { return this.data.buildings; }
  get refs() { return [...this.#refs.values()]; }
  get allBuildings() { return [...this.data.buildings, ...this.#refs.values()]; }
  get refsReady() { return this.#refsState === 'ready'; }

  // ===== 販売中の物件 =====
  get onsaleReady() { return this.#onsaleState === 'ready'; }
  get onsaleRows() { return this.#onsale?.rows ?? []; }

  /**
   * その建物の直近の坪単価（万円/坪）と、その元になった件数。
   * 取り込みのときに建物ごとに出してある（直近24か月の中央値）。
   * 登録済みの建物にも参考の建物にも同じように効かせたいので、ここで引く。
   */
  /**
   * @param {string} buildingId
   * @param {number} [area] 専有面積。渡すと、その広さに近い部屋だけの相場を返す
   */
  tsuboMed(buildingId, area = null) {
    const b = this.#onsale?.buildings?.[buildingId];
    if (!b) return null;
    // 同じ建物でも広い部屋ほど坪単価は下がるので、近い広さで比べる
    if (area != null && b.tsuboBands) {
      const key = String(Math.floor(area / 10) * 10);
      const hit = b.tsuboBands[key];
      if (hit) return { med: hit[0], n: hit[1], band: `${key}〜${Number(key) + 10}㎡` };
    }
    return b.tsuboMed ? { med: b.tsuboMed, n: b.tsuboN || 0, band: null } : null;
  }

  /**
   * その建物の新築時の坪単価（万円/坪）と件数。
   * いまの値段が新築時の何倍になっているかを見るために持っている。
   */
  newTsuboMed(buildingId) {
    const b = this.#onsale?.buildings?.[buildingId];
    return b?.newTsuboMed ? { med: b.newTsuboMed, n: b.newN || 0 } : null;
  }

  /** onsale.json を読む。一覧を開いたときに呼ぶ */
  ensureOnsale() {
    if (this.#onsaleState !== 'idle') return;
    this.#onsaleState = 'loading';
    (async () => {
      let v = await idb.get('kv', 'onsale').catch(() => null);
      if (this.configured) {
        try {
          const got = await this.repo.getJson(ONSALE);
          v = got ? got.data : { buildings: {}, rows: [] };
          await idb.set('kv', 'onsale', v);
        } catch { /* 取れなければキャッシュのまま */ }
      }
      this.#onsale = v || { buildings: {}, rows: [] };
      this.#onsaleState = 'ready';
      this.emitLoaded();
    })();
  }

  /** 読み込み済みとして差し込む。smoke から使う */
  setOnsale(v) {
    this.#onsale = { buildings: {}, rows: [], ...v };
    this.#onsaleState = 'ready';
    this.emit();
  }

  // ===== 成約事例 =====
  // 仲介からもらった REINS の成約。売り出し価格とは別物なので、混ぜずに持つ。
  // 実際にいくらで決まったかは、指値を決めるときのいちばん強い手がかりになる。
  get dealsReady() { return this.#dealsState === 'ready'; }
  get dealRows() { return this.#deals?.rows ?? []; }
  get dealsSource() { return this.#deals?.source ?? ''; }
  get dealsImportedAt() { return this.#deals?.importedAt ?? ''; }

  /**
   * その建物の成約。新しい順。
   * kind を渡すと売買（sale）か賃貸（rent）だけにする。
   * 古い行には kind が無いので、その場合は売買として扱う。
   */
  dealsOf(buildingId, kind = 'sale') {
    return this.dealRows.filter((x) => x.buildingId === buildingId
      && (kind == null || (x.kind || 'sale') === kind));
  }

  /** 売買・賃貸それぞれ何件持っているか */
  get dealCounts() {
    const c = { sale: 0, rent: 0 };
    for (const x of this.dealRows) c[x.kind === 'rent' ? 'rent' : 'sale']++;
    return c;
  }

  /** deals.json を読む。相場と指値を開いたときに呼ぶ */
  ensureDeals() {
    if (this.#dealsState !== 'idle') return;
    this.#dealsState = 'loading';
    (async () => {
      let v = await idb.get('kv', 'deals').catch(() => null);
      if (this.configured) {
        try {
          const got = await this.repo.getJson(DEALS);
          v = got ? got.data : { rows: [] };
          await idb.set('kv', 'deals', v);
        } catch { /* 取れなければ手元の控えのまま */ }
      }
      this.#deals = v || { rows: [] };
      this.#dealsState = 'ready';
      this.emitLoaded();
    })();
  }

  /** 読み込み済みとして差し込む。smoke から使う */
  setDeals(v) {
    this.#deals = { rows: [], ...v };
    this.#dealsState = 'ready';
    this.emit();
  }

  /**
   * 建物を引く。properties.json → 参考建物 → onsale に埋めた最小限、の順に探す。
   * onsale だけ読んだ状態でも一覧が描けるようにするため。
   */
  building(id) {
    return this.data.buildings.find((b) => b.id === id)
      || this.#refs.get(id)
      || (this.#onsale?.buildings?.[id] ? { id, ...this.#onsale.buildings[id] } : null);
  }

  /** 読み込み済みとして参考建物を差し込む。取り込みと smoke から使う */
  setRefs(list) {
    // すでに自分の建物になっているものは、空いている項目だけ埋める。
    // 参考側で上書きすると、自分で直した値（駐車場代など）が消える
    const own = new Map(this.data.buildings.map((b) => [b.id, b]));
    for (const b of list) {
      const mine = own.get(b.id);
      if (mine) {
        for (const [k, v] of Object.entries(b)) {
          if (k !== 'id' && (mine[k] === null || mine[k] === undefined || mine[k] === '')) mine[k] = v;
        }
        continue;
      }
      this.#refs.set(b.id, b);
    }
    this.#refsState = 'ready';
    this.emit();
  }

  /** 参考建物をまとめて読む。相場タブを開いたときだけ呼ぶ */
  ensureRefs() {
    if (this.#refsState !== 'idle') return;
    this.#refsState = 'loading';
    (async () => {
      const read = async (path, key) => {
        let v = await idb.get('kv', key).catch(() => null);
        if (this.configured) {
          try {
            const got = await this.repo.getJson(path);
            v = got ? got.data : null;
            await idb.set('kv', key, v);
          } catch { /* 取れなければキャッシュのまま */ }
        }
        return v;
      };
      const take = (list) => { for (const b of list ?? []) this.#refs.set(b.id, b); };
      const idx = await read(REFS_INDEX, 'refs:index');
      const files = idx?.files ?? [];
      // 25本を一度に投げると GitHub 側に止められることがある。相場と同じく少しずつ流し、
      // 読めた分から画面に出す。全部そろうまで何も出ないより、増えていく方がよい
      let i = 0;
      const failed = [];
      const worker = async () => {
        while (i < files.length) {
          const f = files[i++];
          const list = await read(f, `refs:${f}`);
          if (list) take(list);
          else failed.push(f);
          this.emitLoaded();
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      // 取れなかった分は一度だけやり直す。黙って「参考建物が無い」状態で
      // 確定させると、建物名で探しても出てこない画面になる
      for (const f of failed) take(await read(f, `refs:${f}`));
      this.#refsState = 'ready';
      this.emitLoaded();
    })();
  }

  /**
   * 参考建物を検討中へ移す。部屋を足した建物は編集の対象になるので、
   * 読み取り専用の refs から properties.json 側へ持ってくる。
   */
  /**
   * 参考の建物を自分の建物に移す。部屋を足したときに呼ぶ。
   *
   * 参考建物（refs）はタブを開くまで読まないので、一覧から部屋を足すと
   * まだ手元に無いことがある。そのときは onsale に埋めてある最小限の
   * 記録で器だけ作っておく。あとで refs が来たときに setRefs が中身を埋める。
   * ここで作り損ねると、部屋に建物名が付かない状態になる。
   */
  #promote(buildingId) {
    if (this.data.buildings.some((b) => b.id === buildingId)) return;
    const ref = this.#refs.get(buildingId);
    if (ref) {
      this.#refs.delete(buildingId);
      this.data.buildings.push(ref);
      return;
    }
    const min = this.building(buildingId);
    if (min) this.data.buildings.push({ ...buildingDefaults(), ...min });
  }

  addBuilding(partial = {}) {
    const b = {
      id: uid('b'), ...buildingDefaults(),
      name: '新規の建物', lat: null, lng: null,
      cover: null, coverThumb: null, images: [],
      photos: [],            // マンレビの写真のURL。画像そのものは持たない
      ...partial,
    };
    this.data.buildings.push(b);
    this.markDirty();
    return b;
  }

  /** 建物を消すと、その配下の部屋と売り出し履歴も一緒に消える */
  async deleteBuilding(id) {
    this.data.buildings = this.data.buildings.filter((b) => b.id !== id);
    this.data.rooms = this.data.rooms.filter((r) => r.buildingId !== id);
    await this.save(`delete: 建物と配下の部屋を削除 (${id})`);
    // 相場は別ファイルなので個別に消す。消せなくても本体の削除は済んでいる
    const m = this.#market.get(id);
    this.#market.delete(id);
    this.marketDirty.delete(id);
    await idb.del('kv', `market:${id}`).catch(() => {});
    if (m?.sha) await this.repo.remove(marketPath(id), m.sha, `delete: 相場を削除 (${id})`).catch(() => {});
  }

  // ===== 相場（建物ごとの別ファイル） =====
  // 売り出し履歴・賃料履歴・新築分譲価格。件数が桁違いなので properties.json には入れず、
  // 相場タブで選んだ建物の分だけ読む。

  /** 読み込み済みなら中身、まだなら null */
  marketOf(buildingId) { return this.#market.get(buildingId) ?? null; }

  /**
   * 未読なら読みに行く。読めたら change を投げて画面を描き直させる。
   * 画面側は「まだ null」の状態でも描けるようにしておくこと。
   */
  ensureMarket(buildingId) {
    if (!buildingId || this.#market.has(buildingId) || this.#marketLoading.has(buildingId)) return;
    this.#marketLoading.add(buildingId);
    (async () => {
      const key = `market:${buildingId}`;
      let m = await idb.get('kv', key).catch(() => null);   // オフラインでも直前の内容を出す
      if (this.configured) {
        try {
          const got = await this.repo.getJson(marketPath(buildingId));
          m = got ? { ...emptyMarket(), ...got.data, sha: got.sha } : { ...emptyMarket(), sha: null };
          await idb.set('kv', key, m);
        } catch { /* 取れなければキャッシュのまま */ }
      }
      this.#market.set(buildingId, m || { ...emptyMarket(), sha: null });
      this.#marketLoading.delete(buildingId);
      this.emitLoaded();
    })();
  }

  /**
   * 複数の建物の相場をまとめて読む。
   *
   * まず手元の控え（IndexedDB）を全部読んで1回描き直す。開いた瞬間に前回の
   * 中身が出るので、待たされない。そのあと取り直しを少しずつ流す。
   * 何百件も一度に投げると GitHub 側に止められるため、6件ずつにしている。
   */
  ensureMarkets(buildingIds) {
    const todo = buildingIds.filter((id) =>
      id && !this.#market.has(id) && !this.#marketLoading.has(id));
    if (!todo.length) return;
    for (const id of todo) this.#marketLoading.add(id);
    (async () => {
      // 1) 控えから先に出す
      let hit = 0;
      await Promise.all(todo.map(async (id) => {
        const m = await idb.get('kv', `market:${id}`).catch(() => null);
        if (m) { this.#market.set(id, m); hit++; }
      }));
      if (hit) this.emitLoaded();

      // 2) 取り直し。6件ずつ流し、25件ごとに描き直して進み具合を見せる
      if (!this.configured) {
        for (const id of todo) {
          if (!this.#market.has(id)) this.#market.set(id, { ...emptyMarket(), sha: null });
          this.#marketLoading.delete(id);
        }
        this.emit();
        return;
      }
      let i = 0, done = 0;
      const worker = async () => {
        while (i < todo.length) {
          const id = todo[i++];
          try {
            const got = await this.repo.getJson(marketPath(id));
            const m = got ? { ...emptyMarket(), ...got.data, sha: got.sha }
              : { ...emptyMarket(), sha: null };
            this.#market.set(id, m);
            await idb.set('kv', `market:${id}`, m);
          } catch {
            // 取れなければ控えのまま。控えも無ければ空で置く（読み込み中のままにしない）
            if (!this.#market.has(id)) this.#market.set(id, { ...emptyMarket(), sha: null });
          }
          this.#marketLoading.delete(id);
          if (++done % 25 === 0) this.emitLoaded();
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      this.emitLoaded();
    })();
  }

  /** いま読み込み中の建物の数。画面に進み具合を出すため */
  get marketLoadingCount() { return this.#marketLoading.size; }

  /** 読み込み済みとして相場を差し込む。まとめ取り込みと smoke から使う */
  setMarket(buildingId, data = {}) {
    this.#market.set(buildingId, { ...emptyMarket(), ...data, sha: data.sha ?? null });
    this.emit();
  }

  /** 書き換え用。未読の建物には触らせない（空で上書きしてしまうため） */
  #marketFor(buildingId) {
    const m = this.#market.get(buildingId);
    if (!m) throw new Error('相場をまだ読み込んでいません');
    return m;
  }

  #markMarketDirty(buildingId) {
    this.marketDirty.add(buildingId);
    idb.set(`kv`, `market:${buildingId}`, this.#market.get(buildingId));
    this.emit();
  }

  listingsOf(buildingId) { return this.marketOf(buildingId)?.sale ?? []; }
  rentsOf(buildingId) { return this.marketOf(buildingId)?.rent ?? []; }
  newPricesOf(buildingId) { return this.marketOf(buildingId)?.new ?? []; }

  addListing(buildingId, partial = {}) {
    const m = {
      id: uid('m'), buildingId,
      listedYM: null, closedYM: null, open: false,
      // closedYM は販売終了年月。open が true なら販売中、
      // どちらも無い行は「終了年月の記録が無い」（マンレビの「ー」）
      floor: null, layout: '', direction: '', feature: '',
      area: null, balcony: null,
      price: null,                          // 万円。価格変更後の最終価格
      priceHistory: [],                     // [{ ym, price }] 価格変更履歴
      kanrihi: null, shuzen: null,          // 万円/月。部屋と単位をそろえる
      source: 'マンレビ', note: '',
      ...partial,
    };
    this.#marketFor(buildingId).sale.push(m);
    this.#markMarketDirty(buildingId);
    return m;
  }

  // 賃貸まわりの金額は円のまま持つ。掲載も生活実感も円で、万円に直すと写し間違えるため。
  addRent(buildingId, partial = {}) {
    const m = {
      id: uid('t'), buildingId,
      ym: null,                             // 賃貸年月
      floor: null, layout: '', direction: '', area: null,
      rent: null,                           // 円/月
      kanrihi: null,                        // 円/月
      deposit: null, keyMoney: null, guarantee: null,   // 敷金・礼金・保証金（円）
      source: 'マンレビ', note: '',
      ...partial,
    };
    this.#marketFor(buildingId).rent.push(m);
    this.#markMarketDirty(buildingId);
    return m;
  }

  addNewPrice(buildingId, partial = {}) {
    const m = {
      id: uid('n'), buildingId,
      floor: null, direction: '', layout: '',
      area: null, balcony: null,
      price: null,                          // 万円。新築時の分譲価格
      source: 'マンレビ', note: '',
      ...partial,
    };
    this.#marketFor(buildingId).new.push(m);
    this.#markMarketDirty(buildingId);
    return m;
  }

  #removeFrom(buildingId, key, id) {
    const m = this.#marketFor(buildingId);
    m[key] = m[key].filter((x) => x.id !== id);
    this.#markMarketDirty(buildingId);
  }

  deleteListing(buildingId, id) { this.#removeFrom(buildingId, 'sale', id); }
  deleteRent(buildingId, id) { this.#removeFrom(buildingId, 'rent', id); }
  deleteNewPrice(buildingId, id) { this.#removeFrom(buildingId, 'new', id); }

  /** 相場ファイルを書き戻す。字下げなしで置く（機械が書くだけで人は読まない） */
  async saveMarket(buildingId, message = `update: 相場を更新 (${buildingId})`) {
    if (!this.configured) throw new Error('GitHub 接続が未設定です（設定タブ）');
    const m = this.#marketFor(buildingId);
    const { sha, ...body } = m;
    const res = await this.repo.putJson(marketPath(buildingId), body, message, sha ?? undefined, null);
    m.sha = res.sha;
    this.marketDirty.delete(buildingId);
    await idb.set('kv', `market:${buildingId}`, m);
    this.emit();
  }


  // ===== 部屋 =====
  get rooms() { return this.data.rooms; }
  room(id) { return this.data.rooms.find((r) => r.id === id); }
  roomsOf(buildingId) { return this.data.rooms.filter((r) => r.buildingId === buildingId); }

  addRoom(buildingId, partial = {}) {
    this.#promote(buildingId);
    const r = {
      id: uid('r'), buildingId, label: '新規の部屋', status: '検討中', rating: 0,
      listingStatus: '募集中', listedAt: null, closedAt: null, priceHistory: [],
      roomEquipmentTags: [], renovation: 'なし',
      price: null, area: null, layout: '', floor: null, balcony: null,
      kanrihi: null, shuzen: null,
      refMonthly: null, refLoanPrincipal: null, refLoanInterest: null, loan: null,
      offerPrice: null,   // 指値。ライフプランの試算でだけ価格に代えて使う
      salePrice: null,    // 想定売却価格。null なら現在価格を使う
      marketIsoge: null, marketMrev: null,   // 相場の坪単価。出どころごとに持つ
      viewingAt: null, viewingChecks: {}, viewingNote: '',   // 内見
      reform: '', viewNote: '', roomNote: '', imageRange: '', url: '', memo: '',
      cover: null, coverThumb: null, images: [], ...partial,
    };
    this.data.rooms.push(r);
    this.markDirty();
    return r;
  }

  async deleteRoom(id) {
    this.data.rooms = this.data.rooms.filter((r) => r.id !== id);
    await this.save(`delete: 部屋を削除 (${id})`);
  }

  /** 部屋を別の建物へ移す */
  moveRoom(roomId, buildingId) {
    const r = this.room(roomId);
    if (r) { r.buildingId = buildingId; this.markDirty(); }
  }

  // ===== 共通条件 =====
  get loanTerms() { return this.data.settings.loan; }
  saveLoanTerms(patch) {
    Object.assign(this.data.settings.loan, patch);
    this.markDirty();
  }

  // ===== 売却の前提 =====
  get saleTerms() { return this.data.settings.sale; }

  // ===== 家計シミュレーション =====
  get lifeplan() {
    this.data.settings.lifeplan ||= defaultLifeplan();
    return this.data.settings.lifeplan;
  }

  // ===== 参照地点（職場・駅など） =====
  get places() { return this.data.settings.places || []; }

  addPlace(place) {
    this.data.settings.places ||= [];
    this.data.settings.places.push(place);
    this.markDirty();
  }

  removePlace(index) {
    this.data.settings.places.splice(index, 1);
    this.markDirty();
  }

  // ===== 保存した検索条件 =====
  // 「豊洲の3LDK・70㎡以上」のような条件を何度も打ち直さずに済ませる。
  // 端末をまたいで使うので、画面の状態ではなく properties.json に持つ。
  get searches() { return this.data.settings.searches || []; }

  saveSearch(name, filter) {
    this.data.settings.searches ||= [];
    const at = new Date().toISOString();
    const i = this.data.settings.searches.findIndex((x) => x.name === name);
    const entry = { id: i >= 0 ? this.data.settings.searches[i].id : uid('s'), name, filter, at };
    if (i >= 0) this.data.settings.searches[i] = entry;
    else this.data.settings.searches.push(entry);
    this.markDirty();
    return entry;
  }

  removeSearch(id) {
    this.data.settings.searches = this.searches.filter((x) => x.id !== id);
    this.markDirty();
  }

  /** 建物・部屋のどちらでも受け取れる汎用の取得 */
  owner(id) { return this.building(id) || this.room(id); }

  // ===== 画像 =====
  /**
   * 端末で縮小 → 本体とサムネを images/<ID>/ へ、properties.json も含めて1コミットで保存する。
   * 建物（外観・共用部）にも部屋にも同じ仕組みで付けられる。
   */
  async addImages(ownerId, files, category = '概要', onProgress = () => {}) {
    const o = this.owner(ownerId);
    if (!o) throw new Error('対象が見つかりません');
    if (!this.configured) throw new Error('GitHub 接続が未設定です（設定タブ）');

    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) throw new Error('画像ファイルが見つかりませんでした');

    const entries = [];
    const added = [];
    // 失敗したときに元へ戻せるよう、カバー画像の状態を控えておく
    const prevCover = { cover: o.cover, coverThumb: o.coverThumb };
    let done = 0;
    for (const file of list) {
      onProgress(++done, list.length, file.name, '変換中');
      const { full, thumb, cover, width, height } = await processImage(file, this.prefs.imageQuality);
      const stem = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
      const path = `images/${ownerId}/${stem}.jpg`;
      const thumbPath = `images/${ownerId}/${stem}_t.jpg`;

      entries.push({ path, base64: await blobToB64(full) });
      entries.push({ path: thumbPath, base64: await blobToB64(thumb) });
      await idb.set('img', path, full);
      await idb.set('img', thumbPath, thumb);

      const meta = {
        path, thumbPath, category, caption: '', width, height,
        bytes: full.size, name: file.name, addedAt: new Date().toISOString(),
      };
      added.push(meta);
      o.images.push(meta);
      if (!o.cover) { o.cover = path; o.coverThumb = cover; }
    }

    this.data.updatedAt = new Date().toISOString();
    entries.push({ path: DATA_PATH, base64: utf8ToB64(JSON.stringify(this.data, null, 2)) });

    onProgress(list.length, list.length, '', 'アップロード中');
    try {
      await this.repo.commitFiles(entries, `add: ${o.name || o.label} に画像 ${list.length} 枚を追加`);
    } catch (e) {
      o.images = o.images.filter((im) => !added.includes(im));
      Object.assign(o, prevCover);
      throw e;
    }

    const got = await this.repo.getJson(DATA_PATH).catch(() => null);
    if (got) this.sha = got.sha;
    this.dirty = false;
    this.syncState = 'ok';
    await this.#cache();
    this.emit();
    return list.length;
  }

  async deleteImage(ownerId, path) {
    const o = this.owner(ownerId);
    const target = o.images.find((im) => im.path === path);
    for (const f of [path, target?.thumbPath].filter(Boolean)) {
      const sha = await this.repo.shaOf(f);
      if (sha) await this.repo.remove(f, sha, `delete: 画像を削除 (${f})`);
      await idb.del('img', f);
      this.#urls.delete(f);
    }
    o.images = o.images.filter((im) => im.path !== path);
    if (o.cover === path) {
      o.cover = o.images[0]?.path || null;
      o.coverThumb = o.cover ? await coverDataUrl(await this.#blob(o.cover)) : null;
    }
    await this.save('delete: 画像を削除');
  }

  async setCover(ownerId, path) {
    const o = this.owner(ownerId);
    o.cover = path;
    o.coverThumb = await coverDataUrl(await this.#blob(path));
    await this.save('update: カバー画像を変更');
  }

  async #blob(path) {
    let blob = await idb.get('img', path);
    if (!blob) {
      blob = await this.repo.getBlob(path);
      await idb.set('img', path, blob);
    }
    return blob;
  }

  async imageUrl(path) {
    if (this.#urls.has(path)) return this.#urls.get(path);
    const url = URL.createObjectURL(await this.#blob(path));
    this.#urls.set(path, url);
    return url;
  }

  /** 保存済み画像の枚数と概算容量。上限が気になったときに現状を把握するため */
  usage() {
    const owners = [...this.data.buildings, ...this.data.rooms];
    let count = 0, bytes = 0;
    for (const o of owners) {
      for (const im of o.images || []) {
        count += 1;
        // bytes は本体のみ。サムネは概ね本体の7%程度
        bytes += (im.bytes || 0) * 1.07;
      }
    }
    const jsonBytes = new TextEncoder().encode(JSON.stringify(this.data)).length;
    return { count, bytes, jsonBytes };
  }

  async clearImageCache() {
    for (const u of this.#urls.values()) URL.revokeObjectURL(u);
    this.#urls.clear();
    await idb.clear('img');
  }
}

export const store = new Store();
