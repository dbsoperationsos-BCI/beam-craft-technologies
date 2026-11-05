const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * "My Documents" on CRD Documents, the switch the CRM board already has.
 *
 * The scope widens "mine" to "mine and my team's" - it follows `reportsToEmployeeId` the whole way down,
 * so a manager four levels up sees a coordinator's documents. That is the right default and it is also
 * why a coordinator with a team of their own cannot find their own work: eleven rows, one of them theirs.
 *
 * The switch narrows to the reader alone. It is the same arrangement as the board's, down to the reasons:
 * remembered per person, drawn **only** for somebody who has a team, and "mine" is the row's own owner -
 * here the project's pre-production coordinator, which is what the Assigned To column shows.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const SERVICE = read("src", "modules", "sales", "crd-documents", "service.js");
const CONTROLLER = read("src", "modules", "sales", "crd-documents", "controller.js");

test("mine is the row's own owner, not any of the five named columns", () => {
  /*
   * A document is on its project's pre-production coordinator - that is what the column says and what the
   * switch has to agree with. Narrowing on all five named-on columns would answer "projects I am involved
   * in", which is a different question and would leave the column and the switch disagreeing about whose
   * row it is.
   */
  assert.match(SERVICE, /preProductionCoordinatorEmployeeId: mine\.employeeId/);
});

test("an unowned document surfaces for whoever hands work out", () => {
  /*
   * The same rule the board applies to a lead with no CRM. Most projects have no coordinator named yet, so
   * with the switch on those rows belong to nobody - and a document nobody owns has to be visible to
   * somebody or it is only ever found by turning the switch off. It surfaces for a reader who sees
   * everything: they are the ones who staff projects. A coordinator looking at their own work is not shown
   * other people's unstaffed documents.
   */
  assert.match(SERVICE, /mine\.seesUnassigned/);
  assert.match(SERVICE, /preProductionCoordinatorEmployeeId: null/);
});

test("the switch is offered only where it means something", () => {
  /*
   * For somebody with nobody under them the two states are the same list, and a switch that changes
   * nothing invites a reader to flip it, see no difference and conclude the screen is broken. Answered
   * from the org chart, and only ever used to decide whether to *offer* the narrowing - it grants
   * nothing, so a wrong answer can hide a switch and can never widen a list.
   */
  assert.match(CONTROLLER, /managesAnyone/);
  assert.match(CONTROLLER, /subtreeEmployeeIds/);
  assert.match(CONTROLLER, /seesEverything/);
});

test("the flag is read from the query, as the board reads it", () => {
  // The word rather than a flag's presence, which is how the board sends it and how this reads it.
  assert.match(CONTROLLER, /String\(req\.query\.mine \|\| ""\) === "true"/);
});
