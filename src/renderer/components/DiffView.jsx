import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import { STATUS, baseName } from '../lib/util.js';

const MAX_LINES = 4000;

function pairLines(lines) {
  // Convierte líneas unificadas en filas para vista dividida
  const rows = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.t === ' ') { rows.push({ l: { ...l, idx: i }, r: { ...l, idx: i } }); i++; continue; }
    if (l.t === '\\') { i++; continue; }
    const dels = [];
    const adds = [];
    while (i < lines.length && lines[i].t === '-') dels.push({ ...lines[i], idx: i++ });
    while (i < lines.length && lines[i].t === '+') adds.push({ ...lines[i], idx: i++ });
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ l: dels[k] || null, r: adds[k] || null });
    if (!dels.length && !adds.length) i++;
  }
  return rows;
}

export default function DiffView({ repo, target, settings, onSettings, onClose, onChanged, ui, onBlame, onHistory }) {
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState({}); // "h:l" -> true
  const [mode, setMode] = useState(() => settings.diffMode || 'unified');
  const [showAll, setShowAll] = useState(false);
  const [tick, setTick] = useState(0);

  const key = JSON.stringify(target) + settings.diffContext + settings.ignoreWhitespace + tick + (target.rev || '');

  useEffect(() => {
    let dead = false;
    setFiles(null); setErr(''); setPicked({}); setShowAll(false);
    const opts = { file: target.file, context: settings.diffContext, ignoreWhitespace: settings.ignoreWhitespace };
    if (target.kind === 'wip') { opts.staged = target.staged; opts.untracked = target.untracked; }
    else if (target.kind === 'commit') opts.sha = target.sha;
    call('git.getDiff', repo, opts).then((r) => { if (!dead) setFiles(r); }).catch((e) => { if (!dead) setErr(e.message); });
    return () => { dead = true; };
    // eslint-disable-next-line
  }, [repo, key]);

  const isWip = target.kind === 'wip' && !target.untracked;
  const file = files && files[0];

  const apply = useCallback(async (hunk, lines, m) => {
    try {
      await call('git.applyHunk', repo, { file: target.file, hunk, lines, mode: m });
      setPicked({});
      setTick((t) => t + 1);
      onChanged && onChanged();
    } catch (e) { ui.error(e); }
  }, [repo, target.file, onChanged, ui]);

  const pickedIn = (h) => Object.keys(picked).filter((k) => picked[k] && k.startsWith(h + ':')).map((k) => +k.split(':')[1]);
  const togglePick = (h, l) => setPicked((p) => ({ ...p, [`${h}:${l}`]: !p[`${h}:${l}`] }));
  const setMode2 = (m) => { setMode(m); onSettings({ diffMode: m }); };

  let budget = MAX_LINES;

  return (
    <div className="graph-wrap">
      <div className="diff-head">
        <button className="btn sm" onClick={onClose}>← Volver</button>
        <span className={`st ${STATUS[file ? file.status : 'M']?.cls || 'st-m'}`}>{file ? file.status : 'M'}</span>
        <b className="ellipsis" title={target.file}>{target.file}</b>
        {file && <span className="mono" style={{ fontSize: 12 }}><span className="add">+{file.additions}</span> <span className="del">−{file.deletions}</span></span>}
        {target.kind === 'wip' && <span className="tag">{target.untracked ? 'sin seguimiento' : target.staged ? 'preparado' : 'sin preparar'}</span>}
        <span className="spacer" />
        <label className="check muted" title="Ignorar cambios de espacios en blanco"><input type="checkbox" checked={!!settings.ignoreWhitespace} onChange={(e) => onSettings({ ignoreWhitespace: e.target.checked })} /> ignorar espacios</label>
        <select className="select" style={{ width: 92 }} value={settings.diffContext} onChange={(e) => onSettings({ diffContext: +e.target.value })} title="Líneas de contexto">
          {[0, 1, 3, 5, 10, 25].map((n) => <option key={n} value={n}>±{n} líneas</option>)}
        </select>
        <div className="row" style={{ gap: 0 }}>
          <button className={`btn sm ${mode === 'unified' ? 'primary' : ''}`} onClick={() => setMode2('unified')}>Unificado</button>
          <button className={`btn sm ${mode === 'split' ? 'primary' : ''}`} onClick={() => setMode2('split')}>Dividido</button>
        </div>
        {target.file && target.kind !== 'wip' || (target.file && !target.untracked) ? (
          <>
            <button className="btn sm" onClick={() => onHistory(target.file)}>Historial</button>
            <button className="btn sm" onClick={() => onBlame(target.file, target.kind === 'commit' ? target.sha : null)}>Blame</button>
          </>
        ) : null}
      </div>
      <div className="diff-scroll selectable">
        {err && <div className="diff-empty" style={{ color: 'var(--red)' }}>{err}</div>}
        {!files && !err && <div className="diff-empty">Cargando diff…</div>}
        {files && !file && <div className="diff-empty">No hay diferencias para mostrar.</div>}
        {file && file.binary && <div className="diff-empty">Archivo binario ({baseName(target.file)}). No se puede mostrar el diff.</div>}
        {file && !file.binary && file.hunks.length === 0 && <div className="diff-empty">Sin cambios de contenido (¿solo cambió el modo o el nombre?).</div>}
        {file && !file.binary && file.hunks.map((h, hi) => {
          const sel = pickedIn(hi);
          const lines = h.lines;
          const rowsCount = lines.length;
          if (budget <= 0) return null;
          budget -= rowsCount;
          return (
            <div className="hunk" key={hi}>
              <div className="hunk-head">
                <span>{h.header.replace(/ ?@@$/, '').slice(0, 60)}</span>
                <span className="ellipsis faint">{h.section}</span>
                {isWip && (
                  <div className="acts">
                    {sel.length > 0 && <button className="btn sm primary" onClick={() => apply(hi, sel, target.staged ? 'unstage' : 'stage')}>{target.staged ? 'Quitar' : 'Preparar'} {sel.length} línea{sel.length > 1 ? 's' : ''}</button>}
                    {sel.length > 0 && !target.staged && <button className="btn sm danger" onClick={async () => { if (await ui.confirm({ title: 'Descartar líneas', message: `¿Descartar ${sel.length} línea(s) seleccionadas? No se puede deshacer.`, confirmText: 'Descartar', danger: true })) apply(hi, sel, 'discard'); }}>Descartar líneas</button>}
                    <button className="btn sm" onClick={() => apply(hi, null, target.staged ? 'unstage' : 'stage')}>{target.staged ? 'Quitar hunk' : 'Preparar hunk'}</button>
                    {!target.staged && <button className="btn sm danger" onClick={async () => { if (await ui.confirm({ title: 'Descartar hunk', message: 'Se perderán estos cambios del archivo. No se puede deshacer.', confirmText: 'Descartar', danger: true })) apply(hi, null, 'discard'); }}>Descartar</button>}
                  </div>
                )}
              </div>
              {mode === 'unified' ? lines.map((l, li) => (
                <div key={li} className={`dl ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : l.t === '\\' ? 'meta' : ''} ${picked[`${hi}:${li}`] ? 'picked' : ''}`}>
                  <span className="sel">{isWip && (l.t === '+' || l.t === '-') && <input type="checkbox" checked={!!picked[`${hi}:${li}`]} onChange={() => togglePick(hi, li)} />}</span>
                  <span className="ln">{l.o ?? ''}</span><span className="ln">{l.n ?? ''}</span>
                  <span className="sign">{l.t === ' ' ? '' : l.t === '\\' ? '' : l.t}</span>
                  <span className="code">{l.s}</span>
                </div>
              )) : (
                <div className="split">
                  {['l', 'r'].map((side) => (
                    <div className="half" key={side}>
                      {pairLines(lines).map((row, ri) => {
                        const c = row[side];
                        if (!c) return <div key={ri} className="dl empty"><span className="ln"></span><span className="code"> </span></div>;
                        return (
                          <div key={ri} className={`dl ${c.t === '+' ? 'add' : c.t === '-' ? 'del' : ''} ${picked[`${hi}:${c.idx}`] ? 'picked' : ''}`}>
                            <span className="sel">{isWip && (c.t === '+' || c.t === '-') && <input type="checkbox" checked={!!picked[`${hi}:${c.idx}`]} onChange={() => togglePick(hi, c.idx)} />}</span>
                            <span className="ln">{side === 'l' ? c.o ?? '' : c.n ?? ''}</span>
                            <span className="code">{c.s}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {file && !file.binary && budget <= 0 && <div className="diff-empty">Diff muy grande: se muestran solo las primeras {MAX_LINES} líneas.</div>}
      </div>
    </div>
  );
}
