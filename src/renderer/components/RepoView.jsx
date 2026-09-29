import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, onEvent } from '../api.js';
import { useUI } from './ui.jsx';
import Graph from './Graph.jsx';
import Sidebar from './Sidebar.jsx';
import DiffView from './DiffView.jsx';
import WorkingCopy from './WorkingCopy.jsx';
import CommitDetail from './CommitDetail.jsx';
import ConflictModal from './ConflictModal.jsx';
import Console from './Console.jsx';
import { BlameModal, HistoryModal } from './FileModals.jsx';
import { RemotesModal } from './MoreModals.jsx';
import { copyText, hashColor, initials, timeAgo } from '../lib/util.js';

const PAGE = 800;

export default function RepoView({ path, app, reloadApp, logs, menuAction, openProfiles }) {
  const ui = useUI();
  const [data, setData] = useState(null); // {status, refs, flow, identity, submodules}
  const [commits, setCommits] = useState([]);
  const [limit, setLimit] = useState(PAGE);
  const [showAll, setShowAll] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState(null); // {type:'wip'} | {type:'commit', sha}
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [diff, setDiff] = useState(null);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(null);
  const [scrollTo, setScrollTo] = useState(null);
  const [showConsole, setShowConsole] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState(null);
  const [rightW, setRightW] = useState(() => +localStorage.getItem('gp.rightW') || 400);
  const busyRef = useRef(false);
  const initRef = useRef(false);
  const settings = app.settings;

  const profile = useMemo(() => {
    const r = app.repos.find((x) => x.path === path);
    return r && r.profileId ? app.profiles.find((p) => p.id === r.profileId) : null;
  }, [app, path]);

  /* ------------------------------ carga ------------------------------ */
  const load = useCallback(async (lim = limit, all = showAll) => {
    try {
      const [status, refs, flow, identity, submodules, log] = await Promise.all([
        call('git.status', path), call('git.refs', path), call('flow.status', path).catch(() => null),
        call('repo.identity', path), call('git.submodules', path).catch(() => []),
        call('git.log', path, { limit: lim + 1, all }),
      ]);
      setHasMore(log.length > lim);
      setCommits(log.slice(0, lim));
      setData({ status, refs, flow, identity, submodules });
      return { status, log };
    } catch (e) { ui.error(e); return null; }
  }, [path, limit, showAll, ui]);

  useEffect(() => {
    initRef.current = false;
    setData(null); setCommits([]); setSelected(null); setDiff(null); setDetail(null); setLimit(PAGE);
    call('repo.watch', path).catch(() => {});
    load(PAGE, showAll);
    // eslint-disable-next-line
  }, [path]);

  useEffect(() => { if (data) load(limit, showAll); /* eslint-disable-next-line */ }, [showAll]);

  const changeCount = data ? data.status.staged.length + data.status.unstaged.length + data.status.conflicts.length : 0;
  const refresh = useCallback(() => (busyRef.current ? null : load(limit, showAll)), [load, limit, showAll]);

  useEffect(() => {
    if (!data || initRef.current) return;
    initRef.current = true;
    setSelected(changeCount > 0 || !commits.length ? { type: 'wip' } : { type: 'commit', sha: commits[0].sha });
    // eslint-disable-next-line
  }, [data]);

  useEffect(() => {
    let t;
    const off = onEvent((name, p) => {
      if (name === 'repo-changed' && p.path === path) { clearTimeout(t); t = setTimeout(() => refresh(), 150); }
    });
    const focus = () => refresh();
    window.addEventListener('focus', focus);
    return () => { off(); window.removeEventListener('focus', focus); clearTimeout(t); };
  }, [path, refresh]);

  useEffect(() => { if (data && selected && selected.type === 'wip' && changeCount === 0 && commits.length) setSelected({ type: 'commit', sha: commits[0].sha }); /* eslint-disable-next-line */ }, [changeCount]);

  // detalle de commit
  useEffect(() => {
    if (!selected || selected.type !== 'commit') { setDetail(null); return undefined; }
    let dead = false;
    setDetailLoading(true);
    call('git.commitDetail', path, selected.sha).then((d) => { if (!dead) { setDetail(d); setDetailLoading(false); } })
      .catch((e) => { if (!dead) { setDetailLoading(false); setDetail(null); ui.error(e); } });
    return () => { dead = true; };
    // eslint-disable-next-line
  }, [selected && selected.sha, selected && selected.type, path]);

  /* ---------------------------- acciones ----------------------------- */
  const run = useCallback(async (label, fn, { okMsg, noReload, wip } = {}) => {
    busyRef.current = true;
    setBusy(label);
    let res;
    try {
      res = await fn();
      if (okMsg) ui.success(okMsg);
    } catch (e) { ui.error(e); res = undefined; }
    busyRef.current = false;
    setBusy(null);
    if (!noReload) {
      const r = await load(limit, showAll);
      if (r && r.status.conflicts.length && res && res.ok === false && res.conflicts) setModal({ name: 'conflicts' });
      // tras merge/pull/rebase/etc. lleva al usuario a "Cambios locales" para que pueda hacer commit
      const st = r && r.status;
      if (st && (st.state || (wip && (st.staged.length || st.unstaged.length || st.conflicts.length)))) setSelected({ type: 'wip' });
    }
    return res;
  }, [load, limit, showAll, ui]);

  const handleMerge = (res, okMsg) => {
    if (!res || res.cancelled) return;
    if (res.ok === false && res.conflicts) {
      ui.warn(`Hay ${res.conflicts} archivo(s) con conflictos. Resuélvelos para continuar.${res.stashed ? '\nTus cambios locales están guardados a salvo y se restaurarán al completar o abortar.' : ''}`);
    } else if (res.ok && res.autostashConflict) {
      ui.warn('Operación completada, pero tus cambios locales chocan con el resultado. Siguen guardados en Stashes (panel izquierdo): aplícalos desde ahí.');
    } else if (res.ok) ui.success(okMsg);
  };

  // Si git se niega porque hay cambios locales que chocan, pregunta y reintenta guardándolos temporalmente (stash).
  const askStash = async (what, detail) => ui.confirm({
    title: 'Tienes cambios locales que chocan',
    message: `Git no puede ${what} sin tocar tus cambios sin commit.\n\n${(detail || '').split('\n').slice(0, 6).join('\n')}\n\n¿Guardarlos temporalmente (stash), continuar y restaurarlos después? No se pierde nada.`,
    confirmText: 'Guardar, continuar y restaurar',
  });
  const withStash = async (what, exec) => {
    let r;
    try { r = await exec(false); } catch (e) {
      if (!e.dirty) throw e;
      r = { ok: false, dirty: true, message: e.message };
    }
    if (r && r.dirty) {
      if (!(await askStash(what, r.message))) return { ok: false, cancelled: true };
      r = await exec(true);
    }
    return r;
  };

  const cur = data && data.status.branch;
  const curName = cur && !cur.detached ? cur.head : null;

  const A = {
    fetch: () => run('Fetch…', () => call('git.fetch', path, {}), { okMsg: 'Fetch completado' }),
    pull: (mode) => run('Pull…', async () => {
      const r = await withStash('hacer pull', (autostash) => call('git.pull', path, { mode: mode || settings.pullMode || 'merge', autostash }));
      handleMerge(r, r.message && /Already up to date/i.test(r.message) ? 'Ya está actualizado' : 'Pull completado');
      return r;
    }, { wip: true }),
    push: async (opts = {}) => {
      if (!curName) return ui.error('Estás en HEAD desasociado: crea o cambia a una rama para hacer push.');
      const remotes = data.refs.remotesList;
      if (!remotes.length) return ui.error('Este repositorio no tiene remotos. Añade uno desde el panel “Remotos”.');
      const up = cur.upstream;
      let args;
      if (opts.tags) args = { remote: (up ? up.split('/')[0] : remotes[0].name), tags: true };
      else if (up) args = { remote: up.split('/')[0], branch: curName, remoteBranch: up.slice(up.indexOf('/') + 1), force: opts.force };
      else args = { remote: (remotes.find((r) => r.name === 'origin') || remotes[0]).name, branch: curName, setUpstream: true, force: opts.force };
      if (opts.force && !(await ui.confirm({ title: 'Push forzado', message: `Vas a reescribir el historial remoto de "${curName}" con --force-with-lease. ¿Continuar?`, confirmText: 'Forzar push', danger: true }))) return;
      return run('Push…', () => call('git.push', path, args), { okMsg: 'Push completado' });
    },
    checkout: async (b, remote) => run(`Checkout ${b.name}…`, async () => {
      const r = await withStash('cambiar de rama', (autostash) => call('git.checkout', path, b.name, { remote: !!remote, autostash }));
      handleMerge(r || { ok: true }, `Checkout de ${b.name}`);
      return r;
    }, { wip: true }),
    checkoutDetached: (sha) => run('Checkout…', () => call('git.checkoutDetached', path, sha), { okMsg: 'HEAD desasociado en ' + sha.slice(0, 7) }),
    createBranch: async (from, label) => {
      const v = await ui.form({ title: label || 'Nueva rama', submitText: 'Crear', fields: [
        { name: 'name', label: 'Nombre de la rama', required: true, placeholder: 'feature/mi-cambio', mono: true },
        { name: 'from', label: 'Crear desde', default: from || (curName || 'HEAD'), mono: true },
        { name: 'checkout', label: 'Cambiar a la nueva rama', type: 'checkbox', default: true }] });
      if (!v) return;
      return run('Creando rama…', () => call('git.createBranch', path, v.name.trim(), { from: v.from.trim() || undefined, checkout: v.checkout }), { okMsg: `Rama ${v.name} creada` });
    },
    merge: async (name) => {
      const v = await ui.form({ title: `Merge de "${name}" en "${curName}"`, submitText: 'Merge', fields: [
        { name: 'kind', label: 'Estrategia', type: 'select', default: 'default', options: [
          { value: 'default', label: 'Por defecto (fast-forward si es posible)' },
          { value: 'noff', label: 'Siempre crear commit de merge (--no-ff)' },
          { value: 'squash', label: 'Squash (junta todo en un commit, sin merge)' },
          { value: 'ffonly', label: 'Solo fast-forward (--ff-only)' }] }] });
      if (!v) return;
      const opts = { noFf: v.kind === 'noff', squash: v.kind === 'squash', ffOnly: v.kind === 'ffonly' };
      return run('Merge…', async () => {
        const r = await withStash('hacer el merge', (autostash) => call('git.merge', path, name, { ...opts, autostash }));
        handleMerge(r, v.kind === 'squash' ? 'Cambios traídos al área de preparación: haz commit.' : 'Merge completado');
        return r;
      }, { wip: true });
    },
    rebase: async (onto) => {
      if (!(await ui.confirm({ title: 'Rebase', message: `Se reaplicarán los commits de "${curName}" encima de "${onto}". Esto reescribe el historial local de la rama.`, confirmText: 'Rebase' }))) return;
      return run('Rebase…', async () => {
        const r = await withStash('hacer el rebase', (autostash) => call('git.rebase', path, onto, { autostash }));
        handleMerge(r, 'Rebase completado');
        return r;
      }, { wip: true });
    },
    deleteBranch: async (b) => {
      if (!(await ui.confirm({ title: 'Eliminar rama', message: `¿Eliminar la rama local "${b.name}"?`, confirmText: 'Eliminar', danger: true }))) return;
      return run('Eliminando…', async () => {
        try { await call('git.deleteBranch', path, b.name, {}); }
        catch (e) {
          if (/not fully merged/i.test(e.message)) {
            if (await ui.confirm({ title: 'Rama sin fusionar', message: `"${b.name}" tiene commits que no están en otra rama. ¿Eliminarla igualmente (se perderán)?`, confirmText: 'Eliminar igual', danger: true })) await call('git.deleteBranch', path, b.name, { force: true });
          } else throw e;
        }
      }, { okMsg: `Rama ${b.name} eliminada` });
    },
    renameBranch: async (b) => {
      const v = await ui.form({ title: `Renombrar "${b.name}"`, submitText: 'Renombrar', fields: [{ name: 'name', label: 'Nuevo nombre', default: b.name, required: true, mono: true }] });
      if (v && v.name !== b.name) return run('Renombrando…', () => call('git.renameBranch', path, b.name, v.name.trim()), { okMsg: 'Rama renombrada' });
    },
    deleteRemoteBranch: async (r) => {
      if (!(await ui.confirm({ title: 'Eliminar rama remota', message: `Se ejecutará git push ${r.remote} --delete ${r.short}. Afecta a todo el equipo.`, confirmText: 'Eliminar del remoto', danger: true }))) return;
      return run('Eliminando del remoto…', () => call('git.deleteRemoteBranch', path, r.remote, r.short), { okMsg: 'Rama remota eliminada' });
    },
    setUpstream: async (b) => {
      const opts = [{ value: '', label: '(quitar upstream)' }, ...data.refs.remotes.map((r) => ({ value: r.name, label: r.name }))];
      const v = await ui.form({ title: `Upstream de "${b.name}"`, submitText: 'Guardar', fields: [{ name: 'up', label: 'Rama remota', type: 'select', default: b.upstream || '', options: opts }] });
      if (v) return run('…', () => call('git.setUpstream', path, b.name, v.up || null));
    },
    pushBranch: async (b) => {
      const remotes = data.refs.remotesList;
      if (!remotes.length) return ui.error('No hay remotos configurados.');
      const rem = b.upstream ? b.upstream.split('/')[0] : (remotes.find((r) => r.name === 'origin') || remotes[0]).name;
      return run('Push…', () => call('git.push', path, { remote: rem, branch: b.name, remoteBranch: b.upstream ? b.upstream.slice(b.upstream.indexOf('/') + 1) : undefined, setUpstream: !b.upstream }), { okMsg: 'Push completado' });
    },
    createTag: async (sha) => {
      const v = await ui.form({ title: 'Nuevo tag', submitText: 'Crear tag', fields: [
        { name: 'name', label: 'Nombre', required: true, placeholder: 'v1.0.0', mono: true },
        { name: 'sha', label: 'En el commit', default: sha || 'HEAD', mono: true },
        { name: 'message', label: 'Mensaje (si lo pones, será un tag anotado)', type: 'textarea' },
        { name: 'push', label: 'Publicar el tag en el remoto', type: 'checkbox' }] });
      if (!v) return;
      return run('Creando tag…', async () => {
        await call('git.createTag', path, v.name.trim(), { sha: v.sha.trim() || undefined, message: v.message.trim() || undefined });
        if (v.push) await call('git.pushTag', path, (cur.upstream ? cur.upstream.split('/')[0] : (data.refs.remotesList[0] || {}).name || 'origin'), v.name.trim());
      }, { okMsg: `Tag ${v.name} creado` });
    },
    deleteTag: async (t) => {
      const v = await ui.form({ title: 'Eliminar tag', message: `¿Eliminar el tag "${t.name}"?`, submitText: 'Eliminar', danger: true, fields: [{ name: 'remote', label: 'Eliminarlo también del remoto', type: 'checkbox' }] });
      if (!v) return;
      return run('Eliminando tag…', async () => {
        await call('git.deleteTag', path, t.name);
        if (v.remote) await call('git.deleteRemoteTag', path, (data.refs.remotesList[0] || {}).name || 'origin', t.name);
      }, { okMsg: 'Tag eliminado' });
    },
    pushTag: (t) => run('Push tag…', () => call('git.pushTag', path, (cur && cur.upstream ? cur.upstream.split('/')[0] : (data.refs.remotesList[0] || {}).name || 'origin'), t.name), { okMsg: 'Tag publicado' }),
    stashSave: async () => {
      const v = await ui.form({ title: 'Guardar en stash', submitText: 'Guardar stash', fields: [
        { name: 'message', label: 'Mensaje (opcional)', mono: false },
        { name: 'untracked', label: 'Incluir archivos sin seguimiento', type: 'checkbox', default: true },
        { name: 'keep', label: 'Mantener lo ya preparado (--keep-index)', type: 'checkbox' }] });
      if (v) return run('Stash…', () => call('git.stashPush', path, { message: v.message.trim() || undefined, includeUntracked: v.untracked, keepIndex: v.keep }), { okMsg: 'Cambios guardados en stash' });
    },
    stashApply: (s, pop) => run('Stash…', async () => { const r = await call(pop ? 'git.stashPop' : 'git.stashApply', path, s.index); handleMerge(r, pop ? 'Stash aplicado y eliminado' : 'Stash aplicado'); return r; }, { wip: true }),
    stashDrop: async (s) => {
      if (await ui.confirm({ title: 'Eliminar stash', message: `¿Eliminar "${s.message}"? No se puede deshacer.`, confirmText: 'Eliminar', danger: true })) return run('…', () => call('git.stashDrop', path, s.index), { okMsg: 'Stash eliminado' });
    },
    stashBranch: async (s) => {
      const v = await ui.form({ title: 'Rama desde stash', submitText: 'Crear', fields: [{ name: 'name', label: 'Nombre de la rama', required: true, mono: true }] });
      if (v) return run('…', () => call('git.stashBranch', path, s.index, v.name.trim()), { okMsg: 'Rama creada' });
    },
    cherryPick: (sha) => run('Cherry-pick…', async () => { const r = await call('git.cherryPick', path, [sha], {}); handleMerge(r, 'Cherry-pick aplicado'); return r; }, { wip: true }),
    revert: async (c) => {
      let mainline;
      if (c.parents && c.parents.length > 1) {
        const v = await ui.form({ title: 'Revertir merge', message: 'Este commit es un merge. ¿Qué padre quieres conservar como línea principal?', fields: [{ name: 'm', label: 'Padre', type: 'select', default: '1', options: c.parents.map((p, i) => ({ value: String(i + 1), label: `${i + 1} — ${p.slice(0, 7)}` })) }] });
        if (!v) return;
        mainline = +v.m;
      }
      return run('Revert…', async () => { const r = await call('git.revert', path, c.sha, { mainline }); handleMerge(r, 'Commit revertido'); return r; });
    },
    reset: async (c, mode) => {
      const warn = mode === 'hard' ? ' Se perderán todos los cambios locales sin commit.' : '';
      if (!(await ui.confirm({ title: `Reset --${mode}`, message: `Mover "${curName || 'HEAD'}" a ${c.sha.slice(0, 7)} (${c.subject}).${warn}`, confirmText: `Reset ${mode}`, danger: mode === 'hard' }))) return;
      return run('Reset…', () => call('git.reset', path, c.sha, mode), { okMsg: 'Reset completado' });
    },
    stage: (files) => run('', () => call('git.stage', path, files)),
    unstage: (files) => run('', () => call('git.unstage', path, files)),
    stageAll: () => run('', () => call('git.stageAll', path)),
    unstageAll: () => run('', () => call('git.unstageAll', path)),
    discard: async (files) => {
      if (!(await ui.confirm({ title: 'Descartar cambios', message: `Se perderán los cambios de ${files.length === 1 ? files[0].path : files.length + ' archivos'}. No se puede deshacer.`, confirmText: 'Descartar', danger: true }))) return;
      setDiff(null);
      return run('', () => call('git.discard', path, files));
    },
    discardAll: async () => {
      if (!(await ui.confirm({ title: 'Descartar TODO', message: 'Se eliminarán todos los cambios sin commit y los archivos sin seguimiento. No se puede deshacer.', confirmText: 'Descartar todo', danger: true }))) return;
      setDiff(null);
      return run('', () => call('git.discardAll', path));
    },
    commit: async ({ message, body, amend, noVerify, push, stageAll }) => {
      let errMsg = 'No se pudo crear el commit.';
      const r = await run('Commit…', async () => {
        try {
          if (stageAll) await call('git.stageAll', path);
          await call('git.commit', path, { message, body, amend, noVerify });
        } catch (e) { errMsg = e.message; throw e; }
        return { done: true };
      }, { okMsg: amend ? 'Commit enmendado' : 'Commit creado' });
      if (!r) return { ok: false, error: errMsg };
      if (push) await A.push({ force: amend ? 'lease' : false });
      setDiff(null);
      return { ok: true };
    },
    opContinue: () => run('Continuando…', async () => { const r = await call('git.opContinue', path); handleMerge(r, 'Operación completada'); return r; }, { wip: true }),
    opAbort: async () => {
      if (await ui.confirm({ title: 'Abortar operación', message: 'Se descartará el progreso de la operación en curso y se volverá al estado anterior.', confirmText: 'Abortar', danger: true })) {
        setModal(null); return run('Abortando…', () => call('git.opAbort', path), { okMsg: 'Operación abortada' });
      }
    },
    opSkip: () => run('…', async () => { const r = await call('git.opSkip', path); handleMerge(r, 'Paso omitido'); return r; }),
  };

  /* ---- Gitflow ---- */
  const flowInit = async () => {
    const d = data.flow.config;
    const v = await ui.form({ title: 'Inicializar Gitflow', submitText: 'Inicializar', fields: [
      { name: 'main', label: 'Rama de producción', default: d.main, mono: true },
      { name: 'develop', label: 'Rama de desarrollo', default: 'develop', mono: true },
      { name: 'feature', label: 'Prefijo feature', default: 'feature/', mono: true },
      { name: 'release', label: 'Prefijo release', default: 'release/', mono: true },
      { name: 'hotfix', label: 'Prefijo hotfix', default: 'hotfix/', mono: true },
      { name: 'versiontag', label: 'Prefijo de tags de versión (opcional)', default: '', mono: true, placeholder: 'v' }] });
    if (v) run('Gitflow…', () => call('flow.init', path, v), { okMsg: 'Gitflow inicializado' });
  };
  const flowStart = async (type) => {
    const v = await ui.form({ title: `Iniciar ${type}`, submitText: 'Iniciar', fields: [{ name: 'name', label: type === 'feature' ? 'Nombre de la feature' : 'Versión / nombre', required: true, mono: true, placeholder: type === 'feature' ? 'login-con-google' : '1.2.0' }] });
    if (v) run('Gitflow…', () => call('flow.start', path, type, v.name.trim()), { okMsg: `${type} iniciada` });
  };
  const flowFinish = async (type, b) => {
    const fields = [
      { name: 'keep', label: 'Conservar la rama tras finalizar', type: 'checkbox' },
      ...(type === 'feature' ? [{ name: 'squash', label: 'Squash de los commits', type: 'checkbox' }] : [
        { name: 'tag', label: 'Crear tag', type: 'checkbox', default: true },
        { name: 'tagMessage', label: 'Mensaje del tag', default: `${type === 'release' ? 'Release' : 'Hotfix'} ${b.short}` }]),
      ...(data.refs.remotesList.length ? [{ name: 'push', label: 'Publicar (push) main, develop y tags', type: 'checkbox' }] : []),
    ];
    const v = await ui.form({ title: `Finalizar ${type} "${b.short}"`, submitText: 'Finalizar', message: type === 'feature' ? `Merge de ${b.name} en ${data.flow.config.develop}.` : `Merge en ${data.flow.config.main} + tag + merge en ${data.flow.config.develop}.`, fields });
    if (!v) return;
    const res = await run('Finalizando…', () => call('flow.finish', path, type, b.short, v));
    if (res && res.ok) ui.success(`${type} finalizada:\n• ${res.steps.join('\n• ')}`);
    else if (res && res.conflict) { ui.warn(res.message); setModal({ name: 'conflicts' }); }
  };

  /* ---- Menús ---- */
  const branchMenu = (e, b) => ui.menu(e, [
    { title: b.name },
    { label: 'Checkout', disabled: b.current, onClick: () => A.checkout(b) },
    { label: `Merge en "${curName}"`, disabled: b.current || !curName, onClick: () => A.merge(b.name) },
    { label: `Rebase "${curName}" sobre esta rama`, disabled: b.current || !curName, onClick: () => A.rebase(b.name) },
    { sep: true },
    { label: 'Push…', onClick: () => A.pushBranch(b) },
    { label: 'Definir upstream…', onClick: () => A.setUpstream(b) },
    { label: 'Nueva rama desde aquí…', onClick: () => A.createBranch(b.name) },
    { label: 'Nuevo tag aquí…', onClick: () => A.createTag(b.sha) },
    { sep: true },
    { label: 'Renombrar…', onClick: () => A.renameBranch(b) },
    { label: 'Eliminar', danger: true, disabled: b.current, onClick: () => A.deleteBranch(b) },
    { label: 'Copiar nombre', onClick: () => { copyText(b.name); ui.toast('Copiado'); } },
  ]);
  const remoteMenu = (e, r) => r.remoteName ? ui.menu(e, [
    { title: r.remoteName },
    { label: 'Fetch de este remoto', onClick: () => run('Fetch…', () => call('git.fetch', path, { remote: r.remoteName }), { okMsg: 'Fetch completado' }) },
    { label: 'Gestionar remotos…', onClick: () => setModal({ name: 'remotes' }) },
  ]) : ui.menu(e, [
    { title: r.name },
    { label: 'Checkout (crear rama local)', onClick: () => A.checkout(r, true) },
    { label: `Merge en "${curName}"`, disabled: !curName, onClick: () => A.merge(r.name) },
    { label: `Rebase "${curName}" sobre esta`, disabled: !curName, onClick: () => A.rebase(r.name) },
    { sep: true },
    { label: 'Nueva rama desde aquí…', onClick: () => A.createBranch(r.name) },
    { label: 'Eliminar del remoto', danger: true, onClick: () => A.deleteRemoteBranch(r) },
    { label: 'Copiar nombre', onClick: () => { copyText(r.name); ui.toast('Copiado'); } },
  ]);
  const tagMenu = (e, t) => ui.menu(e, [
    { title: t.name },
    { label: 'Checkout (HEAD desasociado)', onClick: () => A.checkoutDetached(t.sha) },
    { label: 'Publicar tag (push)', onClick: () => A.pushTag(t) },
    { label: 'Nueva rama desde el tag…', onClick: () => A.createBranch(t.name) },
    { sep: true },
    { label: 'Eliminar…', danger: true, onClick: () => A.deleteTag(t) },
    { label: 'Copiar nombre', onClick: () => { copyText(t.name); ui.toast('Copiado'); } },
  ]);
  const stashMenu = (e, s) => ui.menu(e, [
    { title: s.ref },
    { label: 'Aplicar', onClick: () => A.stashApply(s, false) },
    { label: 'Aplicar y eliminar (pop)', onClick: () => A.stashApply(s, true) },
    { label: 'Crear rama desde stash…', onClick: () => A.stashBranch(s) },
    { sep: true },
    { label: 'Eliminar', danger: true, onClick: () => A.stashDrop(s) },
  ]);
  const flowMenu = (e, type, b) => ui.menu(e, [
    { title: b.name },
    { label: 'Checkout', onClick: () => A.checkout({ name: b.name }) },
    { label: 'Publicar (push -u)', onClick: () => run('Publicando…', () => call('flow.publish', path, type, b.short), { okMsg: 'Rama publicada' }) },
    { label: 'Finalizar…', onClick: () => flowFinish(type, b) },
  ]);
  const commitMenu = (e, c) => {
    const isBranchTip = c.refs.filter((r) => r.type === 'local' || r.type === 'head');
    ui.menu(e, [
      { title: c.sha.slice(0, 7) + ' · ' + (c.subject.length > 34 ? c.subject.slice(0, 34) + '…' : c.subject) },
      { label: 'Checkout (HEAD desasociado)', onClick: () => A.checkoutDetached(c.sha) },
      { label: 'Nueva rama aquí…', onClick: () => A.createBranch(c.sha) },
      { label: 'Nuevo tag aquí…', onClick: () => A.createTag(c.sha) },
      { sep: true },
      { label: 'Cherry-pick', disabled: !curName, onClick: () => A.cherryPick(c.sha) },
      { label: 'Revert…', disabled: !curName, onClick: () => A.revert(c) },
      { label: `Merge en "${curName}"`, disabled: !curName || isBranchTip.some((r) => r.name === curName), onClick: () => A.merge(c.sha) },
      { label: `Rebase "${curName}" sobre este commit`, disabled: !curName, onClick: () => A.rebase(c.sha) },
      { sep: true },
      { label: 'Reset --soft aquí', onClick: () => A.reset(c, 'soft') },
      { label: 'Reset --mixed aquí', onClick: () => A.reset(c, 'mixed') },
      { label: 'Reset --hard aquí', danger: true, onClick: () => A.reset(c, 'hard') },
      { sep: true },
      { label: 'Copiar SHA', onClick: () => { copyText(c.sha); ui.toast('SHA copiado'); } },
    ]);
  };
  const addToGitignore = async (p) => {
    try {
      let cur = '';
      try { cur = await call('git.readWorkFile', path, '.gitignore'); } catch (_) { /* no existe */ }
      await call('git.writeWorkFile', path, '.gitignore', cur + (cur && !cur.endsWith('\n') ? '\n' : '') + p + '\n');
      ui.success(`"${p}" añadido a .gitignore`);
      refresh();
    } catch (e) { ui.error(e); }
  };
  const fileMenu = (e, f, section) => ui.menu(e, [
    { title: f.path },
    section === 'unstaged' ? { label: 'Preparar', onClick: () => A.stage([f.path]) } : { label: 'Quitar de preparados', onClick: () => A.unstage([f.path]) },
    section === 'unstaged' ? { label: 'Descartar cambios…', danger: true, onClick: () => A.discard([{ path: f.path, untracked: !!f.untracked }]) } : null,
    { sep: true },
    !f.untracked ? { label: 'Historial del archivo', onClick: () => setModal({ name: 'history', file: f.path }) } : null,
    !f.untracked ? { label: 'Blame', onClick: () => setModal({ name: 'blame', file: f.path }) } : null,
    f.untracked ? { label: 'Añadir a .gitignore', onClick: () => addToGitignore(f.path) } : null,
    { label: 'Mostrar en Finder', onClick: () => call('app.showInFinder', `${path}/${f.path}`) },
    { label: 'Copiar ruta', onClick: () => { copyText(f.path); ui.toast('Copiado'); } },
  ]);
  const commitFileMenu = (e, f, sha) => ui.menu(e, [
    { title: f.path },
    { label: 'Historial del archivo', onClick: () => setModal({ name: 'history', file: f.path }) },
    { label: 'Blame en este commit', onClick: () => setModal({ name: 'blame', file: f.path, sha }) },
    { label: 'Copiar ruta', onClick: () => { copyText(f.path); ui.toast('Copiado'); } },
  ]);

  const profileMenu = (e) => ui.menuAt(e.currentTarget, [
    { title: 'Perfil de este repositorio' },
    ...app.profiles.map((p) => ({ label: `${profile && profile.id === p.id ? '✔ ' : '   '}${p.label}  ·  ${p.email}`, onClick: async () => {
      try { await call('repo.setProfile', path, p.id); await reloadApp(); await load(); ui.success(`Perfil "${p.label}" aplicado a este repo`); } catch (err) { ui.error(err); } } })),
    { label: `${!profile ? '✔ ' : '   '}Sin perfil (config global)`, onClick: async () => { await call('repo.setProfile', path, null); await reloadApp(); await load(); } },
    { sep: true },
    { label: 'Probar conexión con el remoto', onClick: async () => { const r = await call('repo.testAuth', path).catch((er) => ({ ok: false, output: er.message })); r.ok ? ui.success(r.output) : ui.error(r.output); } },
    { label: 'Administrar perfiles…', onClick: () => openProfiles(profile && profile.id) },
  ]);

  /* ---- selección ---- */
  const selectCommit = (c) => { setDiff(null); setSelected(c.sha === 'WIP' ? { type: 'wip' } : { type: 'commit', sha: c.sha }); };
  const selectSha = (sha) => {
    setDiff(null); setResults(null);
    const full = commits.find((c) => c.sha.startsWith(sha) || c.sha === sha);
    setSelected({ type: 'commit', sha: full ? full.sha : sha });
    setScrollTo({ sha: full ? full.sha : sha, n: Date.now() });
  };

  useEffect(() => {
    if (!menuAction) return;
    const m = menuAction.name;
    if (m === 'fetch') A.fetch(); else if (m === 'pull') A.pull(); else if (m === 'push') A.push(); else if (m === 'refresh') refresh();
    // eslint-disable-next-line
  }, [menuAction]);

  useEffect(() => {
    if (!search.trim()) { setResults(null); return undefined; }
    const t = setTimeout(() => call('git.searchCommits', path, search.trim()).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [search, path]);

  if (!data) return <div className="center"><div className="empty-state" style={{ margin: 'auto' }}>Cargando repositorio…</div></div>;

  const { status, refs } = data;
  const graphCommits = changeCount > 0 ? [{ sha: 'WIP', parents: status.branch.oid ? [status.branch.oid] : [], refs: [] }, ...commits] : commits;
  const selSha = selected && selected.type === 'wip' ? 'WIP' : selected && selected.sha;
  const selectedFileForPane = diff ? diff.file : null;

  const startResize = (e) => {
    e.preventDefault();
    const startX = e.clientX; const startW = rightW;
    const mv = (ev) => setRightW(Math.max(300, Math.min(760, startW + startX - ev.clientX)));
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); localStorage.setItem('gp.rightW', String(rightWRef.current)); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  rightWRef.current = rightW;

  const idn = data.identity;
  return (
    <>
      {busy && <><div className="busy-bar" />{busy && <div className="busy-label">{busy}</div>}</>}
      <div className="toolbar">
        <button className="tool" onClick={A.fetch} title="Fetch (⇧⌘F)"><span className="ico">⟳</span><span className="lbl">Fetch</span></button>
        <div style={{ position: 'relative' }}>
          <button className="tool" onClick={() => A.pull()} title="Pull (⇧⌘L)"><span className="ico">⬇</span><span className="lbl">Pull</span>{cur.behind > 0 && <span className="badge warn">{cur.behind}</span>}</button>
        </div>
        <button className="icon-btn" style={{ marginLeft: -6, marginRight: 4 }} title="Modo de pull" onClick={(e) => ui.menuAt(e.currentTarget, [
          { title: 'Pull con…' },
          { label: 'Merge', onClick: () => A.pull('merge') }, { label: 'Rebase', onClick: () => A.pull('rebase') }, { label: 'Solo fast-forward', onClick: () => A.pull('ff-only') }])}>▾</button>
        <button className="tool" onClick={() => A.push()} title="Push (⇧⌘P)"><span className="ico">⬆</span><span className="lbl">Push</span>{cur.ahead > 0 && <span className="badge">{cur.ahead}</span>}</button>
        <button className="icon-btn" style={{ marginLeft: -6, marginRight: 4 }} title="Más opciones de push" onClick={(e) => ui.menuAt(e.currentTarget, [
          { label: 'Push --force-with-lease', danger: true, onClick: () => A.push({ force: 'lease' }) }, { label: 'Push de todos los tags', onClick: () => A.push({ tags: true }) }])}>▾</button>
        <div className="tool-sep" />
        <button className={`tool ${selected && selected.type === 'wip' ? 'active' : ''}`} onClick={() => { setDiff(null); setSelected({ type: 'wip' }); }} title="Ir a Cambios locales para hacer commit"><span className="ico">✔</span><span className="lbl">Commit</span>{changeCount > 0 && <span className="badge">{changeCount}</span>}</button>
        <button className="tool" onClick={() => A.createBranch()}><span className="ico">⑂</span><span className="lbl">Rama</span></button>
        <button className="tool" onClick={A.stashSave} disabled={!changeCount}><span className="ico">📦</span><span className="lbl">Stash</span></button>
        <button className="tool" onClick={() => A.createTag()}><span className="ico">🏷</span><span className="lbl">Tag</span></button>
        <button className="tool" onClick={() => setModal({ name: 'remotes' })}><span className="ico">☁</span><span className="lbl">Remotos</span></button>
        <div className="tool-sep" />
        <button className={`tool ${showConsole ? '' : ''}`} onClick={() => setShowConsole((s) => !s)}><span className="ico">›_</span><span className="lbl">Consola</span></button>
        <button className="tool" onClick={() => call('app.showInFinder', path)}><span className="ico">📂</span><span className="lbl">Finder</span></button>
        <span className="spacer" />
        <button className="profile-chip" onClick={profileMenu} title="Cambiar de cuenta para este repositorio">
          <span className="avatar" style={{ background: profile ? profile.color : 'var(--faint)' }}>{profile ? profile.label[0].toUpperCase() : '?'}</span>
          <span className="who">{profile ? profile.label : 'Sin perfil'}<small>{idn.name || '—'} · {idn.email || 'sin correo'}</small></span>
          <span className="muted">▾</span>
        </button>
      </div>

      <div className="main">
        <Sidebar refs={refs} flow={data.flow} submodules={data.submodules}
          onSelectSha={selectSha} onCheckout={(b, remote) => A.checkout(b, remote)}
          onBranchMenu={branchMenu} onRemoteMenu={remoteMenu} onTagMenu={tagMenu} onStashMenu={stashMenu}
          onCreateBranch={() => A.createBranch()} onCreateTag={() => A.createTag()} onStashSave={A.stashSave}
          onAddRemote={() => setModal({ name: 'remotes' })} onManageRemotes={() => setModal({ name: 'remotes' })}
          onFlowInit={flowInit} onFlowStart={flowStart} onFlowFinish={flowFinish} onFlowMenu={flowMenu}
          onSubmoduleUpdate={(p) => run('Submódulos…', () => call('git.submoduleUpdate', path, p), { okMsg: 'Submódulos actualizados' })}
          onSelectStash={(s) => { setDiff(null); setSelected({ type: 'commit', sha: `stash@{${s.index}}` }); }} />

        <div className="center">
          {diff ? (
            <DiffView repo={path} target={diff} settings={settings} ui={ui}
              onSettings={async (p) => { await call('app.setSettings', p); await reloadApp(); }}
              onClose={() => setDiff(null)} onChanged={refresh}
              onBlame={(f, sha) => setModal({ name: 'blame', file: f, sha })} onHistory={(f) => setModal({ name: 'history', file: f })} />
          ) : (
            <div className="graph-wrap">
              <div className="graph-head">
                <input className="input" style={{ maxWidth: 320 }} placeholder="Buscar commits (mensaje, autor, SHA)…" value={search} onChange={(e) => setSearch(e.target.value)} />
                <label className="check muted"><input type="checkbox" checked={showAll} onChange={(e) => { setShowAll(e.target.checked); }} /> Todas las ramas</label>
                <span className="spacer" />
                <span className="muted">{commits.length} commits{hasMore ? '+' : ''}</span>
                <button className="icon-btn" title="Refrescar (⌘R)" onClick={refresh}>⟳</button>
              </div>
              {results ? (
                <div className="pane-scroll">
                  {!results.length && <div className="empty-state">Sin resultados para “{search}”.</div>}
                  {results.map((c) => (
                    <div key={c.sha} className="list-item" onClick={() => { selectSha(c.sha); setSearch(''); }}>
                      <span className="avatar" style={{ background: hashColor(c.email) }}>{initials(c.author)}</span>
                      <div className="grow ellipsis"><div>{c.subject}</div><div className="faint" style={{ fontSize: 11 }}>{c.author} · {timeAgo(c.time)}</div></div>
                      <span className="mono faint">{c.sha.slice(0, 7)}</span>
                    </div>
                  ))}
                </div>
              ) : !graphCommits.length ? (
                <div className="empty-state" style={{ margin: 'auto' }}>
                  <div style={{ fontSize: 40 }}>🌱</div><b>Repositorio vacío</b><div>Prepara archivos y haz tu primer commit desde el panel derecho.</div>
                </div>
              ) : (
                <>
                  <div className="graph-cols"><span style={{ width: 0 }} /><span className="grow" style={{ paddingLeft: 60 }}>Descripción</span><span style={{ width: 150 }}>Autor</span><span style={{ width: 92 }}>Fecha</span><span style={{ width: 62 }}>SHA</span></div>
                  <Graph commits={graphCommits} selectedSha={selSha} onSelect={selectCommit} onContext={commitMenu} wipCount={changeCount}
                    onRefDblClick={(r) => (r.type === 'remote' ? A.checkout({ name: r.name }, true) : r.type === 'head' ? null : A.checkout({ name: r.name }))}
                    onRefContext={(e, r) => (r.type === 'remote' ? remoteMenu(e, { ...refs.remotes.find((x) => x.name === r.name) || { name: r.name, remote: r.name.split('/')[0], short: r.name.split('/').slice(1).join('/') } })
                      : r.type === 'tag' ? tagMenu(e, refs.tags.find((t) => t.name === r.name) || { name: r.name, sha: '' })
                      : branchMenu(e, refs.branches.find((b) => b.name === r.name) || { name: r.name, current: true }))}
                    hasMore={hasMore} loadingMore={loadingMore} scrollToSha={scrollTo}
                    onLoadMore={async () => { setLoadingMore(true); const n = limit + PAGE; setLimit(n); await load(n, showAll); setLoadingMore(false); }} />
                </>
              )}
            </div>
          )}
          {showConsole && <Console repo={path} logs={logs} onClose={() => setShowConsole(false)} onAfterCommand={refresh} />}
        </div>

        <div className="resizer" onMouseDown={startResize} />
        <div className="right" style={{ width: rightW }}>
          {selected && selected.type === 'wip' ? (
            <WorkingCopy repo={path} status={status} identity={idn} profile={profile} selected={diff && diff.kind === 'wip' ? diff : null}
              onOpenFile={setDiff} actions={A} onFileMenu={fileMenu} onOpenConflicts={() => setModal({ name: 'conflicts' })} onSwitchProfile={profileMenu} />
          ) : (
            <CommitDetail changeCount={changeCount} onGoWip={() => { setDiff(null); setSelected({ type: 'wip' }); }} detail={detail} loading={detailLoading} selectedFile={selectedFileForPane} onOpenFile={setDiff} onSelectSha={selectSha} onFileMenu={commitFileMenu} ui={ui} />
          )}
        </div>
      </div>

      {modal && modal.name === 'conflicts' && (
        <ConflictModal repo={path} status={status} onClose={() => setModal(null)}
          onResolved={async () => { await load(); }}
          onContinue={async () => { setModal(null); await A.opContinue(); }} onAbort={A.opAbort} />
      )}
      {modal && modal.name === 'blame' && <BlameModal repo={path} file={modal.file} sha={modal.sha} onClose={() => setModal(null)} onSelectSha={selectSha} />}
      {modal && modal.name === 'history' && <HistoryModal repo={path} file={modal.file} onClose={() => setModal(null)} onSelectSha={selectSha} />}
      {modal && modal.name === 'remotes' && <RemotesModal repo={path} remotes={refs.remotesList} onClose={() => setModal(null)} onChanged={() => load()} />}
    </>
  );
}

const rightWRef = { current: 400 };
