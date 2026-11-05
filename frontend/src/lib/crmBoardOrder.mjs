/**
 * The order a lead moves through the pipeline, as the CRM's boards lay their status columns out:
 * the Leads board and the lead reports on CRM Reports read the same list, so the two can never put
 * the pipeline in different orders. A status missing from it falls in after the ones named.
 * `Converted & Followup` is offered on Qua Qua alone; elsewhere it has a column only while a lead
 * reads as it - see `crmBoardColumnStatuses`.
 */
export const CRM_BOARD_STATUS_ORDER = ["Followup", "Interested", "CNA", "Converted & Followup", "Converted", "Rejected", "Invalid"];

/**
 * The status columns a Leads board stands in, given what its leads **actually** read as.
 *
 * Each column is one server-paged query for one status (`status IN [value]`), so a lead is on the
 * board only when its status has a column - there is no catch-all lane to fall into, as there is on
 * a board that holds all its cards at once. A fixed list therefore hid every lead whose status it
 * did not name, while the table on the same tab listed them:
 *
 *   * **a status the vertical does not offer** - an import whose own Status column said "Inactive",
 *     which `statusDisplaySql` passes through as written;
 *   * **Converted & Followup outside Qua Qua** - the server reads those spellings onto that label on
 *     every vertical, and only Qua Qua offers it as a pill;
 *   * **Unassigned for a reader who manages nobody** - the data scope still shows them a lead they
 *     typed in with no CRM against it, and their branch admin likewise.
 *
 * `occurring` is the server's own answer to "which statuses do this tab's leads hold" - the Status
 * column's `column-values`, read with the board's scope, tab, range and filters - so a column is
 * added for exactly the statuses a lead on this tab holds, and never widens what is read. Null until
 * it has answered, and the board then stands in the fixed columns alone, as it always did.
 *
 * Order: Unassigned, Yet to connect, the vertical's statuses in `CRM_BOARD_STATUS_ORDER` with any
 * other occurring status after them, then Project deleted. Matched without regard to case, as MySQL
 * compares the status filter, so a stored "interested" never stands up a second Interested column.
 */
export function crmBoardColumnStatuses({
  offered = [],
  occurring = null,
  showUnassigned = false,
  unassigned = "Unassigned",
  yetToConnect = "Yet to connect",
  projectDeleted = "Project deleted",
} = {}) {
  const keyOf = (status) => String(status ?? "").trim().toLowerCase();
  const held = new Set();
  const occurringStatuses = [];
  for (const status of Array.isArray(occurring) ? occurring : []) {
    const key = keyOf(status);
    if (!key || held.has(key)) continue;
    held.add(key);
    occurringStatuses.push(String(status).trim());
  }
  const named = new Set([unassigned, yetToConnect, projectDeleted, ...offered].map(keyOf));
  const extra = occurringStatuses.filter((status) => !named.has(keyOf(status)));
  const rank = (status) => {
    const at = CRM_BOARD_STATUS_ORDER.indexOf(status);
    return at === -1 ? CRM_BOARD_STATUS_ORDER.length : at;
  };
  // `sort` is stable: the offered ones keep their order and come ahead of an unnamed extra, which
  // keeps the order the server listed it in.
  const middle = [...offered, ...extra].sort((a, b) => rank(a) - rank(b));
  return [
    ...(showUnassigned || held.has(keyOf(unassigned)) ? [unassigned] : []),
    yetToConnect,
    ...middle,
    projectDeleted,
  ];
}
