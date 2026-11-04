'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePath, FLAG } = require('../src/core/passive-path');

// A tiny tree: 1 -- 2 -- 3 -- 4, plus an ascendancy node 5 hanging off 3 and a
// jewel socket 6 hanging off 2. Node 1 is allocated in the build.
function tree(extra = {}) {
  return {
    nodes: [
      [1, 0, 0, 'start', FLAG.allocated, '', []],
      [2, 1, 0, 'two', 0, '', []],
      [3, 2, 0, 'three', 0, '', []],
      [4, 3, 0, 'four', 0, '', []],
      [5, 2, 1, 'ascendancy', FLAG.ascendancy, 'Necromancer', []],
      [6, 1, 1, 'socket', FLAG.jewelSocket, '', []],
    ],
    edges: [[1, 2], [2, 3], [3, 4], [3, 5], [2, 6]],
    ...extra,
  };
}

test('a walk that grows from an allocated node is accepted', () => {
  const r = validatePath({ tree: tree(), path: [2, 3, 4] });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.reasons, []);
  assert.equal(r.checked, 3);
});

test('skipping a node is a jump, not a shortcut', () => {
  const r = validatePath({ tree: tree(), path: [2, 4] });
  assert.equal(r.status, 'invalid');
  assert.deepEqual(r.reasons, ['NOT_ADJACENT']);
  assert.deepEqual(r.details, [{ code: 'NOT_ADJACENT', node: 4 }]);
});

test('a route that does not touch anything allocated cannot start', () => {
  const r = validatePath({ tree: tree(), path: [4, 3] });
  assert.equal(r.status, 'invalid');
  assert.deepEqual(r.reasons, ['NO_START']);
  assert.equal(r.details[0].node, 4);
});

test('an id the tree does not know is refused, not ignored', () => {
  const r = validatePath({ tree: tree(), path: [2, 999] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.reasons.includes('UNKNOWN_NODE'));
});

test('an ascendancy node without the class is unverified, not invalid', () => {
  const r = validatePath({ tree: tree(), path: [2, 3, 5] });
  assert.equal(r.status, 'unverified');
  assert.deepEqual(r.reasons, ['ASCENDANCY_MISSING']);
});

test('the wrong ascendancy class is invalid; the right one passes', () => {
  const wrong = validatePath({ tree: tree(), path: [2, 3, 5], ascendancy: 'Deadeye' });
  assert.equal(wrong.status, 'invalid');
  assert.deepEqual(wrong.reasons, ['WRONG_ASCENDANCY']);
  const right = validatePath({ tree: tree(), path: [2, 3, 5], ascendancy: 'Necromancer' });
  assert.equal(right.status, 'ok');
});

test('a jewel socket without jewel data is unverified', () => {
  const r = validatePath({ tree: tree(), path: [2, 6], ascendancy: undefined });
  assert.equal(r.status, 'unverified');
  assert.deepEqual(r.reasons, ['JEWEL_DATA_MISSING']);
});

test('no tree at all is unverified: the rule cannot be applied', () => {
  const r = validatePath({ tree: null, path: [2, 3] });
  assert.equal(r.status, 'unverified');
  assert.deepEqual(r.reasons, ['TREE_MISSING']);
});

test('an empty route is rejected outright', () => {
  const r = validatePath({ tree: tree(), path: [] });
  assert.equal(r.status, 'invalid');
  assert.deepEqual(r.reasons, ['EMPTY']);
});

// ---- draft editing rules ----

test('a node joins the draft only next to something already in it', () => {
  const t = tree();
  const { canAllocate } = require('../src/core/passive-path');
  const set = new Set([1]);
  assert.equal(canAllocate(t, set, 2).ok, true);
  assert.deepEqual(canAllocate(t, set, 4), { ok: false, reason: 'not-adjacent' });
  assert.deepEqual(canAllocate(t, set, 1), { ok: false, reason: 'already-allocated' });
  assert.deepEqual(canAllocate(t, set, 999), { ok: false, reason: 'not-in-tree' });
});

test('a node leaves the draft only when nothing hangs off it', () => {
  const t = tree();
  const { canDeallocate } = require('../src/core/passive-path');
  const set = new Set([1, 2, 3]);
  // 3 is a leaf (its only allocated neighbour is 2)
  assert.equal(canDeallocate(t, set, 3).ok, true);
  // 2 sits between 1 and 3: taking it out would orphan 3
  assert.deepEqual(canDeallocate(t, set, 2), { ok: false, reason: 'not-a-leaf' });
  assert.deepEqual(canDeallocate(t, set, 4), { ok: false, reason: 'not-allocated' });
});
