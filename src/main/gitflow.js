'use strict';
/**
 * Gitflow nativo (compatible con las claves de config de git-flow-avh).
 * No requiere tener instalado `git flow`.
 */
const { GitError } = require('./exec');

const DEFAULTS = {
  main: 'main',
  develop: 'develop',
  feature: 'feature/',
  release: 'release/',
  hotfix: 'hotfix/',
  support: 'support/',
  versiontag: '',
};
const TYPES = ['feature', 'release', 'hotfix'];

function createGitflow(git) {
  async function readConfig(repo) {
    const c = {};
    c.main = await git.getConfig(repo, 'gitflow.branch.master');
    c.develop = await git.getConfig(repo, 'gitflow.branch.develop');
    for (const k of ['feature', 'release', 'hotfix', 'support', 'versiontag']) {
      c[k] = await git.getConfig(repo, `gitflow.prefix.${k}`);
    }
    return c;
  }

  async function branchExists(repo, name) {
    const r = await git.g(repo, ['show-ref', '--verify', '-q', `refs/heads/${name}`], { allowFail: true, silent: true });
    return r.code === 0;
  }

  async function status(repo) {
    const cfg = await readConfig(repo);
    const refs = await git.refs(repo);
    const names = refs.branches.map((b) => b.name);
    const initialized = !!(cfg.main && cfg.develop && names.includes(cfg.main) && names.includes(cfg.develop));
    const eff = {
      main: cfg.main || (names.includes('main') ? 'main' : names.includes('master') ? 'master' : DEFAULTS.main),
      develop: cfg.develop || DEFAULTS.develop,
      feature: cfg.feature || DEFAULTS.feature,
      release: cfg.release || DEFAULTS.release,
      hotfix: cfg.hotfix || DEFAULTS.hotfix,
      support: cfg.support || DEFAULTS.support,
      versiontag: cfg.versiontag || '',
    };
    const branches = {};
    for (const t of TYPES) {
      branches[t] = names.filter((n) => n.startsWith(eff[t])).map((n) => ({ name: n, short: n.slice(eff[t].length) }));
    }
    const cur = refs.branches.find((b) => b.current);
    let current = null;
    if (cur) {
      for (const t of TYPES) if (cur.name.startsWith(eff[t])) current = { type: t, name: cur.name.slice(eff[t].length), branch: cur.name };
    }
    return { initialized, config: eff, branches, current, hasCommits: refs.hasCommits };
  }

  async function init(repo, opts = {}) {
    if (!(await git.hasCommits(repo))) {
      throw new GitError('Gitflow necesita al menos un commit en el repositorio. Haz el primer commit y vuelve a intentarlo.');
    }
    const cfg = { ...DEFAULTS, ...opts };
    if (!(await branchExists(repo, cfg.main))) throw new GitError(`No existe la rama principal "${cfg.main}".`);
    if (!(await branchExists(repo, cfg.develop))) await git.createBranch(repo, cfg.develop, { from: cfg.main, checkout: false });
    await git.setConfig(repo, 'gitflow.branch.master', cfg.main);
    await git.setConfig(repo, 'gitflow.branch.develop', cfg.develop);
    for (const k of ['feature', 'release', 'hotfix', 'support']) await git.setConfig(repo, `gitflow.prefix.${k}`, cfg[k]);
    await git.g(repo, ['config', '--local', 'gitflow.prefix.versiontag', cfg.versiontag || '']);
    if (opts.checkoutDevelop !== false) await git.checkout(repo, cfg.develop);
    return status(repo);
  }

  async function assertInit(repo) {
    const st = await status(repo);
    if (!st.initialized) throw new GitError('Gitflow no está inicializado en este repositorio.');
    return st;
  }

  async function validName(repo, full) {
    const r = await git.g(repo, ['check-ref-format', '--branch', full], { allowFail: true, silent: true });
    if (r.code !== 0) throw new GitError(`Nombre de rama inválido: ${full}`);
  }

  async function start(repo, type, name, { base } = {}) {
    if (!TYPES.includes(type)) throw new GitError('Tipo de flujo inválido.');
    const st = await assertInit(repo);
    const cfg = st.config;
    const full = cfg[type] + name;
    await validName(repo, full);
    if (await branchExists(repo, full)) throw new GitError(`La rama ${full} ya existe.`);
    const from = base || (type === 'hotfix' ? cfg.main : cfg.develop);
    await git.createBranch(repo, full, { from });
    return { branch: full };
  }

  /**
   * Finaliza feature/release/hotfix. Es idempotente: si un merge dio conflicto,
   * resuélvelo, haz commit y vuelve a ejecutar; salta lo ya hecho.
   */
  async function finish(repo, type, name, opts = {}) {
    const { keep = false, squash = false, tag = true, tagMessage, push = false, deleteRemote = false } = opts;
    const st = await assertInit(repo);
    const cfg = st.config;
    const branch = cfg[type] + name;
    if (!(await branchExists(repo, branch))) throw new GitError(`La rama ${branch} no existe.`);
    if (await git.repoState(repo)) throw new GitError('Hay una operación en curso (merge/rebase…). Resuélvela o abórtala antes de finalizar.');
    const dirty = await git.status(repo);
    if (dirty.staged.length || dirty.unstaged.some((f) => !f.untracked)) {
      throw new GitError('Tienes cambios sin confirmar. Haz commit o stash antes de finalizar.');
    }
    const steps = [];
    const mergeInto = async (target, source = branch) => {
      await git.checkout(repo, target);
      if (await git.isAncestor(repo, source, target)) { steps.push(`${source} ya está integrada en ${target}`); return true; }
      const r = await git.merge(repo, source, squash && type === 'feature' ? { squash: true } : { noFf: true, message: `Merge ${source === branch ? 'branch' : 'tag'} '${source}' into ${target}` });
      if (!r.ok) {
        return { conflict: true, target, conflicts: r.conflicts };
      }
      if (squash && type === 'feature') {
        await git.commit(repo, { message: `Merge feature ${name} (squash)` });
      }
      steps.push(`Merge de ${source} en ${target}`);
      return true;
    };
    const conflictResult = (c) => ({ ok: false, conflict: true, target: c.target, conflicts: c.conflicts, steps,
      message: `Conflictos al integrar en ${c.target}. Resuélvelos, confirma la fusión y ejecuta "Finalizar" de nuevo.` });

    if (type === 'feature') {
      const r = await mergeInto(cfg.develop);
      if (r !== true) return conflictResult(r);
    } else {
      const r1 = await mergeInto(cfg.main);
      if (r1 !== true) return conflictResult(r1);
      let tagName = null;
      if (tag) {
        tagName = (cfg.versiontag || '') + name;
        const exists = (await git.g(repo, ['show-ref', '--verify', '-q', `refs/tags/${tagName}`], { allowFail: true, silent: true })).code === 0;
        if (!exists) {
          await git.checkout(repo, cfg.main);
          await git.createTag(repo, tagName, { message: tagMessage || `${type === 'release' ? 'Release' : 'Hotfix'} ${name}` });
          steps.push(`Tag ${tagName}`);
        } else steps.push(`El tag ${tagName} ya existía`);
      }
      // Como git-flow: develop recibe el tag (que incluye el merge en main)
      const r2 = await mergeInto(cfg.develop, tagName || cfg.main);
      if (r2 !== true) return conflictResult(r2);
    }
    if (!keep) {
      await git.deleteBranch(repo, branch, { force: true });
      steps.push(`Rama ${branch} eliminada`);
    }
    const remotes = await git.remotes(repo);
    if (push && remotes.length) {
      const rem = remotes.find((r) => r.name === 'origin') ? 'origin' : remotes[0].name;
      if (type !== 'feature') await git.push(repo, { remote: rem, branch: cfg.main });
      await git.push(repo, { remote: rem, branch: cfg.develop });
      if (tag && type !== 'feature') await git.push(repo, { remote: rem, tags: true });
      if (deleteRemote) await git.deleteRemoteBranch(repo, rem, branch).catch(() => {});
      steps.push(`Push a ${rem}`);
    }
    return { ok: true, steps };
  }

  async function publish(repo, type, name) {
    const st = await assertInit(repo);
    const branch = st.config[type] + name;
    const remotes = await git.remotes(repo);
    if (!remotes.length) throw new GitError('El repositorio no tiene remotos.');
    const rem = remotes.find((r) => r.name === 'origin') ? 'origin' : remotes[0].name;
    return git.push(repo, { remote: rem, branch, setUpstream: true });
  }

  return { status, init, start, finish, publish, DEFAULTS };
}

module.exports = { createGitflow, DEFAULTS, TYPES };
