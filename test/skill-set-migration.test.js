'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planMigration } = require('../src/core/skill-set-migration');

const skills = [
  { id: 1, key: 'Twister|Barrage', label: 'Twister' },
  { id: 2, key: 'Herald of Ash', label: 'Herald of Ash' },
];

test('the old manual mark becomes a set1/set2 edit on the matching skill', () => {
  const { edits, leftover } = planMigration({ 'main|Twister|Barrage': '2', 'main|Herald of Ash': '12' }, 'main', skills);
  assert.deepEqual(edits, [
    { id: 1, key: 'Twister|Barrage', set1: false, set2: true, label: 'Twister' },
    { id: 2, key: 'Herald of Ash', set1: true, set2: true, label: 'Herald of Ash' },
  ]);
  assert.deepEqual(leftover, {});
});

test('another character\'s marks are left alone, not migrated into this build', () => {
  const { edits, leftover } = planMigration({ 'pabc|Twister|Barrage': '1' }, 'main', skills);
  assert.deepEqual(edits, []);
  assert.deepEqual(leftover, {});
});

test('a key whose gem no longer exists is reported as leftover, never guessed', () => {
  const { edits, leftover } = planMigration({ 'main|Removed Skill': '1' }, 'main', skills);
  assert.deepEqual(edits, []);
  assert.deepEqual(leftover, { 'main|Removed Skill': '1' });
});

test('an unknown value is leftover rather than mapped to something', () => {
  const { edits, leftover } = planMigration({ 'main|Herald of Ash': 'both' }, 'main', skills);
  assert.deepEqual(edits, []);
  assert.deepEqual(leftover, { 'main|Herald of Ash': 'both' });
});

test('one skill is edited once even if two keys point at it', () => {
  const { edits } = planMigration({ 'main|Herald of Ash': '1' }, 'main', skills);
  assert.equal(edits.length, 1);
});

test('a weapon-slot skill is resolved by the build, not edited and not leftover', () => {
  const locked = [{ id: 3, key: 'Spear Throw', label: 'Spear Throw', locked: true }];
  const { edits, resolved, leftover } = planMigration({ 'main|Spear Throw': '2' }, 'main', locked);
  assert.deepEqual(edits, []);
  assert.deepEqual(resolved, [{ id: 3, key: 'Spear Throw', label: 'Spear Throw', reason: 'weapon slot' }]);
  assert.deepEqual(leftover, {});
});
