const employeeOptionLists = require("./employeeOptionLists");

/*
 * The people cells of a sheet import, to the person each names - written once for Pre Production →
 * Import and Production → Import, so the two read a cell the same way.
 *
 * A cell names an employee by their Employee Code, their login, or their name exactly. Anybody else -
 * somebody who has left the studio, whose name the old sheet still carries, or a name that is no
 * employee's at all - is kept as the name alone, with nothing linked: the importing side stores that
 * name beside its (empty) link and the board prints it as written. A code or name of an employee who
 * no longer works here is kept the same way, under the employee's own name.
 *
 * Employees are matched by code, login or exact name only - never by a looser reading of the text -
 * because a name two people share is refused to be guessed at: `referenceMatchers` answers
 * "ambiguous" for it, and an ambiguous cell is kept as written rather than linked to either.
 */

/** What a cell can name one employee by. */
const NAMES_ONE = new Set(["employee-id", "username", "exact"]);

/**
 * `texts` are the cells (already non-empty). Returns one `{ id, name }` per cell, in order: `id` is the
 * working employee's key, or null when the cell names nobody working here; `name` is the employee's
 * own name when linked, else the text as written (cut to the column's 191).
 */
async function resolvePeople(transaction, refs, texts) {
  const named = texts.map((raw) => {
    const text = String(raw).trim();
    const match = refs.employee(text);
    return { text, target: NAMES_ONE.has(match.kind) ? match.target : null };
  });
  const ids = [...new Set(named.filter((person) => person.target).map((person) => person.target.id))];
  const active = ids.length
    ? await transaction.employee.findMany({
      where: { id: { in: ids }, archivedAt: null, employmentStatus: { in: await employeeOptionLists.workingEmployeeStatuses() } },
      select: { id: true, employeeName: true },
    })
    : [];
  const nameById = new Map(active.map((employee) => [employee.id, employee.employeeName]));
  return named.map(({ text, target }) => (
    target && nameById.has(target.id)
      ? { id: target.id, name: nameById.get(target.id) }
      : { id: null, name: (target?.employeeName || text).slice(0, 191) }
  ));
}

module.exports = { resolvePeople };
