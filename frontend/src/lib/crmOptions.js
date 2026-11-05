/**
 * The CRM's own option lists, in one place.
 *
 * These were defined inside CRMPage, which meant any other page that wanted the same choices
 * had to copy them and then quietly fall out of step. Anything that offers a CRM choice reads
 * it from here instead, so the lists are the same wherever they appear.
 */

// The three verticals the CRM is split into. Not places - these name the line of business.
// No "All" and no counts: a vertical switch picks one vertical, the same on every page.
export const verticalOptions = [
  { value: "Dum Dum", label: "Dum Dum" },
  { value: "Qua Qua", label: "Qua Qua" },
  { value: "Corp", label: "Corp" },
];

// The vertical a page opens on when it has no reason to prefer another.
export const DEFAULT_VERTICAL = "Dum Dum";

/**
 * The branches a lead can be assigned to, **only while the real list is being fetched**.
 *
 * The studio maintains its branches in Settings → Organization → Branches, so this cannot be the
 * list: use `useBranchOptions()`, which reads them and is already narrowed to the ones the signed-in
 * person's roles reach. This is the placeholder for the first paint and for a request that fails,
 * because a picker with no options at all cannot be used.
 *
 * It named six branches that do not exist until September 2026 — `Erode`, `Tiruppur`, `Coimbatore`,
 * `Bangalore`, `Hyderabad`, `Vizag` — while the studio's are the six below. Assigned Branch on a
 * lead therefore offered six values that matched no branch, and one added or renamed by the studio
 * never appeared in the CRM at all. Spelled the way the `branch` table spells them now, so the
 * placeholder and the answer that replaces it describe the same studio.
 *
 * Stored in `assignedBranch`, which is a separate column from the vertical, with `branchId` beside
 * it holding the reference the server resolves.
 */
export const FALLBACK_BRANCH_OPTIONS = [
  { value: "Erode TN", label: "Erode TN" },
  { value: "Tiruppur TN", label: "Tiruppur TN" },
  { value: "Coimbatore TN", label: "Coimbatore TN" },
  { value: "Bangalore KA", label: "Bangalore KA" },
  { value: "Hyderabad TL", label: "Hyderabad TL" },
  { value: "Visakhapatnam AP", label: "Visakhapatnam AP" },
];

/*
 * There is no list of CRMs here any more.
 *
 * It used to name three people. A roster written into the application is wrong the day somebody
 * joins or leaves, and it is wrong silently: the leads assigned to a name that is no longer in the
 * list stay assigned to it, while the person who replaced them cannot be picked at all.
 *
 * The CRMs are the Sales department's active employees, which the HR module already knows -
 * `GET /api/sales/crm-employees`, through `getCrmEmployees()`. Anywhere that offers a CRM to pick
 * reads it from there, and adds whatever names are already on the leads so a lead assigned to
 * somebody who has since left can still be filtered for.
 */

/** The names already in use on the rows, so a filter can still find them. */
export function crmNamesFromRows(rows = [], key = "crm") {
  const names = new Set();
  for (const row of rows) {
    const name = String(row?.[key] ?? "").trim();
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * The CRMs to offer: the Sales roster, plus any name already sitting on a lead.
 *
 * Sorted and de-duplicated case-insensitively, because the roster writes "Diya" and a sheet may
 * have written "diya" - offering both as two choices makes the filter look broken.
 */
export function crmOptionsFrom(employees = [], usedNames = []) {
  const byKey = new Map();
  for (const name of [...employees.map((row) => row?.employeeName ?? row?.name ?? row), ...usedNames]) {
    const label = String(name ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    // The roster's spelling wins, since it is the one being maintained.
    if (!byKey.has(key)) byKey.set(key, label);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b)).map((label) => ({ value: label, label }));
}

// A column filter takes plain strings, not {value,label} pairs.
export function optionValues(options) {
  return options.map((option) => option.value ?? option);
}

/**
 * A stored vertical value folded onto one of the three verticals, or "" when it is not one of them.
 *
 * Leads arrive from Google Sheets and CSV imports as well as from the app, so the column holds
 * whatever each producer wrote - "dumdum", "Corporate", "QUA QUA". Every reader has to agree
 * on what those mean, or the same lead lands on different verticals in different places.
 *
 * Mirrors VERTICAL_SQL in backend/src/modules/sales/crm-leads/leadQueryService.js. Keep the two
 * in step.
 */
export function normalizeVertical(value) {
  const vertical = String(value || "").trim().toLowerCase();
  if (!vertical) return "";
  if (vertical === "dum dum" || vertical === "dumdum") return "Dum Dum";
  if (vertical === "qua qua" || vertical === "quaqua") return "Qua Qua";
  if (vertical === "corp" || vertical === "corporate" || vertical === "corporation") return "Corp";
  return "";
}

/**
 * The vertical a row belongs to, always one of the three.
 *
 * A blank or unrecognised vertical belongs to Dum Dum - the same fallback the lead table and the
 * backend's own board clause apply. Without it a row with an empty vertical would belong to no
 * vertical at all and simply never be listed.
 */
export function resolveVertical(value) {
  return normalizeVertical(value) || DEFAULT_VERTICAL;
}
