// アプリの状態管理。実体は GitHub のプライベートリポジトリ、IndexedDB はオフライン用キャッシュ。
import { GitHubRepo, blobToB64 } from './github.js';
import { idb } from './idb.js';
import { processImage } from './image.js';
import { uid } from './util.js';

const CFG_KEY = 'bukken.config.v1';
const DATA_PATH = 'properties.json';

const EMPTY = { schemaVersion: 1, updatedAt: null, properties: [] };

class Store extends EventTarget {
  // 既定の接続先。トークンだけは端末ごとに入力が必要
  config = { owner: 'mmmhg835', repo: 'bukken-data', branch: 'main', token: '' };
  data = structuredClone(EMPTY);
  sha = null;
  dirty = false;
  syncState = 'idle';   // idle | syncing | ok | error | unconfigured
  lastError = '';
  #urls = new Map();    // path -> objectURL（画像表示用）

  emit() { this.dispatchEvent(new Event('change')); }

  get repo() { return new GitHubRepo(this.config); }
  get configured() { return this.repo.configured; }

  // ===== 起動 =====
  async init() {
    try {
      const saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      Object.assign(this.config, saved);
    } catch { /* 破損時は既定値のまま */ }

    const cached = await idb.get('kv', 'data');
    if (cached) { this.data = cached.data; this.sha = cached.sha; this.dirty = !!cached.dirty; }

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

  async #cache() {
    await idb.set('kv', 'data', { data: this.data, sha: this.sha, dirty: this.dirty });
  }

  // ===== 同期 =====
  /** リモートを取得。ローカルに未保存変更があれば上書きせず警告する */
  async sync() {
    if (!this.configured) { this.syncState = 'unconfigured'; this.emit(); return; }
    this.syncState = 'syncing'; this.emit();
    try {
      const got = await this.repo.getJson(DATA_PATH);
      if (!got) {
        // データファイルがまだ無い場合は空で作成
        const res = await this.repo.putJson(DATA_PATH, this.data, 'init: properties.json を作成');
        this.sha = res.sha;
      } else if (this.dirty && got.sha !== this.sha) {
        this.syncState = 'error';
        this.lastError = 'リモートが別の端末で更新されています。「保存」で上書きするか、リロードして取り込んでください。';
        this.emit();
        return;
      } else if (!this.dirty) {
        this.data = got.data; this.sha = got.sha;
      }
      this.syncState = 'ok'; this.lastError = '';
      await this.#cache();
    } catch (e) {
      this.syncState = 'error'; this.lastError = e.message;
    }
    this.emit();
  }

  markDirty() { this.dirty = true; this.emit(); this.#cache(); }

  /** properties.json をコミット */
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
        // 別端末の更新と衝突。最新 sha を取り直して再試行できる状態にする
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

  // ===== 物件 =====
  get properties() { return this.data.properties; }
  find(id) { return this.data.properties.find((p) => p.id === id); }

  addProperty(partial = {}) {
    const p = {
      id: uid('p'), no: this.data.properties.length + 1,
      name: '新規物件', status: '検討中', rating: 0,
      price: null, area: null, layout: '', floor: null, totalFloors: null,
      builtYM: '', stations: '', walk: '', balcony: null,
      kanrihi: null, shuzen: null, loanPrincipal: null, loanInterest: null, monthlyTotal: null,
      reform: '', viewNote: '', roomNote: '', imageRange: '', memo: '',
      images: [], ...partial,
    };
    this.data.properties.push(p);
    this.markDirty();
    return p;
  }

  updateProperty(id, patch) {
    const p = this.find(id);
    if (!p) return;
    Object.assign(p, patch);
    this.markDirty();
  }

  async deleteProperty(id) {
    const i = this.data.properties.findIndex((p) => p.id === id);
    if (i < 0) return;
    this.data.properties.splice(i, 1);
    await this.save(`delete: 物件を削除 (${id})`);
  }

  // ===== 画像 =====
  /** 端末で縮小 → images/<物件ID>/ にコミット → properties.json に登録 */
  async addImages(propId, files, category = '概要', onProgress = () => {}) {
    const p = this.find(propId);
    if (!p) throw new Error('物件が見つかりません');
    if (!this.configured) throw new Error('GitHub 接続が未設定です（設定タブ）');

    const list = [...files].filter((f) => f.type.startsWith('image/'));
    let done = 0;
    for (const file of list) {
      onProgress(++done, list.length, file.name);
      const { blob, thumb, width, height } = await processImage(file);
      const safe = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\-一-龠ぁ-んァ-ヶ]/g, '_').slice(0, 40);
      const path = `images/${propId}/${Date.now().toString(36)}_${safe || 'photo'}.jpg`;

      await this.repo.put(path, await blobToB64(blob), `add: ${p.name} の画像を追加`);
      await idb.set('img', path, blob);                       // すぐ表示できるようキャッシュ

      p.images.push({
        path, category, caption: '', width, height,
        name: file.name, addedAt: new Date().toISOString(),
      });
      if (!p.coverThumb) { p.coverThumb = thumb; p.cover = path; }
    }
    await this.save(`add: ${p.name} に画像 ${list.length} 枚を追加`);
    return list.length;
  }

  async deleteImage(propId, path) {
    const p = this.find(propId);
    const sha = await this.repo.shaOf(path);
    if (sha) await this.repo.remove(path, sha, `delete: 画像を削除 (${path})`);
    p.images = p.images.filter((im) => im.path !== path);
    await idb.del('img', path);
    this.#urls.delete(path);
    if (p.cover === path) { p.cover = p.images[0]?.path || null; p.coverThumb = null; }
    await this.save('delete: 画像を削除');
  }

  async setCover(propId, path) {
    const p = this.find(propId);
    p.cover = path;
    const blob = await this.#blob(path);
    p.coverThumb = await blobToThumb(blob);
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

  /** 画像の表示用 URL。キャッシュ済みなら通信しない */
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

async function blobToThumb(blob) {
  const { thumb } = await processImage(new File([blob], 'c.jpg', { type: 'image/jpeg' }));
  return thumb;
}

export const store = new Store();
