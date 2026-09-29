import React, { useEffect, useState } from 'react';
import { call } from '../api.js';
import { Modal, Field, useUI } from './ui.jsx';
import { copyText } from '../lib/util.js';

const COLORS = ['#6c8cff', '#4ec98a', '#f0925a', '#b48cf5', '#e7b84d', '#4dc3d9', '#f2686b', '#d97ab8'];
const EMPTY = { label: '', name: '', email: '', sshKey: '', host: 'github.com', tokenUser: '', token: '', color: COLORS[0] };

export default function ProfilesModal({ profiles, repos, globalIdentity, onClose, onChanged, initialId }) {
  const ui = useUI();
  const [selId, setSelId] = useState(initialId || (profiles[0] && profiles[0].id) || null);
  const [form, setForm] = useState(() => (profiles.find((p) => p.id === selId) ? { ...EMPTY, ...profiles.find((p) => p.id === selId), token: '' } : { ...EMPTY }));
  const [keys, setKeys] = useState([]);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [clearToken, setClearToken] = useState(false);

  useEffect(() => { call('profile.sshKeys').then(setKeys).catch(() => {}); }, []);

  const select = (p) => {
    setSelId(p ? p.id : null);
    setForm(p ? { ...EMPTY, ...p, token: '' } : { ...EMPTY });
    setTest(null); setClearToken(false);
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const sel = profiles.find((p) => p.id === selId);
  const assigned = sel ? repos.filter((r) => r.profileId === sel.id) : [];

  const save = async () => {
    if (!form.label.trim()) return ui.error('Ponle un nombre al perfil (ej. "Trabajo").');
    try {
      const saved = await call('profile.save', { ...form, id: selId, clearToken });
      await onChanged();
      setSelId(saved.id);
      setForm({ ...EMPTY, ...saved, token: '' });
      setClearToken(false);
      ui.success('Perfil guardado');
    } catch (e) { ui.error(e); }
  };

  const remove = async () => {
    if (!(await ui.confirm({ title: 'Eliminar perfil', message: `¿Eliminar "${sel.label}"? Los repos asignados quedarán sin perfil (la config local de git no se toca).`, confirmText: 'Eliminar', danger: true }))) return;
    await call('profile.delete', sel.id);
    await onChanged();
    select(null);
  };

  const testSsh = async () => {
    setTesting(true); setTest(null);
    try { setTest(await call('profile.testSsh', { sshKey: form.sshKey, host: form.host })); } catch (e) { setTest({ ok: false, output: e.message }); }
    setTesting(false);
  };

  const genKey = async () => {
    try {
      const k = await call('profile.generateKey', { label: form.label || 'cuenta', email: form.email });
      set('sshKey', k.path);
      setKeys(await call('profile.sshKeys'));
      copyText(k.publicKey);
      ui.toast('Llave creada. La llave pública se copió al portapapeles: pégala en GitHub/GitLab/Azure DevOps → SSH keys.', 'success', 9000);
    } catch (e) { ui.error(e); }
  };

  const copyPub = async () => {
    try { copyText(await call('profile.publicKey', form.sshKey)); ui.toast('Llave pública copiada'); } catch (e) { ui.error(e); }
  };

  const setGlobal = async () => {
    if (!sel) return;
    if (!(await ui.confirm({ title: 'Cambiar identidad global', message: `Esto cambiará user.name y user.email de tu git global a:\n${sel.name} <${sel.email}>\n\nAfecta a todos los repos que no tengan identidad local.`, confirmText: 'Cambiar global' }))) return;
    try { await call('profile.setGlobal', sel.id); await onChanged(); ui.success('Identidad global actualizada'); } catch (e) { ui.error(e); }
  };

  return (
    <Modal title="Perfiles de cuenta Git" size="wide" onClose={onClose}
      footer={<>
        <span className="muted grow" style={{ fontSize: 12 }}>Git global actual: <b>{globalIdentity.name || '—'}</b> &lt;{globalIdentity.email || '—'}&gt;</span>
        <button className="btn" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="split2" style={{ minHeight: 480 }}>
        <div className="list">
          {profiles.map((p) => (
            <div key={p.id} className={`list-item ${p.id === selId ? 'selected' : ''}`} onClick={() => select(p)}>
              <span className="avatar" style={{ background: p.color }}>{(p.label || '?')[0].toUpperCase()}</span>
              <div className="grow ellipsis"><div>{p.label}</div><div className="faint" style={{ fontSize: 11 }}>{p.email}</div></div>
            </div>
          ))}
          <div className="list-item" onClick={() => select(null)} style={{ color: 'var(--accent)' }}>＋ Nuevo perfil</div>
        </div>
        <div className="detail">
          <div className="col" style={{ gap: 12 }}>
            <div className="row">
              <Field label="Nombre del perfil"><input className="input" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Trabajo, Personal, Cliente X…" /></Field>
              <Field label="Color"><div className="row" style={{ gap: 5, height: 32 }}>{COLORS.map((c) => <span key={c} className={`swatch ${form.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} />)}</div></Field>
            </div>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow"><Field label="Nombre (user.name)"><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field></div>
              <div className="grow"><Field label="Correo (user.email)"><input className="input" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field></div>
            </div>
            <Field label="Llave SSH (para remotos git@…)" hint="Se usa solo en los comandos de red de los repos con este perfil (IdentitiesOnly), sin tocar ~/.ssh/config.">
              <div className="row">
                <select className="select" value={form.sshKey} onChange={(e) => set('sshKey', e.target.value)}>
                  <option value="">(ninguna)</option>
                  {keys.map((k) => <option key={k.path} value={k.path}>{k.name}</option>)}
                  {form.sshKey && !keys.find((k) => k.path === form.sshKey) && <option value={form.sshKey}>{form.sshKey}</option>}
                </select>
                <button className="btn" onClick={async () => { const p = await call('app.pickFile', { title: 'Llave privada', defaultPath: '~/.ssh' }); if (p) set('sshKey', p); }}>Examinar</button>
                <button className="btn" onClick={genKey} title="Crea una llave ed25519 nueva en ~/.ssh">Generar</button>
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <input className="input" style={{ width: 170 }} value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="github.com" title="Host para probar" />
                <button className="btn" disabled={testing} onClick={testSsh}>{testing ? 'Probando…' : 'Probar SSH'}</button>
                <button className="btn" disabled={!form.sshKey} onClick={copyPub}>Copiar llave pública</button>
              </div>
              {test && <div className="pre-out" style={{ marginTop: 6, borderColor: test.ok ? 'var(--green)' : 'var(--border)' }}>{test.ok ? '✔ ' : ''}{test.output || '(sin salida)'}</div>}
            </Field>
            <Field label="Token de acceso (HTTPS)" hint={sel && sel.hasToken && !clearToken ? 'Hay un token guardado (cifrado con el Keychain de macOS). Escribe uno nuevo para reemplazarlo.' : 'PAT de GitHub / GitLab / Azure DevOps. Se guarda cifrado con el Keychain.'}>
              <div className="row">
                <input className="input" style={{ width: 170 }} value={form.tokenUser} onChange={(e) => set('tokenUser', e.target.value)} placeholder="usuario" />
                <input className="input" type="password" value={form.token} onChange={(e) => set('token', e.target.value)} placeholder={sel && sel.hasToken && !clearToken ? '••••••••  (guardado)' : 'ghp_…'} autoComplete="off" />
                {sel && sel.hasToken && <label className="check" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={clearToken} onChange={(e) => setClearToken(e.target.checked)} /> quitar</label>}
              </div>
            </Field>
            {sel && (
              <div className="muted" style={{ fontSize: 12 }}>
                Repos con este perfil: {assigned.length ? assigned.map((r) => r.name).join(', ') : 'ninguno'}
              </div>
            )}
            <div className="row">
              <button className="btn primary" onClick={save}>{sel ? 'Guardar cambios' : 'Crear perfil'}</button>
              {sel && <button className="btn" onClick={setGlobal} title="Cambia user.name/email de git --global">Usar como identidad global</button>}
              <span className="spacer" />
              {sel && <button className="btn danger" onClick={remove}>Eliminar</button>}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
