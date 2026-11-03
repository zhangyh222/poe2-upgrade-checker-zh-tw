'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dedupeCandidates } = require('../src/core/listing-dedupe');

const listed = (name, baseType, priceText) => ({ id: `${name}-${priceText}`, name, baseType, priceText });

test('the same item sold by several sellers is one candidate that counts them', () => {
  const out = dedupeCandidates([
    listed('Skysliver', 'Winged Spear', '2 chaos'),
    listed('Skysliver', 'Winged Spear', '4 chaos'),
    listed('Skysliver', 'Winged Spear', '5 chaos'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].listings, 3);
  assert.equal(out[0].priceText, '2 chaos', 'the cheapest listing is the one kept (list arrives price-sorted)');
});

test('different bases and different names stay separate candidates', () => {
  const out = dedupeCandidates([
    listed('Skysliver', 'Winged Spear', '2 chaos'),
    listed('Skysliver', 'Winged Spear Two', '3 chaos'),
    listed('Stormveil', 'Winged Spear', '4 chaos'),
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((c) => c.listings), [1, 1, 1]);
});

test('name matching ignores case, and an empty base still keys on the name', () => {
  const out = dedupeCandidates([
    listed('Skysliver', '', '1 chaos'),
    listed('skysliver', '', '2 chaos'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].listings, 2);
});
