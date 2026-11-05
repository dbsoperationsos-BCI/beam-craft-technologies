const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LIST = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");

test("the employee list says whose resignation is submitted and waiting for HR, without moving them", () => {
  const list = LIST.slice(LIST.indexOf("async function listEmployees(req, res) {"), LIST.indexOf("async function createEmployee(req, res) {"));
  // Read for the page's employees only, and only forms still Submitted - Approved is real notice.
  assert.match(list, /prisma\.employeeOffboardingInvite\.findMany\(\{\n\s+where: \{ employeeId: \{ in: data\.map\(\(employee\) => employee\.id\) \}, status: "Submitted" \},/);
  assert.match(list, /resignationPending: resignationFor\.has\(employee\.id\)/);
  // Nothing about the employee is written here: HR's approval is still what records the separation.
  assert.doesNotMatch(list, /prisma\.employee\.update\(/);
});

test("HR may give the resignation date when raising a form; the server works out the last day and the employee's form opens on it", () => {
  const OFF = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "offboarding-invites", "controller.js"), "utf8");
  const create = OFF.slice(OFF.indexOf("async function createInvite(req, res) {"), OFF.indexOf("async function scopedInvite("));
  assert.match(OFF, /resignationDate: z\.coerce\.date\(\)\.optional\(\),\n\}\)\.strict\(\);/);
  assert.match(create, /const resignationKey = parsed\.data\.resignationDate \? studioDateKey\(parsed\.data\.resignationDate\) : null;/);
  // Never a last day from the request: always the notice counted from the date.
  assert.match(create, /proposedLastWorkingDate: lastWorkingDateFrom\(resignationKey, noticePeriodDays\),/);
  assert.match(OFF, /\} : hrSetResignationDate\(updated\) \? \{\n\s+resignationDate: updated\.resignationDate,\n\s+proposedLastWorkingDate: updated\.proposedLastWorkingDate,\n\s+\} : null,/);
  const { lastWorkingDateFrom } = require("../src/modules/hrm/offboarding-invites/controller");
  assert.equal(lastWorkingDateFrom("2026-10-31", 30).toISOString().slice(0, 10), "2026-11-29");
});

test("a resignation date HR set is the employee's to see, not to change - the server keeps it", () => {
  const OFF = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "offboarding-invites", "controller.js"), "utf8");
  const { hrSetResignationDate } = require("../src/modules/hrm/offboarding-invites/controller");
  assert.equal(hrSetResignationDate({ resignationDate: new Date("2026-11-02"), submittedAt: null }), true);
  // Sent back after a submission: the date is the employee's own, theirs to correct.
  assert.equal(hrSetResignationDate({ resignationDate: new Date("2026-11-02"), submittedAt: new Date() }), false);
  assert.equal(hrSetResignationDate({ resignationDate: null, submittedAt: null }), false);
  // Submitting cannot move it: HR's date is used, never the request's.
  assert.match(OFF, /const resignationKey = studioDateKey\(hrSetResignationDate\(invite\) \? invite\.resignationDate : parsed\.data\.resignationDate\);/);
  assert.match(OFF, /resignationDateFixed: hrSetResignationDate\(updated\),/);
  // HR changing the notice period recounts the last day from their date.
  assert.match(OFF, /proposedLastWorkingDate: lastWorkingDateFrom\(resignationKey, parsed\.data\.noticePeriodDays\),/);
});

test("a resignation completed from the offboarding panel approves the employee's submitted form and links it", () => {
  const SEP = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "separations", "controller.js"), "utf8");
  const create = SEP.slice(SEP.indexOf("async function createSeparation(req, res) {"), SEP.indexOf("async function getPendingWork("));
  assert.match(create, /if \(input\.separationType === "Resignation" && data\?\.employeeId\) \{/);
  assert.match(create, /where: \{ employeeId: data\.employeeId, status: "Submitted" \},\n\s+data: \{ status: "Approved", reviewedAt: new Date\(\), reviewedByUserId: actorId \|\| null, separationId: data\.id \},/);
  // Logged, never thrown: the separation is already on record.
  assert.match(create, /\.catch\(\(linkError\) => console\.error\(/);
});
