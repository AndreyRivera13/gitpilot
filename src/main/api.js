'use strict';
/**
 * API única que consumen tanto Electron (IPC) como el puente web de pruebas.
 * Cada método recibe argumentos serializables y devuelve datos serializables.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const exec = require('./exec');
const { createGit } = require('./git');
const { createGitflow } = require('./gitflow');
const { createProfiles } = require('./profiles');

function createApi({ store, emit = () => {}, dialogs = {} }) {
  let profiles; // se asigna tras crear git (dependencia circular controlada)
  const git = createGit({
    getAuthEnv: (repo) => (profiles ? profiles.authEnv(repo) : {}),
    getSettings: () => store.getSettings(),
  });
  profiles = createProfiles({ store, git });
  const flow = createGitflow(git);

  exec.settings.gitPath = store.getSettings().gitPath || 'git';
  exec.onLog((e) => emit('log', e));

  /* ------------------------------ watchers ----------------------------- */
  const watchers = new Map();
  function watch(repo) {
    if (watchers.has(repo)) return;
    let timer = null;
    const fire = () => { clearTimeout(timer); timer = setTimeout(() => emit('repo-changed', { path: repo }), 450); };
    try {
      const w = fs.watch(repo, { recursive: true }, (evt, name) => {
        if (!name) return fire();
        const n = String(name).split(path.sep).join('/');
        if (n.startsWith('.git/objects') || n.startsWith('.git/logs') || n.includes('node_modules/') || n.endsWith('.lock')) return;
        if (n.startsWith('.git/') && !/^\.git\/(HEAD|index|refs|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|REBASE_HEAD|rebase-merge|rebase-apply|ORIG_HEAD|packed-refs)/.test(n)) return;
        fire();
      });
      w.on('error', () => {});
      watchers.set(repo, { w, stop: () => { clearTimeout(timer); w.close(); } });
    } catch (_) { /* plataforma sin recursive */ }
  }
  function unwatch(repo) {
    const x = watchers.get(repo);
    if (x) { x.stop(); watchers.delete(repo); }
  }

  const need = async (repo) => {
    if (!repo || !(await git.isRepo(repo))) throw new Error('La carpeta no es un repositorio Git.');
  };

  /* ------------------------------- métodos ----------------------------- */
  const api = {
    /* app */
    async 'app.state'() {
      let gitVersion = '';
      try { gitVersion = (await exec.run(['--version'], { silent: true })).stdout.trim(); } catch (e) { gitVersion = 'ERROR: ' + e.message; }
      return {
        profiles: store.listProfiles(),
        repos: store.listRepos(),
        tabs: store.data.tabs,
        activeRepo: store.data.activeRepo,
        settings: store.getSettings(),
        globalIdentity: await profiles.getGlobalIdentity(),
        gitVersion,
        platform: process.platform,
        home: os.homedir(),
      };
    },
    async 'app.setSettings'(patch) {
      const s = store.setSettings(patch);
      exec.settings.gitPath = s.gitPath || 'git';
      return s;
    },
    async 'app.setSession'(s) { store.setSession(s); return true; },
    async 'app.opLog'() { return exec.getHistory(); },
    async 'app.clearOpLog'() { exec.clearHistory(); return true; },
    async 'app.pickFolder'(opts) { return dialogs.pickFolder ? dialogs.pickFolder(opts) : null; },
    async 'app.pickFile'(opts) { return dialogs.pickFile ? dialogs.pickFile(opts) : null; },
    async 'app.openExternal'(url) { return dialogs.openExternal ? dialogs.openExternal(url) : null; },
    async 'app.showInFinder'(p) { return dialogs.showInFinder ? dialogs.showInFinder(p) : null; },
    async 'app.homeDir'() { return os.homedir(); },

    /* repos */
    async 'repo.open'(dir) {
      dir = dir.replace(/^~/, os.homedir());
      if (!(await git.isRepo(dir))) throw new Error('Esa carpeta no es un repositorio Git. Usa "Inicializar" si quieres crear uno.');
      const top = await git.toplevel(dir);
      const r = store.addRepo(top);
      watch(top);
      return r;
    },
    async 'repo.init'(dir, opts) {
      dir = dir.replace(/^~/, os.homedir());
      const top = await git.init(dir, opts);
      store.addRepo(top);
      watch(top);
      return store.getRepo(top);
    },
    async 'repo.clone'({ url, dest, profileId, branch, depth, recurse, opId }) {
      dest = dest.replace(/^~/, os.homedir());
      if (fs.existsSync(dest) && fs.readdirSync(dest).length) throw new Error('La carpeta destino ya existe y no está vacía.');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // credenciales del perfil elegido (aún no hay repo asignado)
      let env = {};
      if (profileId) {
        const tmp = store.getRepo(dest);
        store.setRepoProfile(dest, profileId);
        env = await profiles.authEnv(dest);
        if (!tmp) store.removeRepo(dest);
      }
      await git.clone(url, dest, { branch, depth, recurse, env, onProgress: (l) => emit('progress', { opId, line: l }) });
      store.addRepo(dest);
      if (profileId) await profiles.assignToRepo(dest, profileId);
      watch(dest);
      return store.getRepo(dest);
    },
    async 'repo.remove'(p) { unwatch(p); store.removeRepo(p); return true; },
    async 'repo.setProfile'(repo, profileId) { await need(repo); await profiles.assignToRepo(repo, profileId); return store.getRepo(repo); },
    async 'repo.unwatch'(p) { unwatch(p); return true; },
    async 'repo.watch'(p) { watch(p); return true; },
    async 'repo.identity'(repo) { await need(repo); return git.identity(repo); },
    async 'repo.testAuth'(repo) { await need(repo); return profiles.testRepo(repo); },

    /* perfiles */
    async 'profile.list'() { return store.listProfiles(); },
    async 'profile.save'(p) { return store.saveProfile(p); },
    async 'profile.delete'(id) { store.deleteProfile(id); return true; },
    async 'profile.setGlobal'(id) { return profiles.setGlobalIdentity(id); },
    async 'profile.sshKeys'() { return profiles.listSshKeys(); },
    async 'profile.publicKey'(k) { return profiles.readPublicKey(k); },
    async 'profile.generateKey'(o) { return profiles.generateSshKey(o); },
    async 'profile.testSsh'(o) { return profiles.testSsh(o); },
  };

  /* Métodos de git: primer argumento = ruta del repo. Se registran con el prefijo "git." */
  const gitMethods = [
    'status', 'log', 'searchCommits', 'commitDetail', 'commitFiles', 'getDiff', 'stage', 'stageAll',
    'unstage', 'unstageAll', 'discard', 'discardAll', 'applyHunk', 'commit', 'lastCommitMessage',
    'refs', 'createBranch', 'checkout', 'checkoutDetached', 'renameBranch', 'deleteBranch',
    'deleteRemoteBranch', 'setUpstream', 'merge', 'rebase', 'cherryPick', 'revert', 'reset',
    'opContinue', 'opAbort', 'opSkip', 'remotes', 'addRemote', 'removeRemote', 'renameRemote',
    'setRemoteUrl', 'fetch', 'pull', 'push', 'currentBranch', 'createTag', 'deleteTag', 'pushTag',
    'deleteRemoteTag', 'stashPush', 'stashApply', 'stashPop', 'stashDrop', 'stashBranch',
    'submodules', 'submoduleUpdate', 'submoduleAdd', 'conflictFile', 'resolveWith', 'markResolved',
    'fileHistory', 'blame', 'fileAt', 'listFiles', 'getConfig', 'setConfig', 'identity', 'rawCommand',
    'readWorkFile', 'writeWorkFile',
  ];
  for (const m of gitMethods) {
    api['git.' + m] = async (repo, ...args) => {
      const r = await git[m](repo, ...args);
      return r === undefined ? true : (r && r.stdout !== undefined && r.code !== undefined && m !== 'rawCommand' ? true : r);
    };
  }
  /* Gitflow */
  for (const m of ['status', 'init', 'start', 'finish', 'publish']) {
    api['flow.' + m] = async (repo, ...args) => flow[m](repo, ...args);
  }

  return { api, git, flow, profiles, watch, unwatch, shutdown() { for (const k of [...watchers.keys()]) unwatch(k); } };
}

module.exports = { createApi };
