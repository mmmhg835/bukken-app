// アプリの状態管理。実体は GitHub のプライベートリポジトリ、IndexedDB はオフライン用キャッシュ。
import { GitHubRepo, blobToB64, utf8ToB64 } from './github.js';
import { idb } from './idb.js';
import { processImage, coverDataUrl, DEFAULT_PRESET, QUALITY_PRESETS } from './image.js';
import { migrate, CURRENT_SCHEMA } from './migrate.js';
import { DEFAULT_TERMS } from './loan.js';
import { uid } from './util.js';

const CFG_KEY = 'bukken.config.v1';
const PREF_KEY = 'bukken.prefs.v1';
const DATA_PATH = 'properties.json';

const EMPTY = {
  schemaVersion: CURRENT_SCHEMA, updatedAt: null,
  settings: { loan: { ...DEFAULT_TERMS }, places: [] }, buildings: [], rooms: [],
};

class Store extends EventTarget {
  config = { owner: 'mmmhg835', repo: 'bukken-data', branch: 'main', token: '' };
  prefs = { imageQuality: DEFAULT_PRESET };
  data = structuredClone(EMPTY);
  sha = null;
  dirty = false;
  syncState = 'idle';   // idle | syncing | ok | error | unconfigured
  lastError = '';
  #urls = new Map();

  emit() { this.dispatchEvent(new Event('change')); }

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
        const got = await this.repo.getJson(DATA_PATH).catch(() => null);
        if (got) this.sha = got.sha;
        this.lastError = '他の端末の変更と衝突しました。もう一度「保存」を押すと上書きします。';
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
  get buildings() { return this.data.buildings; }
  building(id) { return this.data.buildings.find((b) => b.id === id); }

  addBuilding(partial = {}) {
    const b = {
      id: uid('b'), name: '新規の建物', address: '', lat: null, lng: null,
      builtYM: '', totalFloors: null, stations: '', walk: '',
      amenities: '', memo: '', images: [], ...partial,
    };
    this.data.buildings.push(b);
    this.markDirty();
    return b;
  }

  /** 建物を消すと、その配下の部屋も一緒に消える */
  async deleteBuilding(id) {
    this.data.buildings = this.data.buildings.filter((b) => b.id !== id);
    this.data.rooms = this.data.rooms.filter((r) => r.buildingId !== id);
    await this.save(`delete: 建物と配下の部屋を削除 (${id})`);
  }

  // ===== 部屋 =====
  get rooms() { return this.data.rooms; }
  room(id) { return this.data.rooms.find((r) => r.id === id); }
  roomsOf(buildingId) { return this.data.rooms.filter((r) => r.buildingId === buildingId); }

  addRoom(buildingId, partial = {}) {
    const r = {
      id: uid('r'), buildingId, label: '新規の部屋', status: '検討中', rating: 0,
      listingStatus: '募集中', listedAt: null, closedAt: null, priceHistory: [],
      price: null, area: null, layout: '', floor: null, balcony: null,
      kanrihi: null, shuzen: null,
      refMonthly: null, refLoanPrincipal: null, refLoanInterest: null, loan: null,
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

  async clearImageCache() {
    for (const u of this.#urls.values()) URL.revokeObjectURL(u);
    this.#urls.clear();
    await idb.clear('img');
  }
}

export const store = new Store();
