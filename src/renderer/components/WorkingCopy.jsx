import React, { useEffect, useRef, useState } from 'react';
import { STATUS, baseName, dirName } from '../lib/util.js';
import { call } from '../api.js';

function FileRow({ f, staged, selected, onOpen, onToggle, onDiscard, onMenu }) {
  const st = STATUS[f.status] || STATUS.M;
  return (
    <div className={`file-row ${selected ? 'selected' : ''}`} onClick={onOpen} onContextMenu={onMenu} title={`${f.path}${f.origPath ? '\n← ' + f.origPath : ''}`}>
      <span className={`st ${st.cls}`} title={st.label}>{st.ch}</span>
      <span className="name ellipsis"><span>{baseName(f.path)}</span> <span className="dir">{dirName(f.path)}</span></span>
      <span className="acts">
        {!staged && <button className="icon-btn" title="Descartar cambios" onClick={(e) => { e.stopPropagation(); onDiscard(); }}>↩</button>}
        <button className="icon-btn" title={staged ? 'Quitar de preparados' : 'Preparar'} onClick={(e) => { e.stopPropagation(); onToggle(); }}>{staged ? '−' : '＋'}</button>
      </span>
    </div>
  );
}

export default function WorkingCopy({ repo, status, identity, profile, selected, onOpenFile, actions, onFileMenu, onOpenConflicts, onSwitchProfile }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [amend, setAmend] = useState(false);
  const [pushAfter, setPushAfter] = useState(false);
  const [noVerify, setNoVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const subjRef = useRef(null);
  const state = status.state;
  const nConf = status.conflicts.length;
  const canCommit = (status.staged.length > 0 || amend) && subject.trim() && nConf === 0 && !busy;

  useEffect(() => {
    if (!amend) return;
    call('git.lastCommitMessage', repo).then((m) => {
      const [s, ...rest] = m.split('\n');
      setSubject(s || ''); setBody(rest.join('\n').trim());
    }).catch(() => {});
    // eslint-disable-next-line
  }, [amend]);

  const doCommit = async () => {
    if (!canCommit) return;
    setBusy(true);
    const ok = await actions.commit({ message: subject, body, amend, noVerify, push: pushAfter });
    setBusy(false);
    if (ok) { setSubject(''); setBody(''); setAmend(false); }
  };

  const mergeMsgHint = state === 'merge' ? 'Se usará el mensaje de merge por defecto.' : '';

  return (
    <>
      <div className="pane-title">
        <span>Cambios locales</span>
        <span className="spacer" />
        <span className="muted" style={{ fontWeight: 400 }}>{status.branch.detached ? 'HEAD desasociado' : status.branch.head}</span>
      </div>
      <div className="pane-scroll">
        {state && (
          <div className="banner">
            <b>{{ merge: 'Merge en curso', rebase: 'Rebase en curso', 'cherry-pick': 'Cherry-pick en curso', revert: 'Revert en curso', bisect: 'Bisect en curso' }[state]}</b>
            {nConf > 0
              ? <span>{nConf} archivo{nConf > 1 ? 's' : ''} con conflictos. Resuélvelos y continúa.</span>
              : <span>Sin conflictos pendientes. Puedes continuar.</span>}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {nConf > 0 && <button className="btn primary sm" onClick={onOpenConflicts}>Resolver conflictos</button>}
              <button className="btn sm" disabled={nConf > 0} onClick={actions.opContinue}>{state === 'merge' ? 'Completar merge' : 'Continuar'}</button>
              {(state === 'rebase' || state === 'cherry-pick') && <button className="btn sm" onClick={actions.opSkip}>Omitir</button>}
              <button className="btn sm danger" onClick={actions.opAbort}>Abortar</button>
            </div>
          </div>
        )}

        {nConf > 0 && (
          <>
            <div className="section-title"><span>Conflictos ({nConf})</span></div>
            {status.conflicts.map((c) => (
              <div key={c.path} className="file-row" onClick={onOpenConflicts} title={c.kind}>
                <span className="st st-c">!</span>
                <span className="name ellipsis"><span>{baseName(c.path)}</span> <span className="dir">{dirName(c.path)}</span></span>
                <span className="num faint">{c.kind}</span>
              </div>
            ))}
          </>
        )}

        <div className="section-title">
          <span>Sin preparar ({status.unstaged.length})</span><span className="spacer" />
          {status.unstaged.length > 0 && <>
            <button className="btn sm" onClick={actions.stageAll}>Preparar todo</button>
            <button className="icon-btn" title="Descartar todo" onClick={actions.discardAll}>↩</button>
          </>}
        </div>
        {status.unstaged.map((f) => (
          <FileRow key={'u' + f.path} f={f} staged={false}
            selected={selected && selected.file === f.path && !selected.staged}
            onOpen={() => onOpenFile({ kind: 'wip', file: f.path, staged: false, untracked: !!f.untracked })}
            onToggle={() => actions.stage([f.path])}
            onDiscard={() => actions.discard([{ path: f.path, untracked: !!f.untracked }])}
            onMenu={(e) => onFileMenu(e, f, 'unstaged')} />
        ))}
        {!status.unstaged.length && <div className="flow-empty">No hay cambios sin preparar</div>}

        <div className="section-title">
          <span>Preparados ({status.staged.length})</span><span className="spacer" />
          {status.staged.length > 0 && <button className="btn sm" onClick={actions.unstageAll}>Quitar todo</button>}
        </div>
        {status.staged.map((f) => (
          <FileRow key={'s' + f.path} f={f} staged
            selected={selected && selected.file === f.path && selected.staged}
            onOpen={() => onOpenFile({ kind: 'wip', file: f.path, staged: true })}
            onToggle={() => actions.unstage([f.path])}
            onMenu={(e) => onFileMenu(e, f, 'staged')} />
        ))}
        {!status.staged.length && <div className="flow-empty">Nada preparado para commit</div>}
      </div>

      <div className="commit-box">
        <div className="row" style={{ fontSize: 12 }}>
          <span className="avatar" style={{ background: profile ? profile.color : 'var(--faint)' }}>{(identity.name || '?')[0].toUpperCase()}</span>
          <div className="grow ellipsis muted" title={`${identity.name} <${identity.email}>`}>
            Commit como <b style={{ color: 'var(--text)' }}>{identity.name || '(sin nombre)'}</b> &lt;{identity.email || 'sin correo'}&gt;
          </div>
          <button className="btn sm ghost" onClick={onSwitchProfile}>Cambiar</button>
        </div>
        {(!identity.name || !identity.email) && <div style={{ color: 'var(--orange)', fontSize: 12 }}>Falta identidad: asigna un perfil o configura user.name/user.email.</div>}
        <input ref={subjRef} className="input" placeholder={state === 'merge' ? 'Mensaje (opcional en merge)' : 'Resumen del commit'} value={subject} maxLength={200}
          onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doCommit(); }} />
        <textarea className="textarea" rows={3} placeholder="Descripción (opcional)" value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doCommit(); }} />
        <div className="row" style={{ flexWrap: 'wrap', fontSize: 12 }}>
          <label className="check"><input type="checkbox" checked={amend} onChange={(e) => { setAmend(e.target.checked); if (!e.target.checked) { setSubject(''); setBody(''); } }} /> Enmendar último</label>
          <label className="check"><input type="checkbox" checked={pushAfter} onChange={(e) => setPushAfter(e.target.checked)} /> Push después</label>
          <label className="check" title="Omite los hooks pre-commit"><input type="checkbox" checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)} /> --no-verify</label>
          <span className="spacer" />
          <span className={subject.length > 72 ? 'del' : 'faint'}>{subject.length}/72</span>
        </div>
        <button className="btn primary" disabled={!canCommit && !(state === 'merge' && nConf === 0)} onClick={() => (state === 'merge' && !subject.trim() ? actions.opContinue() : doCommit())}>
          {amend ? 'Enmendar commit' : state === 'merge' ? 'Completar merge' : `Commit (${status.staged.length})`} <span className="kbd">⌘↵</span>
        </button>
        {mergeMsgHint && <div className="faint" style={{ fontSize: 11 }}>{mergeMsgHint}</div>}
      </div>
    </>
  );
}
