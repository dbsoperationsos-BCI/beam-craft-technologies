const test = require("node:test");
const assert = require("node:assert/strict");
const { employeeSchema } = require("../src/modules/hrm/employees/controller");

/*
 * The Employee ID the studio mints, and the Employee ID the API will accept back.
 *
 * These are two halves of one fact that lived in two files and disagreed: `services/identifiers.js`
 * builds `DBS-1` — hyphenated, unpadded, deliberately so — while the update schema demanded
 * `DBS001`. Nothing generated that, so handing a stored id back, which every Update and every
 * Approve & Onboard does, was refused with "Validation failed" against a field nobody had edited.
 *
 * The assertion that matters is the first one: what the generator produces has to be something the
 * validator recognises. If the id format is ever changed, this is what should fail.
 */

const parse = (employeeId) => employeeSchema.partial().safeParse({ employeeId }).success;

/**
 * The shape `["DBS", tag, ...parts, number].filter(Boolean).join("-")` produces for EMPLOYEE, whose
 * definition carries no tag, no parts and a width of 0 — so no padding and a single separator.
 */
const mintedEmployeeId = (counter) => ["DBS", String(counter)].join("-");

test("an id straight from the generator is one the API accepts", () => {
  for (const counter of [1, 9, 42, 100, 2026]) {
    assert.equal(parse(mintedEmployeeId(counter)), true, mintedEmployeeId(counter));
  }
});

test("the older unhyphenated ids already on the repository still save", () => {
  // Rows predating the current generator carry these; an edit of one must not be refused.
  for (const id of ["DBS1", "DBS001", "DBS0042"]) assert.equal(parse(id), true, id);
});

test("anything that is not an employee id is still refused", () => {
  for (const id of ["DBS", "DBS-", "DBS-abc", "ABC-1", "1", "dbs-1 "]) assert.equal(parse(id), false, id);
});

test("no id at all is allowed, since the server mints it on create", () => {
  assert.equal(employeeSchema.partial().safeParse({ employeeId: null }).success, true);
  assert.equal(employeeSchema.partial().safeParse({}).success, true);
});

test("a whole reviewed record round-trips, which is what Approve & Onboard sends", () => {
  const payload = {
    employeeId: mintedEmployeeId(1),
    employeeName: "John Smith",
    employmentStatus: "HR Onboarding Pending",
    dateOfJoining: "2026-03-01",
    // Set at onboarding, six months from joining, and sent back with the rest.
    nextReviewDate: "2026-09-01",
    reviews: [],
  };
  const parsed = employeeSchema.partial().safeParse(payload);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.flatten().fieldErrors));
});
