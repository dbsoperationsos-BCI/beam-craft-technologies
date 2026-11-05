const prisma = require("../../../config/db");

/**
 * Whether a value on one of the studio's lists is being used by a record, and by how many.
 *
 * Field Settings deletes permanently (`?permanent=true`), and nothing checked first - so removing
 * "Accounts" from Departments left every employee filed under it holding a value no list offers any
 * more. The record still read correctly, because these lists are stored on the employee as plain
 * text rather than as a link to the row, which is exactly what made the loss quiet: nothing failed,
 * nothing was reported, and the studio simply could not choose that department again.
 *
 * ── How a value is matched ──
 *
 * `exact` is a column holding one answer - a department, a gender. `csv` is a column holding several
 * comma-separated - an employee's skills and the languages they know - where a plain `contains`
 * would count "Photo" as a use of "Photography", so candidates are narrowed in SQL and then checked
 * properly in JavaScript.
 *
 * Matching is case-insensitive and ignores surrounding spaces, because these values were typed into
 * records for years before they were lists: "accounts" and "Accounts" are the same department to
 * everyone except a string comparison.
 *
 * A use may carry a `where` of its own, spread into every count and every rename: the CRM's lists
 * are counted on the leads still on the board and not on the ones in the trash, whose answer is
 * nobody's any more.
 */

/** A record still counts when it is archived - it goes on displaying the value it holds. */
const ARCHIVABLE = new Set(["employee"]);

/** The entries of a comma-separated column, without the blanks a trailing comma leaves. */
const splitCsv = (value) => String(value || "").split(",").map((part) => part.trim()).filter(Boolean);

const same = (a, b) => String(a || "").trim().toLocaleLowerCase() === String(b || "").trim().toLocaleLowerCase();

/**
 * Every record using this value, per place it can be used.
 *
 * Returns `{ total, archived, places }`, where `places` names each column that holds it and how
 * many rows there are - so the refusal can say *where* it is used rather than only that it is.
 */
async function countUsage(definition, name) {
  const value = String(name || "").trim();
  if (!value || !definition.usedBy?.length) return { total: 0, archived: 0, places: [] };

  const places = [];
  let archived = 0;
  for (const use of definition.usedBy) {
    const model = prisma[use.model];
    if (!model) continue;
    if (use.match === "csv") {
      // Narrowed in SQL, then checked entry by entry: `contains` alone would count "Photography"
      // as a use of "Photo".
      const rows = await model.findMany({
        where: { [use.field]: { contains: value }, ...(use.where || {}) },
        select: { [use.field]: true, ...(ARCHIVABLE.has(use.model) ? { archivedAt: true } : {}) },
      });
      const matching = rows.filter((row) => splitCsv(row[use.field]).some((entry) => same(entry, value)));
      if (matching.length) {
        places.push({ label: use.label, count: matching.length });
        archived += matching.filter((row) => row.archivedAt).length;
      }
      continue;
    }
    const where = { [use.field]: value, ...(use.where || {}) };
    const count = await model.count({ where });
    if (count) {
      places.push({ label: use.label, count });
      if (ARCHIVABLE.has(use.model)) archived += await model.count({ where: { ...where, archivedAt: { not: null } } });
    }
  }
  return { total: places.reduce((sum, place) => sum + place.count, 0), archived, places };
}

/** "4 employees" / "3 employees and 1 onboarding invite", for the sentence explaining the refusal. */
function describeUsage(usage) {
  const parts = usage.places.map((place) => `${place.count} ${place.label}${place.count === 1 ? "" : "s"}`);
  if (parts.length <= 1) return parts[0] || "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The whole sentence a refused delete answers with.
 *
 * It names the value, says what is using it and what to do about it, because "cannot delete" on its
 * own leaves somebody clicking again. The archived count is called out where there is one: an entry
 * nobody currently works under still cannot go if a former employee's record names it, and that
 * reads as a bug unless it is said.
 */
function refusalMessage(definition, name, usage) {
  const used = describeUsage(usage);
  const archivedNote = usage.archived
    ? ` (${usage.archived} of them archived, whose records still show it)`
    : "";
  return `"${name}" is used by ${used}${archivedNote}, so this ${definition.label.toLocaleLowerCase()} cannot be deleted. `
    + `Change those records to something else first, or rename this entry instead - renaming updates every record that uses it.`;
}

/**
 * Carries a rename through to every record holding the old value.
 *
 * The other half of the same problem: these lists are stored as text, so renaming "Accounts" to
 * "Accounts Team" and doing nothing else leaves every employee under the old word - the list and the
 * records disagreeing, silently, which is worse than a refused delete because nothing says so.
 *
 * Runs inside the caller's transaction so the row and the records it names move together: a rename
 * that updated half the employees and then failed would be the drift it exists to prevent.
 */
async function renameUsage(tx, definition, previousName, nextName) {
  const from = String(previousName || "").trim();
  const to = String(nextName || "").trim();
  if (!from || !to || same(from, to) || !definition.usedBy?.length) return 0;

  let changed = 0;
  for (const use of definition.usedBy) {
    const model = tx[use.model];
    if (!model) continue;
    if (use.match === "csv") {
      const rows = await model.findMany({
        where: { [use.field]: { contains: from }, ...(use.where || {}) },
        select: { id: true, [use.field]: true },
      });
      for (const row of rows) {
        const entries = splitCsv(row[use.field]);
        if (!entries.some((entry) => same(entry, from))) continue;
        const rewritten = entries.map((entry) => (same(entry, from) ? to : entry)).join(", ");
        await model.update({ where: { id: row.id }, data: { [use.field]: rewritten } });
        changed += 1;
      }
      continue;
    }
    const result = await model.updateMany({ where: { [use.field]: from, ...(use.where || {}) }, data: { [use.field]: to } });
    changed += result.count;
  }
  return changed;
}

module.exports = { countUsage, describeUsage, refusalMessage, renameUsage };
