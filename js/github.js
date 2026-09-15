// GitHub Contents API クライアント。データ用プライベートリポジトリを直接読み書きする。
const API = 'https://api.github.com';

export class GitHubRepo {
  constructor({ owner, repo, branch = 'main', token }) {
    Object.assign(this, { owner, repo, branch, token });
  }

  get configured() { return !!(this.owner && this.repo && this.token); }
  #base(path) { return `${API}/repos/${this.owner}/${this.repo}/contents/${path}`; }
  #headers(accept = 'application/vnd.github+json') {
    return {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async #req(url, opts = {}) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch { /* ignore */ }
      const err = new Error(`GitHub ${res.status}: ${detail || res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  /** 接続確認。成功すればリポジトリ名を返す */
  async check() {
    const res = await this.#req(`${API}/repos/${this.owner}/${this.repo}`, { headers: this.#headers() });
    const j = await res.json();
    return { fullName: j.full_name, private: j.private, defaultBranch: j.default_branch };
  }

  /** JSON ファイルを取得。存在しなければ null */
  async getJson(path) {
    try {
      const res = await this.#req(
        `${this.#base(path)}?ref=${encodeURIComponent(this.branch)}`,
        { headers: this.#headers(), cache: 'no-store' }
      );
      const j = await res.json();
      return { data: JSON.parse(b64ToUtf8(j.content)), sha: j.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** バイナリを Blob として取得（プライベートリポでも認証付きで読める） */
  async getBlob(path) {
    const res = await this.#req(
      `${this.#base(path)}?ref=${encodeURIComponent(this.branch)}`,
      { headers: this.#headers('application/vnd.github.raw') }
    );
    return res.blob();
  }

  /** base64 文字列をコミット。sha を渡すと更新、省略すると新規作成 */
  async put(path, base64, message, sha) {
    const res = await this.#req(this.#base(path), {
      method: 'PUT',
      headers: { ...this.#headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: base64, branch: this.branch, ...(sha ? { sha } : {}) }),
    });
    const j = await res.json();
    return { sha: j.content?.sha, commit: j.commit?.sha };
  }

  async putJson(path, obj, message, sha) {
    return this.put(path, utf8ToB64(JSON.stringify(obj, null, 2)), message, sha);
  }

  async remove(path, sha, message) {
    await this.#req(this.#base(path), {
      method: 'DELETE',
      headers: { ...this.#headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha, branch: this.branch }),
    });
  }

  /** 削除にはファイルの sha が必要なので単体取得する */
  async shaOf(path) {
    try {
      const res = await this.#req(
        `${this.#base(path)}?ref=${encodeURIComponent(this.branch)}`,
        { headers: this.#headers('application/vnd.github.object') }
      );
      return (await res.json()).sha;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }
}

// ===== base64 ヘルパ（UTF-8 安全） =====
export function utf8ToB64(str) {
  return bytesToB64(new TextEncoder().encode(str));
}
export function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
export function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000; // スタック溢れ防止のため分割して変換
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
export async function blobToB64(blob) {
  return bytesToB64(new Uint8Array(await blob.arrayBuffer()));
}
