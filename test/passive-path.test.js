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
  assert.deepEqual(r.reasons, [{ code: 'NOT_ADJACENT', node: 4 }]);
});

test('a route that does not touch anything allocated cannot start', () => {
  const r = validatePath({ tree: tree(), path: [4, 3] });
  assert.equal(r.status, 'invalid');
  assert.equal(r.reasons[0].code, 'NO_START');
  assert.equal(r.reasons[0].node, 4);
});

test('an id the tree does not know is refused, not ignored', () => {
  const r = validatePath({ tree: tree(), path: [2, 999] });
  assert.equal(r.status, 'invalid');
  assert.ok(r.reasons.some((x) => x.code === 'UNKNOWN_NODE' && x.node === 999));
});

test('an ascendancy node without the class is unverified, not invalid', () => {
  const r = validatePath({ tree: tree(), path: [2, 3, 5] });
  assert.equal(r.status, 'unverified');
  assert.deepEqual(r.reasons, [{ code: 'ASCENDANCY_UNKNOWN', node: 5 }]);
});

test('the wrong ascendancy class is invalid; the right one passes', () => {
  const wrong = validatePath({ tree: tree(), path: [2, 3, 5], ascendancy: 'Deadeye' });
  assert.equal(wrong.status, 'invalid');
  assert.deepEqual(wrong.reasons, [{ code: 'WRONG_ASCENDANCY', node: 5 }]);
  const right = validatePath({ tree: tree(), path: [2, 3, 5], ascendancy: 'Necromancer' });
  assert.equal(right.status, 'ok');
});

test('a jewel socket without jewel data is unverified', () => {
  const r = validatePath({ tree: tree(), path: [2, 6], ascendancy: undefined });
  assert.equal(r.status, 'unverified');
  assert.deepEqual(r.reasons, [{ code: 'JEWEL_UNKNOWN', node: 6 }]);
});

test('no tree at all is unverified: the rule cannot be applied', () => {
  const r = validatePath({ tree: null, path: [2, 3] });
  assert.equal(r.status, 'unverified');
  assert.deepEqual(r.reasons, [{ code: 'NO_TREE' }]);
});

test('an empty route is rejected outright', () => {
  const r = validatePath({ tree: tree(), path: [] });
  assert.equal(r.status, 'invalid');
  assert.deepEqual(r.reasons, [{ code: 'EMPTY' }]);
});
