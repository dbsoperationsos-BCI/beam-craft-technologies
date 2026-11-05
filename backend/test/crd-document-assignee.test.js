const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Who a CRD document is on.
 *
 * It is the project's **pre-production coordinator**, and it is not a new column: that person is already
 * named on the project, already one of the five columns `dataScope` narrows the register by, and
 * therefore already the reason the document reaches them. Copying the id onto the document would put the
 * same fact in two rows for the two to disagree about the first time a project's coordinator changed.
 *
 * What was missing was being able to *see* it. The screen showed no owner at all, so a list narrowed to
 * the reader's own work looked exactly like a list of everybody's.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const SERVICE = read("src", "modules", "sales", "crd-documents", "service.js");
const SCOPE = read("src", "services", "projectScope.js");
const SCHEMA = read("prisma", "schema.prisma");

test("the assignee is the project's own coordinator, not a second column", () => {
  assert.match(SERVICE, /preProductionCoordinatorEmployeeId: true/);
  assert.match(SERVICE, /preProductionCoordinatorEmployee: \{ select: \{ employeeName: true, employeeId: true \} \}/);
  // Nothing on the document itself holds an assignee - the link lives on the project, once.
  assert.equal(/assignedToEmployeeId/.test(SCHEMA.slice(SCHEMA.indexOf("model SalesProjectCrdDocument"), SCHEMA.indexOf("model SalesCrdTermsSettings"))), false);
});

test("the name is resolved through the relation, with the stored text only as a fallback", () => {
  /*
   * Rule 5: the link is the id and the text beside it is a copy. The employee's current name comes back
   * from the relation, so somebody who has since been renamed reads correctly here; the copy on the
   * project answers for the rows that were filled in before anybody was linked.
   */
  assert.match(SERVICE, /assignedTo: project\.preProductionCoordinatorEmployee\?\.employeeName \|\| project\.preProductionCoordinator \|\| ""/);
});

test("it is the same person the scope already narrows by", () => {
  // The point of not adding a column: the visible owner and the reason the row is visible are one fact.
  assert.match(SCOPE, /"preProductionCoordinatorEmployeeId",/);
  assert.match(SCOPE, /const PROJECT_SCOPE_COLUMNS = \{ branch: "branchId", employee: NAMED_ON_FIELDS, user: "createdByUserId" \};/);
});

test("a standalone document has no project, so it has nobody", () => {
  /*
   * A document raised by hand against an enquiry that answers to no project has no coordinator to take -
   * and inventing one would be a claim about who is responsible. It reads blank, which is true.
   */
  assert.match(SERVICE, /assignedTo: ""/);
});
