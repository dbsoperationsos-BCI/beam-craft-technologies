const test = require("node:test");
const assert = require("node:assert/strict");

const { LINKABLE_EMPLOYEE_FIELDS, linkProblem, linkableEmployee, readLinkedEmployeeId } = require("../src/modules/admin/userEmployeeLink");

/**
 * Administration → Users: joining a login to the person it belongs to.
 *
 * The rules worth testing are the ones no column can express. The unique index already stops two
 * logins claiming one employee; what it cannot do is say *which* login is in the way, tell an
 * archived employee from a missing one, or let somebody undo a link they made by mistake. Those
 * three are the whole of this module, and each of them was a way an administrator could be left
 * stuck on a screen with no explanation.
 */

const employee = { id: 42, employeeName: "Priya Raman", archivedAt: null };

test("an employee id is taken only when it actually names one", () => {
  assert.deepEqual(readLinkedEmployeeId(42), { ok: true, value: 42 });
  // The browser sends form values as strings, and the column is an int.
  assert.deepEqual(readLinkedEmployeeId("42"), { ok: true, value: 42 });

  // Anything that is not a positive whole number is refused rather than coerced. Zero and the
  // negatives matter: `Number("-1")` is a perfectly good number and would reach Prisma as an id.
  for (const bad of ["0", 0, "-1", -1, "4.5", 4.5, "abc", true, {}, []]) {
    assert.equal(readLinkedEmployeeId(bad).ok, false, JSON.stringify(bad));
  }
});

test("clearing the link is possible, whichever way the screen says nothing", () => {
  // Three spellings of "no employee", because a <select> cannot hold null: an empty option's value
  // is the empty string, and the picker's own "Not linked" row needs a value that is not an id.
  for (const blank of [null, undefined, "", "none"]) {
    assert.deepEqual(readLinkedEmployeeId(blank), { ok: true, value: null }, String(blank));
  }
});

test("an employee that is gone is refused, and says which kind of gone", () => {
  assert.equal(linkProblem({ employee: null }), "That employee is no longer on the repository.");
  assert.equal(
    linkProblem({ employee: { ...employee, archivedAt: new Date() } }),
    "That employee has been removed from the repository.",
  );
  assert.equal(linkProblem({ employee }), null);
});

test("one employee answers for one login, and the message names the login in the way", () => {
  // The unique index would reject this too, but as a constraint error the screen cannot read.
  assert.equal(
    linkProblem({ employee, linkedTo: 7, userId: 9, linkedUserName: "priya.r" }),
    "Priya Raman is already linked to priya.r. Clear that link first.",
  );

  // A holder whose name could not be read still gets a sentence rather than a constraint error.
  assert.equal(
    linkProblem({ employee, linkedTo: 7, userId: 9 }),
    "Priya Raman is already linked to another login. Clear that link first.",
  );

  // Re-saving the link that is already there is not a clash with itself — the Users screen sends
  // the whole form back, so this happens on any save that changes something else.
  assert.equal(linkProblem({ employee, linkedTo: 9, userId: 9 }), null);
  // Ids arrive as strings from a URL parameter often enough that the comparison must not care.
  assert.equal(linkProblem({ employee, linkedTo: 9, userId: "9" }), null);
});

test("the picker discloses a name and a place of work, and nothing else about a person", () => {
  // An administrator choosing who a login belongs to needs enough to tell two people apart. They
  // are not thereby given the Employee Repository, so the row stops at the public columns and a photo link.
  assert.deepEqual(Object.keys(LINKABLE_EMPLOYEE_FIELDS).sort(), [
    "department", "designation", "employeeId", "employeeName", "employmentStatus", "id", "profilePhotoUrl",
  ]);
});

test("an employee already spoken for stays on the list, marked", () => {
  // Dropping them would leave somebody unable to tell "not in the repository" from "already
  // taken", and only the second is something they can do anything about.
  const taken = linkableEmployee({ ...employee, employeeId: "DBS-014", department: "Post", designation: "Editor" }, 7);
  assert.equal(taken.linkedToUserId, 7);
  assert.equal(taken.employeeName, "Priya Raman");
  assert.equal(taken.employeeId, "DBS-014");

  const free = linkableEmployee({ ...employee, employeeId: "DBS-014", department: null, designation: null });
  assert.equal(free.linkedToUserId, null);
  // Blank text columns read as null rather than as an empty string the picker would print.
  assert.equal(free.department, null);
  assert.equal(free.designation, null);
});
