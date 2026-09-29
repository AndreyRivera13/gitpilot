'use strict';
/**
 * Servicio Git: todas las operaciones sobre un repositorio.
 * Cada función recibe la ruta del repo como primer argumento.
 */
const fs = require('fs');
const path = require('path');
const { run, GitError } = require('./exec');
const P = require('./parsers');

function createGit({ getAuthEnv = async () => ({}), getSettings = () => ({}) } = {}) {
  /** Ejecuta git en un repo. opts.net = true añade credenciales del perfil. */
  async function g(repo, args, opts = {}) {
    let env = opts.env || {};
    if (opts.net) env = { ...(await getAuthEnv(repo)), ...env };
    return run(args, { ...opts, cwd: repo, env });
  }
  const out = async (repo, args, opts) => (await g(repo, args, opts)).stdout;
  const line = async (repo, args, opts) => (await out(repo, args, opts)).trim();

  /* ============================ REPO / ESTADO ============================ */

  async function isRepo(dir) {
    try {
      const r = await run(['rev-parse', '--is-inside-work-tree'], { cwd: dir, allowFail: true, silent: true });
      return r.code === 0 && r.stdout.trim() === 'true';
    } catch (_) { return false; }
  }

  async function toplevel(dir) {
    return line(dir, ['rev-parse', '--show-toplevel']);
  }

  async function gitDir(repo) {
    return line(repo, ['rev-parse', '--absolute-git-dir']);
  }

  async function hasCommits(repo) {
    const r = await g(repo, ['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true, silent: true });
    return r.code === 0;
  }

  async function repoState(repo) {
    const gd = await gitDir(repo);
    const ex = (f) => fs.existsSync(path.join(gd, f));
    if (ex('rebase-merge') || ex('rebase-apply')) return 'rebase';
    if (ex('MERGE_HEAD')) return 'merge';
    if (ex('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (ex('REVERT_HEAD')) return 'revert';
    if (ex('BISECT_LOG')) return 'bisect';
    return null;
  }

  async function init(dir, { initialBranch } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const args = ['init'];
    if (initialBranch) args.push('-b', initialBranch);
    await run(args, { cwd: dir });
    return toplevel(dir);
  }

  async function clone(url, dest, { branch, depth, recurse, env, onProgress } = {}) {
    const args = ['clone', '--progress'];
    if (branch) args.push('-b', branch);
    if (depth) args.push('--depth', String(depth));
    if (recurse) args.push('--recurse-submodules');
    args.push(url, dest);
    await run(args, { cwd: path.dirname(dest), env, onStderr: onProgress, timeout: 0 });
    return dest;
  }

  async function status(repo) {
    const [text, state] = await Promise.all([
      out(repo, ['status', '--porcelain=v2', '-b', '-z', '--untracked-files=all']),
      repoState(repo),
    ]);
    const s = P.parseStatus(text);
    s.state = state;
    s.autostash = fs.existsSync(path.join(await gitDir(repo), 'MERGE_AUTOSTASH'));
    return s;
  }

  /* ================================ LOG ================================= */

  async function log(repo, { limit = 800, skip = 0, all = true, branch, author, search, file } = {}) {
    if (!(await hasCommits(repo))) return [];
    const args = ['log', '--date-order', '--decorate=full', `--format=${P.RS}${P.LOG_FORMAT}`, `-n`, String(limit)];
    if (skip) args.push('--skip', String(skip));
    if (branch) args.push(branch);
    else if (all) args.push('--all');
    else args.push('HEAD');
    if (author) args.push(`--author=${author}`, '-i');
    if (search) args.push(`--grep=${search}`, '-i');
    if (file) args.push('--follow', '--', file);
    return P.parseLog(await out(repo, args));
  }

  /** Búsqueda global: mensaje, autor o hash (sin grafo) */
  async function searchCommits(repo, query) {
    if (!query || !(await hasCommits(repo))) return [];
    const base = ['log', '--all', '--date-order', '--decorate=full', `--format=${P.RS}${P.LOG_FORMAT}`, '-n', '300', '-i'];
    const runs = [
      out(repo, [...base, `--grep=${query}`]),
      out(repo, [...base, `--author=${query}`]),
    ];
    if (/^[0-9a-f]{4,40}$/i.test(query)) {
      runs.push(out(repo, ['log', '-n', '1', '--decorate=full', `--format=${P.RS}${P.LOG_FORMAT}`, query], { allowFail: true }));
    }
    const seen = new Set();
    const res = [];
    for (const txt of await Promise.all(runs)) {
      for (const c of P.parseLog(txt)) if (!seen.has(c.sha)) { seen.add(c.sha); res.push(c); }
    }
    return res.sort((a, b) => b.time - a.time);
  }

  async function commitDetail(repo, sha) {
    const fmt = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%D', '%B'].join('%x1f');
    const meta = await out(repo, ['show', '--no-patch', '--decorate=full', `--format=${fmt}`, sha]);
    const f = meta.replace(/\n$/, '').split(P.FS);
    const parents = f[1] ? f[1].split(' ') : [];
    const files = await commitFiles(repo, sha);
    return {
      sha: f[0], parents, author: f[2], email: f[3], date: f[4],
      committer: f[5], committerEmail: f[6], committerDate: f[7],
      refs: P.parseDecorations(f[8]), message: (f.slice(9).join(P.FS) || '').trim(), files,
    };
  }

  async function commitFiles(repo, sha, against) {
    const range = against ? [against, sha] : null;
    const base = range
      ? ['diff', '-M', ...range]
      : ['show', '--format=', '-M', '-m', '--first-parent', '--root', sha];
    const ns = await out(repo, [...base, '--name-status', '-z']);
    const nu = await out(repo, [...base, '--numstat', '-z']);
    return P.parseCommitFiles(ns, nu);
  }

  /* ================================ DIFF ================================ */

  const diffOpts = (o = {}) => {
    const a = ['--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', `-U${o.context ?? getSettings().diffContext ?? 3}`];
    if (o.ignoreWhitespace ?? getSettings().ignoreWhitespace) a.push('-w');
    return a;
  };

  /**
   * getDiff({ file, staged, untracked, sha, from, to, context, ignoreWhitespace })
   * Devuelve [{ path, status, binary, hunks, ...}] ya parseado.
   */
  async function getDiff(repo, o = {}) {
    let args;
    if (o.sha) {
      args = ['show', '--format=', '-M', '-m', '--first-parent', '--root', ...diffOpts(o), o.sha];
    } else if (o.from && o.to) {
      args = ['diff', '-M', ...diffOpts(o), o.from, o.to];
    } else if (o.untracked) {
      const r = await g(repo, ['diff', '--no-index', ...diffOpts(o), '--', '/dev/null', o.file], { allowFail: true });
      return fixNoIndex(P.parseDiff(r.stdout), o.file);
    } else if (o.stash != null) {
      args = ['diff', '-M', ...diffOpts(o), `stash@{${o.stash}}^1`, `stash@{${o.stash}}`];
    } else {
      args = ['diff', '-M', ...diffOpts(o)];
      if (o.staged) args.push('--cached');
    }
    if (o.file) args.push('--', o.file);
    const text = await out(repo, args);
    return P.parseDiff(text);
  }

  function fixNoIndex(files, file) {
    for (const f of files) { f.status = 'A'; f.path = file; f.newPath = file; f.oldPath = null; }
    return files;
  }

  /* ============================== STAGING =============================== */

  async function stage(repo, files) {
    if (!files || !files.length) return;
    await g(repo, ['add', '-A', '--', ...files]);
  }

  async function stageAll(repo) { await g(repo, ['add', '-A']); }

  async function unstage(repo, files) {
    if (!files || !files.length) return;
    if (await hasCommits(repo)) await g(repo, ['reset', '-q', 'HEAD', '--', ...files]);
    else await g(repo, ['rm', '--cached', '-r', '-q', '--', ...files]);
  }

  async function unstageAll(repo) {
    if (await hasCommits(repo)) await g(repo, ['reset', '-q']);
    else await g(repo, ['rm', '--cached', '-r', '-q', '.'], { allowFail: true });
  }

  /** files: [{path, untracked}] */
  async function discard(repo, files) {
    const tracked = files.filter((f) => !f.untracked).map((f) => f.path);
    const untracked = files.filter((f) => f.untracked).map((f) => f.path);
    if (tracked.length) await g(repo, ['checkout', '--', ...tracked]);
    if (untracked.length) await g(repo, ['clean', '-f', '-d', '--', ...untracked]);
  }

  async function discardAll(repo) {
    await g(repo, ['checkout', '--', '.'], { allowFail: true });
    await g(repo, ['clean', '-f', '-d']);
  }

  /**
   * Stage / unstage / discard de un hunk o de líneas concretas.
   * { file, staged, hunk, lines?: number[], mode }
   */
  async function applyHunk(repo, { file, hunk, lines, mode, context }) {
    const staged = mode === 'unstage';
    const files = await getDiff(repo, { file, staged, context: 3 });
    const f = files.find((x) => x.path === file) || files[0];
    if (!f) throw new GitError('No hay cambios para ese archivo.');
    const sel = lines && lines.length ? new Set(lines) : null;
    const patch = P.buildPatch(f, hunk, sel, mode);
    const args = ['apply', '--recount', '--whitespace=nowarn'];
    if (mode === 'stage') args.push('--cached');
    else if (mode === 'unstage') args.push('--cached', '-R');
    else args.push('-R'); // discard
    await g(repo, args, { input: patch });
  }

  /* ============================== COMMIT ================================ */

  async function commit(repo, { message, body, amend, noVerify, signoff, allowEmpty } = {}) {
    const args = ['commit'];
    if (amend) args.push('--amend');
    if (noVerify) args.push('--no-verify');
    if (signoff) args.push('-s');
    if (allowEmpty) args.push('--allow-empty');
    let input;
    if (message && message.trim()) {
      input = message.trim() + (body && body.trim() ? '\n\n' + body.trim() : '') + '\n';
      args.push('-F', '-');
    } else if (amend) args.push('--no-edit');
    else throw new GitError('El mensaje del commit no puede estar vacío.');
    await g(repo, args, { input });
    return line(repo, ['rev-parse', 'HEAD']);
  }

  async function lastCommitMessage(repo) {
    if (!(await hasCommits(repo))) return '';
    return (await out(repo, ['log', '-1', '--format=%B'])).trim();
  }

  /* ============================== RAMAS ================================= */

  async function refs(repo) {
    const [rtxt, stxt, head] = await Promise.all([
      out(repo, ['for-each-ref', `--format=${P.REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags']),
      out(repo, ['stash', 'list', '--format=%gd%x1f%H%x1f%gs%x1f%at']),
      hasCommits(repo),
    ]);
    const r = P.parseRefs(rtxt);
    r.stashes = P.parseStashes(stxt);
    r.remotesList = await remotes(repo);
    r.hasCommits = head;
    return r;
  }

  async function createBranch(repo, name, { from, checkout = true } = {}) {
    if (checkout) await g(repo, ['checkout', '-b', name, ...(from ? [from] : [])]);
    else await g(repo, ['branch', name, ...(from ? [from] : [])]);
  }

  async function checkout(repo, target, { remote, autostash } = {}) {
    if (autostash) {
      // guarda lo local, cambia de rama y lo restaura; si al restaurar hay conflictos, el stash se conserva
      const before = (await out(repo, ['stash', 'list'])).split('\n').filter(Boolean).length;
      await g(repo, ['stash', 'push', '-u', '-m', 'GitPilot: auto-stash antes de cambiar de rama']);
      const after = (await out(repo, ['stash', 'list'])).split('\n').filter(Boolean).length;
      const stashed = after > before;
      try { await checkout(repo, target, { remote }); }
      catch (e) {
        if (stashed) await g(repo, ['stash', 'pop'], { allowFail: true });
        throw e;
      }
      if (stashed) {
        const r = await g(repo, ['stash', 'pop'], { allowFail: true });
        if (r.code !== 0) return { ok: true, autostashConflict: true, message: 'Tus cambios siguen guardados en el stash (no se pudieron aplicar sin conflictos).' };
      }
      return { ok: true };
    }
    if (remote) {
      // origin/feature -> crea local 'feature' con seguimiento
      const local = target.slice(target.indexOf('/') + 1);
      const exists = (await g(repo, ['show-ref', '--verify', '-q', `refs/heads/${local}`], { allowFail: true, silent: true })).code === 0;
      if (exists) await g(repo, ['checkout', local], { allowFail: true }).then((r) => checkoutFail(r));
      else await g(repo, ['checkout', '-b', local, '--track', target], { allowFail: true }).then((r) => checkoutFail(r));
      return { ok: true };
    }
    checkoutFail(await g(repo, ['checkout', target], { allowFail: true }));
    return { ok: true };
  }

  function checkoutFail(r) {
    if (r.code === 0) return;
    const text = (r.stderr || r.stdout || '').trim();
    if (isDirtyErr(text)) { const e = new GitError(text || 'Cambios locales en conflicto.', { code: r.code }); e.dirty = true; throw e; }
    throw new GitError(text || 'La operación falló.', { code: r.code });
  }

  async function checkoutDetached(repo, sha) { await g(repo, ['checkout', '--detach', sha]); }

  async function renameBranch(repo, oldName, newName) { await g(repo, ['branch', '-m', oldName, newName]); }

  async function deleteBranch(repo, name, { force } = {}) { await g(repo, ['branch', force ? '-D' : '-d', name]); }

  async function deleteRemoteBranch(repo, remote, name) {
    await g(repo, ['push', remote, '--delete', name], { net: true });
  }

  async function setUpstream(repo, branch, upstream) {
    if (upstream) await g(repo, ['branch', `--set-upstream-to=${upstream}`, branch]);
    else await g(repo, ['branch', '--unset-upstream', branch]);
  }

  async function merge(repo, branch, { noFf, ffOnly, squash, message, autostash } = {}) {
    const args = ['merge'];
    if (autostash) args.push('--autostash');
    if (noFf) args.push('--no-ff');
    if (ffOnly) args.push('--ff-only');
    if (squash) args.push('--squash');
    if (message) args.push('-m', message);
    args.push(branch);
    const r = await g(repo, args, { allowFail: true });
    return mergeResult(repo, r);
  }

  // Errores de git que significan "tus cambios locales estorban": no se ha tocado nada.
  const DIRTY_RE = /(local changes to the following files would be overwritten|Please commit your changes or stash them|cannot (pull|rebase|merge|checkout).*(unstaged|uncommitted)|You have unstaged changes|Your index contains uncommitted changes|would be overwritten by (merge|checkout))/i;
  const isDirtyErr = (t) => !/untracked working tree/i.test(t) && DIRTY_RE.test(t);
  const AUTOSTASH_CONFLICT_RE = /(Applying autostash resulted in conflicts|safe in the stash|Your changes are safe|Cannot apply the autostash|stash entry is kept)/i;

  async function mergeResult(repo, r) {
    const st = await status(repo);
    const conflicts = st.conflicts;
    const text = `${r.stderr || ''}\n${r.stdout || ''}`;
    if (r.code !== 0) {
      if (conflicts.length) return { ok: false, conflicts: conflicts.length, stashed: st.autostash, message: 'Hay conflictos que resolver.' };
      if (isDirtyErr(text)) {
        return { ok: false, dirty: true, message: (r.stderr || r.stdout).trim() };
      }
      throw new GitError((r.stderr || r.stdout).trim() || 'La operación falló.', { code: r.code });
    }
    const res = { ok: true, message: (r.stdout || '').trim() };
    if (AUTOSTASH_CONFLICT_RE.test(text)) res.autostashConflict = true;
    return res;
  }

  async function rebase(repo, onto, { autostash } = {}) {
    const r = await g(repo, ['rebase', ...(autostash ? ['--autostash'] : []), onto], { allowFail: true });
    return mergeResult(repo, r);
  }

  async function cherryPick(repo, shas, { noCommit } = {}) {
    const args = ['cherry-pick'];
    if (noCommit) args.push('-n');
    args.push(...shas);
    const r = await g(repo, args, { allowFail: true });
    return mergeResult(repo, r);
  }

  async function revert(repo, sha, { mainline, noCommit } = {}) {
    const args = ['revert', '--no-edit'];
    if (mainline) args.push('-m', String(mainline));
    if (noCommit) args.push('-n');
    args.push(sha);
    const r = await g(repo, args, { allowFail: true });
    return mergeResult(repo, r);
  }

  async function reset(repo, target, mode = 'mixed') {
    await g(repo, ['reset', `--${mode}`, target]);
  }

  /** Continuar / abortar operación en curso */
  async function opContinue(repo) {
    const st = await repoState(repo);
    const cmd = { merge: ['commit', '--no-edit'], rebase: ['rebase', '--continue'], 'cherry-pick': ['cherry-pick', '--continue'], revert: ['revert', '--continue'] }[st];
    if (!cmd) throw new GitError('No hay ninguna operación en curso.');
    const r = await g(repo, cmd, { allowFail: true });
    return mergeResult(repo, r);
  }

  async function opAbort(repo) {
    const st = await repoState(repo);
    const cmd = { merge: ['merge', '--abort'], rebase: ['rebase', '--abort'], 'cherry-pick': ['cherry-pick', '--abort'], revert: ['revert', '--abort'] }[st];
    if (!cmd) throw new GitError('No hay ninguna operación en curso.');
    await g(repo, cmd);
  }

  async function opSkip(repo) {
    const st = await repoState(repo);
    const cmd = { rebase: ['rebase', '--skip'], 'cherry-pick': ['cherry-pick', '--skip'] }[st];
    if (!cmd) throw new GitError('Solo se puede omitir en rebase o cherry-pick.');
    const r = await g(repo, cmd, { allowFail: true });
    return mergeResult(repo, r);
  }

  async function isAncestor(repo, a, b) {
    const r = await g(repo, ['merge-base', '--is-ancestor', a, b], { allowFail: true, silent: true });
    return r.code === 0;
  }

  /* ============================ REMOTOS / SYNC ========================== */

  async function remotes(repo) {
    const txt = await out(repo, ['remote', '-v']);
    const map = {};
    for (const l of txt.split('\n').filter(Boolean)) {
      const m = l.match(/^(\S+)\t(\S+) \((fetch|push)\)$/);
      if (!m) continue;
      map[m[1]] = map[m[1]] || { name: m[1], fetchUrl: '', pushUrl: '' };
      map[m[1]][m[3] === 'fetch' ? 'fetchUrl' : 'pushUrl'] = m[2];
    }
    return Object.values(map);
  }

  const addRemote = (repo, name, url) => g(repo, ['remote', 'add', name, url]);
  const removeRemote = (repo, name) => g(repo, ['remote', 'remove', name]);
  const renameRemote = (repo, a, b) => g(repo, ['remote', 'rename', a, b]);
  const setRemoteUrl = (repo, name, url) => g(repo, ['remote', 'set-url', name, url]);

  async function fetch(repo, { remote, prune = true, tags = true } = {}) {
    const args = ['fetch'];
    if (remote) args.push(remote); else args.push('--all');
    if (prune) args.push('--prune');
    if (tags) args.push('--tags', '--force');
    await g(repo, args, { net: true, timeout: 0 });
  }

  async function pull(repo, { remote, branch, mode = 'merge', autostash } = {}) {
    const args = ['pull'];
    if (mode === 'rebase') args.push('--rebase');
    else if (mode === 'ff-only') args.push('--ff-only');
    else args.push('--no-rebase');
    if (autostash) args.push('--autostash');
    if (remote) args.push(remote);
    if (branch) args.push(branch);
    const r = await g(repo, args, { net: true, allowFail: true, timeout: 0 });
    return mergeResult(repo, r);
  }

  async function push(repo, { remote, branch, remoteBranch, setUpstream: su, force, tags, followTags } = {}) {
    const args = ['push'];
    if (su) args.push('-u');
    if (force === 'lease') args.push('--force-with-lease');
    else if (force) args.push('--force');
    if (tags) args.push('--tags');
    if (followTags) args.push('--follow-tags');
    const rem = remote || 'origin';
    args.push(rem);
    if (branch) args.push(remoteBranch ? `${branch}:${remoteBranch}` : branch);
    else if (!tags) args.push('HEAD');
    const r = await g(repo, args, { net: true, timeout: 0 });
    return (r.stderr || r.stdout).trim();
  }

  /** ¿La rama actual tiene upstream? Útil para decidir push -u */
  async function currentBranch(repo) {
    const r = await g(repo, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true, silent: true });
    return r.code === 0 ? r.stdout.trim() : null;
  }

  /* ================================ TAGS ================================ */

  async function createTag(repo, name, { sha, message, force } = {}) {
    const args = ['tag'];
    if (force) args.push('-f');
    if (message) args.push('-a', '-m', message);
    args.push(name);
    if (sha) args.push(sha);
    await g(repo, args);
  }
  const deleteTag = (repo, name) => g(repo, ['tag', '-d', name]);
  const pushTag = (repo, remote, name) => g(repo, ['push', remote, `refs/tags/${name}`], { net: true });
  const deleteRemoteTag = (repo, remote, name) => g(repo, ['push', remote, '--delete', `refs/tags/${name}`], { net: true });

  /* ================================ STASH =============================== */

  async function stashPush(repo, { message, includeUntracked, keepIndex, files } = {}) {
    const args = ['stash', 'push'];
    if (includeUntracked) args.push('-u');
    if (keepIndex) args.push('-k');
    if (message) args.push('-m', message);
    if (files && files.length) args.push('--', ...files);
    const r = await g(repo, args);
    return r.stdout.trim();
  }
  async function stashApply(repo, index) {
    const r = await g(repo, ['stash', 'apply', `stash@{${index}}`], { allowFail: true });
    return mergeResult(repo, r);
  }
  async function stashPop(repo, index) {
    const r = await g(repo, ['stash', 'pop', `stash@{${index}}`], { allowFail: true });
    return mergeResult(repo, r);
  }
  const stashDrop = (repo, index) => g(repo, ['stash', 'drop', `stash@{${index}}`]);
  const stashBranch = (repo, index, name) => g(repo, ['stash', 'branch', name, `stash@{${index}}`]);

  /* ============================ SUBMÓDULOS ============================== */

  async function submodules(repo) {
    if (!fs.existsSync(path.join(repo, '.gitmodules'))) return [];
    const txt = await out(repo, ['submodule', 'status', '--recursive'], { allowFail: true });
    return P.parseSubmodules(txt);
  }
  const submoduleUpdate = (repo, p) => g(repo, ['submodule', 'update', '--init', '--recursive', ...(p ? ['--', p] : [])], { net: true, timeout: 0 });
  const submoduleAdd = (repo, url, p) => g(repo, ['submodule', 'add', url, ...(p ? [p] : [])], { net: true, timeout: 0 });

  /* ============================ CONFLICTOS ============================== */

  async function readWorkFile(repo, file) {
    const abs = path.join(repo, file);
    if (!abs.startsWith(path.resolve(repo))) throw new GitError('Ruta fuera del repositorio.');
    return fs.promises.readFile(abs, 'utf8');
  }

  async function writeWorkFile(repo, file, content) {
    const abs = path.join(repo, file);
    if (!abs.startsWith(path.resolve(repo))) throw new GitError('Ruta fuera del repositorio.');
    await fs.promises.writeFile(abs, content, 'utf8');
  }

  async function conflictFile(repo, file) {
    const content = await readWorkFile(repo, file).catch(() => '');
    return { content, segments: P.parseConflicts(content) };
  }

  /** side: 'ours' | 'theirs' */
  async function resolveWith(repo, file, side) {
    await g(repo, ['checkout', `--${side}`, '--', file]);
    await g(repo, ['add', '--', file]);
  }

  async function markResolved(repo, file, content) {
    if (content != null) await writeWorkFile(repo, file, content);
    await g(repo, ['add', '--', file]);
  }

  /* =========================== HISTORIAL / BLAME ======================== */

  async function fileHistory(repo, file, limit = 200) {
    if (!(await hasCommits(repo))) return [];
    return P.parseLog(await out(repo, ['log', '--follow', '--decorate=full', `--format=${P.RS}${P.LOG_FORMAT}`, '-n', String(limit), '--', file]));
  }

  async function blame(repo, file, sha) {
    const args = ['blame', '--line-porcelain'];
    if (sha) args.push(sha);
    args.push('--', file);
    return P.parseBlame(await out(repo, args));
  }

  async function fileAt(repo, sha, file) {
    const r = await g(repo, ['show', `${sha}:${file}`], { raw: true, allowFail: true });
    if (r.code !== 0) throw new GitError('El archivo no existe en esa revisión.');
    if (r.stdout.includes(0)) return { binary: true, content: '' };
    return { binary: false, content: r.stdout.toString('utf8') };
  }

  async function listFiles(repo) {
    const t = await out(repo, ['ls-files', '-z']);
    return t.split('\0').filter(Boolean);
  }

  /* ================================ CONFIG ============================== */

  async function getConfig(repo, key, scope) {
    const args = ['config'];
    if (scope) args.push(`--${scope}`);
    args.push('--get', key);
    const r = await g(repo, args, { allowFail: true, silent: true });
    return r.code === 0 ? r.stdout.trim() : '';
  }

  async function setConfig(repo, key, value, scope = 'local') {
    if (value === '' || value == null) await g(repo, ['config', `--${scope}`, '--unset', key], { allowFail: true });
    else await g(repo, ['config', `--${scope}`, key, value]);
  }

  async function identity(repo) {
    const [name, email, nameLocal, emailLocal] = await Promise.all([
      getConfig(repo, 'user.name'), getConfig(repo, 'user.email'),
      getConfig(repo, 'user.name', 'local'), getConfig(repo, 'user.email', 'local'),
    ]);
    return { name, email, local: !!(nameLocal || emailLocal), sshCommand: await getConfig(repo, 'core.sshCommand', 'local') };
  }

  /** Comando libre (consola). Solo `git ...` */
  async function rawCommand(repo, cmdline) {
    const args = splitArgs(cmdline);
    if (args[0] === 'git') args.shift();
    if (!args.length) throw new GitError('Comando vacío.');
    const r = await g(repo, args, { net: true, allowFail: true, timeout: 0 });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  }

  function splitArgs(s) {
    const res = [];
    let cur = '';
    let q = null;
    let has = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === q) q = null;
        else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i];
        else cur += c;
      } else if (c === '"' || c === "'") { q = c; has = true; }
      else if (/\s/.test(c)) { if (cur || has) { res.push(cur); cur = ''; has = false; } }
      else { cur += c; has = true; }
    }
    if (cur || has) res.push(cur);
    return res;
  }

  return {
    g, out, line, isRepo, toplevel, gitDir, hasCommits, repoState, init, clone, status,
    log, searchCommits, commitDetail, commitFiles, getDiff, stage, stageAll, unstage, unstageAll,
    discard, discardAll, applyHunk, commit, lastCommitMessage, refs, createBranch, checkout,
    checkoutDetached, renameBranch, deleteBranch, deleteRemoteBranch, setUpstream, merge, rebase,
    cherryPick, revert, reset, opContinue, opAbort, opSkip, isAncestor, remotes, addRemote,
    removeRemote, renameRemote, setRemoteUrl, fetch, pull, push, currentBranch, createTag,
    deleteTag, pushTag, deleteRemoteTag, stashPush, stashApply, stashPop, stashDrop, stashBranch,
    submodules, submoduleUpdate, submoduleAdd, readWorkFile, writeWorkFile, conflictFile,
    resolveWith, markResolved, fileHistory, blame, fileAt, listFiles, getConfig, setConfig,
    identity, rawCommand, splitArgs,
  };
}

module.exports = { createGit };
