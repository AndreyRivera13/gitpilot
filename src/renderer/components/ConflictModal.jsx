import React, { useCallback, useEffect, useState } from 'react';
import { call } from '../api.js';
import { Modal, useUI } from './ui.jsx';
import { baseName, dirName } from '../lib/util.js';

function compose(segments, choices) {
  let ci = 0;
  return segments.map((s) => {
    if (s.type === 'text') return s.text;
    const c = choices[ci++];
    if (c === 'ours') return s.ours;
    if (c === 'theirs') return s.theirs;
    if (c === 'both') return [s.ours, s.theirs].filter((x) => x !== '').join('\n');
    if (c === 'both-rev') return [s.theirs, s.ours].filter((x) => x !== '').join('\n');
    return null;
  }).join('\n');
}

export default function ConflictModal({ repo, status, onClose, onResolved, onContinue, onAbort }) {
  const ui = useUI();
  const [sel, setSel] = useState(status.conflicts[0] ? status.conflicts[0].path : null);
  const [data, setData] = useState(null);
  const [choices, setChoices] = useState([]);
  const [manual, setManual] = useState(null); // texto libre si el usuario edita a mano
  const files = status.conflicts;

  const load = useCallback(async (path) => {
    if (!path) { setData(null); return; }
    setData(null); setManual(null);
    try {
      const d = await call('git.conflictFile', repo, path);
      setData(d);
      setChoices(d.segments.filter((s) => s.type === 'conflict').map(() => null));
    } catch (e) { ui.error(e); }
  }, [repo, ui]);

  useEffect(() => { load(sel); }, [sel, load]);
  useEffect(() => { if (!files.find((f) => f.path === sel)) setSel(files[0] ? files[0].path : null); }, [files, sel]);

  const pick = (i, v) => setChoices((c) => c.map((x, k) => (k === i ? v : x)));
  const allChosen = data && choices.every(Boolean);
  const final = data ? (manual != null ? manual : (allChosen ? compose(data.segments, choices) : null)) : null;
  const setAll = (v) => setChoices((c) => c.map(() => v));

  const markResolved = async () => {
    try {
      await call('git.markResolved', repo, sel, final);
      ui.success(`${baseName(sel)} marcado como resuelto`);
      await onResolved();
    } catch (e) { ui.error(e); }
  };
  const wholeFile = async (side) => {
    try { await call('git.resolveWith', repo, sel, side); ui.success(`${baseName(sel)}: se usó ${side === 'ours' ? 'tu versión' : 'la versión entrante'}`); await onResolved(); } catch (e) { ui.error(e); }
  };
  const deletedOrBinary = data && data.segments.filter((s) => s.type === 'conflict').length === 0;

  return (
    <Modal title={`Resolver conflictos (${files.length})`} size="xl" onClose={onClose}
      footer={<>
        <button className="btn danger" onClick={onAbort}>Abortar operación</button>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cerrar</button>
        <button className="btn primary" disabled={files.length > 0} onClick={onContinue} title={files.length ? 'Resuelve todos los archivos primero' : ''}>Continuar / completar</button>
      </>}>
      <div className="split2">
        <div className="list">
          {files.map((f) => (
            <div key={f.path} className={`list-item ${f.path === sel ? 'selected' : ''}`} onClick={() => setSel(f.path)}>
              <span className="st st-c">!</span>
              <div className="grow ellipsis"><div>{baseName(f.path)}</div><div className="faint" style={{ fontSize: 11 }}>{dirName(f.path)} {f.kind}</div></div>
            </div>
          ))}
          {!files.length && <div className="empty-state">✔ Todos los conflictos están resueltos. Pulsa “Continuar”.</div>}
        </div>
        <div className="detail">
          {!sel && <div className="empty-state">Sin conflictos.</div>}
          {sel && !data && <div className="empty-state">Cargando…</div>}
          {sel && data && (
            <>
              <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                <b className="grow ellipsis">{sel}</b>
                <span className="muted">Todo el archivo:</span>
                <button className="btn sm" onClick={() => wholeFile('ours')}>Usar mío</button>
                <button className="btn sm" onClick={() => wholeFile('theirs')}>Usar entrante</button>
              </div>
              {deletedOrBinary && (
                <div className="banner info">Este conflicto no tiene marcadores de texto (archivo eliminado, binario o renombrado). Elige “Usar mío” o “Usar entrante”, o resuélvelo en tu editor y usa “Marcar resuelto”.
                  <div><button className="btn sm" onClick={async () => { try { await call('git.markResolved', repo, sel, null); await onResolved(); } catch (e) { ui.error(e); } }}>Marcar resuelto (tal como está)</button></div></div>
              )}
              {!deletedOrBinary && (
                <>
                  <div className="row" style={{ marginBottom: 10 }}>
                    <span className="muted">Todos los bloques:</span>
                    <button className="btn sm" onClick={() => { setManual(null); setAll('ours'); }}>Míos</button>
                    <button className="btn sm" onClick={() => { setManual(null); setAll('theirs'); }}>Entrantes</button>
                    <button className="btn sm" onClick={() => { setManual(null); setAll('both'); }}>Ambos</button>
                    <span className="spacer" />
                    <button className="btn sm" onClick={() => setManual(manual != null ? null : (final != null ? final : compose(data.segments, choices.map((c) => c || 'ours'))))}>
                      {manual != null ? 'Volver a bloques' : 'Editar a mano'}
                    </button>
                  </div>
                  {manual != null ? (
                    <textarea className="textarea mono" style={{ minHeight: 360, whiteSpace: 'pre' }} value={manual} onChange={(e) => setManual(e.target.value)} />
                  ) : (() => {
                    let ci = -1;
                    return data.segments.map((s, k) => {
                      if (s.type === 'text') return s.text.trim() ? <div key={k} className="conf-ctx">{s.text.split('\n').slice(-3).join('\n')}</div> : null;
                      const i = ++ci;
                      return (
                        <div key={k} className="conf-block">
                          <div className="bar">
                            <b>Conflicto {i + 1}</b>
                            <span className="spacer" />
                            <button className={`btn sm ${choices[i] === 'ours' ? 'primary' : ''}`} onClick={() => pick(i, 'ours')}>Mío</button>
                            <button className={`btn sm ${choices[i] === 'theirs' ? 'primary' : ''}`} onClick={() => pick(i, 'theirs')}>Entrante</button>
                            <button className={`btn sm ${choices[i] === 'both' ? 'primary' : ''}`} onClick={() => pick(i, 'both')}>Ambos</button>
                            <button className={`btn sm ${choices[i] === 'both-rev' ? 'primary' : ''}`} onClick={() => pick(i, 'both-rev')} title="Entrante primero, luego mío">Ambos ↺</button>
                          </div>
                          <div className="conf-cols">
                            <div className={`conf-col ours ${['ours', 'both', 'both-rev'].includes(choices[i]) ? 'chosen' : ''}`}><div className="faint" style={{ marginBottom: 4 }}>Mío · {s.oursLabel}</div>{s.ours || <i className="faint">(vacío)</i>}</div>
                            <div className={`conf-col theirs ${['theirs', 'both', 'both-rev'].includes(choices[i]) ? 'chosen' : ''}`}><div className="faint" style={{ marginBottom: 4 }}>Entrante · {s.theirsLabel}</div>{s.theirs || <i className="faint">(vacío)</i>}</div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn primary" disabled={final == null} onClick={markResolved}>Guardar y marcar resuelto</button>
                    {final == null && <span className="muted">Elige una opción en cada bloque para continuar.</span>}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
