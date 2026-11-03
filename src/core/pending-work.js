'use strict';

// Work the UI may cancel while it runs. Path of Building is a single Lua process
// and cannot be interrupted halfway through a calculation, so "cancel" means: take
// the work out of this table, stop the engine (its next use reloads the build), and
// let the caller report "cancelled" instead of a stale result.
//
// begin() returns a handle the caller must finish() in a finally block: a finished
// operation can never be cancelled afterwards, which is what stops a late click
// from killing an engine that is already serving the next request.

function createPendingWork() {
  const ops = new Map();
  // ids the user cancelled, so a caller can report "cancelled" instead of
  // whatever half-finished answer the engine managed to produce
  const cancelled = new Set();

  function begin(id, cancel) {
    const op = { id, cancel, done: false };
    ops.set(id, op);
    const handle = {
      id,
      finish() {
        op.done = true;
        if (ops.get(id) === op) ops.delete(id);
      },
      cancel() {
        if (op.done || ops.get(id) !== op) return false;
        op.done = true;
        ops.delete(id);
        if (typeof op.cancel === 'function') op.cancel();
        return true;
      },
    };
    return handle;
  }

  // returns true when this call is the one that cancelled the work
  function cancel(id) {
    const op = id ? ops.get(id) : null;
    if (!op || op.done) return false;
    op.done = true;
    ops.delete(id);
    cancelled.add(id);
    if (cancelled.size > 100) cancelled.delete(cancelled.values().next().value);
    if (typeof op.cancel === 'function') op.cancel();
    return true;
  }

  return {
    begin, cancel,
    size: () => ops.size,
    has: (id) => !!ops.get(id),
    wasCancelled: (id) => (id ? cancelled.has(id) : false),
  };
}

module.exports = { createPendingWork };
