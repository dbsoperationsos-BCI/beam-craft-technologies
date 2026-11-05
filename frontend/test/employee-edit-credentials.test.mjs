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

test("Edit gets the same two pages onboarding has, keeping its own Reviews section", () => {
  assert.match(PANEL, /const pageLinksFor = \(mode\) => \(mode === "edit" \? editPageLinks : onboardingPageLinks\)/);
  assert.match(PANEL, /\["review", "Employee Details", editOnlySectionLinks\]/, "Edit's first page drops the Reviews section");
  /*
   * The page a rail entry belongs to is decided by a set of ids, and it was built from the short
   * list. Reviews is Edit-only and so was not in it — which would have filed Edit's own Reviews
   * heading under the credentials page and sent a click there.
   */
  assert.match(PANEL, /const reviewSectionIds = new Set\(editOnlySectionLinks\.map/);
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
  assert.match(HOOK, /if \(!managing\) \{/);
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
