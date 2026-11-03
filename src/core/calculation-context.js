'use strict';

class StaleCalculationError extends Error {
  constructor() {
    super('Your character or build changed. Check the item again.');
    this.name = 'StaleCalculationError';
    this.code = 'STALE_CALCULATION';
  }
}

// Keep an immutable identity across awaits. The owner supplies character, build
// generation and calculation settings; a switch away and back changes generation.
function createCalculationContext(readIdentity) {
  let nextId = 0;
  const live = new WeakMap();
  const fingerprint = () => JSON.stringify(readIdentity());
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function capture(scope = {}) {
    const identity = fingerprint();
    const token = freeze({ requestId: ++nextId, ...JSON.parse(identity), scope: JSON.parse(JSON.stringify(scope)) });
    live.set(token, identity);
    return token;
  }
  function isCurrent(token) { return live.has(token) && live.get(token) === fingerprint(); }
  function assertCurrent(token) { if (!isCurrent(token)) throw new StaleCalculationError(); }
  async function run(token, action) {
    assertCurrent(token);
    const result = await action();
    assertCurrent(token);
    return result;
  }
  return { capture, isCurrent, assertCurrent, run };
}

module.exports = { createCalculationContext, StaleCalculationError };
