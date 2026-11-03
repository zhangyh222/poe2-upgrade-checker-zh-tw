'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createOperationQueue } = require('../src/core/operation-queue');
function gate() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

test('multi-step operations hold the lease until every step finishes', async () => {
  const queue = createOperationQueue(), pause = gate(), events = [];
  const a = queue.run(async () => { events.push('A-load'); await pause.promise; events.push('A-restore'); });
  const b = queue.run(async () => { events.push('B-load'); });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events, ['A-load']); pause.resolve(); await Promise.all([a, b]);
  assert.deepEqual(events, ['A-load', 'A-restore', 'B-load']);
});

test('a failed transaction does not poison the next operation', async () => {
  const queue = createOperationQueue();
  const a = queue.run(async () => { throw Error('engine stopped'); });
  const b = queue.run(async () => 'reloaded');
  await assert.rejects(a, /engine stopped/); assert.equal(await b, 'reloaded');
});

test('queued cancellation never starts the action', async () => {
  const queue = createOperationQueue(), pause = gate(), controller = new AbortController();
  const a = queue.run(() => pause.promise); let called = false;
  const b = queue.run(() => { called = true; }, { signal: controller.signal });
  controller.abort(); pause.resolve(); await a;
  await assert.rejects(b, { name: 'AbortError' }); assert.equal(called, false);
});

test('running cancellation retains the lease until safe completion', async () => {
  const queue = createOperationQueue(), pause = gate(), controller = new AbortController(); let started = false;
  const a = queue.run(() => pause.promise, { signal: controller.signal });
  const b = queue.run(() => { started = true; });
  await new Promise((r) => setImmediate(r)); controller.abort();
  assert.equal(started, false); pause.resolve();
  await assert.rejects(a, { name: 'AbortError' }); await b; assert.equal(started, true);
});
