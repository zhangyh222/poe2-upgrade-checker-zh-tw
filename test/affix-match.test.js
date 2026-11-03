'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, firstValue, createMatcher } = require('../src/core/affix-match');

const STRENGTH = {
  group: 'Strength', type: 'Suffix',
  tiers: [
    { tier: 1, text: '+(34-36) to Strength', level: 81 },
    { tier: 2, text: '+(31-33) to Strength', level: 74 },
    { tier: 9, text: '+(5-8) to Strength', level: 1 },
  ],
};
const matcher = createMatcher([STRENGTH]);

test('the shape ignores the numbers, the value picks the tier', () => {
  assert.equal(normalize('+(34-36) to Strength'), normalize('+35 to Strength'));
  assert.equal(firstValue('+35 to Strength'), 35);
  const hit = matcher.match('+35 to Strength');
  assert.equal(hit.group, 'Strength');
  assert.equal(hit.tier, 1);
  assert.equal(hit.confidence, 'exact');
  assert.equal(hit.position, 0.5);
});

test('another band of the same shape is a different tier', () => {
  assert.equal(matcher.match('+7 to Strength').tier, 9);
  assert.equal(matcher.match('+32 to Strength').tier, 2);
});

test('a roll outside every band is range-only, not a confident tier', () => {
  const hit = matcher.match('+99 to Strength');
  assert.equal(hit.confidence, 'range-only');
  assert.equal(hit.position, null);
});

test('an unknown line is null, not a guess', () => {
  assert.equal(matcher.match('12% increased Attack Speed'), null);
});
