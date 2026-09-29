import React, { useEffect, useState } from 'react';
import { call, onEvent } from '../api.js';
import { Modal, Field, useUI } from './ui.jsx';

export function SettingsModal({ app, onClose, onChanged }) {
  const ui = useUI();
  const [gitPath, setGitPath] = useState(app.settings.gitPath || 'git');
  const [pullMode, setPullMode] = useState(app.settings.pullMode || 'merge');
  const save = async () => {
    await call('app.setSettings', { gitPath: gitPath.trim() || 'git', pullMode });
    await onChanged();
    ui.success('Ajustes guardados');
    onClose();
  };
  return (
    <Modal title="Ajustes" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save}>Guardar</button></>}>
      <div className="modal-body">
        <Field label="Ruta del ejecutable git" hint={`Detectado: ${app.gitVersion}`}><input className="input mono" value={gitPath} onChange={(e) => setGitPath(e.target.value)} /></Field>
        <Field label="Modo de Pull por defecto">
          <select className="select" value={pullMode} onChange={(e) => setPullMode(e.target.value)}>
            <option value="merge">Merge (git pull --no-rebase)</option>
            <option value="rebase">Rebase (git pull --rebase)</option>
            <option value="ff-only">Solo fast-forward (git pull --ff-only)</option>
          </select>
        </Field>
        <Field label="Identidad global de git"><div className="muted">{app.globalIdentity.name || '—'} &lt;{app.globalIdentity.email || '—'}&gt; — cámbiala desde “Perfiles”.</div></Field>
      </div>
    </Modal>
  );
}

export function RemotesModal({ repo, remotes, onClose, onChanged }) {
  const ui = useUI();
  const [test, setTest] = useState(null);
  const add = async () => {
    const v = await ui.form({ title: 'Añadir remoto', submitText: 'Añadir', fields: [
      { name: 'name', label: 'Nombre', default: remotes.length ? '' : 'origin', required: true },
      { name: 'url', label: 'URL', placeholder: 'git@github.com:usuario/repo.git', required: true, mono: true }] });
    if (!v) return;
    try { await call('git.addRemote', repo, v.name.trim(), v.url.trim()); await onChanged(); } catch (e) { ui.error(e); }
  };
  const edit = async (r) => {
    const v = await ui.form({ title: `Editar remoto "${r.name}"`, submitText: 'Guardar', fields: [
      { name: 'name', label: 'Nombre', default: r.name, required: true },
      { name: 'url', label: 'URL', default: r.fetchUrl, required: true, mono: true }] });
    if (!v) return;
    try {
      if (v.url !== r.fetchUrl) await call('git.setRemoteUrl', repo, r.name, v.url.trim());
      if (v.name !== r.name) await call('git.renameRemote', repo, r.name, v.name.trim());
      await onChanged();
    } catch (e) { ui.error(e); }
  };
  const del = async (r) => {
    if (!(await ui.confirm({ title: 'Eliminar remoto', message: `¿Eliminar el remoto "${r.name}"? También se eliminan sus ramas de seguimiento locales.`, confirmText: 'Eliminar', danger: true }))) return;
    try { await call('git.removeRemote', repo, r.name); await onChanged(); } catch (e) { ui.error(e); }
  };
  const doTest = async () => { setTest('Probando…'); try { const r = await call('repo.testAuth', repo); setTest((r.ok ? '✔ ' : '✘ ') + r.output); } catch (e) { setTest('✘ ' + e.message); } };
  return (
    <Modal title="Remotos" size="wide" onClose={onClose} footer={<><button className="btn" onClick={doTest}>Probar conexión</button><span className="spacer" /><button className="btn primary" onClick={add}>＋ Añadir remoto</button><button className="btn" onClick={onClose}>Cerrar</button></>}>
      <div className="modal-body">
        {!remotes.length && <div className="empty-state">Este repositorio no tiene remotos.</div>}
        {remotes.map((r) => (
          <div key={r.name} className="row" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
            <b style={{ width: 90 }}>{r.name}</b>
            <span className="mono grow ellipsis selectable" title={r.fetchUrl}>{r.fetchUrl}</span>
            <button className="btn sm" onClick={() => edit(r)}>Editar</button>
            <button className="btn sm danger" onClick={() => del(r)}>Eliminar</button>
          </div>
        ))}
        {test && <div className="pre-out">{test}</div>}
      </div>
    </Modal>
  );
}

export function CloneModal({ profiles, home, onClose, onDone }) {
  const ui = useUI();
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState(`${home}/Documents/Git`);
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState('');
  const [branch, setBranch] = useState('');
  const [recurse, setRecurse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState([]);
  const opId = useState(() => 'clone-' + Date.now())[0];

  useEffect(() => {
    const off = onEvent((n, p) => { if (n === 'progress' && p.opId === opId) setLines((l) => [...l.slice(-30), p.line]); });
    return () => off();
  }, [opId]);

  const onUrl = (v) => {
    setUrl(v);
    const m = v.trim().replace(/\/+$/, '').match(/([^/:]+?)(?:\.git)?$/);
    if (m && (!name || name === (url.trim().replace(/\/+$/, '').match(/([^/:]+?)(?:\.git)?$/) || [])[1])) setName(m[1]);
  };
  const go = async () => {
    if (!url.trim() || !name.trim()) return ui.error('Indica la URL y el nombre de la carpeta.');
    setBusy(true); setLines([]);
    try {
      const r = await call('repo.clone', { url: url.trim(), dest: `${parent.replace(/\/$/, '')}/${name.trim()}`, profileId: profileId || null, branch: branch.trim() || undefined, recurse, opId });
      ui.success('Repositorio clonado');
      onDone(r.path);
    } catch (e) { ui.error(e); setBusy(false); }
  };
  return (
    <Modal title="Clonar repositorio" onClose={busy ? undefined : onClose} footer={<><button className="btn" disabled={busy} onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Clonando…' : 'Clonar'}</button></>}>
      <div className="modal-body">
        <Field label="URL del repositorio"><input className="input mono" value={url} onChange={(e) => onUrl(e.target.value)} placeholder="git@github.com:usuario/repo.git  o  https://…" autoFocus /></Field>
        <Field label="Cuenta a usar" hint="Se usan su llave SSH / token para clonar y se asigna al repo (identidad local).">
          <select className="select" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">(sin perfil — credenciales del sistema)</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.email}</option>)}
          </select>
        </Field>
        <Field label="Carpeta contenedora">
          <div className="row"><input className="input mono" value={parent} onChange={(e) => setParent(e.target.value)} />
            <button className="btn" onClick={async () => { const p = await call('app.pickFolder', { title: 'Carpeta contenedora' }); if (p) setParent(p); }}>Examinar…</button></div>
        </Field>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow"><Field label="Nombre de carpeta"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
          <div className="grow"><Field label="Rama (opcional)"><input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="por defecto" /></Field></div>
        </div>
        <label className="check"><input type="checkbox" checked={recurse} onChange={(e) => setRecurse(e.target.checked)} /> Incluir submódulos</label>
        {busy && <div className="pre-out">{lines.join('\n') || 'Conectando…'}</div>}
      </div>
    </Modal>
  );
}
