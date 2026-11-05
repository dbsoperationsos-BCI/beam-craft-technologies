import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { accountSections, credentialSections } from "../src/constants/employeeCredentialConfig.js";

/*
 * The Login Credentials page, reached from Edit Employee as well as from onboarding.
 *
 * Edit showed the record's details and nothing else, which reads an account as something issued
 * once and never looked at again: an employee taken on before this flow existed had no way to be
 * given one without going round through Administration, and the roles, cover and leave approval
 * recorded beside a login could be read nowhere on the screen that owns the person.
 *
 * The page does two jobs now, and the line between them is about who owns what.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const PANEL = read("components", "employees", "EmployeeFormPanel.js");
const HOOK = read("components", "employees", "useCredentialForm.js");

test("Edit gets the same two pages onboarding has, then Payslip Details, with Reviews as a page of its own at the end", () => {
  assert.match(PANEL, /const pageLinksFor = \(mode\) => \(mode === "edit" \? editPageLinks : onboardingPageLinks\)/);
  assert.match(PANEL, /const editPageLinks = \[\s*\["review", "Employee Details", sectionLinks\],\s*\["credentials", "Employee Preference", \[[^\n]*\]\],\s*\/\/[^\n]*\n\s*payslipSectionLinks\[0\],\s*\[REVIEWS_PAGE, "Reviews"\],\s*\];/);
  // Payslip Info is one entry on the rail - no "Payslip Details" group of one - and the page's title.
  assert.match(PANEL, /: page === PAYSLIP_PAGE \? "Payslip Info"/);
  assert.doesNotMatch(PANEL, /"Payslip Details"/);
  assert.match(PANEL, /const payslipSectionLinks = \[\["payslip-info", "Payslip Info"\]\];/);
  /*
   * The page a rail entry belongs to is decided by its id. Reviews is its own page, so it must not
   * fall through to the credentials page, which is where any id not in the details list lands.
   */
  assert.match(PANEL, /const pageForSection = \(id\) => \(id === REVIEWS_PAGE \? REVIEWS_PAGE : payslipSectionIds\.has\(id\) \? PAYSLIP_PAGE : reviewSectionIds\.has\(id\) \? "review" : "credentials"\);/);
});

