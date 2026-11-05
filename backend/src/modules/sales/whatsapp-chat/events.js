const { EventEmitter } = require("node:events");

/*
 * ── When a conversation changes, and who is watching it ───────────────────────────────────────
 *
 * The chat panel used to find out that a client had replied by asking, over and over: it re-read
 * the whole thread every 1.2 seconds and compared. That is a reply landing up to a second and a
 * half after it arrived, a request per open panel per second whether or not anything had happened,
 * and - because nothing stopped one poll starting before the last had answered - a queue of
 * overlapping requests that got *slower* the longer a thread was.
 *
 * So the server says so instead. Every write to a thread announces itself here, and the panel holds
 * a stream open and is told. A reply now reaches the screen in about the time one round trip takes.
 *
 * ── Why an emitter and not a queue ──
 *
 * Because this is already a single-process design and cannot be otherwise: the WhatsApp socket for
 * a signed-in CRM is a live connection held in this process's memory by `sessionManager`, and a
 * second API process would not have it. Everything that could publish here is therefore in the same
 * process as everything that could subscribe, and a Redis channel between them would be two network
 * hops to deliver a message to itself.
 *
 * If the API is ever run as more than one process, the session manager is what breaks first and by
 * a long way - this would need the same treatment at the same time, and the note is here so that
 * whoever does it finds it.
 *
 * ── What is published ──
 *
 * That a thread changed, and nothing else. Not the message: the panel re-reads the thread through
 * the endpoint it already used, so the shape of a message, what counts as visible and how a
 * reaction folds onto its target are all decided in exactly one place. Pushing the message itself
 * would be one round trip faster and would duplicate every one of those rules in the browser, where
 * they would drift.
 */

const bus = new EventEmitter();
// One listener per open panel, and no ceiling on how many CRMs may have one open at once. The
// default of ten is a leak warning, and here it would fire on the eleventh perfectly ordinary user.
bus.setMaxListeners(0);

const CHANGED = "thread-changed";

/**
 * Says that a lead's conversation has changed.
 *
 * `reason` is for the log and for the client's own tracing - "message", "status", "reaction" - and
 * nothing branches on it. Never throws: an announcement that cannot be made must not fail the write
 * it is announcing, and the panel's fallback poll is what covers the gap.
 */
function publishThreadChange({ enquiryId, reason = "message" } = {}) {
  const id = String(enquiryId || "").trim();
  if (!id) return;
  try {
    bus.emit(CHANGED, { enquiryId: id, reason, at: Date.now() });
  } catch (error) {
    console.warn("WhatsApp thread change not announced:", error?.message || error);
  }
}

/**
 * Watches one lead's conversation. Returns the function that stops watching.
 *
 * Filtered here rather than by the caller so a panel is woken only by its own thread: one CRM
 * reading a lead must not be re-fetching because a colleague's client replied.
 */
function subscribeToThread(enquiryId, listener) {
  const id = String(enquiryId || "").trim();
  const handler = (event) => {
    if (event.enquiryId !== id) return;
    try {
      listener(event);
    } catch (error) {
      console.warn("WhatsApp thread listener failed:", error?.message || error);
    }
  };
  bus.on(CHANGED, handler);
  return () => bus.off(CHANGED, handler);
}

module.exports = { publishThreadChange, subscribeToThread };
