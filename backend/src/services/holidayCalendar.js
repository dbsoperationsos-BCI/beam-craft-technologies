const prisma = require("../config/db");
const { calendarDay, localIsoDate } = require("../modules/hrm/attendance/attendanceRules");

/**
 * Which holidays apply to whom, now that a holiday can be one branch's.
 *
 * A holiday row with no `branches` is the studio's: every branch observes it, which is every
 * holiday declared before a branch could be chosen. One with `branches` is those branches' alone.
 * So the question every reader asks - "is this day a holiday for this person?" - is answered by the
 * person's branch: the studio-wide holidays plus their own branch's, and nothing of any other's.
 *
 * Somebody with **no branch** observes the studio-wide holidays only. That is the honest answer
 * rather than "every branch's": a person the repository has not placed is not on holiday whenever
 * any one branch is.
 *
 * Shared, because three things read the same answer and must not disagree: Settings → Holidays
 * writes the list, the studio calendar draws it for a viewer, and every attendance calculation
 * takes it out of the working days. One rule here, in one place.
 */

/** A holiday's scope as `{ allBranches, branchIds }`, from a row read with its `branches`. */
function scopeOf(row) {
  const branchIds = [...new Set((row?.branches || []).map((link) => Number(link.branchId)).filter((id) => Number.isInteger(id) && id > 0))];
  return { allBranches: branchIds.length === 0, branchIds };
}

/** Whether a holiday of `scope` is observed by somebody in `branchId` (null: no branch at all). */
function appliesToBranch(scope, branchId) {
  if (!scope || scope.allBranches) return true;
  const id = Number(branchId);
  return Number.isInteger(id) && id > 0 && scope.branchIds.includes(id);
}

/**
 * Whether two holidays on one day would be the same branch's twice. A studio-wide holiday overlaps
 * everything; two branch holidays overlap where they share a branch. The rule the controller refuses
 * a second holiday on, now that the day itself is no longer unique.
 */
function holidayScopesOverlap(first, second) {
  if (!first || !second) return false;
  if (first.allBranches || second.allBranches) return true;
  return first.branchIds.some((id) => second.branchIds.includes(id));
}

/**
 * The holidays overlapping `from`..`to` (inclusive days), with their branches, oldest first. Either
 * bound may be absent. `client` may be a transaction.
 */
async function loadHolidays({ from = null, to = null, client = prisma } = {}) {
  const holidayDate = {};
  if (from) holidayDate.gte = calendarDay(from);
  if (to) holidayDate.lte = calendarDay(to);
  return client.attendanceHoliday.findMany({
    where: Object.keys(holidayDate).length ? { holidayDate } : {},
    include: { branches: { select: { branchId: true, branch: { select: { id: true, name: true } } } } },
    orderBy: [{ holidayDate: "asc" }, { id: "asc" }],
  });
}

/**
 * A range's holidays, answered per branch.
 *
 * Loaded once for a range however many people are asked about, which is what the register and the
 * dashboard do: `forBranch(branchId)` is the Set of `YYYY-MM-DD` the attendance rules take
 * (`dayKindFor`), and `namesFor(branchId)` the same days with their names. Both are memoised per
 * branch, so asking for forty employees in three branches is three answers.
 */
async function holidayCalendar(from, to, client = prisma) {
  const rows = (await loadHolidays({ from, to, client })).map((row) => ({ ...row, iso: localIsoDate(row.holidayDate), scope: scopeOf(row) }));
  const dates = new Map();
  const names = new Map();
  const key = (branchId) => (Number.isInteger(Number(branchId)) && Number(branchId) > 0 ? Number(branchId) : null);
  const namesFor = (branchId) => {
    const id = key(branchId);
    if (!names.has(id)) {
      const mine = new Map();
      // Oldest id first, so of two names on one day the one declared first is the one shown.
      for (const row of rows) if (appliesToBranch(row.scope, id) && !mine.has(row.iso)) mine.set(row.iso, row.name);
      names.set(id, mine);
    }
    return names.get(id);
  };
  const forBranch = (branchId) => {
    const id = key(branchId);
    if (!dates.has(id)) dates.set(id, new Set(namesFor(id).keys()));
    return dates.get(id);
  };
  return { rows, forBranch, namesFor };
}

/**
 * The branch somebody's holidays are read for: their employee record's branch where the login is
 * linked to one, else the login's own branch, else none. Attendance is an employee's record, so
 * the employee's placement wins; a login with no employee behind it still has a branch of its own.
 */
async function branchForUser(userId, client = prisma) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0 || !client.user?.findUnique) return null;
  const user = await client.user.findUnique({ where: { id }, select: { branchId: true, linkedEmployeeId: true } });
  if (!user) return null;
  if (user.linkedEmployeeId && client.employee?.findUnique) {
    const employee = await client.employee.findUnique({ where: { id: user.linkedEmployeeId }, select: { branchId: true } });
    if (employee?.branchId) return employee.branchId;
  }
  return user.branchId || null;
}

/** An employee's branch, or null where the repository has not placed them. */
async function branchForEmployee(employeeId, client = prisma) {
  const id = Number(employeeId);
  // A test's fake client may hold no employee table at all; that is an employee with no branch.
  if (!Number.isInteger(id) || id <= 0 || !client.employee?.findUnique) return null;
  const employee = await client.employee.findUnique({ where: { id }, select: { branchId: true } });
  return employee?.branchId || null;
}

/** Several employees' branches at once, as `Map<employeeId, branchId | null>`. */
async function branchesForEmployees(employeeIds, client = prisma) {
  const ids = [...new Set((employeeIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length || !client.employee?.findMany) return new Map();
  const rows = await client.employee.findMany({ where: { id: { in: ids } }, select: { id: true, branchId: true } });
  return new Map(rows.map((row) => [row.id, row.branchId || null]));
}

/** What a holiday's scope reads as: "All branches", or the branches by name. */
function scopeLabel(row) {
  const scope = scopeOf(row);
  if (scope.allBranches) return "All branches";
  const names = (row.branches || []).map((link) => link.branch?.name).filter(Boolean);
  return names.length ? names.join(", ") : `${scope.branchIds.length} branch${scope.branchIds.length === 1 ? "" : "es"}`;
}

module.exports = { scopeOf, appliesToBranch, holidayScopesOverlap, loadHolidays, holidayCalendar, branchForUser, branchForEmployee, branchesForEmployees, scopeLabel };
