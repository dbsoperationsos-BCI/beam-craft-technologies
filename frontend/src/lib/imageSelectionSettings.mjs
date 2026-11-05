export const MIN_SELECTION_LIMIT = 1;
export const MAX_SELECTION_LIMIT = 100000;
export function validateSelectionLimit(value) { const number = Number(value); return Number.isInteger(number) && number >= MIN_SELECTION_LIMIT && number <= MAX_SELECTION_LIMIT; }

// The client of a manually named project, asked for once when the project is created — a project
// created from a saved Sales Manager group name reads its client from there instead. The stored
// shape is the one SalesProject.clientMainNumber uses — "+91 9876543210" — so a manual project's
// number reaches the WhatsApp sender looking exactly like a linked one's.
export const DEFAULT_COUNTRY_CODE = "+91";
// An empty number is a legitimate "no client recorded yet", so it formats to "" rather than a
// half-written number the backend would reject.
export function formatClientPhone(countryCode, number) {
  if (!String(number || "").trim()) return "";
  return `${String(countryCode || DEFAULT_COUNTRY_CODE).trim()} ${String(number).trim()}`;
}
export function validateClientPhone(countryCode, number) {
  if (!String(number || "").trim()) return true; // blank is allowed; only sharing demands a number
  return /^\+\d{1,4}$/.test(String(countryCode || "").trim()) && /^\d{10}$/.test(String(number).trim());
}

// The expiry date travels as the calendar writes it — "2026-08-15" — because that is the day the
// studio picked, and turning a stored instant into a day is the only conversion either side needs.
export const toDateInput = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

// The day a link would stop working if the gallery were published now: how a studio reads "six
// months" before there is a publication to count from. `months` comes from studio-wide settings,
// so changing the validity there changes what this field offers.
export function defaultValidUntil(months = 6, from = new Date()) {
  const date = new Date(from);
  date.setMonth(date.getMonth() + Number(months || 6));
  return toDateInput(date);
}

// Everything the Selection Settings rail edits that lives on the project row. Saving returns the
// updated row, so the same function rebuilds the form from the server's answer rather than from
// whatever the page happened to be holding.
//
// The client's name and WhatsApp number are stored on the row too, but no surface edits them any
// more, so they are deliberately not carried here: a form state holding a field nothing can change
// only invites a save that writes it back.
export function projectSettingsState(project, { validityMonths = 6 } = {}) {
  return {
    selectionValidityEnabled: project.selectionValidityEnabled !== false,
    allowPhotoSelection: project.allowPhotoSelection !== false,
    // A project that has never been given a date shows the one it would get, rather than a blank
    // box the studio has to guess at.
    selectionValidUntil: toDateInput(project.selectionValidUntil) || defaultValidUntil(validityMonths),
  };
}

// The whole form: the project row plus the per-deliverable overrides.
export const settingsFormState = (project, deliverables, options) => ({
  ...projectSettingsState(project, options),
  deliverables: (deliverables || []).map((item) => ({ id: item.id, enabled: item.enabled, selectionLimit: item.selectionLimit })),
});

export function hasSettingsChanges(initial, current) {
  return initial.selectionValidityEnabled !== current.selectionValidityEnabled
    || initial.allowPhotoSelection !== current.allowPhotoSelection
    || initial.selectionValidUntil !== current.selectionValidUntil
    || initial.deliverables.some((item) => { const next = current.deliverables.find((candidate) => candidate.id === item.id); return !next || item.enabled !== next.enabled || item.selectionLimit !== next.selectionLimit; });
}

// What a selection item the studio types is given when its Limits box is left empty. One photo,
// not the studio-wide default selection limit: that setting is the fallback for an allocated
// deliverable that carries no quantity, and a typed item has no allocation to read one from.
export const NEW_SELECTION_ITEM_LIMIT = 1;
export function newSelectionItemLimit(typed) {
  return String(typed ?? "").trim() === "" ? NEW_SELECTION_ITEM_LIMIT : Number(typed);
}

// The add rows that hold a name but were never added — typed, then Review & Share pressed instead
// of +. Keyed by group, as the table keeps them.
export function pendingSelectionDrafts(drafts) {
  return Object.entries(drafts || {})
    .filter(([, draft]) => String(draft?.name || "").trim())
    .map(([groupId, draft]) => ({ groupId, name: draft.name.trim(), selectionLimit: newSelectionItemLimit(draft.limit), shootName: draft.shootName || null, shootFolderId: draft.shootFolderId || null }));
}

/**
 * Review & Share: whatever is pending is saved first, and the share flow opens only once it is.
 *
 * Each step is a function returning false (or throwing) to stop, or null when there is nothing for
 * it to do - validate the form, save the settings, add the typed-but-unadded items, publish the
 * gallery. `open` runs only after every step has succeeded, so a failed save never leaves the
 * screen and the edits stay where they were for another try.
 */
export async function saveThenShare({ validate = null, save = null, addDrafts = null, publish = null, open }) {
  if (validate && !validate()) return { ok: false, step: "validate" };
  for (const [step, run] of [["save", save], ["addDrafts", addDrafts], ["publish", publish]]) {
    if (!run) continue;
    try {
      if ((await run()) === false) return { ok: false, step };
    } catch (error) {
      return { ok: false, step, error };
    }
  }
  open();
  return { ok: true };
}
