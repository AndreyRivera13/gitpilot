import React, { useState } from 'react';
import { buildTree, timeAgo } from '../lib/util.js';

function Section({ title, count, open, onToggle, onAdd, addTitle, children }) {
  return (
    <div>
      <div className="sb-head" onClick={onToggle}>
        <span className={`caret ${open ? 'open' : ''}`}>▶</span>
        <span>{title}</span>
        {count != null && <span className="count">{count}</span>}
        {onAdd && <button className="icon-btn plus" title={addTitle} onClick={(e) => { e.stopPropagation(); onAdd(e); }}>＋</button>}
      </div>
      {open && children}
    </div>
  );
}

function Tree({ nodes, depth = 0, render, folderKey }) {
  const [closed, setClosed] = useState({});
  return nodes.map((n) => {
    if (n.item && !n.children.length) return <div key={n.path}>{render(n.item, depth, n.name)}</div>;
    const k = folderKey + n.path;
    const isClosed = closed[k];
    return (
      <div key={k}>
        <div className="sb-item sb-folder" style={{ paddingLeft: 12 + depth * 12 }} onClick={() => setClosed((c) => ({ ...c, [k]: !c[k] }))}>
          <span className={`caret ${isClosed ? '' : 'open'}`}>▶</span>📁 <span className="ellipsis">{n.name}</span>
        </div>
        {!isClosed && <Tree nodes={n.children} depth={depth + 1} render={render} folderKey={folderKey} />}
        {n.item && !isClosed && render(n.item, depth + 1, n.name)}
      </div>
    );
  });
}

