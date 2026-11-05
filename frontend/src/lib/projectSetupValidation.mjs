/**
 * What Project Setup still needs before a project may be started, keyed by field.
 *
 * Kept here rather than inside `StartProjectFormPanel` because it is the one part of that form with
 * a right answer worth testing on its own, and because the same rules are asserted twice: this is
 * what marks the fields and stops the press, and `startProjectSchema` in
 * `backend/src/modules/sales/projects/controller.js` refuses the same shapes at the endpoint. The
 * two must agree — a field this lets through and the server rejects is a save that fails with the
 * form saying nothing, and the reverse is a rule the API does not actually hold anyone to.
 *
 * Only the fields Start Project marks with an asterisk are here. The four assignment dropdowns
 * above them — Project Manager, the two coordinators, Creative Manager — are deliberately not
 * required: a project is routinely started before the studio has settled who is running it.
 */

/** The label each field reads by, for a message that has to name one. */
export const PROJECT_SETUP_FIELD_LABELS = {
  welcomeGift: "Welcome Gift",
  welcomeGiftEmployeeId: "Welcome Gift Assigned To",
  shootCompletedGift: "Shoot Completed Gift",
  shootCompletedGiftEmployeeId: "Shoot Completed Gift Assigned To",
  projectValidityMonths: "Project Validity (In Months)",
  storageNeeded: "Storage Needed",
  crdDocumentStatus: "CRD Document",
};

const REQUIRED = "Required";

/** Empty, whitespace, null and undefined are all "not answered"; `0` and `false` are answers. */
function answered(value) {
  if (value === null || value === undefined) return false;
  return String(value).trim().length > 0;
}

/**
 * Every problem in Project Setup, as `{ field: message }` — empty when there is nothing in the way.
 *
 * An applicable gift is somebody's job, so it carries its assignee with it; a gift that is not
 * being given asks for nobody, which is why the assignee is only checked under "Applicable".
 * Project Validity is the one field with a second way to be wrong: the column takes a whole number
 * of months from one upward, so "0" and "1.5" are answered but still refused, and saying so here
 * is what stops the endpoint being the first thing to mention it.
 */
export function projectSetupProblems(form = {}) {
  const problems = {};

  if (!answered(form.welcomeGift)) problems.welcomeGift = REQUIRED;
  else if (form.welcomeGift === "Applicable" && !answered(form.welcomeGiftEmployeeId)) problems.welcomeGiftEmployeeId = REQUIRED;

  if (!answered(form.shootCompletedGift)) problems.shootCompletedGift = REQUIRED;
  else if (form.shootCompletedGift === "Applicable" && !answered(form.shootCompletedGiftEmployeeId)) problems.shootCompletedGiftEmployeeId = REQUIRED;

  if (!answered(form.projectValidityMonths)) problems.projectValidityMonths = REQUIRED;
  else {
    const months = Number(form.projectValidityMonths);
    if (!Number.isInteger(months) || months < 1) problems.projectValidityMonths = "Enter a whole number of months, 1 or more.";
  }

  if (!answered(form.storageNeeded)) problems.storageNeeded = REQUIRED;
  if (!answered(form.crdDocumentStatus)) problems.crdDocumentStatus = REQUIRED;

  return problems;
}

/** The outstanding fields under the names a person reads them by, for a message that lists them. */
export function missingProjectSetupLabels(form = {}) {
  return Object.keys(projectSetupProblems(form)).map((field) => PROJECT_SETUP_FIELD_LABELS[field] || field);
}
