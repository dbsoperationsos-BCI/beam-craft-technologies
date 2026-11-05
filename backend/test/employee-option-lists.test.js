const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  FALLBACK_WORKING_STATUSES,
  FALLBACK_SPOUSE_STATUSES,
  FALLBACK_GENDERS,
  workingEmployeeStatuses,
  spouseRequiringMaritalStatuses,
  asksForSpouseDetails,
  genderNames,
  publicOnboardingOptionLists,
} = require("../src/services/employeeOptionLists");

/*
 * The employee option lists the studio maintains, and the meanings that used to be written into the
 * code beside them.
 *
 * Three of these lists are not just words on a form. Which employee statuses mean somebody is
 * working here decides who may be handed an asset, who the CRM offers as a salesperson and who may
 * link a WhatsApp session; which marital statuses ask for a spouse decides what the employee and
 * onboarding forms collect and what the public endpoint requires; and the set of genders is what
 * that endpoint validates against. All three were hard-coded - the array in eight files, the
 * literal "Married" in four, a `z.enum` of three genders - so the lists were editable in name only
 * and a rename broke behaviour somewhere nobody was looking.
 *
 * What is asserted here is the property that makes editing them safe: the meaning is read off the
 * row, and nothing ever answers with an empty list.
 */

test("nothing answers with an empty list", async () => {
  /*
   * The one failure that must not happen. "No status counts as working" would empty the CRM's
   * employee list and refuse every asset handover; "no gender is valid" would refuse every
   * onboarding submission. An unseeded table and an unreachable database both fall back to exactly
   * what the code used to say, so the worst case is the behaviour this replaced.
   */
  for (const [what, read] of [
    ["working statuses", workingEmployeeStatuses],
    ["spouse-requiring marital statuses", spouseRequiringMaritalStatuses],
    ["genders", genderNames],
  ]) {
    const list = await read();
    assert.ok(Array.isArray(list) && list.length, `${what} came back empty, which is never a safe answer`);
  }
});

test("the fallbacks are exactly what the code used to say", () => {
  // If these drift, a database that has not been seeded quietly starts behaving differently from
  // the application before this change - which is the one thing the fallback exists to prevent.
  assert.deepEqual(FALLBACK_WORKING_STATUSES, ["Active", "in Training", "PIP"]);
  assert.deepEqual(FALLBACK_SPOUSE_STATUSES, ["Married"]);
  assert.deepEqual(FALLBACK_GENDERS, ["Male", "Female", "Other"]);
});

test("the seeded lists reproduce the old behaviour", async () => {
  // The migration seeds each list with what the browser held, so nothing an employee already
  // answered stops matching and nobody drops out of a query on the day it runs.
  const working = await workingEmployeeStatuses();
  for (const status of FALLBACK_WORKING_STATUSES) {
    assert.ok(working.includes(status), `"${status}" no longer counts as working, so those people leave the CRM`);
  }
  assert.ok((await genderNames()).includes("Male"), "the gender list no longer holds what the enum used to allow");
});

test("whether a status asks for a spouse is the list's answer, not the word", async () => {
  assert.equal(await asksForSpouseDetails("Married"), true);
  assert.equal(await asksForSpouseDetails("Single"), false);
  // Blank is not an answer, and neither is something nobody listed.
  assert.equal(await asksForSpouseDetails(""), false);
  assert.equal(await asksForSpouseDetails(null), false);
  assert.equal(await asksForSpouseDetails("Nonsense"), false);
});

test("a candidate is offered the studio's lists, not the browser's", async () => {
  /*
   * The apply page has no session, so it cannot read the master data the employee form reads. The
   * invite carries the lists instead - without this the two screens ask different things about the
   * same person, which is the drift `employeeOptions.js` exists to prevent.
   */
  const options = await publicOnboardingOptionLists();
  for (const key of ["genders", "workTypes", "maritalStatuses", "emergencyContactRelationships", "spouseRequiringMaritalStatuses"]) {
    assert.ok(Array.isArray(options[key]) && options[key].length, `${key} is missing from what the candidate is offered`);
  }
  // The meaning travels with the words: the page needs to know which answers ask for a spouse.
  assert.ok(options.spouseRequiringMaritalStatuses.every((name) => options.maritalStatuses.includes(name)),
    "a status that asks for a spouse is not on the list the candidate can pick from");
});

/* ─────────────────────────── the call sites, read off the source ─────────────────────────── */

const read = (file) => fs.readFileSync(path.join(process.cwd(), "src", file), "utf8");

test("no module decides for itself who counts as working", () => {
  /*
   * The array was written out in eight files. A ninth copy is how this change comes undone: the
   * list stays editable, and one screen quietly stops following it.
   */
  const callers = [
    "modules/assets/client-storage.controller.js",
    "modules/sales/projects/controller.js",
    "modules/sales/whatsapp-chat/controller.js",
    "modules/accounts/cash-entries/controller.js",
    "modules/hrm/payment-requests/controller.js",
    "modules/sales/extra-quotations/controller.js",
    "modules/hrm/employees/read.service.js",
    "modules/hrm/employees/controller.js",
    "modules/sales/crm-reports/service.js",
  ];
  for (const file of callers) {
    const source = read(file);
    assert.ok(!/\[\s*"Active",\s*"in Training",\s*"PIP"\s*\]/.test(source),
      `${file} writes the working statuses out again instead of asking the list`);
    /*
     * Directly, or through a helper in `employeeOptionLists` that asks it - `salesEmployees()`,
     * which the three readers of the Sales roster now share. The guarantee is that nothing decides
     * for itself, not that every file names the function; the helper is pinned to ask the list by
     * `sales-roster-department.test.js`, so the chain is covered at both ends.
     */
    assert.match(source, /workingEmployeeStatuses|salesEmployees/, `${file} no longer asks the list who counts as working`);
  }
});

test("the public onboarding endpoint no longer fixes the genders in code", () => {
  const source = read("modules/hrm/onboarding-invites/controller.js");
  assert.ok(!/gender:\s*z\.enum\(/.test(source),
    "gender is a fixed enum again, so a gender the studio adds would be refused on submit");
  assert.ok(!/maritalStatus\s*!==\s*"Married"/.test(source),
    "the spouse rule compares against the word \"Married\" again instead of asking the list");
});