export default function Sidebar({ refs, flow, submodules, onSelectSha, onCheckout, onBranchMenu, onRemoteMenu, onTagMenu, onStashMenu,
  onCreateBranch, onCreateTag, onStashSave, onAddRemote, onFlowStart, onFlowFinish, onFlowInit, onFlowMenu, onSubmoduleUpdate, onManageRemotes, onSelectStash }) {
  const [open, setOpen] = useState({ local: true, remote: true, tags: false, stash: true, sub: true, flow: true });
  const tog = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  if (!refs) return <div className="sidebar" />;

  const remoteNames = [...new Set(refs.remotes.map((r) => r.remote))];
  const rlist = refs.remotesList || [];
  const allRemoteNames = [...new Set([...remoteNames, ...rlist.map((r) => r.name)])];

  return (
    <div className="sidebar">
      <Section title="Ramas locales" count={refs.branches.length} open={open.local} onToggle={() => tog('local')} onAdd={onCreateBranch} addTitle="Nueva rama">
        <Tree nodes={buildTree(refs.branches, (b) => b.name)} folderKey="l:" render={(b, depth, short) => (
          <div className={`sb-item ${b.current ? 'current' : ''}`} style={{ paddingLeft: 12 + depth * 12 }} title={`${b.name}${b.upstream ? ' → ' + b.upstream : ''}\n${b.subject}`}
            onClick={() => onSelectSha(b.sha)} onDoubleClick={() => onCheckout(b)} onContextMenu={(e) => onBranchMenu(e, b)}>
            <span>{b.current ? '●' : '⑂'}</span>
            <span className="ellipsis grow">{short}</span>
            {(b.ahead > 0 || b.behind > 0) && <span className="ab">{b.ahead > 0 && <span className="up">↑{b.ahead}</span>}{b.behind > 0 && <span className="down"> ↓{b.behind}</span>}</span>}
            {b.gone && <span className="ab" title="El remoto ya no existe">✕</span>}
          </div>
        )} />
        {!refs.branches.length && <div className="flow-empty">{refs.hasCommits ? 'HEAD desasociado' : 'Aún no hay commits'}</div>}
      </Section>

      <Section title="Remotos" count={allRemoteNames.length} open={open.remote} onToggle={() => tog('remote')} onAdd={onAddRemote} addTitle="Añadir remoto">
        {allRemoteNames.map((rn) => (
          <div key={rn}>
            <div className="sb-item sb-folder" onContextMenu={(e) => onRemoteMenu(e, { remoteName: rn })}>
              <span>☁</span><span className="ellipsis grow">{rn}</span>
              <button className="icon-btn" title="Gestionar remotos" onClick={onManageRemotes}>⚙</button>
            </div>
            <Tree nodes={buildTree(refs.remotes.filter((r) => r.remote === rn), (r) => r.short)} folderKey={`r:${rn}:`} render={(r, depth, short) => (
              <div className="sb-item" style={{ paddingLeft: 26 + depth * 12 }} title={r.name}
                onClick={() => onSelectSha(r.sha)} onDoubleClick={() => onCheckout(r, true)} onContextMenu={(e) => onRemoteMenu(e, r)}>
                <span className="ellipsis grow">{short}</span>
              </div>
            )} />
          </div>
        ))}
        {!allRemoteNames.length && <div className="flow-empty">Sin remotos. Usa ＋ para añadir uno.</div>}
      </Section>

      <Section title="Tags" count={refs.tags.length} open={open.tags} onToggle={() => tog('tags')} onAdd={() => onCreateTag()} addTitle="Nuevo tag en HEAD">
        {[...refs.tags].sort((a, b) => b.date - a.date).map((t) => (
          <div key={t.name} className="sb-item" title={t.subject} onClick={() => onSelectSha(t.sha)} onContextMenu={(e) => onTagMenu(e, t)}>
            <span>🏷</span><span className="ellipsis grow">{t.name}</span>{t.annotated && <span className="ab">anot.</span>}
          </div>
        ))}
      </Section>

      <Section title="Stashes" count={refs.stashes.length} open={open.stash} onToggle={() => tog('stash')} onAdd={onStashSave} addTitle="Guardar cambios en stash">
        {refs.stashes.map((s) => (
          <div key={s.ref} className="sb-item" title={s.message} onClick={() => onSelectStash(s)} onContextMenu={(e) => onStashMenu(e, s)}>
            <span>📦</span><span className="ellipsis grow">{s.message.replace(/^(WIP on|On) /, '')}</span><span className="ab">{timeAgo(s.time)}</span>
          </div>
        ))}
        {!refs.stashes.length && <div className="flow-empty">Sin stashes</div>}
      </Section>

      {submodules && submodules.length > 0 && (
        <Section title="Submódulos" count={submodules.length} open={open.sub} onToggle={() => tog('sub')}>
          {submodules.map((s) => (
            <div key={s.path} className="sb-item" title={`${s.path}\n${s.state}`}>
              <span>{s.state === 'ok' ? '◼' : '◻'}</span><span className="ellipsis grow">{s.path}</span>
              {s.state !== 'ok' && <button className="icon-btn" title="Inicializar/actualizar" onClick={() => onSubmoduleUpdate(s.path)}>⟳</button>}
            </div>
          ))}
          <div className="sb-item"><button className="btn sm" onClick={() => onSubmoduleUpdate()}>Actualizar todos</button></div>
        </Section>
      )}

      <Section title="Gitflow" open={open.flow} onToggle={() => tog('flow')}>
        {!flow || !flow.initialized ? (
          <div style={{ padding: '4px 14px 8px' }}>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Gitflow no está inicializado.</div>
            <button className="btn sm" onClick={onFlowInit} disabled={!flow || !flow.hasCommits}>Inicializar Gitflow…</button>
            {flow && !flow.hasCommits && <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Haz un commit primero.</div>}
          </div>
        ) : (
          <div style={{ padding: '0 8px 6px' }}>
            <div className="row" style={{ gap: 4, padding: '2px 4px 6px' }}>
              {['feature', 'release', 'hotfix'].map((t) => <button key={t} className="btn sm grow" onClick={() => onFlowStart(t)} title={`Iniciar ${t}`}>+ {t}</button>)}
            </div>
            {['feature', 'release', 'hotfix'].map((t) => flow.branches[t].map((b) => (
              <div key={b.name} className={`sb-item ${flow.current && flow.current.branch === b.name ? 'current' : ''}`} onContextMenu={(e) => onFlowMenu(e, t, b)} onDoubleClick={() => onCheckout({ name: b.name })}>
                <span className="tag" style={{ width: 52, textAlign: 'center' }}>{t}</span>
                <span className="ellipsis grow" title={b.name}>{b.short}</span>
                <button className="icon-btn" title="Finalizar" onClick={() => onFlowFinish(t, b)}>✔</button>
              </div>
            )))}
            {!['feature', 'release', 'hotfix'].some((t) => flow.branches[t].length) && <div className="flow-empty">No hay ramas de flujo activas</div>}
            <div className="faint" style={{ fontSize: 11, padding: '4px 6px' }}>main: <b>{flow.config.main}</b> · develop: <b>{flow.config.develop}</b></div>
          </div>
        )}
      </Section>
    </div>
  );
}
