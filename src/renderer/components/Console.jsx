import React, { useEffect, useRef, useState } from 'react';
import { call } from '../api.js';

export default function Console({ repo, logs, onClose, onAfterCommand }) {
  const [tab, setTab] = useState('console');
  const [lines, setLines] = useState([{ k: 'sys', t: 'Consola Git. Escribe un comando (con o sin "git"), por ejemplo: git log --oneline -5' }]);
  const [input, setInput] = useState('');
  const [hist, setHist] = useState([]);
  const [hi, setHi] = useState(-1);
  const [running, setRunning] = useState(false);
  const outRef = useRef(null);

  useEffect(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight; }, [lines, logs, tab]);

  const run = async () => {
    const cmd = input.trim();
    if (!cmd || running) return;
    setInput(''); setHist((h) => [cmd, ...h]); setHi(-1);
    setLines((l) => [...l, { k: 'cmd', t: '$ ' + cmd }]);
    setRunning(true);
    try {
      const r = await call('git.rawCommand', repo, cmd);
      const text = (r.stdout || '') + (r.stderr || '');
      setLines((l) => [...l, { k: r.code === 0 ? 'out' : 'err', t: text.trimEnd() || (r.code === 0 ? '(sin salida)' : `(código ${r.code})`) }]);
    } catch (e) { setLines((l) => [...l, { k: 'err', t: e.message }]); }
    setRunning(false);
    onAfterCommand();
  };

  const onKey = (e) => {
    if (e.key === 'Enter') run();
    else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(hist.length - 1, hi + 1); if (hist[n] != null) { setHi(n); setInput(hist[n]); } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const n = hi - 1; setHi(n); setInput(n >= 0 ? hist[n] : ''); }
  };

  const mine = logs.filter((l) => !l.cwd || l.cwd === repo);

  return (
    <div className="console">
      <div className="console-tabs">
        <button className={`console-tab ${tab === 'console' ? 'active' : ''}`} onClick={() => setTab('console')}>Consola</button>
        <button className={`console-tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>Registro de operaciones ({mine.length})</button>
        <span className="spacer" />
        {tab === 'log' && <button className="btn sm ghost" onClick={() => call('app.clearOpLog')}>Limpiar</button>}
        <button className="icon-btn" onClick={onClose} title="Cerrar">✕</button>
      </div>
      <div className="console-out" ref={outRef}>
        {tab === 'console' ? lines.map((l, i) => <div key={i} className={l.k === 'cmd' ? 'cmd' : l.k === 'err' ? 'err' : l.k === 'sys' ? 'faint' : ''}>{l.t}</div>)
          : mine.map((l, i) => (
            <div key={i} className="log-row">
              <span className="t">{new Date(l.time).toLocaleTimeString()}</span>
              <span className={l.code === 0 ? 'okc' : 'err'}>{l.code === 0 ? '✔' : '✘'}</span>
              <span className="grow">{l.cmd}{l.error ? <div className="err" style={{ whiteSpace: 'pre-wrap' }}>{l.error}</div> : null}</span>
              <span className="ms">{l.ms} ms</span>
            </div>
          ))}
      </div>
      {tab === 'console' && (
        <div className="console-in"><span className="muted">$</span>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} placeholder={running ? 'ejecutando…' : 'git status'} autoFocus spellCheck={false} />
        </div>
      )}
    </div>
  );
}
