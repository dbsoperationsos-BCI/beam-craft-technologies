/**
 * Answers remembered for the length of one request, and no longer.
 *
 * One click on a screen passes several permission guards and scope checks - the notification bell
 * alone asks six - and each of them used to read the user, their roles and every grant of those
 * roles from the database again: eight to ten queries a check, the same answer every time. Held
 * here, the first check reads them and the rest of the request reuses the answer.
 *
 * **Nothing outlives the request.** A role edited in Role Management, a user deactivated, a grant
 * removed - the very next request reads them fresh, exactly as before. There is no expiry to get
 * wrong and nothing to invalidate across requests.
 *
 * Outside a request (a worker, a scheduled job, a test calling a service directly) there is no
 * store, and `remember` simply loads.
 *
 * **A timer or background task must not be started from inside a request** if it will read
 * permissions later: it inherits that request's store for its whole life and would keep reading
 * the answers of that moment. Start such work at boot, as the scheduled jobs in `server.js` are.
 */
const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();

/** Express middleware: everything this request does shares one store. */
function requestCache(req, res, next) {
  storage.run(new Map(), next);
}

/**
 * `load()`'s answer under `key` for the rest of this request. The promise itself is kept, so two
 * checks asking at the same moment share one query; a load that fails is forgotten, so a retry
 * inside the same request reads again.
 */
function remember(key, load) {
  const store = storage.getStore();
  if (!store) return load();
  if (!store.has(key)) {
    const pending = Promise.resolve().then(load);
    store.set(key, pending);
    pending.catch(() => store.delete(key));
  }
  return store.get(key);
}

/** Drops everything this request remembered - after a write that changes what was read. */
function forgetRequestCache() {
  storage.getStore()?.clear();
}

module.exports = { requestCache, remember, forgetRequestCache };
