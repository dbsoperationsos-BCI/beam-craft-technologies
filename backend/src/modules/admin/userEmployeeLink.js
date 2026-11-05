/**
 * Joining a login to the person it belongs to.
 *
 * `User` and `Employee` are separate records held together by the optional `User.linkedEmployeeId`,
 * and until now that column had exactly one writer: creating credentials from the Employee
 * Repository. An account made any other way — the first Super Admin, an account added from
 * Administration → Users — could never be linked to anybody, which is not a cosmetic gap. The link
 * is what Employee Attendance reads to decide whose day is being marked, what Payment Requests
 * matches a requester on, and how Tasks and the org chart find the person behind a login. An
 * unlinked account is refused by all of them, and the attendance screen said so while pointing at
 * a screen that could not fix it.
 *
 * The rules below are the ones no column can express, kept pure so they can be tested without a
 * database: the id has to name a real employee, that employee must not already answer for a
 * different login, and clearing the link has to be possible — somebody linked to the wrong person
 * needs a way back.
 */

const LINK_REFUSED = "Choose an employee from the list, or clear the link.";

/**
 * The employee id a request means, checked before it is used.
 *
 * Answers `{ ok, value }` with `value` null for "no employee", or `{ ok: false, message }`. Shaped
 * like `readMobile` beside it in `routes.js`, for the same reason: a caller reads one of these the
 * same way whichever field it came from.
 *
 * Blank, null and `"none"` all clear the link. The last is there because a `<select>` cannot hold
 * null — an empty option's value is the empty string, and the picker's explicit "Not linked" row
 * needs a value of its own that is not an id.
 */
function readLinkedEmployeeId(raw) {
  if (raw === null || raw === undefined || raw === "" || raw === "none") return { ok: true, value: null };
  // Only a number or a string is a candidate. `Number()` is willing on things that are not ids at
  // all - `Number(true)` is 1 and `Number(["5"])` is 5 - so a JSON body could otherwise name
  // employee 1 by sending a boolean.
  if (typeof raw !== "number" && typeof raw !== "string") return { ok: false, message: LINK_REFUSED };
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return { ok: false, message: LINK_REFUSED };
  return { ok: true, value };
}

/**
 * Why this login cannot be linked to this employee, or null if it can.
 *
 * `employee` is the row the id names, or null when nothing matched. `linkedTo` is the id of the
 * user already holding that employee, or null. `userId` is the account being edited, so re-saving
 * a link that is already in place is not reported as a clash with itself.
 *
 * The one-per-employee rule is a unique index on the column, so this is not the only thing
 * enforcing it — the check is here to answer with a sentence naming the account in the way rather
 * than a constraint error the screen would have to guess at.
 */
function linkProblem({ employee, linkedTo = null, userId = null, linkedUserName = "" }) {
  if (!employee) return "That employee is no longer on the repository.";
  if (employee.archivedAt) return "That employee has been removed from the repository.";
  if (linkedTo && Number(linkedTo) !== Number(userId)) {
    return linkedUserName
      ? `${employee.employeeName} is already linked to ${linkedUserName}. Clear that link first.`
      : `${employee.employeeName} is already linked to another login. Clear that link first.`;
  }
  return null;
}

/** The employee columns the picker and the Users table need, and nothing an administrator does not. */
const LINKABLE_EMPLOYEE_FIELDS = {
  id: true,
  employeeId: true,
  employeeName: true,
  department: true,
  designation: true,
  employmentStatus: true,
};

/**
 * One row of the picker.
 *
 * Employees already answering for another login stay on the list rather than being dropped from
 * it: somebody looking for a name and not finding it has no way to tell "not in the repository"
 * from "already taken", and the second is the one an administrator can do something about.
 */
function linkableEmployee(employee, takenByUserId = null) {
  return {
    id: employee.id,
    employeeId: employee.employeeId,
    employeeName: employee.employeeName,
    department: employee.department || null,
    designation: employee.designation || null,
    employmentStatus: employee.employmentStatus || null,
    linkedToUserId: takenByUserId ?? null,
  };
}

module.exports = { LINKABLE_EMPLOYEE_FIELDS, linkProblem, linkableEmployee, readLinkedEmployeeId };
