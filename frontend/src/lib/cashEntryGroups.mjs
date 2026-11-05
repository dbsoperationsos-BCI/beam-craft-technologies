/**
 * Accounts Manager's All, Received and Spent tabs, one row per project - by its Event ID: a project with several cash
 * entries on the tab - money in and money out alike - becomes one project row with each entry under it
 * (`entries`), and each keeps its own ⋮. A project with one entry, and an entry filed against no
 * project, stay their own rows.
 *
 * The project row leads with its Event ID and the count ("DBS-EVT-0001 · 3 entries"), the types it holds, its latest date and an amount: the total
 * where the entries all go one way, and the net - received less spent - where they mix. It is not an
 * entry, so it has no ⋮, cannot be ticked, and opens nothing.
 *
 * Kept in the order the entries came, so a project sits where its first entry would.
 *
 * **The reader chooses it** (`CashEntryGroupingSwitch`), and Ungrouped is the default. It used to be
 * on for these three tabs always, which is the right view for reading what one project has taken and
 * spent and the wrong one for the question the page is opened with most often - "what came in today".
 * A project row sits where its *first* entry would, so this morning's receipt was down the page under
 * a wedding from August.
 */

/** The tabs with a project behind them. A transfer has none, so there is nothing to group it by. */
export const GROUPED_CASH_TABS = ["All", "Received", "Spent"];

export function groupCashEntriesByProject(entries = []) {
  const groups = new Map();
  const order = [];
  for (const entry of entries) {
    // The Event ID the row shows, else the project behind it; an entry on neither stays alone.
    const key = entry.projectCode || entry.projectId;
    if (!key) { order.push({ entry }); continue; }
    if (!groups.has(key)) { groups.set(key, []); order.push({ key }); }
    groups.get(key).push(entry);
  }
  return order.map(({ entry, key }) => {
    if (entry) return entry;
    const members = groups.get(key);
    if (members.length === 1) return members[0];
    const [first] = members;
    const types = [...new Set(members.map((member) => member.entryType).filter(Boolean))];
    const sum = (field) => members.reduce((total, member) => total + (Number(member[field]) || 0), 0);
    const latest = members.map((member) => member.entryDate).filter(Boolean).sort().at(-1) || null;
    return {
      id: `project:${key}`,
      isProjectGroup: true,
      projectId: first.projectId,
      projectCode: first.projectCode,
      clientName: first.clientName,
      branch: first.branch,
      entryId: [first.projectCode, `${members.length} entries`].filter(Boolean).join(" · "),
      entryType: types.join(" / "),
      entryDate: latest,
      amount: types.length === 1 ? sum("amount") : sum("signedAmount"),
      signedAmount: sum("signedAmount"),
      entries: members,
    };
  });
}
