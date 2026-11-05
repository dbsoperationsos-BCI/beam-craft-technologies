const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { remarkSchema } = require("../src/modules/hrm/interview/controller");

/*
 * A remark written **without** taking a decision.
 *
 * Until now the only way a note reached a candidate's record was by moving their stage - the decision
 * dialog asks for one - so "they said to call back after Diwali" had nowhere to go unless the
 * recruiter also pretended to change something. The note lands in `statusNotes`, the same
 * append-only log the decisions write to, so one list holds both why a stage moved and what was said.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const CONTROLLER = read("src", "modules", "hrm", "interview", "controller.js");
const ROUTES = read("src", "modules", "hrm", "interview", "routes.js");

test("a remark is text and nothing else", () => {
  assert.equal(remarkSchema.safeParse({ note: "Called, asked to try Monday." }).success, true);
  // Whitespace is not a remark. The popup requires one before it will save, and a gate that a space
  // satisfies is not a gate.
  assert.equal(remarkSchema.safeParse({ note: "   " }).success, false);
  assert.equal(remarkSchema.safeParse({}).success, false);
  // Nothing rides along: an object schema drops what it does not name, so a body trying to move the
  // stage through this route moves nothing.
  const parsed = remarkSchema.safeParse({ note: "ok", status: "Selected", nextFollowUpDate: "2026-10-01" });
  assert.equal(parsed.data.status, undefined);
  assert.equal(parsed.data.nextFollowUpDate, undefined);
});

test("it appends, and says who wrote it", () => {
  /*
   * Appended rather than written over, for the reason the decisions are: a candidate chased in March
   * and rejected in May has two things said about them and neither explains the other. `by` is new -
   * a decision's entry never carried the writer, and a log of notes without an author is a log
   * somebody has to guess at.
   */
  assert.match(CONTROLLER, /async function addRemark\(req, res\)/);
  // Two facts, asserted apart rather than as one span: that the entry is **appended** to what is
  // already there, and that it carries the writer. Spanning them with one regex made the assertion
  // depend on how long the comment between them happened to be, which is not a rule about anything.
  assert.match(CONTROLLER, /statusNotes: \[\.\.\.held, \{/);
  assert.match(CONTROLLER, /by: req\.user\?\.name \|\| req\.user\?\.username \|\| null,/);
  // Written at the stage the candidate is on, so the note reads in context rather than floating.
  assert.match(CONTROLLER, /status: current\?\.status/);
  // Partial, so a note cannot blank a column somebody else was editing.
  assert.match(CONTROLLER, /\{ partial: true \}/);
});

test("the route is guarded by the screen's own write permission", () => {
  assert.match(ROUTES, /router\.post\("\/candidates\/:id\/remarks", controller\.addRemark\);/);
  // A POST, so the router's own `requireModule("HRM", "Interview")` asks for READ_WRITE. No second
  // guard, and no role test in the controller - the guard above is the only thing deciding access.
  assert.equal(/addRemark[\s\S]{0,400}?req\.user\.role/.test(CONTROLLER), false);
});