test("the Reviews page shows the review list alone, with nothing of its own to submit", () => {
  assert.match(PANEL, /const onReviewsPage = mode === "edit" && page === REVIEWS_PAGE;/);
  assert.match(PANEL, /\{!onCredentialsPage && !onReviewsPage && !onPayslipPage && sections\.map\(/, "the details are not on the Reviews or Payslip page");
  assert.match(PANEL, /\{onReviewsPage && <>\s*<SchemaFormSection id="reviews" title="Reviews">/);
  assert.match(PANEL, /if \(onReviewsPage \|\| onPayslipPage\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(PANEL, /footer=\{onCredentialsPage \? credentialsFooter : onReviewsPage \|\| onPayslipPage \? reviewsFooter : reviewFooter\}/);
  // Payslip Details: Edit only, one heading - Payslip Info, the personal and the PF details together - on a page of its own.
  assert.match(PANEL, /const onPayslipPage = mode === "edit" && page === PAYSLIP_PAGE;/);
  assert.match(PANEL, /\{onPayslipPage && <>\s*<SchemaFormSection id="payslip-info" title="Payslip Info">/);
  assert.doesNotMatch(PANEL, /id="payslip-personal"|id="payslip-pf"/);
});

test("the Reviews page's Save reaches the same unsaved work Discard walks away from", () => {
  /*
   * Nothing on this page is its own to save - each review is written from its own dialog - but
   * Employee Details or Employee Preference can still hold an edit from before the reader switched
   * pages. Save here is `saveDraftAndClose`, the same call the unsaved-work dialog's own Save/Save
   * draft button makes, so switching to Reviews cannot quietly lose it; Discard is `onClose`
   * directly; asking "are you sure" a second time after a button already named the answer is the
   * confirmation people learn to click through.
   */
  assert.match(PANEL, /const reviewsFooter = <>\s*<button type="button" onClick=\{onClose\}[^>]*>Discard<\/button>/);
  assert.match(PANEL, /disabled=\{!hasUnsavedWork \|\| savingDraft\} onClick=\{\(\) => void saveDraftAndClose\(\)\}/);
});

test("both jobs show the same four headings, so the rail is one rail", () => {
  assert.deepEqual(accountSections.map((section) => section.id), credentialSections.map((section) => section.id));
  assert.deepEqual(accountSections.map((section) => section.title), credentialSections.map((section) => section.title));
});

test("an account that exists states what it signs in with, and offers the rest", () => {
  /*
   * Username, email and password are what the person signs in with; changing an identity belongs to
   * Admin → User Management, the one screen that owns accounts. So the first section becomes one
   * statement, and the three below it — Roles, Alternative, Leave Approval — are untouched.
   */
  const [identity, ...rest] = accountSections;
  assert.deepEqual(identity.fields.map((field) => field.name), ["accountIdentity"]);
  assert.equal(identity.fields[0].type, "custom", "the identity is drawn as fields somebody could type in");
  assert.deepEqual(rest, credentialSections.slice(1), "managing an account changed a section it should not have");
  // Facts, not disabled boxes — a closed input reads as something withheld from you rather than as
  // something decided elsewhere.
  assert.match(HOOK, /accountIdentity: \(\) =>/);
  assert.match(HOOK, /Administration → User Management/);
});

test("the identity is never sent, and is never demanded either", () => {
  const submit = HOOK.slice(HOOK.indexOf("if (managing) {"), HOOK.indexOf("const response = await createLoginCredentials"));
  assert.match(submit, /await updateLoginCredentials\(employee\.id, \{/);
  for (const field of ["username:", "email:", "temporaryPassword:"]) {
    assert.ok(!submit.includes(field), `${field} is sent by the update`);
  }
  // And the same three are not checked on a page that does not show them, which would otherwise
  // refuse a save over fields nobody can reach.
  assert.match(HOOK, /function validate\(values, \{ managing = false \} = \{\}\)/);
  // The shared sign-in rules (`lib/loginCredentials.mjs`), asked only while the identity is being decided.
  assert.match(HOOK, /if \(!managing\) Object\.assign\(errors, loginIdentityProblems\(values\)\);/);
});

test("saving an account is not the same event as creating one", () => {
  /*
   * `finishOnboarding` reads the created user's roles, announces an email and moves the reader to
   * the Active tab. Reusing it for an update would have said an account was created, warned that it
   * had no roles, and moved the tab out from under somebody who had only changed a leave approver.
   */
  assert.match(HOOK, /await onUpdated\?\.\(\);/);
  assert.match(PANEL, /onUpdated: onCredentialsUpdated/);
  const page = read("components", "employees", "EmployeeVerificationPage.js");
  assert.match(page, /async function finishCredentialUpdate\(\)/);
  assert.match(page, /onCredentialsUpdated=\{finishCredentialUpdate\}/);
});

test("the panel can still be closed while managing an account", () => {
  /*
   * The close path saves the credentials page as a draft first and stays open if that fails. There
   * is no draft behind an account that exists, so `saveDraft` answers false for one — and the panel
   * would have read that as "the save failed" and refused to shut, every time.
   */
  assert.match(PANEL, /const credentialsDraftable = credentialsDirty && !credentialForm\.managing;/);
  assert.match(PANEL, /if \(credentialsDraftable && !\(await credentialForm\.saveDraft\(\)\)\) return;/);
  assert.match(HOOK, /if \(!ready \|\| managing\) return false;/);
  // And the button offering to save is absent when there is nothing it could save.
  assert.match(PANEL, /\{\(recordDirty \|\| credentialsDraftable\) && <Button type="button" variant="primary"/);
});

test("Save Changes writes the record too, rather than closing over it", () => {
  /*
   * The two pages are one panel and one press, and the press used to write only the page it stood
   * on. An edit made on Employee Details, then Save Changes over on Login Credentials, wrote the
   * roles and closed — and closed *programmatically*, through the credential save's own callback,
   * which walks straight past the unsaved-work prompt that guards the ×. The details went with
   * nothing said about them.
   *
   * The record is written first and a refusal stops the press there, so half of it cannot succeed
   * quietly.
   */
  assert.match(PANEL, /if \(recordDirty && onSaveDetails\) \{/);
  assert.match(PANEL, /if \(!saved\) \{ goToSection\(firstSectionOf\("review"\)\); return; \}/);
  // Only after the record is safely written does the account save run.
  const handler = PANEL.slice(PANEL.indexOf("async function handleSubmit(event)"), PANEL.indexOf("// Nothing left to lose once the record is saved"));
  assert.ok(handler.indexOf("onSaveDetails(result.payload)") < handler.indexOf("credentialForm.submit(event)"), "the account is saved before the record");
  // And the panel stops calling them unsaved, so a failure afterwards does not re-send the record.
  assert.match(handler, /setOriginalForm\(form\);/);
});

test("the record's own save does not close the panel out from under the account's", () => {
  const page = read("components", "employees", "EmployeeVerificationPage.js");
  const quiet = page.slice(page.indexOf("async function saveEmployeeDetails(payload, validationError)"), page.indexOf("async function saveEmployee(payload, validationError)"));
  assert.ok(quiet, "the quiet save has moved");
  assert.doesNotMatch(quiet, /closeForm\(\)/, "closing here would take the half still to be written with it");
  assert.doesNotMatch(quiet, /setActiveTab/);
  // Answers whether it saved, because the caller stops on a refusal.
  assert.match(quiet, /return true;/);
  assert.match(quiet, /return false;/);
  // One press, one notice: the credential callback speaks for both halves.
  assert.doesNotMatch(quiet, /showSuccess/);
  assert.match(page, /showSuccess\("Changes saved\."\);/);
});

test("the button says when a press is about to save both", () => {
  // "Save Changes" over a page whose sibling also has unsaved work understates what pressing it
  // does, and this press is the one that used to lose that work.
  assert.match(PANEL, /recordDirty \? "Save All Changes" : "Save Changes"/);
});

test("the login page is called Employee Preference wherever it is named", () => {
  assert.equal((PANEL.match(/\["credentials", "Employee Preference", \[/g) || []).length, 2, "both rails");
  assert.match(PANEL, /\? "Employee Preference"\n\s+: page === REVIEWS_PAGE/, "and the page title");
  assert.doesNotMatch(PANEL, /"Login Credentials"/);
  const ATTENDANCE = read("components", "hrm", "AttendanceRequestFormPanel.js");
  assert.doesNotMatch(ATTENDANCE, /on your Login Credentials/);
  assert.match(ATTENDANCE, /Approvers are set by HR on your Employee Preference\./);
});

test("Employee Preference has an Attendance Regularization Approval section: one person, after Permission Approval", async () => {
  const { credentialSections, accountSections } = await import("../src/constants/employeeCredentialConfig.js");
  for (const sections of [credentialSections, accountSections]) {
    const ids = sections.map((section) => section.id);
    assert.equal(ids.indexOf("regularization-approval"), ids.indexOf("permission-approval") + 1);
    const section = sections.find((entry) => entry.id === "regularization-approval");
    assert.equal(section.title, "Attendance Regularization Approval");
    assert.deepEqual(section.fields.map((field) => [field.name, field.label, field.type, field.options]), [
      ["regularizationApproverEmployeeId", "Attendance Regularization Approver", "select", "regularizationApproverOptions"],
    ]);
    // Empty says what happens then: the Permission Approver stands in.
    assert.match(section.fields[0].placeholder, /go to the Permission Approver/);
  }
  const FORM = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "employees", "useCredentialForm.js"), "utf8");
  assert.match(FORM, /regularizationApproverOptions: candidates,/);
  assert.equal((FORM.match(/regularizationApproverEmployeeId: shown\.regularizationApproverEmployeeId \? Number\(shown\.regularizationApproverEmployeeId\) : null,/g) || []).length, 2);
});

test("Raise Request names the Attendance Regularization Approver, or says the Permission Approver stands in", () => {
  const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "AttendanceRequestFormPanel.js"), "utf8");
  assert.match(PANEL, /if \(regularizationRole === "REGULARIZATION_APPROVER"\) return "Goes to your Attendance Regularization Approver\.";/);
  assert.match(PANEL, /if \(regularizationRole === "PERMISSION_APPROVER"\) return "No Attendance Regularization Approver is set for you, so it goes to your Permission Approver\.";/);
  assert.match(PANEL, /const regularizationRole = type === "INCORRECT_LOGIN" \? approvers\?\.regularizationApproverRole \|\| null : null;/);
});
