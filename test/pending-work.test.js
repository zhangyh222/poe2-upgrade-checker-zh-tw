'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPendingWork } = require('../src/core/pending-work');

test('cancelling runs the canceller once and only while the work is live', () => {
  const work = createPendingWork();
  let calls = 0;
  work.begin('op-1', () => { calls++; });
  assert.equal(work.size(), 1);
  assert.equal(work.cancel('op-1'), true);
  assert.equal(calls, 1);
  assert.equal(work.cancel('op-1'), false, 'a cancelled operation cannot be cancelled again');
  assert.equal(work.size(), 0);
});

test('finished work cannot be cancelled: a late click must not stop the engine', () => {
  const work = createPendingWork();
  let calls = 0;
  const handle = work.begin('op-2', () => { calls++; });
  handle.finish();
  assert.equal(work.cancel('op-2'), false);
  assert.equal(handle.cancel(), false);
  assert.equal(calls, 0);
  assert.equal(work.size(), 0);
});

test('the handle cancel and the table cancel are the same decision', () => {
  const work = createPendingWork();
  let calls = 0;
  const handle = work.begin('op-3', () => { calls++; });
  assert.equal(handle.cancel(), true);
  assert.equal(work.cancel('op-3'), false);
  assert.equal(calls, 1);
});

test('a cancelled id stays knowable, so the caller can report "cancelled"', () => {
  const work = createPendingWork();
  work.begin('op-4', () => {});
  assert.equal(work.wasCancelled('op-4'), false);
  work.cancel('op-4');
  assert.equal(work.wasCancelled('op-4'), true);
  assert.equal(work.wasCancelled('other'), false);
});

test('an unknown id is not a cancellation', () => {
  const work = createPendingWork();
  assert.equal(work.cancel('nope'), false);
  assert.equal(work.cancel(), false);
  assert.equal(work.size(), 0);
});
