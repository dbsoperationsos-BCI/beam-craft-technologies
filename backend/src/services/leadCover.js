const prisma = require("../config/db");
const { workingEmployeeStatuses } = require("./employeeOptionLists");
const { buildChain, availableCover } = require("./alternativeChain");
const { studioCalendarDay } = require("./studioTime");

/**
 * Who a lead goes to when the person it was meant for is not here.
 *
 * The rules on a Google Sheet link name one employee. That employee goes on leave, and every lead
 * the rule matches lands on somebody who will not see it for a week - which is worse than arriving
 * unassigned, because unassigned is visible and a full inbox belonging to an absent person is not.
 *
 * This is the database half of `alternativeChain.js`: it loads the alternatives graph, works out
 * who is away today, and hands back a resolver the sync calls per row. The rule about cycles - why
 * the chain must be acyclic, and why at least one person must be the end of the line - is on that
 * module, and worth reading before changing anything here.
 */

/**
 * Today, the granularity leave is approved at - the **studio's** day, as midnight UTC on that date,
 * which is how the `@db.Date` leave columns hold a day.
 *
 * It was the server's own local midnight. On a machine set to India that reaches MySQL as 18:30 UTC
 * the day before, so "the leave starts on or before today" was false on the leave's first day - a
 * one-day leave was never seen, and the absent person kept receiving leads. On a server left on UTC
 * the day turned at 05:30 in the studio instead of midnight. `studioCalendarDay` is right on both.
 */
function startOfToday() {
  return studioCalendarDay();
}

/**
 * Everybody who cannot take work today, and why they cannot.
 *
 * Two reasons, and they are not the same fact. **On leave** is temporary and is exactly what the
 * alternatives exist for. **No longer working here** - relieved, absconded, fired, archived - is
 * permanent, and a rule still naming that person would otherwise go on filling a list nobody
 * reads at all. Both are answered from the studio's own records rather than assumed: leave from
 * the approved requests covering today, the rest from the employment statuses Field Settings
 * marks as working.
 */
async function loadCoverContext() {
  const today = startOfToday();
  const [employees, approvedLeave, working] = await Promise.all([
    prisma.employee.findMany({
      select: {
        id: true,
        employeeName: true,
        employmentStatus: true,
        archivedAt: true,
        alternative1EmployeeId: true,
        alternative2EmployeeId: true,
      },
    }),
    prisma.attendanceRequest.findMany({
      // A comp-off is a day away like a leave, so the cover picks up that person's leads the same way.
      where: { status: "APPROVED", type: { in: ["LEAVE", "COMP_OFF"] }, fromDate: { lte: today }, toDate: { gte: today } },
      select: { employeeId: true },
    }),
    workingEmployeeStatuses(),
  ]);

  const workingSet = new Set(working);
  const onLeave = new Set(approvedLeave.map((request) => Number(request.employeeId)).filter(Number.isInteger));
  const away = new Map();
  const nameById = new Map();
  for (const employee of employees) {
    nameById.set(employee.id, employee.employeeName || "");
    if (employee.archivedAt || !workingSet.has(employee.employmentStatus)) away.set(employee.id, "no longer working here");
    else if (onLeave.has(employee.id)) away.set(employee.id, "on leave today");
  }

  return { chain: buildChain(employees), away, nameById };
}

/**
 * A resolver for one sync pass: given the employee a rule names, who actually gets the lead.
 *
 * **Round-robin, and stateful on purpose.** Vijay away with Abi and Kishore both free means the
 * leads are *shared* between them, not all handed to whoever the graph reached first - a hundred
 * leads landing on one person is the thing the studio was doing by hand and asked to stop doing.
 * The counter lives for the length of a pass, so a sheet's new rows are split evenly within the
 * run that imports them.
 *
 * Answers `null` when the whole chain is away or the employee named nobody. That is a real answer:
 * the lead arrives unassigned, which somebody can see and act on, rather than being given to a
 * person the studio never nominated.
 */
function buildCoverResolver(context) {
  const cursor = new Map();
  return function coverFor(employeeId) {
    const id = Number(employeeId);
    if (!Number.isInteger(id)) return null;
    const reason = context.away.get(id);
    if (!reason) return { employeeId: id, name: context.nameById.get(id) || "", covering: false };

    const candidates = availableCover(context.chain, id, (candidate) => context.away.has(candidate));
    if (!candidates.length) return null;

    const at = cursor.get(id) || 0;
    cursor.set(id, at + 1);
    const chosen = candidates[at % candidates.length];
    return {
      employeeId: chosen,
      name: context.nameById.get(chosen) || "",
      covering: true,
      // Carried so the import preview can say *why* the lead went somewhere other than the rule
      // says - "Vijay Kumar is on leave today" - rather than looking like the rule is wrong.
      coveringFor: context.nameById.get(id) || "",
      reason,
    };
  };
}

module.exports = { loadCoverContext, buildCoverResolver, startOfToday };
