// Asignación de carriles (lanes) para dibujar el grafo de commits.
// commits: [{ sha, parents: [sha...] }] en orden (más reciente primero).
export const LANE_COLORS = 8;

export function computeGraph(commits) {
  const rows = [];
  let lanes = []; // sha esperado en cada carril (null = libre)
  let colors = []; // color de cada carril
  let nextColor = 0;
  const alloc = () => {
    let i = lanes.indexOf(null);
    if (i === -1) { i = lanes.length; lanes.push(null); colors.push(0); }
    return i;
  };
  let maxLanes = 1;

  for (const c of commits) {
    const idxs = [];
    lanes.forEach((s, i) => { if (s === c.sha) idxs.push(i); });
    let lane;
    let color;
    if (idxs.length) { lane = idxs[0]; color = colors[lane]; }
    else { lane = alloc(); color = nextColor++ % LANE_COLORS; colors[lane] = color; }

    const incoming = idxs.filter((i) => i !== lane).map((i) => ({ from: i, color: colors[i] }));
    const hasTop = idxs.length > 0; // hay línea que llega desde arriba al nodo
    const through = [];
    lanes.forEach((s, i) => { if (s !== null && !idxs.includes(i)) through.push({ lane: i, color: colors[i] }); });
    idxs.forEach((i) => { lanes[i] = null; });

    const outgoing = [];
    const parents = c.parents || [];
    parents.forEach((p, pi) => {
      const existing = lanes.indexOf(p);
      if (pi === 0) {
        if (existing !== -1 && existing !== lane) {
          outgoing.push({ to: existing, color: colors[existing], toExisting: true });
        } else {
          lanes[lane] = p;
          colors[lane] = color;
          outgoing.push({ to: lane, color });
        }
      } else if (existing !== -1) {
        outgoing.push({ to: existing, color: colors[existing], toExisting: true });
      } else {
        const l = alloc();
        lanes[l] = p;
        const col = nextColor++ % LANE_COLORS;
        colors[l] = col;
        outgoing.push({ to: l, color: col });
      }
    });
    // recorta carriles libres del final
    while (lanes.length && lanes[lanes.length - 1] === null) { lanes.pop(); colors.pop(); }
    const used = Math.max(lane + 1, lanes.length, ...through.map((t) => t.lane + 1), ...incoming.map((t) => t.from + 1), ...outgoing.map((o) => o.to + 1));
    maxLanes = Math.max(maxLanes, used);
    rows.push({ sha: c.sha, lane, color, hasTop, incoming, through, outgoing, isMerge: parents.length > 1 });
  }
  return { rows, maxLanes };
}
