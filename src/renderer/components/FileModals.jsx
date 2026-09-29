import React, { useEffect, useState } from 'react';
import { call } from '../api.js';
import { Modal, useUI } from './ui.jsx';
import { timeAgo, hashColor, initials } from '../lib/util.js';

export function BlameModal({ repo, file, sha, onClose, onSelectSha }) {
  const ui = useUI();
  const [rows, setRows] = useState(null);
  useEffect(() => { call('git.blame', repo, file, sha).then(setRows).catch((e) => { ui.error(e); onClose(); }); /* eslint-disable-next-line */ }, []);
  return (
    <Modal title={`Blame · ${file}${sha ? ' @ ' + sha.slice(0, 7) : ''}`} size="xl" onClose={onClose}>
      <div style={{ overflow: 'auto', flex: 1 }} className="selectable">
        {!rows && <div className="empty-state">Cargando…</div>}
        {rows && rows.map((r, i) => (
          <div key={i} className={`blame-row ${i === 0 || rows[i - 1].sha !== r.sha ? 'first' : ''}`}>
            <div className="meta" title={`${r.summary}\n${r.author}`} onClick={() => { onSelectSha(r.sha); onClose(); }} style={{ cursor: 'pointer' }}>
              {i === 0 || rows[i - 1].sha !== r.sha ? `${r.sha.slice(0, 7)} ${r.author} · ${timeAgo(r.time)}` : ''}
            </div>
            <div className="ln">{r.line}</div><div className="code">{r.text}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function HistoryModal({ repo, file, onClose, onSelectSha }) {
  const ui = useUI();
  const [rows, setRows] = useState(null);
  useEffect(() => { call('git.fileHistory', repo, file).then(setRows).catch((e) => { ui.error(e); onClose(); }); /* eslint-disable-next-line */ }, []);
  return (
    <Modal title={`Historial · ${file}`} size="wide" onClose={onClose}>
      <div style={{ overflow: 'auto', flex: 1 }}>
        {!rows && <div className="empty-state">Cargando…</div>}
        {rows && !rows.length && <div className="empty-state">Sin historial.</div>}
        {rows && rows.map((c) => (
          <div key={c.sha} className="list-item" onClick={() => { onSelectSha(c.sha); onClose(); }}>
            <span className="avatar" style={{ background: hashColor(c.email) }}>{initials(c.author)}</span>
            <div className="grow ellipsis"><div>{c.subject}</div><div className="faint" style={{ fontSize: 11 }}>{c.author} · {timeAgo(c.time)}</div></div>
            <span className="mono faint">{c.sha.slice(0, 7)}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
