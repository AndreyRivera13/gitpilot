import React, { useCallback, useEffect, useState } from 'react';
import { call, onEvent, onMenu, isElectron } from './api.js';
import { UIProvider, useUI, Modal } from './components/ui.jsx';
import RepoView from './components/RepoView.jsx';
import ProfilesModal from './components/ProfilesModal.jsx';
import { SettingsModal, CloneModal } from './components/MoreModals.jsx';

function Welcome({ app, onOpen, onClone, onInit, onOpenRecent, onProfiles }) {
  const recent = app.repos.filter((r) => !app.tabs.includes(r.path)).slice(-8).reverse();
  const bad = app.gitVersion.startsWith('ERROR');
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div style={{ fontSize: 46 }}>🧭</div>
        <h1>GitPilot</h1>
        <div className="muted">Tu cliente Git con perfiles de cuenta, grafo y Gitflow · {bad ? <span style={{ color: 'var(--red)' }}>{app.gitVersion}</span> : app.gitVersion}</div>
        <div className="actions">
          <button className="btn primary" onClick={onOpen}>Abrir repositorio…</button>
          <button className="btn" onClick={onClone}>Clonar…</button>
          <button className="btn" onClick={onInit}>Inicializar…</button>
        </div>
        {app.profiles.length === 0 && (
          <div className="banner info" style={{ textAlign: 'left', margin: '0 0 16px' }}>
            <b>Primero configura tus cuentas</b>
            <span>Crea un perfil por cada cuenta (Trabajo, Personal…) con su nombre, correo y llave SSH o token. Luego asígnalo a cada repositorio y GitPilot usará esa identidad automáticamente.</span>
            <div><button className="btn sm primary" onClick={() => onProfiles()}>Crear perfiles</button></div>
          </div>
        )}
        {recent.length > 0 && (
          <div className="recent">
            {recent.map((r) => (
              <div key={r.path} className="item" onClick={() => onOpenRecent(r.path)}>
                <span>📁</span><div className="grow ellipsis"><div>{r.name}</div><div className="faint" style={{ fontSize: 11 }}>{r.path}</div></div>
                {r.profileId && app.profiles.find((p) => p.id === r.profileId) && <span className="tag">{app.profiles.find((p) => p.id === r.profileId).label}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Shell() {
  const ui = useUI();
  const [app, setApp] = useState(null);
  const [logs, setLogs] = useState([]);
  const [modal, setModal] = useState(null);
  const [menuAction, setMenuAction] = useState(null);

  const reloadApp = useCallback(async () => { const s = await call('app.state'); setApp(s); return s; }, []);

  useEffect(() => {
    reloadApp().catch((e) => ui.error(e));
    call('app.opLog').then((l) => setLogs(l.slice(-300))).catch(() => {});
    const off = onEvent((n, p) => { if (n === 'log') setLogs((l) => [...l.slice(-299), p]); });
    return off;
    // eslint-disable-next-line
  }, []);

  const persist = async (tabs, activeRepo) => { await call('app.setSession', { tabs, activeRepo }); await reloadApp(); };

  const openPath = useCallback(async (p) => {
    try {
      const r = await call('repo.open', p);
      const s = await call('app.state');
      const tabs = s.tabs.includes(r.path) ? s.tabs : [...s.tabs, r.path];
      await call('app.setSession', { tabs, activeRepo: r.path });
      await reloadApp();
    } catch (e) { ui.error(e); }
  }, [reloadApp, ui]);

  const pickFolder = useCallback(async (title, hint) => {
    let p = await call('app.pickFolder', { title });
    if (!p && !isElectron) {
      const v = await ui.form({ title, fields: [{ name: 'p', label: 'Ruta de la carpeta', default: hint || '', mono: true, required: true }] });
      p = v && v.p;
    }
    return p;
  }, [ui]);

  const doOpen = useCallback(async () => { const p = await pickFolder('Abrir repositorio'); if (p) openPath(p); }, [pickFolder, openPath]);
  const doInit = useCallback(async () => {
    const p = await pickFolder('Carpeta para inicializar como repositorio');
    if (!p) return;
    const v = await ui.form({ title: 'Inicializar repositorio', message: p, submitText: 'Inicializar', fields: [{ name: 'b', label: 'Rama inicial', default: 'main', mono: true }] });
    if (!v) return;
    try { const r = await call('repo.init', p, { initialBranch: v.b.trim() || 'main' }); await openPath(r.path); ui.success('Repositorio inicializado'); } catch (e) { ui.error(e); }
  }, [pickFolder, ui, openPath]);

  const closeTab = useCallback(async (p) => {
    const s = await call('app.state');
    const tabs = s.tabs.filter((t) => t !== p);
    const active = s.activeRepo === p ? (tabs[tabs.length - 1] || null) : s.activeRepo;
    call('repo.unwatch', p).catch(() => {});
    await persist(tabs, active);
    // eslint-disable-next-line
  }, []);

  useEffect(() => onMenu((a) => {
    if (a === 'open-repo') doOpen();
    else if (a === 'clone') setModal({ name: 'clone' });
    else if (a === 'init') doInit();
    else if (a === 'profiles') setModal({ name: 'profiles' });
    else if (a === 'close-tab') { if (app && app.activeRepo) closeTab(app.activeRepo); }
    else setMenuAction({ name: a, ts: Date.now() });
  }), [app, doOpen, doInit, closeTab]);

  if (!app) return <div className="welcome"><div className="muted">Iniciando…</div></div>;
  const active = app.activeRepo;
  const repoInfo = (p) => app.repos.find((r) => r.path === p);
  const openProfiles = (id) => setModal({ name: 'profiles', id });

  return (
    <div className="app">
      <div className={`tabbar ${isElectron ? '' : 'web'}`}>
        {app.tabs.map((p) => {
          const r = repoInfo(p);
          const prof = r && r.profileId ? app.profiles.find((x) => x.id === r.profileId) : null;
          return (
            <div key={p} className={`tab ${p === active ? 'active' : ''}`} onClick={() => persist(app.tabs, p)} title={p}>
              <span className="dot" style={{ background: prof ? prof.color : 'var(--faint)' }} />
              <span className="ellipsis">{(r && r.name) || p.split('/').pop()}</span>
              <span className="x" onClick={(e) => { e.stopPropagation(); closeTab(p); }}>✕</span>
            </div>
          );
        })}
        <button className="btn ghost sm tab-add" onClick={doOpen} title="Abrir repositorio (⌘O)">＋</button>
        <span className="spacer" />
        <button className="btn ghost sm tab-add" onClick={() => setModal({ name: 'clone' })}>Clonar</button>
        <button className="btn ghost sm tab-add" onClick={() => openProfiles()}>👤 Perfiles</button>
        <button className="btn ghost sm tab-add" onClick={() => setModal({ name: 'settings' })}>⚙</button>
      </div>

      {active ? (
        <RepoView key={active} path={active} app={app} reloadApp={reloadApp} logs={logs} menuAction={menuAction} openProfiles={openProfiles} />
      ) : (
        <Welcome app={app} onOpen={doOpen} onClone={() => setModal({ name: 'clone' })} onInit={doInit} onOpenRecent={openPath} onProfiles={openProfiles} />
      )}

      {modal && modal.name === 'profiles' && <ProfilesModal profiles={app.profiles} repos={app.repos} globalIdentity={app.globalIdentity} initialId={modal.id} onClose={() => setModal(null)} onChanged={reloadApp} />}
      {modal && modal.name === 'settings' && <SettingsModal app={app} onClose={() => setModal(null)} onChanged={reloadApp} />}
      {modal && modal.name === 'clone' && <CloneModal profiles={app.profiles} home={app.home} onClose={() => setModal(null)} onDone={(p) => { setModal(null); openPath(p); }} />}
    </div>
  );
}

export default function App() {
  return <UIProvider><Shell /></UIProvider>;
}
