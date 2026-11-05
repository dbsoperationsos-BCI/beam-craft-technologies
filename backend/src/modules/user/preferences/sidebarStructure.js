/**
 * The shape of the sidebar, as the server knows it, and the check a saved layout is held to.
 *
 * ── Why this exists at all ────────────────────────────────────────────────────────────────────
 *
 * The canonical sidebar registry is `frontend/src/constants/navigation.mjs`: one list, holding the
 * ids, the labels, the routes and which module owns each screen. The browser draws from it and
 * arranges from it. But the browser is also what sends this preference, and a preference arriving
 * here has been through a client that can be rewritten — so "Quotations belongs to Sales & CRM" is
 * checked again here rather than taken on trust from the drag that produced it.
 *
 * That needs the *structure*, and only the structure: which module ids exist, which screen ids each
 * one owns, and in what default order. This file is that much of the registry and nothing more — no
 * labels, no routes, no icons, no permissions, because none of those decide whether a layout is
 * well formed. A screen's *permission* is not repeated here either: the server never grants access
 * from a preference, and the browser hides what a role may not open. A layout is an ordering.
 *
 * `test/user-preferences-sidebar.test.js` imports the registry from the frontend package and fails
 * if this file disagrees with it about a single id or its position, so the two cannot drift. That
 * test is the reason this is a safe copy rather than a second source of truth: the registry decides,
 * this mirrors, and the mirror is proven on every test run.
 */

/**
 * Every module, in default order, each with the screens it owns in default order.
 *
 * Mirrors `SIDEBAR_MODULES` in `frontend/src/constants/navigation.mjs` — see above.
 */
const SIDEBAR_STRUCTURE = {
  subscribe: ["media-studio-operations", "subscribe-account-manager"],
  "client-management": ["employee-repository"],
  hrm: ["employee-attendance", "attendance-register", "employee-referral", "tasks", "interview"],
  "sales-crm": ["leads-followups", "reports-analytics", "contacts", "bookings-converted", "quotations"],
  "project-management": ["projects", "crd-documents", "client-gifts"],
  "visual-curation": ["ai-feature", "image-selection", "album-proofing"],
  accounts: ["accounts-manager", "payment-requests"],
  "resource-management": ["assets", "vendors", "client-storage"],
};

/** Which module owns each screen: the relationship a saved layout may never contradict. */
const PARENT_BY_ITEM = new Map(
  Object.entries(SIDEBAR_STRUCTURE).flatMap(([moduleId, items]) => items.map((itemId) => [itemId, moduleId]))
);

/*
 * Caps, because this is a browser-supplied list going into a JSON column.
 *
 * The application has six modules and twenty screens; these leave room for the application to grow
 * several times over and still refuse a list that is being used as storage rather than as an order.
 */
const MAX_MODULES = 50;
const MAX_ITEMS_PER_MODULE = 100;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,59}$/;

/** An error carrying the status the route should answer with — the same shape the service uses. */
const fail = (status, message) => Object.assign(new Error(message), { status });

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * One list of ids, checked and de-duplicated.
 *
 * `isKnown` decides what this list is allowed to name. An id it does not recognise is **dropped**
 * rather than refused: a browser running a build newer than this server would otherwise have every
 * save rejected, and the id it named costs nothing here — the browser re-appends anything genuinely
 * new the next time it works the layout out. A *duplicate* is refused, because a list naming one
 * screen twice cannot have come from dragging and is not an order anybody can be shown.
 */
function checkedIds(list, { isKnown, max, what }) {
  if (!Array.isArray(list)) throw fail(400, `${what} must be a list of ids.`);
  if (list.length > max) throw fail(400, `${what} names more entries than the sidebar has.`);
  const seen = new Set();
  const kept = [];
  for (const raw of list) {
    if (typeof raw !== "string" || !ID_PATTERN.test(raw)) throw fail(400, `${what} must contain sidebar ids.`);
    if (seen.has(raw)) throw fail(400, `${what} names "${raw}" more than once.`);
    seen.add(raw);
    if (isKnown(raw)) kept.push(raw);
  }
  return kept;
}

/**
 * A sidebar layout, as it may be stored: the order of the modules, and the order within each.
 *
 * The one thing refused outright rather than tidied away is a screen listed under a module that
 * does not own it. Every other malformed detail is a client that has fallen behind or run ahead,
 * and is worth accepting quietly; that one is a client asserting a structure the application does
 * not have, and storing it would mean the sidebar's shape had been decided by a request.
 */
function validateSidebarLayout(value) {
  if (!isPlainObject(value)) throw fail(400, "A sidebar layout must be an object.");

  const moduleOrder = checkedIds(value.moduleOrder ?? [], {
    isKnown: (id) => id in SIDEBAR_STRUCTURE,
    max: MAX_MODULES,
    what: "moduleOrder",
  });

  const submodules = value.submoduleOrder ?? {};
  if (!isPlainObject(submodules)) throw fail(400, "submoduleOrder must be an object of module ids.");
  if (Object.keys(submodules).length > MAX_MODULES) throw fail(400, "submoduleOrder names more modules than the sidebar has.");

  const submoduleOrder = {};
  for (const [moduleId, items] of Object.entries(submodules)) {
    if (typeof moduleId !== "string" || !ID_PATTERN.test(moduleId)) throw fail(400, "submoduleOrder must be keyed by module ids.");
    // A module this server has never heard of: dropped with its list, for the reason in `checkedIds`.
    if (!(moduleId in SIDEBAR_STRUCTURE)) continue;
    const checked = checkedIds(items, {
      isKnown: (id) => PARENT_BY_ITEM.has(id),
      max: MAX_ITEMS_PER_MODULE,
      what: `submoduleOrder.${moduleId}`,
    });
    for (const itemId of checked) {
      const parent = PARENT_BY_ITEM.get(itemId);
      if (parent !== moduleId) {
        throw fail(400, `"${itemId}" belongs to "${parent}" and cannot be placed under "${moduleId}".`);
      }
    }
    submoduleOrder[moduleId] = checked;
  }

  return { moduleOrder, submoduleOrder };
}

module.exports = { SIDEBAR_STRUCTURE, validateSidebarLayout, MAX_MODULES, MAX_ITEMS_PER_MODULE };
