/**
 * The Quotation Generator's unsaved edits, kept in this browser tab while they are being made.
 *
 * Editing a quotation that has already been sent never writes to the server until Save as New
 * Version (or Generate) is pressed: a server draft would take a quotation number or a version, and
 * the published quotation must not change on its own. So the edits are auto-saved here instead -
 * the tab's session storage, a moment after typing stops - under the quotation being edited
 * (`edit:<version id>`) or copied (`duplicate:<source id>`). A reload of the page reopens the
 * generator on them (Quotations reads `?edit=` / `?duplicate=` and this), and closing the generator
 * or saving clears them. Session storage is this tab's alone and ends with it: nothing reaches
 * another tab, another person or the server.
 */
export const EDITING_DRAFT_PREFIX = "dbs.quotation.editing.";

const defaultStorage = () => (typeof window === "undefined" ? null : window.sessionStorage);

export const editingDraftScope = ({ editingId = null, duplicateId = null } = {}) => (editingId ? `edit:${editingId}` : duplicateId ? `duplicate:${duplicateId}` : null);

/** Keeps the form for `scope`. False when there is nowhere to keep it. */
export function stashEditingDraft(scope, payload, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!storage || !scope || !payload || typeof payload !== "object") return false;
  try {
    storage.setItem(`${EDITING_DRAFT_PREFIX}${scope}`, JSON.stringify({ savedAt: now, payload }));
    return true;
  } catch {
    return false;
  }
}

/** The kept form for `scope`, or null. */
export function readEditingDraft(scope, { storage = defaultStorage() } = {}) {
  if (!storage || !scope) return null;
  try {
    const stored = JSON.parse(storage.getItem(`${EDITING_DRAFT_PREFIX}${scope}`));
    return stored?.payload && typeof stored.payload === "object" && !Array.isArray(stored.payload) ? stored.payload : null;
  } catch {
    return null;
  }
}

/** Forgets every kept form in this tab - the generator was closed, or what was in it was saved. */
export function clearEditingDrafts({ storage = defaultStorage() } = {}) {
  if (!storage) return;
  try {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(EDITING_DRAFT_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    /* nothing to forget */
  }
}
