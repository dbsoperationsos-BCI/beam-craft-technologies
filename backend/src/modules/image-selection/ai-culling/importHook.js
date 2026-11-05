/**
 * The one hook from the upload flow into AI Culling: told where a photo lands as a READY upload
 * (or settles as a duplicate), after the fact, never awaited. A culling run that began with the
 * import and still waits for its photos is handed to the server's stages once its scope has
 * nothing left on the way - the server-analyzed ones, which nobody else would hand over.
 *
 * Coalesced per project: a batch of fifty landing in the same second asks the service once, a
 * moment after the last of them, and every failure is a warning, never an upload that fails.
 * `createImportHook` takes its service and clock so the coalescing can be checked with fakes.
 */
const SETTLE_MS = 1500;

function createImportHook({ service, settleMs = SETTLE_MS, setTimer = setTimeout, clearTimer = clearTimeout, log = console }) {
  const timers = new Map();
  function photoLanded(projectId) {
    if (!projectId) return;
    const pending = timers.get(projectId);
    if (pending) clearTimer(pending);
    const timer = setTimer(() => {
      timers.delete(projectId);
      Promise.resolve()
        .then(() => service.uploadsLanded(projectId))
        .then((handed) => { if (handed.length) log.log(`[ai-culling] import finished: run${handed.length === 1 ? "" : "s"} ${handed.join(", ")} of project ${projectId} handed to the server`); })
        .catch((error) => log.warn(`[ai-culling] could not hand over the import run of project ${projectId}: ${error.message}`));
    }, settleMs);
    if (typeof timer?.unref === "function") timer.unref();
    timers.set(projectId, timer);
  }
  return { photoLanded, pendingProjects: () => [...timers.keys()] };
}

let real = null;
// Lazy: the service pulls in the queue and Redis, which the derivative route must not load eagerly.
const service = () => real || (real = require("./service"));
module.exports = { ...createImportHook({ service: { uploadsLanded: (projectId) => service().uploadsLanded(projectId) } }), createImportHook };
