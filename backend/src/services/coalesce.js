/*
 * Background work that must not pile up: one run per key at a time in this process. Asks before it
 * starts are folded into it; asks while it runs come to exactly one more run after it, never one
 * beside it. So a burst - a run of holiday edits, a double-click, a shift's logouts - never stacks up
 * the same work twice.
 *
 * Each caller makes its own (`createCoalescer()`), so two kinds of work never share a key by accident.
 * `coalesce(key, run, failed)`: `run` returns a promise; `failed(error)` is told of a failure, which is
 * never thrown - this is work done after the answer has gone.
 */
function createCoalescer() {
  const waiting = new Set();
  const running = new Set();
  const again = new Set();

  function coalesce(key, run, failed) {
    if (waiting.has(key)) return;
    if (running.has(key)) { again.add(key); return; }
    const go = () => {
      waiting.delete(key);
      running.add(key);
      run().catch(failed).finally(() => {
        running.delete(key);
        if (again.delete(key)) coalesce(key, run, failed);
      });
    };
    waiting.add(key);
    setImmediate(go);
  }

  return coalesce;
}

module.exports = { createCoalescer };
