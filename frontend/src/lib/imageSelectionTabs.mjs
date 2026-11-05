/**
 * Which workspace tabs a project linked to Project Management shows, and which shoots each tab
 * stands on - read from `GET /projects/:id/allocated-services`, one entry per allocated service
 * with the backend's own answers on it. Kept free of React so `node --test` can hold the rules.
 *
 * - **Photo Selection** shows when the project has at least one deliverable the client picks
 *   photos against: an allocated deliverable whose master in Settings → Deliverables answers Yes
 *   for Image Selection. That is the backend's `selectable`, the same rule that makes Selection
 *   Items, so the tab and its items can never disagree. A Yes on a master the project was never
 *   allocated earns nothing; the allocation is per project.
 * - **AI Culling** (the deliverable is still named "Photo Culling" in the Deliverables table, and
 *   either spelling matches) shows on every linked project, first.
 * - **AI Editing** shows on every linked project too, second; the workspace holds it to its own
 *   permission.
 * - **Signature Album** is unchanged: it shows when a service named Signature Album is allocated
 *   and its row answers Yes.
 *
 * The order is the flow: cull, edit, select, album. A manual project has no allocation and keeps
 * the tabs ticked when it was created; that is the workspace's business, not this module's.
 */

export const WORKSPACE_TABS = [
  { id: "culling", label: "AI Culling", deliverableName: "Photo Culling", aliases: ["AI Culling"] },
  { id: "editing", label: "AI Editing", deliverableName: "AI Editing" },
  { id: "photos", label: "Photo Selection", deliverableName: "Photo Selection" },
  { id: "album", label: "Signature Album", deliverableName: "Signature Album" },
];

// Mirrors the backend's service-name normalization so "Signature album" and "signature-album"
// match the same tab.
export function normalizedName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const keyOf = (service) => service.key || normalizedName(service.name);
const tabOf = (tabId) => WORKSPACE_TABS.find((tab) => tab.id === tabId);

// The allocated services named for a tab and answered Yes - how every tab used to be earned, and
// how Signature Album still is. Matched by contained name, so "Signature Album (Soft Copy)" counts.
function namedServices(services, tabId) {
  const tab = tabOf(tabId);
  const bases = [tab?.deliverableName, ...(tab?.aliases || [])].map(normalizedName).filter(Boolean);
  if (!bases.length) return [];
  return (services || []).filter((service) => service.imageSelectionEnabled === true && bases.some((base) => keyOf(service).includes(base)));
}

/** The ids of the tabs a linked project shows, in the workspace's order. */
export function linkedWorkspaceTabIds(services = []) {
  return WORKSPACE_TABS.map((tab) => tab.id).filter((id) => {
    if (id === "photos") return (services || []).some((service) => service.selectable === true);
    if (id === "culling" || id === "editing") return true;
    return namedServices(services, id).length > 0;
  });
}

/**
 * The shoots a tab's folder tree shows, or null for all of them.
 *
 * Where a service named for the tab is allocated, the tab shows the shoots it was allocated to,
 * as it always has - Photo Culling allocated to the Wedding shows the Wedding.
 *
 * AI Culling and AI Editing allocated nowhere follow Photo Selection: they show the shoots the
 * Photo Selection deliverable is allocated to, so a shoot sold no Photo Selection - a Haldi added
 * with no deliverables - is on none of the three tabs, rather than on two and missing from the
 * third. Its folder is untouched, and it joins all three the moment Photo Selection is allocated to
 * it in Project Management.
 *
 * With no Photo Selection allocated anywhere either, every shoot shows rather than none: a tab with
 * an empty folder tree would be a tab with nothing to do.
 */
function shootsOf(named) {
  const byId = new Map();
  for (const service of named) for (const shoot of service.shoots || []) if (!byId.has(shoot.id)) byId.set(shoot.id, shoot);
  return [...byId.values()];
}

export function tabShoots(services = [], tabId) {
  const named = namedServices(services, tabId);
  if (named.length) return shootsOf(named);
  if (tabId === "album") return [];
  if (tabId === "culling" || tabId === "editing") {
    const photoSelection = namedServices(services, "photos");
    return photoSelection.length ? shootsOf(photoSelection) : null;
  }
  return null;
}
