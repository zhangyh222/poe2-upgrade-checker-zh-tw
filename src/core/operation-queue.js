'use strict';

function cancelled() {
  const error = new Error('Calculation cancelled.');
  error.name = 'AbortError';
  return error;
}

// A cancelled running operation retains the lease until it settles. Releasing
// early would let the next operation reuse an engine that is still mutating.
function createOperationQueue() {
  let tail = Promise.resolve();
  function run(action, { signal } = {}) {
    const result = tail.then(async () => {
      if (signal && signal.aborted) throw cancelled();
      const value = await action();
      if (signal && signal.aborted) throw cancelled();
      return value;
    });
    tail = result.catch(() => {});
    return result;
  }
  return { run };
}

module.exports = { createOperationQueue };
