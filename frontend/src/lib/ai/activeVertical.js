/**
 * Which of the studio's three businesses the CRM is currently showing.
 *
 * The CRM board is one screen with a vertical switch on it - Dum Dum, Qua Qua, Corp - and the
 * assistant floats above the whole application, so it has no way to see that switch. This is the
 * thread between them: the CRM writes what it is showing, the assistant reads it.
 *
 * A tiny module rather than a context provider, because the two components are nowhere near each
 * other in the tree and threading a provider through the app shell for one string would be more
 * moving parts than the problem deserves.
 *
 * It is a hint, not a permission. The backend validates it against its own registry, and narrowing
 * to a vertical only ever narrows - somebody with CRM access may see all three anyway. Writing
 * nonsense here scopes the assistant to nothing rather than widening it.
 */

const KEY = "dbs_ai_active_vertical";
// Anyone listening - the floating button - is told when the board changes.
const EVENT = "dbs-ai-vertical-change";

/** Records the vertical the CRM is showing. */
export function setActiveVertical(vertical) {
  const value = String(vertical || "").trim();
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(KEY, value);
    else window.localStorage.removeItem(KEY);
  } catch {
    // A private window, or blocked site data. The assistant simply stays unscoped.
  }
  // So an open panel follows the switch rather than answering about the previous board.
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

/** The vertical the CRM is showing, or an empty string. */
export function getActiveVertical() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

/** Calls back whenever the CRM switches board. Returns an unsubscribe. */
export function onVerticalChange(handler) {
  if (typeof window === "undefined") return () => {};
  const listener = (event) => handler(event.detail || "");
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

export const VERTICAL_EVENT = EVENT;
