'use strict';
/**
 * Perfiles de cuenta: identidad (nombre/correo) + credenciales (SSH y/o token).
 * Se asignan por repositorio y solo escriben en la config LOCAL del repo.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, GitError } = require('./exec');

function sshCommandFor(key) {
  return `ssh -i "${key}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
}

const isOurs = (v) => /^ssh -i ".*" -o IdentitiesOnly=yes/.test(v || '');

function createProfiles({ store, git }) {
  // git NO soporta espacios en la ruta de GIT_ASKPASS: se elige el primer directorio sin espacios
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
  const askpassDirs = [path.join(os.homedir(), '.gitpilot'), path.join(os.tmpdir(), `gitpilot-${uid}`), `/tmp/gitpilot-${uid}`];
  const askpassPath = path.join(askpassDirs.find((d) => !/\s/.test(d)) || askpassDirs[2], 'askpass.sh');

  function ensureAskpass() {
    const script = '#!/bin/sh\ncase "$1" in\n  *sername*) printf %s "$GITPILOT_USER" ;;\n  *) printf %s "$GITPILOT_TOKEN" ;;\nesac\n';
    try {
      fs.mkdirSync(path.dirname(askpassPath), { recursive: true, mode: 0o700 });
      if (!fs.existsSync(askpassPath) || fs.readFileSync(askpassPath, 'utf8') !== script) {
        fs.writeFileSync(askpassPath, script, { mode: 0o700 });
      }
      fs.chmodSync(askpassPath, 0o700);
    } catch (e) { /* ignore */ }
    return askpassPath;
  }

  /** Variables de entorno de autenticación para los comandos de red de un repo */
  async function authEnv(repo) {
    const r = store.getRepo(repo);
    const p = r && r.profileId ? store.getProfile(r.profileId) : null;
    if (!p) return {};
    const env = {};
    if (p.sshKey) env.GIT_SSH_COMMAND = sshCommandFor(expandHome(p.sshKey));
    if (p.token) {
      const token = store.decrypt(p.token);
      if (token) {
        env.GIT_ASKPASS = ensureAskpass();
        env.GITPILOT_USER = p.tokenUser || 'git';
        env.GITPILOT_TOKEN = token;
        env.SSH_ASKPASS = '';
        // Anula credential.helper (Keychain) para que el token del perfil tenga prioridad
        env.GIT_CONFIG_COUNT = '1';
        env.GIT_CONFIG_KEY_0 = 'credential.helper';
        env.GIT_CONFIG_VALUE_0 = '';
      }
    }
    return env;
  }

  function expandHome(p) { return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p; }

  /** Escribe identidad y sshCommand del perfil en la config local del repo */
  async function assignToRepo(repo, profileId) {
    store.setRepoProfile(repo, profileId);
    if (!profileId) {
      const cur = await git.getConfig(repo, 'core.sshCommand', 'local');
      if (isOurs(cur)) await git.setConfig(repo, 'core.sshCommand', '');
      return;
    }
    const p = store.getProfile(profileId);
    if (!p) throw new GitError('Perfil inexistente.');
    if (p.name) await git.setConfig(repo, 'user.name', p.name);
    if (p.email) await git.setConfig(repo, 'user.email', p.email);
    const cur = await git.getConfig(repo, 'core.sshCommand', 'local');
    if (p.sshKey) await git.setConfig(repo, 'core.sshCommand', sshCommandFor(expandHome(p.sshKey)));
    else if (isOurs(cur)) await git.setConfig(repo, 'core.sshCommand', '');
  }

  /** Cambia la identidad GLOBAL de git (acción explícita del usuario) */
  async function setGlobalIdentity(profileId) {
    const p = store.getProfile(profileId);
    if (!p) throw new GitError('Perfil inexistente.');
    if (!p.name || !p.email) throw new GitError('El perfil necesita nombre y correo.');
    const opts = { cwd: os.homedir() };
    await run(['config', '--global', 'user.name', p.name], opts);
    await run(['config', '--global', 'user.email', p.email], opts);
    return getGlobalIdentity();
  }

  async function getGlobalIdentity() {
    const opts = { cwd: os.homedir(), allowFail: true, silent: true };
    const n = await run(['config', '--global', '--get', 'user.name'], opts);
    const e = await run(['config', '--global', '--get', 'user.email'], opts);
    return { name: n.stdout.trim(), email: e.stdout.trim() };
  }

  function listSshKeys() {
    const dir = path.join(os.homedir(), '.ssh');
    let files = [];
    try { files = fs.readdirSync(dir); } catch (_) { return []; }
    const keys = [];
    for (const f of files) {
      if (f.endsWith('.pub') || ['known_hosts', 'known_hosts.old', 'config', 'authorized_keys', 'environment'].includes(f)) continue;
      const full = path.join(dir, f);
      try {
        if (!fs.statSync(full).isFile()) continue;
        const head = fs.readFileSync(full, 'utf8').slice(0, 60);
        if (!head.includes('PRIVATE KEY')) continue;
        keys.push({ path: full, name: f, hasPub: fs.existsSync(full + '.pub') });
      } catch (_) { /* ignore */ }
    }
    return keys;
  }

  function readPublicKey(keyPath) {
    const p = expandHome(keyPath) + '.pub';
    if (!fs.existsSync(p)) throw new GitError('No existe la llave pública (.pub) de esa llave.');
    return fs.readFileSync(p, 'utf8').trim();
  }

  async function generateSshKey({ label, email }) {
    const slug = (label || 'cuenta').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cuenta';
    const dir = path.join(os.homedir(), '.ssh');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `id_ed25519_${slug}`);
    if (fs.existsSync(file)) throw new GitError(`Ya existe ${file}. Elige otra etiqueta o selecciona esa llave existente.`);
    await run(['-t', 'ed25519', '-C', email || label || 'gitpilot', '-f', file, '-N', ''], { bin: 'ssh-keygen' });
    return { path: file, publicKey: fs.readFileSync(file + '.pub', 'utf8').trim() };
  }

  async function testSsh({ sshKey, host }) {
    const h = (host || 'github.com').trim();
    const args = ['-T', '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10'];
    if (sshKey) args.unshift('-i', expandHome(sshKey));
    args.push(`git@${h}`);
    const r = await run(args, { bin: 'ssh', allowFail: true, timeout: 20000 });
    const text = (r.stderr + r.stdout).trim();
    const ok = /successfully authenticated|Welcome to GitLab|Hi [^!]+!|authenticated/i.test(text);
    return { ok, output: text };
  }

  async function testRepo(repo) {
    const r = await git.g(repo, ['ls-remote', '--heads', '--quiet', ...(await defaultRemoteArgs(repo))], { net: true, allowFail: true, timeout: 30000 });
    return { ok: r.code === 0, output: (r.code === 0 ? `Conexión correcta (${r.stdout.split('\n').filter(Boolean).length} ramas remotas)` : (r.stderr || r.stdout)).trim() };
  }

  async function defaultRemoteArgs(repo) {
    const rs = await git.remotes(repo);
    if (!rs.length) throw new GitError('El repositorio no tiene remotos.');
    return [(rs.find((r) => r.name === 'origin') || rs[0]).name];
  }

  return { authEnv, assignToRepo, setGlobalIdentity, getGlobalIdentity, listSshKeys, readPublicKey, generateSshKey, testSsh, testRepo };
}

module.exports = { createProfiles, sshCommandFor };
