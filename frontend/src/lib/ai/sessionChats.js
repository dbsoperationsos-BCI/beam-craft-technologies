/**
 * The module assistant's thread: one conversation across every section, kept while it is in use.
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
 * **One thread, not one per section.** It was keyed by module, so asking in Projects and walking to
 * HRM showed an empty panel - the conversation was still there, filed under a screen you had left.
 * Each turn now carries the section it was asked in, so the thread can say where it moved; what the
 * answer may read is still the section's own, decided by the server for every question.
 *
 * **Forgotten after 30 minutes of quiet.** Counted from the last question asked or answer received -
 * not from opening the panel, which is looking rather than talking - so a thread from this morning
 * does not lead an afternoon question astray.
 *
 * The lead assistant does not use this. Its conversations are kept per lead in `localStorage` and
 * are meant to persist - a note about a client is worth having tomorrow, whereas a scratchpad
 * beside a dashboard is not.
 */

export const IDLE_LIMIT_MS = 30 * 60 * 1000;

let thread = [];
let lastActiveAt = 0;

/** When the thread is forgotten, or 0 while there is nothing to forget. */
export function expiresAt() {
  return thread.length && lastActiveAt ? lastActiveAt + IDLE_LIMIT_MS : 0;
}

/** Forgets the conversation. */
export function clearThread() {
  thread = [];
  lastActiveAt = 0;
}

/** What has been said, unless it has gone quiet for too long. Never null - an empty thread is a thread. */
export function readThread(now = Date.now()) {
  const expiry = expiresAt();
  if (expiry && now >= expiry) clearThread();
  return thread;
}

/**
 * Replaces the thread.
 *
 * Stores a copy rather than the caller's array. React hands back a new array on every change, but a
 * caller that mutated one in place would otherwise be editing what is stored here as a side effect.
 * Writing is not activity - the panel writes what it was handed back the moment it opens.
 */
export function writeThread(turns) {
  thread = Array.isArray(turns) ? [...turns] : [];
  if (!thread.length) lastActiveAt = 0;
}

/** A question was asked or an answer arrived: the 30 minutes start again from now. */
export function markActive(now = Date.now()) {
  lastActiveAt = now;
}

/**
 * The thread as the server needs it: roles and content, nothing else.
 *
 * A turn that failed is left out - an error message is not something the model said, and feeding it
 * back invites it to apologise for something it did not do. Empty turns go too: the placeholder an
 * answer streams into is a turn with no content until the first token arrives.
 */
export function historyFor(now = Date.now()) {
  return readThread(now)
    .filter((turn) => !turn.error && typeof turn.content === "string" && turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));
}
