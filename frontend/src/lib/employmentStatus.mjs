/**
 * Who counts as working here, which is the only question every employee picker is really asking.
 *
 * The repository holds nine employment statuses, and most of them are people a form must not offer:
 * somebody still onboarding has not started, and somebody Relieved, Absconded or Fired has left.
 * Naming one of them as a manager, as cover, or as a leave approver records a decision against a
 * person who cannot act on it - and the record reads as though somebody chose them.
 *
 * The same three the backend calls `WORKING_STATUSES`, and the same three the repository's own
 * **Active** tab is built from. Written once here so a fourth status added to the enum has one place
 * to be considered rather than being silently offered by every dropdown in the application.
 *
 * `Long Leave` is deliberately not among them: the person has not left, but they are not there to
 * take the work either, which is the question a picker asks.
 *
 * The repository *table* is the exception and asks for everybody, because it has a tab per status
 * and a row that never arrives lands in none of them.
 *
 * `.mjs` and free of React so `node --test` can read it.
 */
import { scheduledReview } from "./employeeReviewSchedule.mjs";

export const WORKING_STATUSES = ["Active", "in Training", "PIP"];

/**
 * The two statuses that mean "not taken on yet", which is a different thing from not working.
 *
 * A candidate waiting to fill their form in, and one whose submission is with HR, are both people
 * the studio has not started employing - so there is nothing to offboard them *from*. The row menu
 * offered **Start Offboarding** on the second of them, because it only knew to withhold it for
 * `HR Onboarding Pending`; a submission sent back moves the row to `Employee Submission Pending`,
 * which read as an ordinary employee and picked the entry up.
 *
 * Named here, beside `WORKING_STATUSES`, because the two answer the same question from opposite
 * ends and a tenth status added to the enum should have one place to be thought about.
 */
export const ONBOARDING_STATUSES = ["HR Onboarding Pending", "Employee Submission Pending"];

/** The InActive tab's statuses: somebody who has left, or is away on Long Leave. */
export const INACTIVE_STATUSES = ["Relieved", "Absconded", "Long Leave", "Fired"];

/**
 * Whether an experience certificate may be generated: somebody InActive, or serving notice. The
 * server asks the same before it draws one.
 */
export function canGenerateExperienceCertificate(employee) {
  return Boolean(employee) && employee.type !== "invite"
    && (INACTIVE_STATUSES.includes(employee.employmentStatus) || isServingNotice(employee));
}

/**
 * Whether an employment certificate may be generated: somebody Active, as the Active tab counts them
 * - working, and not serving notice. The server asks the same before it draws one.
 */
export function canGenerateEmploymentCertificate(employee) {
  return Boolean(employee) && employee.type !== "invite" && isWorking(employee) && !isServingNotice(employee);
}

/** Whether this row is somebody the studio has not started employing yet. */
export function isOnboarding(employee) {
  return ONBOARDING_STATUSES.includes(employee?.employmentStatus);
}

/** Whether one employee row is somebody a form may offer. */
export function isWorking(employee) {
  return WORKING_STATUSES.includes(employee?.employmentStatus);
}

/**
 * Whether this row is somebody serving their notice: still on a working status, with a last working
 * day on record from their offboarding. They keep working - login, attendance, pickers - until that
 * day; the day after it the server relieves them and the row moves to InActive. The repository shows
 * them under Serving Notice as well as Active.
 */
export function isServingNotice(employee) {
  return isWorking(employee) && Boolean(employee?.dateOfRelieving);
}

/**
 * The Employment Status a person's row reads: their status, with "(Serving Notice)" after it while
 * they serve notice - "Active (Serving Notice)", "in Training (Serving Notice)". The stored status
 * stays as it is, so the column's filter still finds them under Active.
 */
export function employmentStatusLabel(employee) {
  const status = employee?.employmentStatus || "";
  return status && isServingNotice(employee) ? `${status} (Serving Notice)` : status;
}

/**
 * Whether this row is somebody who has sent in their resignation - their offboarding form is
 * Submitted - and HR has not decided it yet. Their employment is untouched until HR approves (that
 * is what records the separation and sets the last working day), but the repository lists them
 * under Serving Notice from the moment it arrives, so a sent-in resignation is never invisible.
 * `resignationPending` comes from the server (`hrm/employees` list).
 */
export function isResignationPending(employee) {
  return isWorking(employee) && !employee?.dateOfRelieving && Boolean(employee?.resignationPending);
}

const noticeDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** What saving an offboarding says while the person still has notice to serve. */
export function servingNoticeMessage(name, lastWorkingDate) {
  const day = String(lastWorkingDate || "").slice(0, 10);
  const label = /^\d{4}-\d{2}-\d{2}$/.test(day) ? noticeDay.format(new Date(`${day}T00:00:00Z`)) : day;
  return `${name} is serving notice until ${label}, and moves to InActive the day after.`;
}

/**
 * Whether this row is a working employee whose review has fallen past due.
 *
 * An overlay, not a status: it answers alongside `isWorking` rather than instead of it, so a row
 * still on Active with an overdue review is both — it shows in Active as it always has, and in the
 * repository's Review Pending tab besides. Somebody onboarding or already departed is never asked
 * this, since a review is not scheduled against either.
 */
export function isReviewPending(employee, now) {
  return isWorking(employee) && Boolean(scheduledReview(employee?.nextReviewDate, now)?.overdue);
}

/**
 * The people a picker may offer, out of whatever list the screen already holds.
 *
 * Invite rows are dropped with them: an invitation is somebody who has not filled the form in yet,
 * so it has no employee to name and appears in these lists only because the repository shows the
 * two side by side.
 */
export function workingEmployees(employees) {
  return (employees || []).filter((row) => row?.type !== "invite" && isWorking(row));
}
