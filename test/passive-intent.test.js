'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../src/core/passive-intent');

test('maximum shield, % shield, recharge rate and delay are four different things', () => {
  assert.deepEqual(classify(['+40 to maximum Energy Shield']), ['maxShield']);
  assert.deepEqual(classify(['15% increased Energy Shield']), ['esPercent']);
  assert.deepEqual(classify(['20% faster start of Energy Shield Recharge']), ['rechargeRate']);
  assert.deepEqual(classify(['30% increased Energy Shield Recharge Rate']), ['rechargeRate']);
  assert.deepEqual(classify(['20% reduced Energy Shield Recharge Delay']), ['rechargeDelay']);
});

test('a recharge mod that also says "increased Energy Shield" is not a shield % roll', () => {
  const kinds = classify(['30% increased Energy Shield Recharge Rate']);
  assert.ok(!kinds.includes('esPercent'), JSON.stringify(kinds));
});

test('a node can carry several categories and they keep a stable order', () => {
  assert.deepEqual(classify(['+20 to maximum Energy Shield', '10% increased maximum Life']), ['maxShield', 'life']);
});

test('nothing recognisable is an empty list, not a guess', () => {
  assert.deepEqual(classify(['12% increased Attack Speed']), []);
  assert.deepEqual(classify([]), []);
});
