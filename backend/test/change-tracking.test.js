const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { WATCHED, COMMON_SKIP, trackChanges, collectedChanges, ownColumns, subjectOf } = require("../src/services/changeTracking");

/*
 * **Every save describes itself, without a handler being wired up.**
 *
 * The activity log recorded that somebody saved a project and nothing about what they saved. Wiring
 * handlers one at a time answers for the handlers somebody remembered: the save the studio was
 * actually pressing (`saveStartProjectDraft`, 131 times in three days) was not one of them, while the
 * two that were had run four times in a week. So the watching moved to the database.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("a relation is not a field anybody edited", () => {
  /*
   * The resolved-names extension hands a write's answer the rows it resolved names from, and the read
   * taken a moment earlier did not ask for them - so a plain diff reported
   * `Branch: — → {"name":"Malaysia"}` on a save that touched no branch. Found by running a real
   * update, not by reading the code.
   */
  const row = { eventId: "DBS-EVT-1", hardDiskStatus: "Pending", branch: { name: "Malaysia" }, shoots: [{ id: "a" }], mainEventDate: new Date("2026-11-20T00:00:00.000Z") };
  const own = ownColumns(row);
  assert.deepEqual(Object.keys(own).sort(), ["eventId", "hardDiskStatus", "mainEventDate"]);
  assert.ok(own.mainEventDate instanceof Date, "a date is a value, not a relation");
  assert.deepEqual(ownColumns(null), {});
});

test("the noise a save makes every time is skipped", () => {
  // A save touches `updatedAt` always; `nameCopies.js` rewrites the text beside an id on any rename;
  // a drag moves `sortOrder` on rows nobody edited. None of those is a claim anybody makes.
  for (const key of ["updatedAt", "createdAt", "createdBy", "updatedBy", "sortOrder", "deletedAt"]) {
    assert.ok(COMMON_SKIP.includes(key), key);
  }
  // And each watched record drops its own blob columns on top of those.
  assert.ok(WATCHED.SalesProject.skip.includes("groupNameGeneratorJson"));
  assert.ok(WATCHED.ProjectShoot.skip.includes("shootLocations"));
});

test("the watched list is short on purpose, and names the records questions are asked about", () => {
  assert.deepEqual(Object.keys(WATCHED).sort(), ["Employee", "PaymentRequest", "ProjectShoot", "SalesProject"]);
  // Each watched update costs one extra read - measured at about 6 ms - so this widens when a
  // question cannot be answered, not before.
  assert.match(read("src/services/changeTracking.js"), /Widen it when a question cannot be answered, not\n \* before\./);
});

test("a line names the record it is about, by the id a person would quote", () => {
  assert.equal(subjectOf("SalesProject", { eventId: "DBS-EVT-0001", id: "x" }), "Project DBS-EVT-0001");
  assert.equal(subjectOf("ProjectShoot", { shootId: "DBS-SID-1", id: "y" }), "Shoot DBS-SID-1");
  assert.equal(subjectOf("Employee", { employeeId: "DBS-11", id: 11 }), "Employee DBS-11");
  assert.equal(subjectOf("PaymentRequest", { requestCode: "PR-9", id: 9 }), "Payment request PR-9");
  // Falling back to the row's own id rather than saying nothing.
  assert.equal(subjectOf("SalesProject", { id: "abc" }), "Project abc");
});

test("nothing is collected outside a request", () => {
  // A scheduled sweep or a worker writes without anybody claiming anything about it.
  assert.equal(collectedChanges(), null);
  trackChanges({}, {}, () => {
    assert.deepEqual(collectedChanges(), [], "inside a request there is a list to fill");
  });
});

test("the lines do not live in the cache that is emptied after a write", () => {
  const source = read("src/services/changeTracking.js");
  /*
   * `forgetRequestCache()` clears `requestCache`'s map after a write - which is exactly when these
   * lines have just been collected. Its own store, or the save would describe itself and then lose
   * the description.
   */
  assert.match(source, /const storage = new AsyncLocalStorage\(\);/);
  assert.doesNotMatch(source, /require\("\.\/requestCache"\)/);
  assert.match(read("src/server.js"), /app\.use\(trackChanges\);/);
});

test("it is composed into the one client, after the names", () => {
  const db = read("src/config/db.js");
  assert.match(db, /extendWithChangeTracking\(extendWithResolvedNames\(new PrismaClient\(\)\)\)/);
  // So what it compares is what a read of the record would have shown.
  assert.match(db, /Applied\n \* after the names/);
});

test("a handler's own words come first, then what the writes said", () => {
  const log = read("src/services/activityLog.js");
  assert.match(log, /const said = req\?\.activityChanges \|\| \[\];/);
  assert.match(log, /const watched = collectedChanges\(\) \|\| \[\];/);
  assert.match(log, /\[\.\.\.said, \.\.\.watched\]\.join\(" · "\)/);
  // And nothing at all for a refused save: a rolled-back transaction leaves its lines behind.
  assert.match(log, /changes: res\.statusCode < 400 \? changesOn\(req\) : null,/);
});

test("a bulk write says how many moved rather than inventing a before", () => {
  const source = read("src/services/changeTracking.js");
  assert.match(source, /async updateMany\(\{ model, args, query \}\)/);
  assert.match(source, /changed together/);
  // `delete` keeps the record's name, read before it goes.
  assert.match(source, /lines\.push\(`\$\{subjectOf\(model, before\)\} deleted`\)/);
});
