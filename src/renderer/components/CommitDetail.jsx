import React from 'react';
import { STATUS, baseName, dirName, fmtDate, hashColor, initials, copyText } from '../lib/util.js';

export default function CommitDetail({ changeCount, onGoWip, detail, loading, selectedFile, onOpenFile, onSelectSha, onFileMenu, ui }) {
  const wipBanner = changeCount > 0 ? (
    <div className="banner" style={{ margin: 8 }}>
      <b>Tienes {changeCount} cambio{changeCount > 1 ? 's' : ''} locales sin commit</b>
      <div className="row"><button className="btn primary sm" onClick={onGoWip}>Ir a Cambios locales y hacer commit</button></div>
    </div>
  ) : null;
  if (loading && !detail) return <div className="empty-state">Cargando…</div>;
  if (!detail) return <div className="empty-state">Selecciona un commit{wipBanner}</div>;
  const d = detail;
  const [subject, ...rest] = d.message.split('\n');
  const body = rest.join('\n').trim();
  const totalAdd = d.files.reduce((a, f) => a + f.additions, 0);
  const totalDel = d.files.reduce((a, f) => a + f.deletions, 0);
  return (
    <>
      <div className="pane-title">
        <span className="avatar" style={{ background: hashColor(d.email) }}>{initials(d.author)}</span>
        <div className="grow ellipsis"><div>{d.author}</div><div className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}>{fmtDate(d.date)}</div></div>
      </div>
      {wipBanner}
      <div className="pane-scroll selectable">
        <div className="commit-msg"><div className="s">{subject}</div>{body}</div>
        <dl className="commit-meta">
          <dt>SHA</dt><dd style={{ margin: 0, minWidth: 0, wordBreak: 'break-all' }}><span className="mono">{d.sha}</span> <button className="icon-btn" title="Copiar" onClick={() => { copyText(d.sha); ui.toast('SHA copiado'); }}>⧉</button></dd>
          <dt>Correo</dt><dd style={{ margin: 0 }}>{d.email}</dd>
          {d.committer !== d.author && <><dt>Committer</dt><dd style={{ margin: 0 }}>{d.committer}</dd></>}
          <dt>{d.parents.length > 1 ? 'Padres' : 'Padre'}</dt>
          <dd style={{ margin: 0 }}>{d.parents.length ? d.parents.map((p) => <span key={p} className="sha-link" style={{ marginRight: 8 }} onClick={() => onSelectSha(p)}>{p.slice(0, 7)}</span>) : <span className="faint">(commit raíz)</span>}</dd>
          {d.refs.length > 0 && <><dt>Refs</dt><dd style={{ margin: 0 }}>{d.refs.map((r, i) => <span key={i} className={`ref ${r.type === 'head' ? 'head' : r.type}`} style={{ marginRight: 4 }}>{r.name}</span>)}</dd></>}
        </dl>
        <div className="section-title"><span>Archivos ({d.files.length})</span><span className="spacer" /><span className="mono" style={{ textTransform: 'none' }}><span className="add">+{totalAdd}</span> <span className="del">−{totalDel}</span></span></div>
        {d.files.map((f) => {
          const st = STATUS[f.status] || STATUS.M;
          return (
            <div key={f.path} className={`file-row ${selectedFile === f.path ? 'selected' : ''}`} onClick={() => onOpenFile({ kind: 'commit', sha: d.sha, file: f.path })}
              onContextMenu={(e) => onFileMenu(e, f, d.sha)} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
              <span className={`st ${st.cls}`} title={st.label}>{st.ch}</span>
              <span className="name ellipsis"><span>{baseName(f.path)}</span> <span className="dir">{dirName(f.path)}</span></span>
              <span className="num">{f.binary ? <span className="faint">bin</span> : <><span className="add">+{f.additions}</span><span className="del">−{f.deletions}</span></>}</span>
            </div>
          );
        })}
        {d.files.length === 0 && <div className="flow-empty">Commit sin cambios de archivos</div>}
      </div>
    </>
  );
}
