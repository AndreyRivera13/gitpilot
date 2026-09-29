'use strict';
/**
 * Parsers puros (sin efectos) de la salida de git. Probados en test/backend.test.js
 */

const FS = '\x1f';
const RS = '\x1e';

/* ------------------------------ STATUS ------------------------------ */

function parseStatus(text) {
  const parts = text.split('\0');
  const branch = { head: null, oid: null, upstream: null, ahead: 0, behind: 0, detached: false };
  const staged = [];
  const unstaged = [];
  const conflicts = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith('# ')) {
      const [, key, ...rest] = p.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.oid') branch.oid = val === '(initial)' ? null : val;
      else if (key === 'branch.head') { branch.head = val; branch.detached = val === '(detached)'; }
      else if (key === 'branch.upstream') branch.upstream = val;
      else if (key === 'branch.ab') {
        const m = val.match(/\+(\d+) -(\d+)/);
        if (m) { branch.ahead = +m[1]; branch.behind = +m[2]; }
      }
      continue;
    }
    const kind = p[0];
    if (kind === '1') {
      const f = p.split(' ');
      const xy = f[1];
      const path = f.slice(8).join(' ');
      addEntry(xy, path, null);
    } else if (kind === '2') {
      const f = p.split(' ');
      const xy = f[1];
      const path = f.slice(9).join(' ');
      const orig = parts[++i];
      addEntry(xy, path, orig);
    } else if (kind === 'u') {
      const f = p.split(' ');
      const xy = f[1];
      const path = f.slice(10).join(' ');
      conflicts.push({ path, x: xy[0], y: xy[1], kind: conflictKind(xy) });
    } else if (kind === '?') {
      unstaged.push({ path: p.slice(2), status: '?', untracked: true });
    }
  }
  function addEntry(xy, path, orig) {
    const x = xy[0];
    const y = xy[1];
    if (x !== '.') staged.push({ path, origPath: orig || undefined, status: x });
    if (y !== '.') unstaged.push({ path, origPath: orig || undefined, status: y });
  }
  return { branch, staged, unstaged, conflicts };
}

function conflictKind(xy) {
  const map = {
    DD: 'ambos borraron', AU: 'añadido por nosotros', UD: 'borrado por ellos',
    UA: 'añadido por ellos', DU: 'borrado por nosotros', AA: 'ambos añadieron', UU: 'ambos modificaron',
  };
  return map[xy] || 'conflicto';
}

/* ------------------------------- LOG -------------------------------- */

const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%D', '%s'].join('%x1f');

