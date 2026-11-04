'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { translate, verifyGlossary, hasChinese } = require('../src/core/zh-query');

test('a Chinese term becomes the English wording the game data uses', () => {
  assert.deepEqual(translate('能量護盾'), { english: 'energy shield', hits: ['energy shield'], dropped: '', partial: false });
  const many = translate('最大能量護盾');
  assert.equal(many.english, 'maximum energy shield');
  assert.deepEqual(many.hits.slice().sort(), ['energy shield', 'maximum']);
  assert.equal(many.partial, false);
});

test('untranslatable Chinese is dropped and reported, not searched as-is', () => {
  const r = translate('量子力學');
  assert.equal(r.partial, true);
  assert.equal(r.english, '');
  assert.equal(r.dropped, '量子力學');
});

test('longer forms win over their own substrings', () => {
  // 移動速度 must not become 速度 (which is not a term) or split into 移動 + 速度
  assert.equal(translate('移動速度').english, 'movement speed');
  assert.equal(translate('攻擊速度').english, 'attack speed');
});

test('English input is left alone', () => {
  assert.deepEqual(translate('energy shield'), { english: 'energy shield', hits: [], dropped: '', partial: false });
  assert.equal(hasChinese('energy shield'), false);
});

test('a known term inside an unknown phrase still translates', () => {
  const r = translate('量子護盾');
  assert.equal(r.english, 'energy shield');
  assert.equal(r.dropped, '量子'); // said out loud, so the caller can warn
  assert.equal(r.partial, false);
});

test('the glossary matches the zh-TW dictionary the app ships', () => {
  const file = path.join(__dirname, '..', 'src', 'data', 'zh-tw.json');
  const dict = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(verifyGlossary(dict), [], 'every Chinese form must appear in the game dictionary');
});

// a phrase the glossary does not list still has to reach the tree: the game
// dictionary says which English words it appears in
test('an unlisted Chinese phrase falls back to the dictionary instead of dead-ending', () => {
  const dict = require('../src/data/zh-tw.json');
  const { hintsFromDict } = require('../src/core/zh-query');
  const hints = hintsFromDict('護體', dict);
  assert.ok(hints.length > 0, 'expected at least one English hint');
  assert.ok(hints.some((h) => h === 'fortification' || h === 'fortified'), JSON.stringify(hints.slice(0, 5)));
});

test('compensation is a word the glossary knows', () => {
  const { translate } = require('../src/core/zh-query');
  assert.equal(translate('补偿').english, 'compensated');
  assert.equal(translate('補償').english, 'compensated');
});

test('half a node name is answered by the names catalog', () => {
  const dict = require('../src/data/zh-tw.json');
  const { namesFromDict } = require('../src/core/zh-query');
  const names = namesFromDict('高貴', dict);
  assert.ok(names.includes('the noble wolf'), JSON.stringify(names.slice(0, 4)));
  // the article is dropped too, because the tree stores "Noble Wolf"
  assert.ok(names.includes('noble wolf'), JSON.stringify(names.slice(0, 4)));
});
