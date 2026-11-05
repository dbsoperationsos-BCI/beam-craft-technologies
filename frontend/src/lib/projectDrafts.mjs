/**
 * Create Project forms put aside half-filled, kept in this browser for five days.
 *
 * A booking is often started before everything is known - the advance not yet paid, the shoots not
 * yet settled - and the form is long, so closing it used to throw the work away. **Save Draft**
 * keeps it here and **Drafts** on Bookings & Converted reopens it. Nothing reaches the server until
 * Save Project, exactly as before.
 *
 * Local storage rather than the database, by the studio's choice: a draft is one person's unfinished
 * typing on one machine, not a record anybody else should see or act on. Kept per signed-in user, so
 * two people sharing a computer do not open each other's drafts.
 *
 * One draft per enquiry. Converting a lead that already has one is how the same booking got started
 * twice, so the conversion asks first (`draftForEnquiry`) and a second save for that enquiry
 * replaces the first rather than sitting beside it.
 *
 * Storage is passed in rather than reached for, so the rules are tested without a browser; every
 * read survives a storage that throws or holds nonsense, and answers "no drafts".
 */
export const PROJECT_DRAFT_TTL_MS = 5 * 24 * 60 * 60 * 1000;

const KEY_PREFIX = "dbs.sales.projectDrafts.";

export function projectDraftsKey(userId) {
  return `${KEY_PREFIX}${userId ?? "anonymous"}`;
}

function readRaw(storage, userId) {
  try {
    const parsed = JSON.parse(storage?.getItem(projectDraftsKey(userId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((draft) => draft && typeof draft === "object" && draft.id) : [];
  } catch {
    return [];
  }
}

function writeRaw(storage, userId, drafts) {
  if (!storage) return;
  if (drafts.length) storage.setItem(projectDraftsKey(userId), JSON.stringify(drafts));
  else storage.removeItem(projectDraftsKey(userId));
}

const sameEnquiry = (draft, enquiryId) => Boolean(enquiryId) && String(draft.enquiryId || "") === String(enquiryId);

/** The drafts still within their five days, newest first. Expired ones are dropped as they are read. */
export function readProjectDrafts(storage, userId, now = Date.now()) {
  const all = readRaw(storage, userId);
  const live = all.filter((draft) => Number(draft.expiresAt) > now);
  if (live.length !== all.length) {
    try { writeRaw(storage, userId, live); } catch { /* read-only storage: the filter still answers */ }
  }
  return live.sort((a, b) => Number(b.savedAt) - Number(a.savedAt));
}

/** The live draft for this enquiry, or null. */
export function draftForEnquiry(storage, userId, enquiryId, now = Date.now()) {
  if (!enquiryId) return null;
  return readProjectDrafts(storage, userId, now).find((draft) => sameEnquiry(draft, enquiryId)) || null;
}

/**
 * Saves a draft and answers it as stored. Replaces the draft with the same `id` (one reopened and
 * saved again) and any other draft for the same enquiry. Each save starts the five days again.
 * Throws when the browser refuses the write - storage full - so the form can say so.
 */
export function saveProjectDraft(storage, userId, { id, enquiryId = "", title = "", snapshot }, now = Date.now()) {
  const draft = {
    id: id || `draft-${now}-${Math.random().toString(36).slice(2, 8)}`,
    enquiryId: String(enquiryId || ""),
    title: String(title || ""),
    savedAt: now,
    expiresAt: now + PROJECT_DRAFT_TTL_MS,
    snapshot,
  };
  const others = readProjectDrafts(storage, userId, now)
    .filter((existing) => existing.id !== draft.id && !sameEnquiry(existing, draft.enquiryId));
  writeRaw(storage, userId, [draft, ...others]);
  return draft;
}

export function removeProjectDraft(storage, userId, id) {
  try {
    writeRaw(storage, userId, readRaw(storage, userId).filter((draft) => draft.id !== id));
  } catch { /* nothing to remove from a storage that cannot be written */ }
}

/** Every draft for this enquiry removed - the project for it has been saved. */
export function removeDraftsForEnquiry(storage, userId, enquiryId) {
  if (!enquiryId) return;
  try {
    writeRaw(storage, userId, readRaw(storage, userId).filter((draft) => !sameEnquiry(draft, enquiryId)));
  } catch { /* as above */ }
}

/*
 * What of the form is kept, made safe to write down.
 *
 * Files are left out - a picked receipt is a `File`, which local storage cannot hold - so the
 * payment proof is chosen again on reopening. A service or deliverable row drops the definition it
 * carried and keeps only its id: reopened, the row is matched against the current master data, so
 * a price or a name changed in Settings since the draft was saved is the one the project gets, and
 * a definition retired since is dropped rather than refused by the save.
 */
const notFile = (value) => !(typeof File !== "undefined" && value instanceof File) && !(typeof Blob !== "undefined" && value instanceof Blob);

function withoutFiles(value) {
  if (Array.isArray(value)) return value.filter(notFile).map(withoutFiles);
  if (value && typeof value === "object") {
    if (!notFile(value)) return undefined;
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => notFile(entry)).map(([key, entry]) => [key, withoutFiles(entry)]));
  }
  return value;
}

/*
 * `enquiryLocked` is kept so a booking that came from a lead or a quotation reopens with its enquiry
 * still settled: changing it there would clear the quotation and the shoots it brought in.
 */
export function projectDraftSnapshot({ form, services = [], deliverables = [], schedulePayments, advance, enquiryLocked = false }) {
  return withoutFiles({
    form,
    enquiryLocked: Boolean(enquiryLocked),
    plan: {
      shoots: form?.shoots || [],
      services: services.map(({ serviceDefinition, ...row }) => row),
      deliverables: deliverables.map(({ deliverableDefinition, ...row }) => row),
    },
    schedulePayments,
    advance,
  });
}

/** Whether saving this advance as a draft leaves a picked receipt behind, so the notice can say so. */
export function draftDropsFiles(advance) {
  return Object.values(advance || {}).some((value) => (Array.isArray(value) ? value : [value]).some((entry) => !notFile(entry)));
}

/** What the drafts list calls a draft: the WhatsApp group name, else the client's number, else the enquiry. */
export function projectDraftTitle(form = {}) {
  return String(form.whatsappGroupName || form.clientMainNumber || "").trim()
    || (form.enquiryId ? `Enquiry #${form.enquiryId}` : "Untitled project");
}
