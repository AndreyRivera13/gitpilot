import React, { useEffect, useMemo, useRef, useState } from 'react';
import { computeGraph } from '../lib/graph.mjs';
import { hashColor, initials, timeAgo } from '../lib/util.js';

const ROW = 28;
const LANE_W = 16;
const X = (lane) => 12 + lane * LANE_W;
const COLOR = (i) => `var(--l${i % 8})`;

function RowGraph({ row, width, selected, wip }) {
  const H = ROW;
  const mid = H / 2;
  const cx = X(row.lane);
  const els = [];
  row.through.forEach((t, i) => els.push(<line key={'t' + i} x1={X(t.lane)} y1={0} x2={X(t.lane)} y2={H} stroke={COLOR(t.color)} strokeWidth="2" />));
  if (row.hasTop) els.push(<line key="top" x1={cx} y1={0} x2={cx} y2={mid} stroke={COLOR(row.color)} strokeWidth="2" />);
  row.incoming.forEach((n, i) => {
    const x1 = X(n.from);
    els.push(<path key={'in' + i} d={`M ${x1} 0 C ${x1} ${mid * 0.9}, ${cx} ${mid * 0.3}, ${cx} ${mid}`} stroke={COLOR(n.color)} strokeWidth="2" fill="none" />);
  });
  row.outgoing.forEach((o, i) => {
    const x2 = X(o.to);
    if (x2 === cx) els.push(<line key={'o' + i} x1={cx} y1={mid} x2={cx} y2={H} stroke={COLOR(o.color)} strokeWidth="2" strokeDasharray={wip ? '3 3' : undefined} />);
    else els.push(<path key={'o' + i} d={`M ${cx} ${mid} C ${cx} ${mid + mid * 0.7}, ${x2} ${mid + mid * 0.3}, ${x2} ${H}`} stroke={COLOR(o.color)} strokeWidth="2" fill="none" />);
  });
  return (
    <svg width={width} height={H} style={{ display: 'block' }}>
      {els}
      {wip
        ? <circle cx={cx} cy={mid} r="5" fill="var(--bg)" stroke={COLOR(row.color)} strokeWidth="2" strokeDasharray="2.5 2" />
        : row.isMerge
          ? <circle cx={cx} cy={mid} r="4" fill="var(--bg)" stroke={COLOR(row.color)} strokeWidth="2.5" />
          : <circle cx={cx} cy={mid} r="5" fill={COLOR(row.color)} stroke={selected ? '#fff' : 'var(--bg)'} strokeWidth="1.5" />}
    </svg>
  );
}

function RefBadges({ refs, onDblClick, onContext }) {
  const locals = refs.filter((r) => r.type === 'head' || r.type === 'local');
  const localNames = new Set(locals.map((r) => r.name));
  const items = [];
  refs.forEach((r, i) => {
    if (r.type === 'remote') {
      const short = r.name.slice(r.name.indexOf('/') + 1);
      if (localNames.has(short)) return; // se muestra fusionado con la rama local
      items.push(<span key={i} className="ref remote" title={r.name} onDoubleClick={(e) => { e.stopPropagation(); onDblClick(r); }} onContextMenu={(e) => onContext(e, r)}>☁ {r.name}</span>);
    } else if (r.type === 'head' || r.type === 'local') {
      const remote = refs.find((x) => x.type === 'remote' && x.name.slice(x.name.indexOf('/') + 1) === r.name);
      items.push(<span key={i} className={`ref ${r.type === 'head' ? 'head' : 'local'}`} title={r.name} onDoubleClick={(e) => { e.stopPropagation(); onDblClick(r); }} onContextMenu={(e) => onContext(e, r)}>
        {r.type === 'head' ? '● ' : ''}{r.name}{remote ? ' ☁' : ''}</span>);
    } else if (r.type === 'tag') {
      items.push(<span key={i} className="ref tag" title={`tag ${r.name}`} onContextMenu={(e) => onContext(e, r)}>🏷 {r.name}</span>);
    } else if (r.type === 'detached') {
      items.push(<span key={i} className="ref detached">HEAD</span>);
    } else if (r.type === 'stash') {
      items.push(<span key={i} className="ref stash">stash</span>);
    }
  });
  return <>{items}</>;
}

export default function Graph({ commits, selectedSha, onSelect, onContext, onRefDblClick, onRefContext, hasMore, onLoadMore, loadingMore, wipCount, scrollToSha }) {
  const { rows, maxLanes } = useMemo(() => computeGraph(commits), [commits]);
  const scrollRef = useRef(null);
  const [scroll, setScroll] = useState({ top: 0, h: 600 });
  const width = Math.max(1, maxLanes) * LANE_W + 20;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const upd = () => setScroll({ top: el.scrollTop, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!scrollToSha) return;
    const i = commits.findIndex((c) => c.sha === scrollToSha.sha);
    if (i >= 0 && scrollRef.current) {
      const el = scrollRef.current;
      const y = i * ROW;
      if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - ROW) el.scrollTop = Math.max(0, y - el.clientHeight / 3);
    }
  }, [scrollToSha, commits]);

  const start = Math.max(0, Math.floor(scroll.top / ROW) - 8);
  const end = Math.min(commits.length, Math.ceil((scroll.top + scroll.h) / ROW) + 8);

  const onKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = commits.findIndex((c) => c.sha === selectedSha);
    const n = Math.max(0, Math.min(commits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    if (commits[n]) onSelect(commits[n]);
    const el = scrollRef.current;
    const y = n * ROW;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y > el.scrollTop + el.clientHeight - ROW * 2) el.scrollTop = y - el.clientHeight + ROW * 2;
  };

  return (
    <div className="graph-scroll" ref={scrollRef} tabIndex={0} onKeyDown={onKey}
      onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })}>
      <div style={{ height: commits.length * ROW + (hasMore ? 56 : 8), position: 'relative' }}>
        {commits.slice(start, end).map((c, k) => {
          const i = start + k;
          const row = rows[i];
          const wip = c.sha === 'WIP';
          return (
            <div key={c.sha} className={`g-row ${c.sha === selectedSha ? 'selected' : ''} ${wip ? 'wip' : ''}`} style={{ top: i * ROW, height: ROW }}
              onClick={() => onSelect(c)} onContextMenu={(e) => !wip && onContext(e, c)}>
              <RowGraph row={row} width={width} selected={c.sha === selectedSha} wip={wip} />
              <div className="g-msg">
                {wip ? <span className="subj">Cambios locales ({wipCount})</span> : (
                  <>
                    <RefBadges refs={c.refs} onDblClick={onRefDblClick} onContext={onRefContext} />
                    <span className="subj" title={c.subject}>{c.subject}</span>
                  </>
                )}
              </div>
              {!wip && (
                <>
                  <div className="g-author"><span className="avatar" style={{ background: hashColor(c.email || c.author), width: 18, height: 18, fontSize: 9 }}>{initials(c.author)}</span><span className="ellipsis">{c.author}</span></div>
                  <div className="g-date" title={new Date(c.time * 1000).toLocaleString()}>{timeAgo(c.time)}</div>
                  <div className="g-sha">{c.sha.slice(0, 7)}</div>
                </>
              )}
            </div>
          );
        })}
        {hasMore && (
          <div className="load-more" style={{ position: 'absolute', top: commits.length * ROW, left: 0, right: 0 }}>
            <button className="btn" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? 'Cargando…' : 'Cargar más commits'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
