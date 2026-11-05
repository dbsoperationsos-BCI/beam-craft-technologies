/**
 * Which of the Employee form's required fields are required of *this* person.
 *
 * A field's tuple in `EmployeeFormPanel` carries a plain `required` boolean, which is the right
 * answer for almost all of them. This is where the exceptions live, so the form's star and the
 * refusal that stops a save are decided by one rule rather than two that can drift.
 *
 * Free of React so `test/employee-required-fields.test.mjs` can hold the rules.
 */

/** The system role that makes somebody a Super Admin. Seeded `isSystem`, so it cannot be renamed. */
export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

/**
 * Whether a field marked required actually is.
 *
 * The one exception so far is **Reports To** for a Super Admin. They are the top of the org chart
 * and report to nobody, so the field had to be answered with somebody who is not their manager -
 * and whoever was named became their manager where it counts: `dataScope` walks
 * `reportsToEmployeeId` to decide whose records a person gets, and the org chart draws the Super
 * Admin *underneath* whoever was picked. An answer invented to get past a form is not harmless
 * here.
 *
 * The field is still shown, and may still be answered: a studio that wants a reporting line drawn
 * for its Super Admin can give them one. It only stops being demanded. That is deliberately not
 * `isFieldVisible`'s job - a field that is not shown is cleared on save, and this one is not.
 */
export function isFieldRequired(key, required, { superAdmin = false } = {}) {
  if (!required) return false;
  if (key === "reportsToEmployeeId" && superAdmin) return false;
  return true;
}

/**
 * Whether the person this form is about is a Super Admin, from the two places that can say so.
 *
 * `employee.isSuperAdmin` is the server's answer about a login that already exists - the legacy
 * `user.role` column or the system role, whichever they carry. `superAdminSelected` is the
 * credentials page's answer about one being created right now, before anything has been saved, so
 * an administrator can be added in a single pass rather than refused over a manager they do not
 * have. Either is enough.
 */
export function isSuperAdminSubject(employee, superAdminSelected = false) {
  return Boolean(employee?.isSuperAdmin) || Boolean(superAdminSelected);
}
