/**
 * The module assistant's thread, for as long as the page is open.
 *
 * A plain object in module scope, which is the whole trick: it outlives the panel being closed and
 * reopened, and outlives navigating between screens, because the floating button lives in the app
 * shell and this module is loaded once. A refresh throws the whole JavaScript context away and the
 * conversation goes with it.
 *
 * **Deliberately not `sessionStorage`.** The name suggests it is the right tool and it is not:
 * `sessionStorage` survives a reload, and surviving a reload is precisely what this must not do.
 * `localStorage` is further still from what is wanted. Memory is the only store with the lifetime
 * being asked for.
 *
 * Keyed by module, so walking from the CRM to Assets starts a fresh thread rather than carrying a
 * conversation about leads into a question about cameras.
 *
 * The lead assistant does not use this. Its conversations are kept per lead in `localStorage` and
 * are meant to persist - a note about a client is worth having tomorrow, whereas a scratchpad
 * beside a dashboard is not.
 */

const threads = new Map();

/** What has been said in this module, this page-load. Never null - an empty thread is a thread. */
export function readThread(module) {
  return threads.get(String(module || "")) || [];
}

/**
 * Replaces a module's thread.
 *
 * Stores a copy rather than the caller's array. React hands back a new array on every change, but a
 * caller that mutated one in place would otherwise be editing what is stored here as a side effect.
 */
export function writeThread(module, turns) {
  const key = String(module || "");
  if (!key) return;
  threads.set(key, Array.isArray(turns) ? [...turns] : []);
}

/** Forgets one module's thread, or all of them. */
export function clearThread(module) {
  if (module === undefined) threads.clear();
  else threads.delete(String(module || ""));
}

/**
 * The thread as the server needs it: roles and content, nothing else.
 *
 * A turn that failed is left out - an error message is not something the model said, and feeding it
 * back invites it to apologise for something it did not do. Empty turns go too: the placeholder an
 * answer streams into is a turn with no content until the first token arrives.
 */
export function historyFor(module) {
  return readThread(module)
    .filter((turn) => !turn.error && typeof turn.content === "string" && turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));
}
