const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { fieldChanges, changedFieldNames, humanLabel, showValue, isSecret } = require("../src/services/recordChanges");
const { describeChanges, entryForRequest } = require("../src/services/activityLog");

/*
 * **The log can say what a write changed.**
 *
 * It recorded that somebody saved a project and nothing about what they saved, so "he says he updated
 * it and it is not reflecting" could not be answered from it either way. What it must not become is a
 * record of request bodies: the module's own promise is that it never keeps a body, a query string, a
 * token or a password, and that is kept by making this opt-in - a handler hands over the words it
 * wants written, so an endpoint carrying a password says nothing because it never asked to.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("only what moved, and only what was actually sent", () => {
  const before = { clientName: "Sharma", mainEventDate: new Date("2026-11-20T00:00:00.000Z"), hardDiskStatus: "Pending", remarks: "" };
  const after = { clientName: "Sharma Kumar", mainEventDate: "2026-11-22", hardDiskStatus: "Pending", remarks: null };
  assert.deepEqual(fieldChanges(before, after), [
    "Client Name: Sharma → Sharma Kumar",
    "Main Event Date: 20 Nov 2026 → 22 Nov 2026",
  ]);
  /*
   * `hardDiskStatus` did not move. `remarks` went from "" to null, which is the same emptiness - the
   * database keeps that difference and a reader does not care which flavour of blank a field held.
   * And a field the form never sent is absent, not "set to nothing", or a partial save would report
   * half the record.
   */
  assert.deepEqual(fieldChanges({ a: "x", b: "y" }, { a: "x" }), []);
  assert.deepEqual(fieldChanges({ a: "x" }, { a: "z" }), ["A: x → z"]);
});

test("a day is compared as a day, whatever shape it arrives in", () => {
  // Prisma hands back a Date and a form sends "2026-11-20"; compared as they come, every save of an
  // unchanged date would report a change.
  const same = fieldChanges({ day: new Date("2026-11-20T00:00:00.000Z") }, { day: "2026-11-20" });
  assert.deepEqual(same, []);
  assert.equal(showValue(new Date("2026-11-20T00:00:00.000Z")), "20 Nov 2026");
  assert.equal(showValue(""), "—");
  assert.equal(showValue(false), "No");
  assert.equal(showValue(0), "0", "zero is an answer, not a blank");
});

test("a value is never written down for a field that could hold a secret", () => {
  for (const key of ["password", "passwordHash", "confirmPassword", "apiKey", "otpCode", "resetToken", "upiPin"]) {
    assert.equal(isSecret(key), true, key);
  }
  assert.equal(isSecret("clientName"), false);
  // Even a caller that passes its whole validated body gets them dropped rather than recorded.
  assert.deepEqual(fieldChanges({ password: "old" }, { password: "new", clientName: "A" }), ["Client Name: — → A"]);
});

test("the studio's own spellings survive the derived label", () => {
  assert.equal(humanLabel("mainEventDate"), "Main Event Date");
  assert.equal(humanLabel("whatsappGroupNameId"), "WhatsApp Group Name ID");
  assert.equal(humanLabel("upiId"), "UPI ID");
  assert.equal(humanLabel("crdDocumentUrl"), "CRD Document URL");
  // And a caller may override one that still reads badly.
  assert.deepEqual(fieldChanges({ gou: "No" }, { gou: "Yes" }, { labels: { gou: "Gift of Us" } }), ["Gift of Us: No → Yes"]);
});

test("the names alone, for a trail that keeps no values", () => {
  assert.deepEqual(changedFieldNames({ a: "x", b: 1 }, { a: "y", b: 2 }), ["A", "B"]);
});

test("nothing is recorded unless a handler says so, and never on a refused save", () => {
  const req = (over = {}) => ({ user: { id: 7 }, originalUrl: "/api/sales/projects/1", method: "PATCH", route: { path: "/:id" }, baseUrl: "/api/sales/projects", headers: {}, ...over });
  // No handler spoke: the line carries nothing, which is what every untouched endpoint does.
  assert.equal(entryForRequest(req(), { statusCode: 200 }, Date.now())?.changes, null);
  // One that did.
  const spoke = req();
  describeChanges(spoke, ["Main Event Date: 20 Nov 2026 → 22 Nov 2026"]);
  describeChanges(spoke, "Production Manager: — → Karthik");
  assert.equal(
    entryForRequest(spoke, { statusCode: 200 }, Date.now()).changes,
    "Main Event Date: 20 Nov 2026 → 22 Nov 2026 · Production Manager: — → Karthik",
    "two calls join, so a save can describe each part where it does it",
  );
  // A refused save changed nothing, and a line claiming it did would be worse than no line.
  const refused = req();
  describeChanges(refused, ["Client Name: A → B"]);
  assert.equal(entryForRequest(refused, { statusCode: 400 }, Date.now()).changes, null);
  // Blank lines are not lines.
  const quiet = req();
  describeChanges(quiet, ["", "   ", null]);
  assert.equal(entryForRequest(quiet, { statusCode: 200 }, Date.now()).changes, null);
});

test("the column is read, filtered and stored, and the migration is additive", () => {
  const service = read("src/modules/admin/activity-logs/service.js");
  assert.match(service, /changes: true \};/, "on the list, not only the detail panel");
  assert.match(service, /everyChunk\(filters\.changes, \(chunk\) => \(\{ changes: \{ contains: chunk \} \}\)\)/);
  // Whitelisted in the controller, or the screen's filter is sent and silently dropped.
  assert.match(read("src/modules/admin/activity-logs/controller.js"), /^  changes: text,$/m);
  const migration = read("prisma/migrations/20261104120000_activity_log_changed_fields/migration.sql");
  assert.match(migration, /ALTER TABLE `user_activity_log` ADD COLUMN `changes` TEXT NULL;/);
  // Nullable, so every line already written stays as it is.
  assert.doesNotMatch(migration, /NOT NULL|UPDATE `user_activity_log`/);
});

test("the two project saves that caused this now say what they changed", () => {
  const controller = read("src/modules/sales/projects/controller.js");
  // Start / Edit Project, and Edit Sale Details.
  assert.match(controller, /const changes = fieldChanges\(before, parsed\.data\);\n\s*describeChanges\(req, changes\);/);
  assert.match(controller, /const saleChanges = fieldChanges\(saleBefore, parsed\.data\);\n\s*describeChanges\(req, saleChanges\);/);
  // The before is taken from the read the save already makes, inside its transaction.
  assert.match(controller, /saleBefore = existing;/);
  // And the project's own Activity tab says the same thing, so the two screens do not disagree.
  assert.match(controller, /detail: changes\.length \? changes\.join\(" · "\) : "Project details saved \(Start \/ Edit Project\)"/);
});
