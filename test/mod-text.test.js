'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ranges, band, positionInBand } = require('../src/core/mod-text');

test('ranges come out of the modifier text in order', () => {
  assert.deepEqual(ranges('+(34-36) to Strength'), [{ min: 34, max: 36 }]);
  assert.deepEqual(ranges('Adds (5-8) to (12-15) Physical Damage'), [{ min: 5, max: 8 }, { min: 12, max: 15 }]);
  assert.deepEqual(ranges('+5 to Strength'), []);
});

test('a plain number is its own band', () => {
  assert.deepEqual(band('+5 to Strength'), { min: 5, max: 5 });
  assert.deepEqual(band('(34-36)'), { min: 34, max: 36 });
  assert.equal(band('no numbers here'), null);
});

test('a roll is placed inside its band, and outside means "not this tier"', () => {
  assert.equal(positionInBand('+(34-36) to Strength', 34), 0);
  assert.equal(positionInBand('+(34-36) to Strength', 36), 1);
  assert.equal(positionInBand('+(34-36) to Strength', 35), 0.5);
  assert.equal(positionInBand('+(34-36) to Strength', 33), null);
  assert.equal(positionInBand('+5 to Strength', 5), 1);
  assert.equal(positionInBand('+(34-36) to Strength', null), null);
});
