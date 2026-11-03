'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeGuards, evaluateGuards, overall } = require('../src/core/guard-conditions');

const before = { Life: 2000, ColdResistTotal: 75, MovementSpeedMod: 1.3, TotalEHP: 7000, FullDPS: 100000 };
const after = { Life: 1900, ColdResistTotal: 80, MovementSpeedMod: 1.3, TotalEHP: 7200, FullDPS: 105000 };

test('global, slot and temporary conditions are all kept, each with its own layer', () => {
  const g = mergeGuards({
    global: [{ metric: 'coldRes', op: 'min', value: 75, unit: 'percent' }],
    slot: [{ metric: 'movementSpeed', op: 'keep', slot: 'Boots' }], slotName: 'Boots',
    search: [{ metric: 'life', op: 'min', value: 1800 }],
  });
  assert.equal(g.conflicts.length, 0);
  assert.equal(g.effective.length, 3);
  assert.deepEqual(g.effective.map((c) => c.layer), ['global', 'slot', 'search']);
});

test('a temporary condition may not loosen an inherited one', () => {
  const g = mergeGuards({
    global: [{ metric: 'coldRes', op: 'min', value: 75 }],
    search: [{ metric: 'coldRes', op: 'min', value: 60 }],
  });
  assert.equal(g.conflicts.length, 1);
  assert.match(g.conflicts[0].reason, /looser/);
  // the inherited bar survives
  assert.equal(g.effective.find((c) => c.metric === 'coldRes').value, 75);
});

test('a temporary condition may tighten an inherited one', () => {
  const g = mergeGuards({
    global: [{ metric: 'coldRes', op: 'min', value: 75 }],
    search: [{ metric: 'coldRes', op: 'min', value: 80 }],
  });
  assert.equal(g.conflicts.length, 0);
  assert.equal(g.effective.find((c) => c.metric === 'coldRes').value, 80);
});

test('replacing an inherited "keep" with a threshold is a conflict, not an override', () => {
  const g = mergeGuards({ slot: [{ metric: 'movementSpeed', op: 'keep', slot: 'Boots' }], slotName: 'Boots', search: [{ metric: 'movementSpeed', op: 'min', value: 20 }] });
  assert.equal(g.conflicts.length, 1);
  assert.equal(g.effective.find((c) => c.metric === 'movementSpeed').op, 'keep');
});

test('evaluation: pass, fail and unverified are three different things', () => {
  const g = mergeGuards({
    global: [{ metric: 'coldRes', op: 'min', value: 75 }, { metric: 'life', op: 'keep' }, { metric: 'spirit', op: 'min', value: 100 }],
  });
  const rows = evaluateGuards(g, before, after);
  const byMetric = Object.fromEntries(rows.map((r) => [r.metric, r.status]));
  assert.equal(byMetric.coldRes, 'pass'); // 80 >= 75
  assert.equal(byMetric.life, 'fail'); // 1900 < 2000
  assert.equal(byMetric.spirit, 'unverified'); // PoB reported nothing
  assert.equal(overall(rows), 'fail', 'any fail is a fail');
});

test('no failures but missing data is unverified, never a pass', () => {
  const g = mergeGuards({ global: [{ metric: 'spirit', op: 'min', value: 100 }] });
  const rows = evaluateGuards(g, before, after);
  assert.equal(overall(rows), 'unverified');
});

test('no conditions is unverified, not a green pass', () => {
  assert.equal(overall([]), 'unverified');
});

test('a condition that belongs to one weapon set is unverified while comparing the other', () => {
  const g = mergeGuards({ slot: [{ metric: 'dps', op: 'keep', slot: 'Weapon', weaponSet: 2 }] });
  const rows = evaluateGuards(g, before, after, { weaponSet: 1 });
  assert.equal(rows[0].status, 'unverified');
  assert.match(rows[0].reason, /weapon set 2/);
});

test('an unknown metric is refused instead of guessed', () => {
  assert.throws(() => mergeGuards({ global: [{ metric: 'nope', op: 'min', value: 1 }] }), { code: 'UNKNOWN_METRIC' });
  assert.throws(() => mergeGuards({ global: [{ metric: 'life', op: 'min' }] }), { code: 'INVALID_CONDITION' });
});

