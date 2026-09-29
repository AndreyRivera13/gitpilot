import assert from 'assert';
import { computeGraph } from '../src/renderer/lib/graph.mjs';

// M merge de B y D ; B -> A ; D -> A
const commits = [
  { sha: 'M', parents: ['B', 'D'] },
  { sha: 'D', parents: ['A'] },
  { sha: 'B', parents: ['A'] },
  { sha: 'A', parents: [] },
];
const { rows, maxLanes } = computeGraph(commits);
assert.strictEqual(rows[0].lane, 0);
assert.strictEqual(rows[0].outgoing.length, 2);
assert.strictEqual(rows[1].lane, 1); // D en segundo carril
assert.strictEqual(rows[1].through.length, 1); // carril de B pasa por D
assert.strictEqual(rows[2].lane, 0);
assert.strictEqual(rows[2].outgoing[0].to, 1); // B converge hacia el carril de A
assert.strictEqual(rows[2].outgoing[0].toExisting, true);
assert.strictEqual(rows[3].hasTop, true);
assert.strictEqual(maxLanes, 2);
// lineal
const lin = computeGraph([{ sha: 'c', parents: ['b'] }, { sha: 'b', parents: ['a'] }, { sha: 'a', parents: [] }]);
assert.ok(lin.rows.every((r) => r.lane === 0));
assert.strictEqual(lin.maxLanes, 1);
console.log('graph ok');
