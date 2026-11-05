/**
 * Which AI module the page you are on belongs to.
 *
 * The assistant follows you: open it in the CRM and it is a Sales session, open it in Image
 * Selection and it is an Image Selection one. That is a convenience, not a security boundary - the
 * scope travels with the request and the backend decides whether you may have it, from your
 * permissions in the database. Editing this file, or the value in a devtools console, gets a 403
 * rather than another module's data.
 *
 * The names are the backend's own - the permission table's - so there is no translation layer to
 * drift out of step.
 */

/*
 * Longest path first, because `/sales/crm` must not be matched by a shorter `/sales` rule that
 * happened to be declared earlier. Ordered explicitly rather than sorted, so the order is visible.
 */
const ROUTES = [
  ["/sales", "SALES"],
  ["/hrm", "HRM"],
  // Employees is the HRM module's own screen under a shorter path.
  ["/employees", "HRM"],
  ["/image-selection", "IMAGE_SELECTION"],
  ["/asset-management", "ASSET"],
  ["/accounts", "ACCOUNTS"],
  /*
   * The project pipeline, which is the Sales one.
   *
   * These screens were left without an assistant at first, on the reasoning that "project
   * management" is a feature of both SALES and IMAGE_SELECTION and choosing one would be a guess.
   * That was wrong about the routes: `/project-management` shows enquiry ids, WhatsApp group names
   * and source branches - it is SALES / Project Management - and Image Selection's own project
   * screens live under `/image-selection`. There was no ambiguity, only a missing scope.
   */
  ["/project-management", "PROJECT"],
  // Present but toolless: it can talk here and read nothing. See the backend's modules.js.
  ["/admin", "ADMIN"],
];

/**
 * The module for a path.
 *
 * Every signed-in screen now maps to one, so the assistant follows you across the whole
 * application. An unrecognised path still returns null rather than guessing - a scope the backend
 * does not know would be refused anyway, and a button that always fails is worse than none.
 */
export function moduleForPath(pathname) {
  const path = String(pathname || "").toLowerCase();
  if (!path) return null;

  const match = ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return match ? match[1] : null;
}

/** What to call a module on screen. */
export const MODULE_LABELS = {
  SALES: "CRM",
  HRM: "HRM",
  IMAGE_SELECTION: "Image Selection",
  ASSET: "Assets",
  ACCOUNTS: "Accounts",
  PROJECT: "Projects",
  ADMIN: "Administration",
  GLOBAL: "Global",
};

export function moduleLabel(module) {
  return MODULE_LABELS[module] || module || "";
}
