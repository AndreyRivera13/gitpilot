import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../api.js';

const UICtx = createContext(null);
export const useUI = () => useContext(UICtx);

/* ------------------------------- Modal ------------------------------- */
export function Modal({ title, children, footer, onClose, size = '', className = '' }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={`modal ${size} ${className}`} role="dialog">
        <div className="modal-head">
          <span className="grow ellipsis">{title}</span>
          {onClose && <button className="icon-btn" onClick={onClose} title="Cerrar (Esc)">✕</button>}
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label className="lab">{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/* ---------------------------- Formulario ---------------------------- */
function FormDialog({ spec, onDone }) {
  const [vals, setVals] = useState(() => Object.fromEntries(spec.fields.map((f) => [f.name, f.default ?? (f.type === 'checkbox' ? false : '')])));
  const [err, setErr] = useState('');
  const firstRef = useRef(null);
  useEffect(() => { firstRef.current && firstRef.current.focus(); firstRef.current && firstRef.current.select && firstRef.current.select(); }, []);
  const set = (n, v) => setVals((s) => ({ ...s, [n]: v }));
  const submit = () => {
    for (const f of spec.fields) {
      if (f.required && !String(vals[f.name] ?? '').trim()) { setErr(`Falta: ${f.label}`); return; }
    }
    onDone(vals);
  };
  const browse = async (f) => {
    const p = await call(f.pick === 'file' ? 'app.pickFile' : 'app.pickFolder', { title: f.label });
    if (p) set(f.name, p);
  };
  return (
    <Modal title={spec.title} onClose={() => onDone(null)} size={spec.size}
      footer={<>
        <button className="btn" onClick={() => onDone(null)}>Cancelar</button>
        <button className={`btn ${spec.danger ? 'danger solid' : 'primary'}`} onClick={submit}>{spec.submitText || 'Aceptar'}</button>
      </>}>
      <div className="modal-body" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); submit(); } }}>
        {spec.message && <div className="muted selectable" style={{ whiteSpace: 'pre-wrap' }}>{spec.message}</div>}
        {spec.fields.map((f, i) => (
          <Field key={f.name} label={f.type === 'checkbox' ? null : f.label} hint={f.hint}>
            {f.type === 'checkbox' ? (
              <label className="check"><input type="checkbox" checked={!!vals[f.name]} onChange={(e) => set(f.name, e.target.checked)} /> {f.label}</label>
            ) : f.type === 'select' ? (
              <select className="select" value={vals[f.name]} onChange={(e) => set(f.name, e.target.value)} ref={i === 0 ? firstRef : null}>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea className="textarea" value={vals[f.name]} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} ref={i === 0 ? firstRef : null} />
            ) : f.type === 'path' ? (
              <div className="row">
                <input className="input mono" value={vals[f.name]} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} ref={i === 0 ? firstRef : null} />
                <button className="btn" onClick={() => browse(f)}>Examinar…</button>
              </div>
            ) : (
              <input className={`input ${f.mono ? 'mono' : ''}`} type={f.type === 'password' ? 'password' : 'text'} value={vals[f.name]}
                onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} ref={i === 0 ? firstRef : null} />
            )}
          </Field>
        ))}
        {err && <div style={{ color: 'var(--red)' }}>{err}</div>}
      </div>
    </Modal>
  );
}

/* ------------------------------ Menú ------------------------------- */
function Menu({ menu, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(6, Math.min(menu.x, window.innerWidth - r.width - 8)),
      y: Math.max(6, Math.min(menu.y, window.innerHeight - r.height - 8)),
    });
  }, [menu]);
  useEffect(() => {
    const close = () => onClose();
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('wheel', close, { passive: true });
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', esc); window.removeEventListener('wheel', close); };
  }, [onClose]);
  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.filter(Boolean).map((it, i) => it.sep ? <div key={i} className="menu-sep" />
        : it.title ? <div key={i} className="menu-title">{it.title}</div>
        : (
          <div key={i} className={`menu-item ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}`}
            onClick={() => { if (it.disabled) return; onClose(); it.onClick && it.onClick(); }}>
            {it.icon && <span style={{ width: 16, textAlign: 'center' }}>{it.icon}</span>}
            <span>{it.label}</span>{it.hint && <span className="hint">{it.hint}</span>}
          </div>
        ))}
    </div>
  );
}

/* ----------------------------- Provider ---------------------------- */
export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [menu, setMenu] = useState(null);
  const idRef = useRef(1);

  const toast = useCallback((msg, kind = 'info', ms) => {
    const id = idRef.current++;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms || (kind === 'error' ? 9000 : 3800));
  }, []);

  const ui = useMemo(() => ({
    toast,
    success: (m) => toast(m, 'success'),
    warn: (m) => toast(m, 'warn', 6000),
    error: (e) => toast(typeof e === 'string' ? e : (e && e.message) || 'Error', 'error'),
    form: (spec) => new Promise((resolve) => setDialog({ spec, resolve })),
    confirm: (spec) => new Promise((resolve) => setDialog({
      spec: { ...spec, fields: [], title: spec.title || 'Confirmar', submitText: spec.confirmText || 'Aceptar' },
      resolve: (v) => resolve(!!v),
    })),
    menu: (e, items) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    menuAt: (el, items) => {
      const r = el.getBoundingClientRect();
      setMenu({ x: r.left, y: r.bottom + 2, items });
    },
  }), [toast]);

  return (
    <UICtx.Provider value={ui}>
      {children}
      {dialog && <FormDialog spec={dialog.spec} onDone={(v) => { const r = dialog.resolve; setDialog(null); r(v); }} />}
      {menu && <Menu menu={menu} onClose={() => setMenu(null)} />}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </UICtx.Provider>
  );
}