function parseDecorations(d) {
  const refs = [];
  if (!d) return refs;
  for (let item of d.split(', ')) {
    item = item.trim();
    if (!item) continue;
    if (item.startsWith('HEAD -> ')) {
      refs.push({ type: 'head', name: item.slice(8).replace(/^refs\/heads\//, ''), current: true });
    } else if (item === 'HEAD') {
      refs.push({ type: 'detached', name: 'HEAD', current: true });
    } else if (item.startsWith('tag: ')) {
      refs.push({ type: 'tag', name: item.slice(5).replace(/^refs\/tags\//, '') });
    } else if (item.startsWith('refs/heads/')) {
      refs.push({ type: 'local', name: item.slice(11) });
    } else if (item.startsWith('refs/remotes/')) {
      const n = item.slice(13);
      if (n.endsWith('/HEAD')) continue;
      refs.push({ type: 'remote', name: n });
    } else if (item === 'refs/stash') {
      refs.push({ type: 'stash', name: 'stash' });
    }
  }
  return refs;
}

function parseLog(text) {
  const out = [];
  for (const rec of text.split(RS)) {
    const r = rec.replace(/^\n/, '').replace(/\n$/, '');
    if (!r) continue;
    const f = r.split(FS);
    if (f.length < 8) continue;
    out.push({
      sha: f[0],
      parents: f[1] ? f[1].split(' ') : [],
      author: f[2],
      email: f[3],
      time: +f[4],
      committer: f[5],
      refs: parseDecorations(f[6]),
      subject: f.slice(7).join(FS),
    });
  }
  return out;
}

/* ------------------------------- REFS ------------------------------- */

const REF_FORMAT = [
  '%(refname)', '%(objectname)', '%(upstream:short)', '%(upstream:track,nobracket)',
  '%(HEAD)', '%(objecttype)', '%(*objectname)', '%(subject)', '%(committerdate:unix)', '%(creatordate:unix)',
].join(FS);

function parseRefs(text) {
  const branches = [];
  const remotes = [];
  const tags = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split(FS);
    const [refname, sha, upstream, track, head, otype, deref, subject, cdate, credate] = f;
    if (refname.startsWith('refs/heads/')) {
      const t = parseTrack(track);
      branches.push({
        name: refname.slice(11), sha, upstream: upstream || null,
        ahead: t.ahead, behind: t.behind, gone: t.gone,
        current: head === '*', subject, date: +cdate || 0,
      });
    } else if (refname.startsWith('refs/remotes/')) {
      const full = refname.slice(13);
      if (full.endsWith('/HEAD') || !full.includes('/')) continue;
      const i = full.indexOf('/');
      remotes.push({ name: full, remote: full.slice(0, i), short: full.slice(i + 1), sha, subject, date: +cdate || 0 });
    } else if (refname.startsWith('refs/tags/')) {
      tags.push({
        name: refname.slice(10), sha: otype === 'tag' ? deref : sha,
        annotated: otype === 'tag', subject, date: +credate || 0,
      });
    }
  }
  return { branches, remotes, tags };
}

function parseTrack(t) {
  const r = { ahead: 0, behind: 0, gone: false };
  if (!t) return r;
  if (t === 'gone') { r.gone = true; return r; }
  const a = t.match(/ahead (\d+)/);
  const b = t.match(/behind (\d+)/);
  if (a) r.ahead = +a[1];
  if (b) r.behind = +b[1];
  return r;
}

function parseStashes(text) {
  return text.split('\n').filter(Boolean).map((l) => {
    const [ref, sha, msg, time] = l.split(FS);
    const idx = +(ref.match(/\{(\d+)\}/) || [0, 0])[1];
    return { ref, index: idx, sha, message: msg, time: +time };
  });
}

/* ---------------------------- COMMIT FILES --------------------------- */

/** Une salidas de `--name-status -z` y `--numstat -z` */
function parseCommitFiles(nameStatusZ, numstatZ) {
  const files = [];
  const ns = nameStatusZ.split('\0');
  for (let i = 0; i < ns.length;) {
    const st = ns[i++];
    if (!st) continue;
    const code = st[0];
    if (code === 'R' || code === 'C') {
      const oldPath = ns[i++];
      const path = ns[i++];
      files.push({ status: code, path, oldPath, additions: 0, deletions: 0 });
    } else {
      const path = ns[i++];
      files.push({ status: code, path, additions: 0, deletions: 0 });
    }
  }
  const nu = numstatZ.split('\0');
  let idx = 0;
  for (let i = 0; i < nu.length;) {
    const rec = nu[i++];
    if (!rec) continue;
    const m = rec.match(/^(\S+)\t(\S+)\t(.*)$/);
    if (!m) continue;
    let add = m[1] === '-' ? 0 : +m[1];
    let del = m[2] === '-' ? 0 : +m[2];
    if (m[3] === '') i += 2; // rename: dos rutas a continuación
    const f = files[idx++];
    if (f) { f.additions = add; f.deletions = del; f.binary = m[1] === '-'; }
  }
  return files;
}

/* ------------------------------- DIFF -------------------------------- */

function parseDiff(text) {
  const files = [];
  if (!text) return files;
  const lines = text.split('\n');
  let file = null;
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('diff --git ') || l.startsWith('diff --cc ') || l.startsWith('diff --combined ')) {
      file = { header: [l], oldPath: null, newPath: null, path: null, status: 'M', binary: false, hunks: [], additions: 0, deletions: 0 };
      const m = l.match(/^diff --git a\/(.*) b\/(.*)$/);
      if (m) { file.oldPath = m[1]; file.newPath = m[2]; file.path = m[2]; }
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk && !l.startsWith('@@')) {
      // cabecera del archivo
      file.header.push(l);
      if (l.startsWith('new file mode')) file.status = 'A';
      else if (l.startsWith('deleted file mode')) file.status = 'D';
      else if (l.startsWith('rename from ')) { file.status = 'R'; file.oldPath = l.slice(12); }
      else if (l.startsWith('rename to ')) { file.newPath = l.slice(10); file.path = file.newPath; }
      else if (l.startsWith('Binary files') || l.startsWith('GIT binary patch')) file.binary = true;
      else if (l.startsWith('--- ')) { const p = stripPrefix(l.slice(4), 'a/'); if (p) file.oldPath = p; }
      else if (l.startsWith('+++ ')) { const p = stripPrefix(l.slice(4), 'b/'); if (p) { file.newPath = p; file.path = p; } }
      continue;
    }
    if (l.startsWith('@@')) {
      const m = l.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
      if (!m) continue;
      hunk = {
        header: l, oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2],
        newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], section: m[5] || '', lines: [],
      };
      file.hunks.push(hunk);
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    const c = l[0];
    if (c === '+') { hunk.lines.push({ t: '+', s: l.slice(1), n: newNo++ }); file.additions++; }
    else if (c === '-') { hunk.lines.push({ t: '-', s: l.slice(1), o: oldNo++ }); file.deletions++; }
    else if (c === ' ') { hunk.lines.push({ t: ' ', s: l.slice(1), o: oldNo++, n: newNo++ }); }
    else if (c === '\\') { hunk.lines.push({ t: '\\', s: l.slice(1) }); }
    else if (l === '' && i === lines.length - 1) { /* fin */ }
    else if (l === '') { hunk.lines.push({ t: ' ', s: '', o: oldNo++, n: newNo++ }); }
  }
  if (!file) return files;
  for (const f of files) if (!f.path) f.path = f.newPath || f.oldPath;
  return files;
}

function stripPrefix(p, prefix) {
  if (p === '/dev/null') return null;
  p = p.replace(/\t.*$/, '');
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/**
 * Construye un parche válido con un hunk (o solo algunas de sus líneas).
 * mode: 'stage' (aplicar al índice), 'unstage' (revertir del índice) o 'discard' (revertir del working tree)
 * selected: Set<number> de índices de línea dentro del hunk, o null = todo el hunk
 */
function buildPatch(file, hunkIndex, selected, mode) {
  const hunk = file.hunks[hunkIndex];
  if (!hunk) throw new Error('Hunk inexistente');
  const forward = mode === 'stage';
  const out = [];
  let prevKept = true;
  hunk.lines.forEach((ln, idx) => {
    const sel = !selected || selected.has(idx);
    if (ln.t === ' ') { out.push(' ' + ln.s); prevKept = true; return; }
    if (ln.t === '\\') { if (prevKept) out.push('\\' + ln.s); return; }
    if (ln.t === '+') {
      if (sel) { out.push('+' + ln.s); prevKept = true; }
      else if (forward) { prevKept = false; }
      else { out.push(' ' + ln.s); prevKept = true; }
    } else if (ln.t === '-') {
      if (sel) { out.push('-' + ln.s); prevKept = true; }
      else if (forward) { out.push(' ' + ln.s); prevKept = true; }
      else { prevKept = false; }
    }
  });
  let oldCount = 0;
  let newCount = 0;
  for (const l of out) {
    if (l[0] === ' ') { oldCount++; newCount++; }
    else if (l[0] === '-') oldCount++;
    else if (l[0] === '+') newCount++;
  }
  const start = forward ? hunk.oldStart : hunk.newStart;
  const head = `@@ -${forward ? hunk.oldStart : start},${oldCount} +${forward ? start : hunk.newStart},${newCount} @@${hunk.section ? ' ' + hunk.section : ''}`;
  return file.header.join('\n') + '\n' + head + '\n' + out.join('\n') + '\n';
}

/* ------------------------------- BLAME ------------------------------- */

function parseBlame(text) {
  const lines = text.split('\n');
  const out = [];
  const commits = {};
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/);
    if (m) {
      cur = { sha: m[1], line: +m[3] };
      if (!commits[cur.sha]) commits[cur.sha] = {};
      continue;
    }
    if (!cur) continue;
    if (l.startsWith('\t')) {
      const c = commits[cur.sha];
      out.push({ line: cur.line, sha: cur.sha, author: c.author, time: c.time, summary: c.summary, text: l.slice(1) });
      cur = null;
    } else if (l.startsWith('author ')) commits[cur.sha].author = l.slice(7);
    else if (l.startsWith('author-time ')) commits[cur.sha].time = +l.slice(12);
    else if (l.startsWith('summary ')) commits[cur.sha].summary = l.slice(8);
  }
  return out;
}

/* ---------------------------- SUBMODULES ----------------------------- */

function parseSubmodules(text) {
  return text.split('\n').filter(Boolean).map((l) => {
    const flag = l[0];
    const m = l.slice(1).match(/^([0-9a-f]+) (\S.*?)(?: \((.*)\))?$/);
    if (!m) return null;
    return {
      sha: m[1], path: m[2], describe: m[3] || '',
      state: flag === '-' ? 'no-inicializado' : flag === '+' ? 'desactualizado' : flag === 'U' ? 'conflicto' : 'ok',
    };
  }).filter(Boolean);
}

/* ----------------------- Conflictos (marcadores) --------------------- */

/**
 * Divide un archivo con marcadores <<<<<<< ======= >>>>>>> en segmentos.
 * Devuelve [{type:'text', text} | {type:'conflict', ours, theirs, base?, oursLabel, theirsLabel}]
 */
function parseConflicts(content) {
  const lines = content.split('\n');
  const segs = [];
  let buf = [];
  let i = 0;
  const flush = () => { if (buf.length) { segs.push({ type: 'text', text: buf.join('\n') }); buf = []; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^<{7}( |$)/.test(l)) {
      flush();
      const oursLabel = l.slice(8);
      const ours = [];
      const base = [];
      const theirs = [];
      let section = 'ours';
      let theirsLabel = '';
      i++;
      while (i < lines.length) {
        const c = lines[i];
        if (/^\|{7}( |$)/.test(c)) { section = 'base'; i++; continue; }
        if (/^={7}$/.test(c)) { section = 'theirs'; i++; continue; }
        if (/^>{7}( |$)/.test(c)) { theirsLabel = c.slice(8); i++; break; }
        (section === 'ours' ? ours : section === 'base' ? base : theirs).push(c);
        i++;
      }
      segs.push({ type: 'conflict', ours: ours.join('\n'), theirs: theirs.join('\n'), base: base.length ? base.join('\n') : null, oursLabel, theirsLabel, oursLines: ours.length, theirsLines: theirs.length });
    } else {
      buf.push(l);
      i++;
    }
  }
  flush();
  return segs;
}

module.exports = {
  FS, RS, LOG_FORMAT, REF_FORMAT,
  parseStatus, parseLog, parseDecorations, parseRefs, parseStashes,
  parseCommitFiles, parseDiff, buildPatch, parseBlame, parseSubmodules, parseConflicts,
};
