import { INACTIVE_STATUSES, isServingNotice } from "./employmentStatus.mjs";

/**
 * An employee's work history: each stint at the studio, oldest first, read from their joining date
 * and the times they left and came back (`EmployeeRejoin`, sent as `rejoins` on the employee list and
 * on My Profile).
 *
 * The first stint starts on `dateOfJoining` and ends on the first rejoin's `leftOn`; each later one
 * starts on a rejoin's `rejoinedOn`. The last runs to today - or to `dateOfRelieving` for somebody who
 * has left again (an inactive status). A stint that ended carries the role it was worked in, kept on
 * the rejoin row; the current one, the record's own designation and department.
 */
const day = (value) => (value ? String(value).slice(0, 10) : null);
const how = (type, reason) => [type, reason].filter(Boolean).join(" · ") || null;

export function workStints(employee) {
  if (!employee) return [];
  const rejoins = [...(employee.rejoins || [])].sort((a, b) => String(a.rejoinedOn).localeCompare(String(b.rejoinedOn)));
  const stints = [];
  let from = day(employee.dateOfJoining);
  let rejoined = false;
  for (const row of rejoins) {
    stints.push({ from, to: day(row.leftOn), rejoined, endedAs: how(row.separationType, row.separationReason), designation: row.designation || null, department: row.department || null });
    from = day(row.rejoinedOn);
    rejoined = true;
  }
  const leftAgain = INACTIVE_STATUSES.includes(employee.employmentStatus) && employee.dateOfRelieving;
  stints.push({ from, to: leftAgain ? day(employee.dateOfRelieving) : null, rejoined, endedAs: leftAgain ? employee.employmentStatus : null, designation: employee.designation || null, department: employee.department || null });
  return stints;
}

/** Whole days from one "YYYY-MM-DD" to another, both counted. */
export function daysBetween(from, to) {
  if (!from || !to) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * The stints as the steps a flow draws, oldest first: Joined, then Left and Rejoined for each return,
 * then Left again or Present. Each `{ kind, date, designation, department, note, awayDays }` - `awayDays`
 * on a Rejoined step, the days between their last day and coming back. Somebody serving their notice
 * ends on Notice instead of Present, dated with the last working day it runs to.
 */
export function workHistorySteps(employee, today = new Date().toISOString().slice(0, 10)) {
  const steps = [];
  workStints(employee).forEach((stint, index, all) => {
    const previous = all[index - 1];
    steps.push({
      kind: stint.rejoined ? "rejoined" : "joined",
      date: stint.from,
      designation: stint.designation,
      department: stint.department,
      awayDays: stint.rejoined && previous?.to && stint.from ? Math.max(0, daysBetween(previous.to, stint.from) - 2) : null,
      servedDays: stint.from ? daysBetween(stint.from, stint.to || today) : null,
    });
    if (stint.to) steps.push({ kind: "left", date: stint.to, designation: stint.designation, department: stint.department, note: stint.endedAs });
  });
  const last = steps[steps.length - 1];
  if (last && last.kind !== "left") {
    steps.push(isServingNotice(employee) ? { kind: "notice", date: day(employee.dateOfRelieving) } : { kind: "present", date: null });
  }
  return steps;
}

/** Total days worked across every stint, to today for the one still running. */
export function daysWorked(employee, today = new Date().toISOString().slice(0, 10)) {
  return workStints(employee).reduce((sum, stint) => sum + (stint.from ? daysBetween(stint.from, stint.to || today) : 0), 0);
}
