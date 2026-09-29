'use strict';
/* Pruebas del backend contra repos reales en /tmp. Ejecutar: npm test */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { run } = require('../src/main/exec');
const { Store } = require('../src/main/store');
const { createApi } = require('../src/main/api');
const P = require('../src/main/parsers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpilot-test-'));
const store = new Store(path.join(tmp, 'userdata'), null);
const { api, git, flow } = createApi({ store });

let passed = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failures.push(name); console.log('  FAIL', name, '\n      ', e.message.split('\n')[0]); if (process.env.DEBUG) console.log(e.stack); }
}
const sh = (cwd, cmd) => run(['-c', 'user.name=T', '-c', 'user.email=t@t.co', ...cmd.split(' ')], { cwd, silent: true });
const write = (r, f, c) => { fs.mkdirSync(path.dirname(path.join(r, f)), { recursive: true }); fs.writeFileSync(path.join(r, f), c); };
const read = (r, f) => fs.readFileSync(path.join(r, f), 'utf8');

(async () => {
  const repo = path.join(tmp, 'repo');
  const remoteDir = path.join(tmp, 'remote.git');

  console.log('Parsers');
  await t('parseConflicts', async () => {
    const segs = P.parseConflicts('a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feat\nb');
    assert.strictEqual(segs.length, 3);
    assert.strictEqual(segs[1].ours, 'x');
    assert.strictEqual(segs[1].theirs, 'y');
  });

  console.log('Repos y commits');
  await t('init + primer commit', async () => {
    await api['repo.init'](repo, { initialBranch: 'main' });
    await run(['config', 'user.name', 'Tester'], { cwd: repo, silent: true });
    await run(['config', 'user.email', 'tester@example.com'], { cwd: repo, silent: true });
    write(repo, 'a.txt', 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
    let s = await api['git.status'](repo);
    assert.strictEqual(s.unstaged.length, 1);
    assert.strictEqual(s.unstaged[0].untracked, true);
    await api['git.stage'](repo, ['a.txt']);
    s = await api['git.status'](repo);
    assert.strictEqual(s.staged.length, 1);
    await api['git.commit'](repo, { message: 'primer commit', body: 'cuerpo largo' });
    const lg = await api['git.log'](repo, {});
    assert.strictEqual(lg.length, 1);
    assert.strictEqual(lg[0].subject, 'primer commit');
    const d = await api['git.commitDetail'](repo, lg[0].sha);
    assert.strictEqual(d.message, 'primer commit\n\ncuerpo largo');
    assert.strictEqual(d.files[0].path, 'a.txt');
    assert.strictEqual(d.files[0].additions, 10);
  });

  await t('unstage / discard / diff', async () => {
    write(repo, 'a.txt', 'l1\nCAMBIO\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n');
    write(repo, 'nuevo.txt', 'hola\n');
    let diff = await api['git.getDiff'](repo, { file: 'a.txt' });
    assert.strictEqual(diff[0].hunks.length, 1);
    assert.strictEqual(diff[0].additions, 1);
    const ud = await api['git.getDiff'](repo, { file: 'nuevo.txt', untracked: true });
    assert.strictEqual(ud[0].additions, 1);
    await api['git.stage'](repo, ['a.txt']);
    await api['git.unstage'](repo, ['a.txt']);
    let s = await api['git.status'](repo);
    assert.ok(s.unstaged.find((f) => f.path === 'a.txt'));
    await api['git.discard'](repo, [{ path: 'a.txt' }, { path: 'nuevo.txt', untracked: true }]);
    s = await api['git.status'](repo);
    assert.strictEqual(s.unstaged.length, 0);
  });

  console.log('Staging por hunk / líneas');
  await t('stage hunk y líneas sueltas', async () => {
    // dos cambios lejanos = dos hunks
    const lines = Array.from({ length: 40 }, (_, i) => `linea${i + 1}`);
    write(repo, 'h.txt', lines.join('\n') + '\n');
    await api['git.stage'](repo, ['h.txt']);
    await api['git.commit'](repo, { message: 'h' });
    const mod = [...lines];
    mod[1] = 'CAMBIO-A';
    mod[35] = 'CAMBIO-B';
    write(repo, 'h.txt', mod.join('\n') + '\n');
    let d = await api['git.getDiff'](repo, { file: 'h.txt' });
    assert.strictEqual(d[0].hunks.length, 2, 'esperaba 2 hunks');
    await api['git.applyHunk'](repo, { file: 'h.txt', hunk: 0, mode: 'stage' });
    const staged = await api['git.getDiff'](repo, { file: 'h.txt', staged: true });
    assert.strictEqual(staged[0].hunks.length, 1);
    assert.ok(staged[0].hunks[0].lines.some((l) => l.s === 'CAMBIO-A'));
    const un = await api['git.getDiff'](repo, { file: 'h.txt' });
    assert.strictEqual(un[0].hunks.length, 1);
    // des-stage el hunk
    await api['git.applyHunk'](repo, { file: 'h.txt', hunk: 0, mode: 'unstage' });
    const st2 = await api['git.getDiff'](repo, { file: 'h.txt', staged: true });
    assert.strictEqual(st2.length, 0);
    // línea concreta: solo el '+' de CAMBIO-B (dentro del hunk 1)
    let d2 = await api['git.getDiff'](repo, { file: 'h.txt' });
    const hi = d2[0].hunks.findIndex((h) => h.lines.some((l) => l.s === 'CAMBIO-B'));
    const plus = d2[0].hunks[hi].lines.findIndex((l) => l.t === '+' && l.s === 'CAMBIO-B');
    await api['git.applyHunk'](repo, { file: 'h.txt', hunk: hi, lines: [plus], mode: 'stage' });
    const sd = await api['git.getDiff'](repo, { file: 'h.txt', staged: true });
    assert.strictEqual(sd[0].additions, 1);
    assert.strictEqual(sd[0].deletions, 0);
    // descartar el hunk restante (CAMBIO-A) del working tree
    d2 = await api['git.getDiff'](repo, { file: 'h.txt' });
    const ai = d2[0].hunks.findIndex((h) => h.lines.some((l) => l.s === 'CAMBIO-A'));
    await api['git.applyHunk'](repo, { file: 'h.txt', hunk: ai, mode: 'discard' });
    assert.ok(!read(repo, 'h.txt').includes('CAMBIO-A'));
    assert.ok(read(repo, 'h.txt').includes('CAMBIO-B'));
    await api['git.commit'](repo, { message: 'solo B' });
  });

  console.log('Ramas, merge, conflictos');
  await t('crear rama, commit, checkout, merge --no-ff', async () => {
    await api['git.createBranch'](repo, 'feature-x', {});
    write(repo, 'x.txt', 'x\n');
    await api['git.stage'](repo, ['x.txt']);
    await api['git.commit'](repo, { message: 'add x' });
    await api['git.checkout'](repo, 'main');
    const r = await api['git.merge'](repo, 'feature-x', { noFf: true, message: 'merge x' });
    assert.ok(r.ok);
    const lg = await api['git.log'](repo, {});
    assert.strictEqual(lg[0].parents.length, 2);
    const refs = await api['git.refs'](repo);
    assert.ok(refs.branches.find((b) => b.name === 'main' && b.current));
    await api['git.renameBranch'](repo, 'feature-x', 'feature-y');
    await api['git.deleteBranch'](repo, 'feature-y', {});
  });

  await t('conflicto: detectar, resolver con marcadores, continuar', async () => {
    await api['git.createBranch'](repo, 'c1', {});
    write(repo, 'conf.txt', 'base\n');
    await api['git.stage'](repo, ['conf.txt']);
    await api['git.commit'](repo, { message: 'base' });
    await api['git.createBranch'](repo, 'c2', {});
    write(repo, 'conf.txt', 'rama c2\n');
    await api['git.stage'](repo, ['conf.txt']);
    await api['git.commit'](repo, { message: 'c2' });
    await api['git.checkout'](repo, 'c1');
    write(repo, 'conf.txt', 'rama c1\n');
    await api['git.stage'](repo, ['conf.txt']);
    await api['git.commit'](repo, { message: 'c1' });
    const r = await api['git.merge'](repo, 'c2', {});
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.conflicts, 1);
    const s = await api['git.status'](repo);
    assert.strictEqual(s.state, 'merge');
    assert.strictEqual(s.conflicts[0].path, 'conf.txt');
    const cf = await api['git.conflictFile'](repo, 'conf.txt');
    assert.strictEqual(cf.segments.filter((x) => x.type === 'conflict').length, 1);
    await api['git.markResolved'](repo, 'conf.txt', 'resuelto\n');
    const c = await api['git.opContinue'](repo);
    assert.ok(c.ok);
    assert.strictEqual((await api['git.status'](repo)).state, null);
  });

  await t('conflicto: abortar y resolver con "theirs"', async () => {
    await api['git.checkout'](repo, 'c2');
    write(repo, 'conf.txt', 'otra en c2\n');
    await api['git.stage'](repo, ['conf.txt']);
    await api['git.commit'](repo, { message: 'c2b' });
    await api['git.checkout'](repo, 'c1');
    write(repo, 'conf.txt', 'otra en c1\n');
    await api['git.stage'](repo, ['conf.txt']);
    await api['git.commit'](repo, { message: 'c1b' });
    let r = await api['git.merge'](repo, 'c2', {});
    assert.strictEqual(r.ok, false);
    await api['git.opAbort'](repo);
    assert.strictEqual((await api['git.status'](repo)).state, null);
    r = await api['git.merge'](repo, 'c2', {});
    await api['git.resolveWith'](repo, 'conf.txt', 'theirs');
    assert.strictEqual(read(repo, 'conf.txt'), 'otra en c2\n');
    await api['git.opContinue'](repo);
  });

  await t('cherry-pick, revert, reset', async () => {
    await api['git.checkout'](repo, 'main');
    await api['git.createBranch'](repo, 'cp', {});
    write(repo, 'cp.txt', 'cp\n');
    await api['git.stage'](repo, ['cp.txt']);
    const sha = await api['git.commit'](repo, { message: 'para cherry' });
    await api['git.checkout'](repo, 'main');
    const r = await api['git.cherryPick'](repo, [sha], {});
    assert.ok(r.ok);
    assert.ok(fs.existsSync(path.join(repo, 'cp.txt')));
    const rv = await api['git.revert'](repo, 'HEAD', {});
    assert.ok(rv.ok);
    assert.ok(!fs.existsSync(path.join(repo, 'cp.txt')));
    const before = (await api['git.log'](repo, { all: false }))[0].sha;
    await api['git.reset'](repo, 'HEAD~1', 'hard');
    const after = (await api['git.log'](repo, { all: false }))[0].sha;
    assert.notStrictEqual(before, after);
  });

  await t('rebase', async () => {
    await api['git.checkout'](repo, 'main');
    await api['git.createBranch'](repo, 'rb', {});
    write(repo, 'rb.txt', 'rb\n');
    await api['git.stage'](repo, ['rb.txt']);
    await api['git.commit'](repo, { message: 'rb commit' });
    await api['git.checkout'](repo, 'main');
    write(repo, 'main-extra.txt', 'm\n');
    await api['git.stage'](repo, ['main-extra.txt']);
    await api['git.commit'](repo, { message: 'main extra' });
    await api['git.checkout'](repo, 'rb');
    const r = await api['git.rebase'](repo, 'main');
    assert.ok(r.ok);
    const lg = await api['git.log'](repo, { all: false });
    assert.strictEqual(lg[0].subject, 'rb commit');
    assert.strictEqual(lg[1].subject, 'main extra');
    await api['git.checkout'](repo, 'main');
  });

  console.log('Stash, tags, remotos');
  await t('stash push / apply / pop / drop', async () => {
    write(repo, 'a.txt', 'stash me\n');
    write(repo, 'untracked-stash.txt', 'u\n');
    await api['git.stashPush'](repo, { message: 'mi stash', includeUntracked: true });
    let s = await api['git.status'](repo);
    assert.strictEqual(s.unstaged.length, 0);
    let refs = await api['git.refs'](repo);
    assert.strictEqual(refs.stashes.length, 1);
    assert.ok(refs.stashes[0].message.includes('mi stash'));
    const d = await api['git.getDiff'](repo, { stash: 0 });
    assert.ok(d.length >= 1);
    const r = await api['git.stashPop'](repo, 0);
    assert.ok(r.ok);
    refs = await api['git.refs'](repo);
    assert.strictEqual(refs.stashes.length, 0);
    await api['git.discardAll'](repo);
  });

  await t('tags', async () => {
    await api['git.createTag'](repo, 'v1.0.0', { message: 'release 1' });
    await api['git.createTag'](repo, 'ligero', {});
    let refs = await api['git.refs'](repo);
    assert.strictEqual(refs.tags.length, 2);
    assert.strictEqual(refs.tags.find((x) => x.name === 'v1.0.0').annotated, true);
    await api['git.deleteTag'](repo, 'ligero');
    refs = await api['git.refs'](repo);
    assert.strictEqual(refs.tags.length, 1);
  });

  await t('remotos: push -u, fetch, pull (merge/rebase/ff-only), delete remote', async () => {
    await run(['init', '--bare', '-b', 'main', remoteDir], { silent: true });
    await api['git.addRemote'](repo, 'origin', remoteDir);
    assert.strictEqual((await api['git.remotes'](repo))[0].name, 'origin');
    await api['git.push'](repo, { remote: 'origin', branch: 'main', setUpstream: true });
    await api['git.push'](repo, { remote: 'origin', tags: true });
    let refs = await api['git.refs'](repo);
    assert.ok(refs.remotes.find((r) => r.name === 'origin/main'));
    assert.strictEqual(refs.branches.find((b) => b.name === 'main').upstream, 'origin/main');
    // segundo clon empuja un commit
    const other = path.join(tmp, 'other');
    await run(['clone', remoteDir, other], { silent: true });
    await run(['config', 'user.name', 'O'], { cwd: other, silent: true });
    await run(['config', 'user.email', 'o@o.co'], { cwd: other, silent: true });
    write(other, 'remoto.txt', 'r\n');
    await run(['add', '.'], { cwd: other, silent: true });
    await run(['commit', '-m', 'desde otro'], { cwd: other, silent: true });
    await run(['push'], { cwd: other, silent: true });
    await api['git.fetch'](repo, {});
    let st = await api['git.status'](repo);
    assert.strictEqual(st.branch.behind, 1);
    const r = await api['git.pull'](repo, { mode: 'ff-only' });
    assert.ok(r.ok);
    assert.ok(fs.existsSync(path.join(repo, 'remoto.txt')));
    // divergencia -> pull con rebase
    write(other, 'r2.txt', 'r2\n');
    await run(['add', '.'], { cwd: other, silent: true });
    await run(['commit', '-m', 'otro 2'], { cwd: other, silent: true });
    await run(['push'], { cwd: other, silent: true });
    write(repo, 'local2.txt', 'l2\n');
    await api['git.stage'](repo, ['local2.txt']);
    await api['git.commit'](repo, { message: 'local 2' });
    const pr = await api['git.pull'](repo, { mode: 'rebase' });
    assert.ok(pr.ok);
    await api['git.push'](repo, { remote: 'origin', branch: 'main' });
    // rama remota y borrado
    await api['git.createBranch'](repo, 'temp', {});
    await api['git.push'](repo, { remote: 'origin', branch: 'temp', setUpstream: true });
    await api['git.checkout'](repo, 'main');
    await api['git.deleteRemoteBranch'](repo, 'origin', 'temp');
    await api['git.fetch'](repo, {});
    refs = await api['git.refs'](repo);
    assert.ok(!refs.remotes.find((x) => x.name === 'origin/temp'));
    await api['git.deleteBranch'](repo, 'temp', { force: true });
    // checkout de rama remota crea seguimiento
    await run(['checkout', '-b', 'solo-remota'], { cwd: other, silent: true });
    write(other, 'sr.txt', 'sr\n');
    await run(['add', '.'], { cwd: other, silent: true });
    await run(['commit', '-m', 'sr'], { cwd: other, silent: true });
    await run(['push', '-u', 'origin', 'solo-remota'], { cwd: other, silent: true });
    await api['git.fetch'](repo, {});
    await api['git.checkout'](repo, 'origin/solo-remota', { remote: true });
    st = await api['git.status'](repo);
    assert.strictEqual(st.branch.head, 'solo-remota');
    assert.strictEqual(st.branch.upstream, 'origin/solo-remota');
    await api['git.checkout'](repo, 'main');
  });

  await t('amend, historial de archivo, blame, fileAt, búsqueda', async () => {
    write(repo, 'amend.txt', 'v1\n');
    await api['git.stage'](repo, ['amend.txt']);
    await api['git.commit'](repo, { message: 'mensaje viejo' });
    write(repo, 'amend.txt', 'v2\n');
    await api['git.stage'](repo, ['amend.txt']);
    await api['git.commit'](repo, { message: 'mensaje nuevo', amend: true });
    const lg = await api['git.log'](repo, { all: false });
    assert.strictEqual(lg[0].subject, 'mensaje nuevo');
    const h = await api['git.fileHistory'](repo, 'amend.txt');
    assert.strictEqual(h.length, 1);
    const b = await api['git.blame'](repo, 'amend.txt');
    assert.strictEqual(b[0].text, 'v2');
    assert.strictEqual(b[0].author, 'Tester');
    const f = await api['git.fileAt'](repo, 'HEAD', 'amend.txt');
    assert.strictEqual(f.content, 'v2\n');
    const sr = await api['git.searchCommits'](repo, 'nuevo');
    assert.ok(sr.length >= 1);
    const sr2 = await api['git.searchCommits'](repo, lg[0].sha.slice(0, 7));
    assert.strictEqual(sr2[0].sha, lg[0].sha);
  });

  console.log('Gitflow');
  await t('init + feature start/finish', async () => {
    const r2 = path.join(tmp, 'flowrepo');
    await api['repo.init'](r2, { initialBranch: 'main' });
    await run(['config', 'user.name', 'F'], { cwd: r2, silent: true });
    await run(['config', 'user.email', 'f@f.co'], { cwd: r2, silent: true });
    let st = await api['flow.status'](r2);
    assert.strictEqual(st.initialized, false);
    write(r2, 'a.txt', 'a\n');
    await api['git.stageAll'](r2);
    await api['git.commit'](r2, { message: 'init' });
    st = await api['flow.init'](r2, {});
    assert.strictEqual(st.initialized, true);
    assert.strictEqual((await api['git.status'](r2)).branch.head, 'develop');
    await api['flow.start'](r2, 'feature', 'login');
    assert.strictEqual((await api['git.status'](r2)).branch.head, 'feature/login');
    st = await api['flow.status'](r2);
    assert.deepStrictEqual(st.current, { type: 'feature', name: 'login', branch: 'feature/login' });
    write(r2, 'login.txt', 'l\n');
    await api['git.stageAll'](r2);
    await api['git.commit'](r2, { message: 'login' });
    const fin = await api['flow.finish'](r2, 'feature', 'login', {});
    assert.ok(fin.ok, JSON.stringify(fin));
    assert.strictEqual((await api['git.status'](r2)).branch.head, 'develop');
    const refs = await api['git.refs'](r2);
    assert.ok(!refs.branches.find((b) => b.name === 'feature/login'));
    const lg = await api['git.log'](r2, { all: false });
    assert.strictEqual(lg[0].parents.length, 2);
    // release
    await api['flow.start'](r2, 'release', '1.0.0');
    write(r2, 'ver.txt', '1.0.0\n');
    await api['git.stageAll'](r2);
    await api['git.commit'](r2, { message: 'bump 1.0.0' });
    const fr = await api['flow.finish'](r2, 'release', '1.0.0', { tagMessage: 'v1' });
    assert.ok(fr.ok, JSON.stringify(fr));
    const rf = await api['git.refs'](r2);
    assert.ok(rf.tags.find((x) => x.name === '1.0.0'));
    assert.ok(await git.isAncestor(r2, 'main', 'develop'));
    // hotfix
    await api['flow.start'](r2, 'hotfix', '1.0.1');
    write(r2, 'fix.txt', 'fix\n');
    await api['git.stageAll'](r2);
    await api['git.commit'](r2, { message: 'fix' });
    const fh = await api['flow.finish'](r2, 'hotfix', '1.0.1', {});
    assert.ok(fh.ok, JSON.stringify(fh));
    assert.ok(fs.existsSync(path.join(r2, 'fix.txt')));
    await api['git.checkout'](r2, 'main');
    assert.ok(fs.existsSync(path.join(r2, 'fix.txt')));
  });

  await t('gitflow: finish con conflicto es reanudable', async () => {
    const r3 = path.join(tmp, 'flowconf');
    await api['repo.init'](r3, { initialBranch: 'main' });
    await run(['config', 'user.name', 'F'], { cwd: r3, silent: true });
    await run(['config', 'user.email', 'f@f.co'], { cwd: r3, silent: true });
    write(r3, 'a.txt', 'a\n');
    await api['git.stageAll'](r3);
    await api['git.commit'](r3, { message: 'init' });
    await api['flow.init'](r3, {});
    await api['flow.start'](r3, 'feature', 'f1');
    write(r3, 'a.txt', 'desde feature\n');
    await api['git.stageAll'](r3);
    await api['git.commit'](r3, { message: 'f1' });
    await api['git.checkout'](r3, 'develop');
    write(r3, 'a.txt', 'desde develop\n');
    await api['git.stageAll'](r3);
    await api['git.commit'](r3, { message: 'dev' });
    const fin = await api['flow.finish'](r3, 'feature', 'f1', {});
    assert.strictEqual(fin.ok, false);
    assert.strictEqual(fin.conflict, true);
    await api['git.markResolved'](r3, 'a.txt', 'resuelto\n');
    await api['git.opContinue'](r3);
    const fin2 = await api['flow.finish'](r3, 'feature', 'f1', {});
    assert.ok(fin2.ok, JSON.stringify(fin2));
    assert.ok(!(await api['git.refs'](r3)).branches.find((b) => b.name === 'feature/f1'));
  });

  console.log('Perfiles / cuentas');
  await t('perfiles por repo: identidad local, no toca la global', async () => {
    const globalBefore = await api['profile.setGlobal'] && (await api['app.state']()).globalIdentity;
    const p1 = await api['profile.save']({ label: 'Trabajo', name: 'Brayam Trabajo', email: 'trabajo@empresa.com', sshKey: '', token: 'ghp_secreto', tokenUser: 'brayam' });
    const p2 = await api['profile.save']({ label: 'Personal', name: 'Andrey P', email: 'personal@gmail.com' });
    assert.strictEqual(p1.hasToken, true);
    assert.strictEqual(p1.token, undefined);
    assert.ok(!JSON.stringify(store.listProfiles()).includes('ghp_secreto'));
    await api['repo.setProfile'](repo, p1.id);
    let id = await api['repo.identity'](repo);
    assert.strictEqual(id.email, 'trabajo@empresa.com');
    write(repo, 'perfil.txt', 'x\n');
    await api['git.stageAll'](repo);
    await api['git.commit'](repo, { message: 'commit como trabajo' });
    let lg = await api['git.log'](repo, { all: false });
    assert.strictEqual(lg[0].email, 'trabajo@empresa.com');
    await api['repo.setProfile'](repo, p2.id);
    write(repo, 'perfil2.txt', 'x\n');
    await api['git.stageAll'](repo);
    await api['git.commit'](repo, { message: 'commit como personal' });
    lg = await api['git.log'](repo, { all: false });
    assert.strictEqual(lg[0].email, 'personal@gmail.com');
    const globalAfter = (await api['app.state']()).globalIdentity;
    assert.deepStrictEqual(globalBefore, globalAfter);
    // auth env con token
    const { createProfiles } = require('../src/main/profiles');
    await api['repo.setProfile'](repo, p1.id);
    const env = await createProfiles({ store, git }).authEnv(repo);
    assert.strictEqual(env.GITPILOT_TOKEN, 'ghp_secreto');
    assert.ok(fs.existsSync(env.GIT_ASKPASS));
    const out = await run(['--version'], { env, silent: true });
    const ask = await require('child_process').execFileSync(env.GIT_ASKPASS, ['Username for https://x'], { env: { ...process.env, ...env } }).toString();
    assert.strictEqual(ask, 'brayam');
    const ask2 = require('child_process').execFileSync(env.GIT_ASKPASS, ['Password for https://x'], { env: { ...process.env, ...env } }).toString();
    assert.strictEqual(ask2, 'ghp_secreto');
    await api['repo.setProfile'](repo, null);
  });

  await t('llaves SSH: generar y listar (HOME temporal)', async () => {
    try { require('child_process').execFileSync('ssh-keygen', ['-V'], { stdio: 'ignore' }); } catch (e) { if (e.code === 'ENOENT') { console.log('      (omitida: ssh-keygen no está instalado aquí)'); return; } }
    const fakeHome = path.join(tmp, 'home');
    fs.mkdirSync(fakeHome);
    const oldHome = process.env.HOME;
    // os.homedir() respeta HOME en POSIX
    process.env.HOME = fakeHome;
    try {
      const k = await api['profile.generateKey']({ label: 'Mi Cuenta', email: 'k@k.co' });
      assert.ok(k.publicKey.startsWith('ssh-ed25519'));
      assert.ok(k.path.endsWith('id_ed25519_mi_cuenta'));
      const keys = await api['profile.sshKeys']();
      assert.strictEqual(keys.length, 1);
      assert.strictEqual((await api['profile.publicKey'](k.path)), k.publicKey);
      await assert.rejects(api['profile.generateKey']({ label: 'Mi Cuenta' }), /Ya existe/);
    } finally { process.env.HOME = oldHome; }
  });

  console.log('Cambios locales protegidos');
  const mkDirty = async (name) => {
    const r = path.join(tmp, name);
    await api['repo.init'](r, { initialBranch: 'main' });
    await run(['config', 'user.name', 'T'], { cwd: r, silent: true });
    await run(['config', 'user.email', 't@t.co'], { cwd: r, silent: true });
    write(r, 'f.txt', 'a\nb\nc\n'); write(r, 'g.txt', 'x\n');
    await api['git.stageAll'](r); await api['git.commit'](r, { message: 'base' });
    await api['git.createBranch'](r, 'feat', {});
    write(r, 'f.txt', 'a\nB-feat\nc\n'); await api['git.stageAll'](r); await api['git.commit'](r, { message: 'feat' });
    await api['git.checkout'](r, 'main');
    return r;
  };
  await t('merge con cambios locales que NO chocan: se conservan', async () => {
    const r = await mkDirty('d1');
    write(r, 'g.txt', 'x\nLOCAL\n'); write(r, 'nuevo.txt', 'sin seguimiento');
    const m = await api['git.merge'](r, 'feat', { noFf: true, message: 'm' });
    assert.strictEqual(m.ok, true);
    assert.strictEqual(read(r, 'g.txt'), 'x\nLOCAL\n');
    assert.strictEqual(read(r, 'nuevo.txt'), 'sin seguimiento');
    assert.strictEqual(read(r, 'f.txt'), 'a\nB-feat\nc\n');
  });
  await t('merge con cambios locales que chocan: avisa (dirty), no toca nada y reintenta con autostash', async () => {
    const r = await mkDirty('d2');
    write(r, 'f.txt', 'a\nLOCAL\nc\n');
    const m = await api['git.merge'](r, 'feat', { noFf: true, message: 'm' });
    assert.strictEqual(m.ok, false); assert.strictEqual(m.dirty, true);
    assert.strictEqual(read(r, 'f.txt'), 'a\nLOCAL\nc\n');           // intacto
    const m2 = await api['git.merge'](r, 'feat', { noFf: true, message: 'm', autostash: true });
    // el merge se hace y al restaurar chocan: nada se pierde (queda en el stash o con marcadores)
    const stashes = await api['git.refs'](r).then((x) => x.stashes.length);
    const txt = read(r, 'f.txt');
    assert.ok(m2.autostashConflict || stashes > 0 || /LOCAL/.test(txt), 'los cambios locales no deben desaparecer');
    assert.ok(stashes > 0 || /LOCAL/.test(txt));
  });
  await t('merge con conflicto real + cambios locales: abortar restaura lo local', async () => {
    const r = await mkDirty('d3');
    write(r, 'f.txt', 'a\nB-main\nc\n'); await api['git.stageAll'](r); await api['git.commit'](r, { message: 'main change' });
    write(r, 'g.txt', 'x\nLOCAL\n'); write(r, 'u.txt', 'untracked');
    const m = await api['git.merge'](r, 'feat', { noFf: true, message: 'm' });
    assert.strictEqual(m.ok, false); assert.ok(m.conflicts >= 1);
    assert.strictEqual(read(r, 'g.txt'), 'x\nLOCAL\n');                // git lo mantiene en su sitio
    await api['git.opAbort'](r);
    assert.strictEqual(read(r, 'g.txt'), 'x\nLOCAL\n');
    assert.strictEqual(read(r, 'u.txt'), 'untracked');
    assert.strictEqual(read(r, 'f.txt'), 'a\nB-main\nc\n');
  });
  await t('merge con autostash + conflicto: status.autostash y se restaura al completar', async () => {
    const r = await mkDirty('d4');
    write(r, 'f.txt', 'a\nB-main\nc\n'); await api['git.stageAll'](r); await api['git.commit'](r, { message: 'main change' });
    write(r, 'g.txt', 'x\nLOCAL\n');
    const m = await api['git.merge'](r, 'feat', { noFf: true, message: 'm', autostash: true });
    assert.strictEqual(m.ok, false);
    let st = await api['git.status'](r);
    assert.strictEqual(st.autostash, true);
    write(r, 'f.txt', 'a\nRES\nc\n'); await api['git.stage'](r, ['f.txt']);
    await api['git.commit'](r, { message: 'merge resuelto' });
    assert.strictEqual(read(r, 'g.txt'), 'x\nLOCAL\n');
    st = await api['git.status'](r);
    assert.strictEqual(st.autostash, false);
    assert.strictEqual((await api['git.refs'](r)).stashes.length, 0);
  });
  await t('rebase con cambios sin preparar: dirty → autostash lo conserva', async () => {
    const r = await mkDirty('d5');
    await api['git.checkout'](r, 'feat');
    write(r, 'g.txt', 'x\nLOCAL\n');
    const a = await api['git.rebase'](r, 'main');
    if (a.dirty) {
      const b = await api['git.rebase'](r, 'main', { autostash: true });
      assert.strictEqual(b.ok, true);
    }
    assert.strictEqual(read(r, 'g.txt'), 'x\nLOCAL\n');
  });
  await t('checkout que choca con cambios locales: dirty, luego autostash lo restaura', async () => {
    const r = await mkDirty('d6');
    write(r, 'f.txt', 'a\nLOCAL\nc\n');
    let err;
    try { await api['git.checkout'](r, 'feat'); } catch (e) { err = e; }
    assert.ok(err && err.dirty, 'debe marcar dirty');
    assert.strictEqual(read(r, 'f.txt'), 'a\nLOCAL\nc\n');
    const res = await api['git.checkout'](r, 'feat', { autostash: true });
    assert.strictEqual(res.ok, true);
    const st = await api['git.status'](r);
    assert.strictEqual(st.branch.head, 'feat');
    const stashes = (await api['git.refs'](r)).stashes.length;
    assert.ok(res.autostashConflict ? stashes > 0 : /LOCAL/.test(read(r, 'f.txt')));
  });
  await t('commit con identidad del repo, sin preparar nada falla con mensaje claro', async () => {
    const r = await mkDirty('d7');
    await assert.rejects(api['git.commit'](r, { message: 'nada' }), /nothing|nada|no changes/i);
    write(r, 'g.txt', 'y\n'); await api['git.stageAll'](r);
    const sha = await api['git.commit'](r, { message: 'ok', body: 'cuerpo' });
    assert.ok(/^[0-9a-f]{40}$/.test(sha));
  });

  console.log('Otros');
  await t('clone con progreso, submódulos, consola, config', async () => {
    const dest = path.join(tmp, 'clonado');
    const lines = [];
    const { api: api2 } = createApi({ store, emit: (n, p) => { if (n === 'progress') lines.push(p.line); } });
    await api2['repo.clone']({ url: remoteDir, dest, opId: 'x' });
    assert.ok(fs.existsSync(path.join(dest, '.git')));
    assert.ok(lines.length > 0);
    assert.deepStrictEqual(await api['git.submodules'](dest), []);
    const r = await api['git.rawCommand'](dest, 'git log --oneline -n 1 --format="%s"');
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.trim().length > 0);
    await api['git.setConfig'](dest, 'user.name', 'Zed');
    assert.strictEqual(await api['git.getConfig'](dest, 'user.name'), 'Zed');
    const hist = await api['app.opLog']();
    assert.ok(hist.length > 20);
  });

  await t('errores claros: repo inválido, mensaje vacío', async () => {
    await assert.rejects(api['repo.open'](tmp), /no es un repositorio/i);
    await assert.rejects(api['git.commit'](repo, { message: '' }), /vac/i);
  });

  console.log(`\n${passed} pruebas OK, ${failures.length} fallidas`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures.length ? 1 : 0);
})();
