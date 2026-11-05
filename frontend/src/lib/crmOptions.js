/**
 * The CRM's own option lists, in one place.
 *
 * These were defined inside CRMPage, which meant any other page that wanted the same choices
 * had to copy them and then quietly fall out of step. Anything that offers a CRM choice reads
 * it from here instead, so the lists are the same wherever they appear.
 */

import { avatarOf } from "./employeeAvatar.mjs";

// The three verticals the CRM is split into. Not places - these name the line of business.
// No "All" and no counts: a vertical switch picks one vertical, the same on every page.
export const verticalOptions = [
  { value: "Dum Dum", label: "Dum Dum" },
  { value: "Qua Qua", label: "Qua Qua" },
  { value: "Corp", label: "Corp" },
];

// The vertical a page opens on when it has no reason to prefer another.
export const DEFAULT_VERTICAL = "Dum Dum";

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
  const entries = [
    ...employees.map((row) => ({ name: row?.employeeName ?? row?.name ?? row, avatar: avatarOf(typeof row === "object" ? row : { name: row }) })),
    ...usedNames.map((name) => ({ name, avatar: avatarOf({ name }) })),
  ];
  for (const { name, avatar } of entries) {
    const label = String(name ?? "").trim();
    if (!label) continue;
    const key = label.toLowerCase();
    // The roster's spelling wins, since it is the one being maintained.
    if (!byKey.has(key)) byKey.set(key, { value: label, label, avatar });
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
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
