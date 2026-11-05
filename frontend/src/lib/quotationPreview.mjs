/**
 * The Quotation Generator's Preview: one tab, kept up to date with the unsaved form on request.
 *
 * Nothing is written to the server to preview. Each time the generator is opened it starts a
 * **preview session** - a random id - and Preview works in that session alone:
 *
 * - The first press keeps the form in session storage under the session id and opens
 *   `/q/preview/<session>` in a tab named for the session. The browser copies the opener's session
 *   storage into the tab it opens, so the new tab finds the form there.
 * - While the tab is open the generator also sends it the form by itself, a moment after editing
 *   stops (`AUTO_SYNC_DELAY_MS`), and the tab answers RENDERED or FAILED once the server has drawn
 *   it - which is what the generator's "Preview up to date" waits for.
 * - Every later press, while that tab is still open, sends the form to it as a message
 *   (`window.postMessage`, to this origin only) and brings it forward - no second tab. A tab that
 *   was closed is simply opened again.
 * - Each form carries a sequence number, rising with every press. The tab keeps the highest it has
 *   seen, refuses an older one, and drops a server answer that comes back for anything but the
 *   newest - so pressing twice quickly can never leave the earlier quotation on screen.
 * - The tab keeps the newest form in its own session storage, so reloading it shows the latest, and
 *   on loading it asks the generator for anything newer.
 * - When the generator closes it says so, and the tab keeps showing the last quotation it was sent,
 *   marked as no longer updating - never another quotation's.
 *
 * Messages are accepted only from this origin, only from the window that opened the tab (or the tab
 * itself, for the generator), and only for the tab's own session, so two quotations open in two
 * generators can never cross. Each tab posts the quotation to `POST /api/sales/quotations/preview`
 * under the signed-in person's session; nothing is saved.
 */
export const PREVIEW_STORAGE_PREFIX = "dbs.quotation.preview.";
export const PREVIEW_CHANNEL = "dbs.quotation.preview";
export const MAX_KEPT_PREVIEWS = 3;
// How long editing has to pause before the open preview is brought up to date by itself.
export const AUTO_SYNC_DELAY_MS = 800;
// UPDATE and CLOSED go to the tab; READY, RENDERED and FAILED come back from it.
export const PREVIEW_MESSAGE_TYPES = Object.freeze({ UPDATE: "update", READY: "ready", CLOSED: "closed", RENDERED: "rendered", FAILED: "failed" });

const defaultStorage = () => (typeof window === "undefined" ? null : window.sessionStorage);
// A UUID, or 16 random bytes as hex where a browser has no randomUUID - never Math.random.
export const newPreviewSession = () => (globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""));
const randomKey = newPreviewSession;
const SESSION_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

/** The path the preview tab opens. */
export const quotationPreviewPath = (key) => `/q/preview/${encodeURIComponent(key)}`;
/** The tab's name: one per preview session, so a second quotation's preview is a tab of its own. */
export const previewWindowName = (session) => `dbs-quotation-preview-${session}`;

/**
 * Keeps `payload` for a preview tab and answers its key, or null when there is nowhere to keep it
 * (no storage, or storage refused it - full, or blocked). `seq` is the press it came from; `closed`
 * marks a preview whose generator has gone, so a reload still says so.
 */
export function stashQuotationPreview(payload, { storage = defaultStorage(), now = Date.now(), key = randomKey(), seq = 0, closed = false } = {}) {
  if (!storage || !payload) return null;
  try {
    const name = `${PREVIEW_STORAGE_PREFIX}${key}`;
    const kept = [];
    for (let index = 0; index < storage.length; index += 1) {
      const existing = storage.key(index);
      if (existing?.startsWith(PREVIEW_STORAGE_PREFIX) && existing !== name) {
        let savedAt = 0;
        try { savedAt = Number(JSON.parse(storage.getItem(existing))?.savedAt) || 0; } catch { savedAt = 0; }
        kept.push({ name: existing, savedAt });
      }
    }
    // Room for this one: the oldest go first.
    kept.sort((a, b) => b.savedAt - a.savedAt).slice(MAX_KEPT_PREVIEWS - 1).forEach((entry) => storage.removeItem(entry.name));
    storage.setItem(name, JSON.stringify({ savedAt: now, seq, closed, payload }));
    return key;
  } catch {
    return null;
  }
}

/** Everything kept for a preview - `{ payload, seq, closed }` - or null when it is not there or not readable. */
export function readQuotationPreviewEntry(key, { storage = defaultStorage() } = {}) {
  if (!storage || !key) return null;
  try {
    const stored = JSON.parse(storage.getItem(`${PREVIEW_STORAGE_PREFIX}${key}`));
    if (!stored?.payload || typeof stored.payload !== "object") return null;
    return { payload: stored.payload, seq: Number.isInteger(stored.seq) ? stored.seq : 0, closed: stored.closed === true };
  } catch {
    return null;
  }
}

/** The quotation a preview tab was opened for, or null when it is not there (or not readable). */
export function readQuotationPreview(key, options) {
  return readQuotationPreviewEntry(key, options)?.payload || null;
}

/** One message between the generator and its preview tab. */
export function previewMessage(type, session, seq = 0, payload = null, message = "") {
  return { channel: PREVIEW_CHANNEL, type, session, seq, ...(payload ? { payload } : {}), ...(message ? { message: String(message).slice(0, 300) } : {}) };
}

/**
 * Whether `event` is a message of this preview session from where it must come from: this origin,
 * the expected window, the right session, a known type, a whole sequence number, and - for an
 * update - a quotation to show. Anything else is not ours and is ignored.
 */
export function acceptedPreviewMessage(event, { session, origin, source }) {
  if (!event || event.origin !== origin) return null;
  const data = event.data;
  /*
   * From the expected window - except CLOSED, which a generator sends as its page unloads: by the time
   * it arrives that page is gone, so it has no window to come from (`source` is null). It carries no
   * quotation and only marks the preview as no longer updating, and it must still be this origin and
   * this session; everything that carries a quotation comes from the expected window or not at all.
   */
  const fromSource = Boolean(source) && event.source === source;
  const closedOnUnload = event.source === null && data?.type === PREVIEW_MESSAGE_TYPES.CLOSED;
  if (!fromSource && !closedOnUnload) return null;
  if (!data || typeof data !== "object" || data.channel !== PREVIEW_CHANNEL) return null;
  if (typeof data.session !== "string" || !SESSION_PATTERN.test(data.session) || data.session !== session) return null;
  if (!Object.values(PREVIEW_MESSAGE_TYPES).includes(data.type)) return null;
  if (!Number.isInteger(data.seq) || data.seq < 0) return null;
  if (data.type === PREVIEW_MESSAGE_TYPES.UPDATE && (!data.payload || typeof data.payload !== "object" || Array.isArray(data.payload))) return null;
  if (data.message !== undefined && (typeof data.message !== "string" || data.message.length > 300)) return null;
  return data;
}
