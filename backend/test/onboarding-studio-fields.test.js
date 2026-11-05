const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * What a candidate's onboarding submission may write, and what it may not.
 *
 * Designation, Department and Vertical are the studio's decisions, taken in Review Employee. The
 * onboarding form never asks the candidate for any of them - so a submission must not write them,
 * and for a long time it wrote all three as the literal string "Not Allocated". That caused two
 * separate faults, and this file exists to keep both fixed.
 *
 *   1. It read as an answer. `SchemaFormFields` adds a stored value it cannot find among a select's
 *      options back into the list rather than losing it, and "Not Allocated" is in none of
 *      `designationOptions`, `departmentOptions` or `verticalOptions` - so it arrived on the review
 *      form as a *selected* option in a required field. HR could approve without ever choosing, and
 *      the register then held a value no dropdown offers.
 *
 *   2. It overwrote. `submittedEmployeeData` runs on the update path too - a candidate sent back for
 *      corrections resubmits through it - so any department or vertical HR had already settled was
 *      reset by the candidate pressing Submit.
 *
 * Read from the source rather than exercised, the way contacts-directory.test.js reads its service:
 * the shape being pinned is which keys the write paths mention, which is a property of the code and
 * needs no database to be true.
 */

const CONTROLLER = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "hrm", "onboarding-invites", "controller.js"),
  "utf8",
);

/** The controller with its prose stripped: the comments discuss the sentinel at length. */
const code = CONTROLLER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the onboarding submission never writes the Not Allocated sentinel", () => {
  /*
   * The string itself, anywhere in the executable source. Pinned as an absence rather than by
   * checking the three fields, because the fault was not that a particular column got it - it was
   * that a placeholder meaning "nobody has chosen" was being stored as though somebody had.
   */
  assert.doesNotMatch(code, /Not Allocated/, "the onboarding submission is writing the sentinel again");
});

test("a candidate's answers do not include the three the studio decides", () => {
  /*
   * `submittedEmployeeData` is the candidate's submission as an employee record, and it is spread
   * into both the create and the update. None of these three may be in it: on create they belong to
   * Review Employee, and on a resubmission writing them would undo what HR settled.
   */
  const body = code.slice(code.indexOf("async function submittedEmployeeData"));
  const fields = body.slice(0, body.indexOf("\n}"));
  for (const field of ["designation", "department", "vertical"]) {
    assert.doesNotMatch(
      fields,
      new RegExp(`^\\s*${field}:`, "m"),
      `"${field}" is written by the candidate's submission, so a resubmission would overwrite HR's choice`,
    );
  }
});

test("designation is seeded from the invite once, on create and not on resubmission", () => {
  /*
   * The one studio answer that exists before the review: Intended Designation is required to send an
   * invite at all. Seeded on the create so a new record starts with the job it was raised for, and
   * deliberately not on the update beside it - re-applying it every time would undo a correction
   * made during review.
   */
  const create = code.slice(code.indexOf("return tx.employee.create"));
  assert.match(create, /designation: invite\.intendedDesignation \|\| null/, "a new record no longer takes the invite's designation");

  const update = code.slice(code.indexOf("return tx.employee.update"), code.indexOf("return tx.employee.create"));
  assert.doesNotMatch(update, /designation:/, "a resubmission is writing the designation again");
});

test("the three columns are nullable, which is what leaves the placeholder showing", () => {
  // An empty required field is the whole point: Review Employee shows its own "Select Department"
  // rather than a chosen answer, and refuses to save until HR picks one. A NOT NULL column would
  // have forced a sentinel back.
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const employee = schema.slice(schema.indexOf("model Employee {"));
  const fields = employee.slice(0, employee.indexOf("\n}"));
  for (const field of ["designation", "department", "vertical"]) {
    assert.match(fields, new RegExp(`^\\s*${field}\\s+String\\?`, "m"), `employee.${field} is not nullable`);
  }
});
