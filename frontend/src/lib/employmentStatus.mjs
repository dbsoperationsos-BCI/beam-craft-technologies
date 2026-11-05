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

/** Whether this row is somebody the studio has not started employing yet. */
export function isOnboarding(employee) {
  return ONBOARDING_STATUSES.includes(employee?.employmentStatus);
}

/** Whether one employee row is somebody a form may offer. */
export function isWorking(employee) {
  return WORKING_STATUSES.includes(employee?.employmentStatus);
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
