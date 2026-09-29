'use strict';
/**
 * Persistencia en JSON (userData/gitpilot.json). Los tokens se cifran con
 * safeStorage de Electron (Keychain de macOS) cuando está disponible.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.file = path.join(dir, 'gitpilot.json');
    this.safe = safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable() ? safeStorage : null;
    fs.mkdirSync(dir, { recursive: true });
    this.data = { profiles: [], repos: [], tabs: [], activeRepo: null, settings: { gitPath: 'git', theme: 'dark', pullMode: 'merge', diffContext: 3, ignoreWhitespace: false } };
    this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...raw, settings: { ...this.data.settings, ...(raw.settings || {}) } };
    } catch (_) { /* primera ejecución */ }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /* --- secretos --- */
  encrypt(plain) {
    if (!plain) return '';
    if (this.safe) return 'enc:' + this.safe.encryptString(plain).toString('base64');
    // Sin Keychain (modo web/pruebas): solo ofuscado, NO seguro.
    return 'b64:' + Buffer.from(plain, 'utf8').toString('base64');
  }

  decrypt(stored) {
    if (!stored) return '';
    if (stored.startsWith('enc:')) {
      if (!this.safe) return '';
      return this.safe.decryptString(Buffer.from(stored.slice(4), 'base64'));
    }
    if (stored.startsWith('b64:')) return Buffer.from(stored.slice(4), 'base64').toString('utf8');
    return '';
  }

  /* --- perfiles --- */
  listProfiles() {
    // Nunca se envía el token al renderer; solo si existe
    return this.data.profiles.map((p) => ({ ...p, token: undefined, hasToken: !!p.token }));
  }

  getProfile(id) { return this.data.profiles.find((p) => p.id === id) || null; }

  saveProfile(input) {
    const now = Date.now();
    let p = input.id ? this.getProfile(input.id) : null;
    if (!p) {
      p = { id: crypto.randomUUID(), createdAt: now, token: '' };
      this.data.profiles.push(p);
    }
    p.label = (input.label || '').trim() || 'Sin nombre';
    p.name = (input.name || '').trim();
    p.email = (input.email || '').trim();
    p.sshKey = (input.sshKey || '').trim();
    p.tokenUser = (input.tokenUser || '').trim();
    p.host = (input.host || '').trim();
    p.color = input.color || p.color || '#6c8cff';
    if (input.clearToken) p.token = '';
    else if (typeof input.token === 'string' && input.token) p.token = this.encrypt(input.token);
    this.save();
    return this.listProfiles().find((x) => x.id === p.id);
  }

  deleteProfile(id) {
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id);
    for (const r of this.data.repos) if (r.profileId === id) r.profileId = null;
    this.save();
  }

  /* --- repos --- */
  listRepos() { return this.data.repos; }
  getRepo(p) { return this.data.repos.find((r) => r.path === p) || null; }

  addRepo(p, name) {
    let r = this.getRepo(p);
    if (!r) {
      r = { path: p, name: name || path.basename(p), profileId: null, addedAt: Date.now() };
      this.data.repos.push(r);
    }
    this.save();
    return r;
  }

  removeRepo(p) {
    this.data.repos = this.data.repos.filter((r) => r.path !== p);
    this.data.tabs = this.data.tabs.filter((t) => t !== p);
    if (this.data.activeRepo === p) this.data.activeRepo = this.data.tabs[0] || null;
    this.save();
  }

  setRepoProfile(p, profileId) {
    const r = this.addRepo(p);
    r.profileId = profileId || null;
    this.save();
  }

  setSession({ tabs, activeRepo }) {
    if (tabs) this.data.tabs = tabs;
    if (activeRepo !== undefined) this.data.activeRepo = activeRepo;
    this.save();
  }

  getSettings() { return this.data.settings; }
  setSettings(patch) { Object.assign(this.data.settings, patch); this.save(); return this.data.settings; }
}

module.exports = { Store };
