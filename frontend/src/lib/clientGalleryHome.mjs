/**
 * The client gallery home, decided without the DOM: what its heading says and which footer
 * actions belong to the tab in view.
 */

const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * The home's heading names the client only — never the project, which is the studio's own label.
 * The client is the couple on a wedding group, otherwise the client name (the Sales Manager
 * group's, or the one typed on a manually named project). A gallery that knows no client keeps
 * "Your gallery".
 */
export function galleryHeading(meta = {}) {
  return [text(meta?.groomName), text(meta?.brideName)].filter(Boolean).join(" & ") || text(meta?.clientName) || "Your gallery";
}

// Deselect All releases what the Selected tab lists, so it is offered only there — on All Photos or
// People it would clear picks the client cannot see from where they stand — and only once something
// is picked for the item in view: with nothing selected there is nothing to release.
export const showsDeselectAll = (tab, selected = 0) => tab === "selected" && selected > 0;

/**
 * The selection items Submit All would send: offered, not yet submitted, and holding at least one
 * saved pick. The same rule the server applies to each item, read from the saved counts the
 * gallery already loaded - so an item merely existing never makes it eligible.
 */
export function submittableItems(deliverables = [], selectionCounts = {}) {
  return deliverables.filter((item) => item.enabled !== false && !item.submittedAt && (selectionCounts[item.id] || 0) > 0);
}

// Submit All earns its place only when there are two or more items to send together; with one, the
// item's own Review & Submit already does the job.
export const showsSubmitAll = (deliverables = [], selectionCounts = {}) => submittableItems(deliverables, selectionCounts).length >= 2;

/**
 * The Submit All popup's sections: the items ready to send and the ones already sent, grouped under
 * the shoot each belongs to (Wedding, Pre Wedding...), in the order the gallery lists them. Grouped
 * by the shoot's id, not its name, so two shoots that share a name stay apart; an item that
 * belongs to no shoot (a manually named project's) sits in a group with no heading. Items with
 * nothing picked and nothing sent are left out - there is nothing to review for them.
 */
export function submitAllGroups(deliverables = [], selectionCounts = {}) {
  const groups = new Map();
  const seen = new Set();
  for (const item of deliverables) {
    if (item.enabled === false || seen.has(item.id)) continue;
    const ready = !item.submittedAt && (selectionCounts[item.id] || 0) > 0;
    if (!ready && !item.submittedAt) continue;
    const key = item.shootId || item.shoot?.id || "";
    if (!groups.has(key)) groups.set(key, { key, label: text(item.shoot?.shoot) || null, items: [] });
    seen.add(item.id);
    groups.get(key).items.push({ item, ready, count: selectionCounts[item.id] || 0 });
  }
  return [...groups.values()];
}

/**
 * Whether Review & Submit may open for the selection item in view - the card list's rule, shared
 * with an open card so the two can never disagree: an item, not yet sent, with at least one saved
 * pick. The limit is a ceiling, not a quota, and the server applies the same rule on submit.
 */
export const canReviewItem = (item, selected = 0) => Boolean(item) && !item.submittedAt && selected > 0;

/**
 * The snackbar after a selection is sent: "Album sent to BEAMCRAFT". The studio is named by its
 * Global Name (Settings -> Branding, carried on the gallery meta as `studioName`), trimmed; with
 * none set the sentence says "your photographer", as it always has. The first letter is raised so
 * an item named "album" still starts the sentence properly.
 */
export function selectionSentMessage(itemName, studioName) {
  const item = String(itemName ?? "").trim();
  const studio = String(studioName ?? "").replace(/\s+/g, " ").trim() || "your photographer";
  const sentence = `${item ? `${item} sent` : "Sent"} to ${studio}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
