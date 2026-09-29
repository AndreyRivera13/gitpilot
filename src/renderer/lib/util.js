export function timeAgo(unix) {
  if (!unix) return '';
  const s = Math.floor(Date.now() / 1000 - unix);
  if (s < 45) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} d`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `hace ${mo} mes${mo > 1 ? 'es' : ''}`;
  return `hace ${Math.round(mo / 12)} a`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(typeof iso === 'number' ? iso * 1000 : iso);
  return d.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export function hashColor(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 48%)`;
}

export const STATUS = {
  M: { label: 'Modificado', cls: 'st-m', ch: 'M' },
  A: { label: 'Añadido', cls: 'st-a', ch: 'A' },
  D: { label: 'Eliminado', cls: 'st-d', ch: 'D' },
  R: { label: 'Renombrado', cls: 'st-r', ch: 'R' },
  C: { label: 'Copiado', cls: 'st-r', ch: 'C' },
  T: { label: 'Tipo cambiado', cls: 'st-m', ch: 'T' },
  '?': { label: 'Sin seguimiento', cls: 'st-u', ch: 'U' },
  U: { label: 'Conflicto', cls: 'st-c', ch: '!' },
};

export function baseName(p) { return (p || '').split('/').filter(Boolean).pop() || p; }
export function dirName(p) { const i = (p || '').lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i + 1); }

/** Agrupa nombres con "/" en un árbol: [{name, full, children:[...]}] */
export function buildTree(items, getName = (x) => x) {
  const root = { children: new Map() };
  for (const it of items) {
    const parts = getName(it).split('/');
    let node = root;
    parts.forEach((p, i) => {
      if (!node.children.has(p)) node.children.set(p, { name: p, children: new Map(), item: null, path: parts.slice(0, i + 1).join('/') });
      node = node.children.get(p);
      if (i === parts.length - 1) node.item = it;
    });
  }
  const conv = (n) => [...n.children.values()]
    .map((c) => ({ name: c.name, path: c.path, item: c.item, children: conv(c) }))
    .sort((a, b) => (!!b.children.length - !!a.children.length) || a.name.localeCompare(b.name));
  return conv(root);
}

export function copyText(t) {
  try { navigator.clipboard.writeText(t); } catch (_) { /* ignore */ }
}
