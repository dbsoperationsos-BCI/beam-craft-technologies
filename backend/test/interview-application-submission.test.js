const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * What a candidate's own submission may write, and what it may not.
 *
 * The submission is applied through `prepareValues` **partially**, which is what lets a candidate
 * fill in their half of a record without blanking the half HR already filled. The trap in that
 * arrangement is precise: partial means "write every key you were given", so a key the form stops
 * asking about but keeps *sending* arrives empty and wipes a stored answer. Taking a field off the
 * form is therefore two changes, not one - the field, and the key.
 *
 * Department is the case. It was asked as "where you would be working, if you know", which a
 * candidate cannot answer about a studio they have not joined, so it came back blank or guessed.
 * Which department a hire lands in is the studio's answer, set on the record.
 */

const INVITES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "invites.js"), "utf8");

test("the submission is applied partially, so a candidate cannot blank what HR filled in", () => {
  assert.match(INVITES, /service\.prepareValues\(values, \{ partial: true \}\)/);
});

test("a candidate's submission neither asks for nor sends a department", () => {
  // Not in the values the submission writes, which is the assertion that matters: a key here is a
  // column written, and an empty one would wipe the department HR set.
  assert.equal(/^\s*department: data\.department,$/m.test(INVITES), false, "the submission must not write a department");
  // Not accepted either, rather than accepted and ignored - an object schema drops what it does not
  // name, so an older tab still posting the field is no trouble.
  assert.equal(/^\s*department: shortText\(\d+\),$/m.test(INVITES), false, "the schema should not name a department");
  // And not sent back to the form as a prefill, so the form never carries it in the first place.
  assert.equal(/department: candidate\.department/.test(INVITES), false, "the prefill should not carry a department");
});

test("a candidate's submission neither asks for nor sends a highest qualification", () => {
  /*
   * It was a box beside a Qualifications list that already asks for every qualification with its
   * marks and year - the same answer twice, in a shorter form, with nothing to say which the studio
   * should believe. Off the form, and out of the write for the same reason the department is: the
   * submission is partial, so an empty key would be written over what is on the record.
   */
  assert.equal(/^\s*highestQualification: data\.highestQualification,$/m.test(INVITES), false, "the submission must not write one");
  assert.equal(/^\s*highestQualification: shortText\(\d+\),$/m.test(INVITES), false, "the schema should not name one");
  assert.equal(/highestQualification: candidate\.highestQualification/.test(INVITES), false, "the prefill should not carry one");
  // Experience is still written: it is what the form decides from the rows, or "Fresher".
  assert.match(INVITES, /^\s*experience: data\.experience,$/m);
  assert.match(INVITES, /experience: shortText\(60\),/);
});

test("the form asks where a candidate is from and where they are, not a state and an address", () => {
  /*
   * A **State** was too coarse to answer what a studio actually asks about somebody it is
   * considering - can they be on the floor on Saturday, and would the job mean moving - and a postal
   * **Address** is more than a studio should hold about a person it has not hired. Native Place and
   * Current Location replace both.
   *
   * The removal is the same three-part cut the department and the highest qualification were, and
   * for the same reason: the submission is applied **partially**, so a key the form stops asking
   * about but keeps *sending* arrives empty and writes over what is on the record. `state` and
   * `address` are still real columns - a linked sheet and the CSV import fill them - so an empty one
   * from a submission would destroy an imported answer.
   */
  for (const gone of ["state", "address"]) {
    assert.equal(new RegExp(`^\\s*${gone}: data\\.${gone},$`, "m").test(INVITES), false, `the submission must not write a ${gone}`);
    assert.equal(new RegExp(`^\\s*${gone}: shortText\\(\\d+\\),$`, "m").test(INVITES), false, `the schema should not name a ${gone}`);
    assert.equal(new RegExp(`${gone}: candidate\\.${gone}`).test(INVITES), false, `the prefill should not carry a ${gone}`);
  }
  // And the two that replaced them are asked for, written, and read back when a link is reopened.
  for (const asked of ["nativePlace", "currentLocation"]) {
    assert.match(INVITES, new RegExp(`^\\s*${asked}: shortText\\(191\\),$`, "m"), `${asked} should be accepted`);
    assert.match(INVITES, new RegExp(`^\\s*${asked}: data\\.${asked},$`, "m"), `${asked} should be written`);
    assert.match(INVITES, new RegExp(`${asked}: candidate\\.${asked}`), `${asked} should be prefilled`);
  }
  // The city is untouched: it is a different question from either of them.
  assert.match(INVITES, /^\s*city: data\.city,$/m);
});

test("the form is still told what it does need, so the cut took nothing else with it", () => {
  for (const field of ["position", "employmentType", "experience", "currentCompany", "city", "state"]) {
    assert.ok(new RegExp(`${field}: `).test(INVITES), `${field} should still be part of a submission`);
  }
  assert.match(INVITES, /contactNumber: submissionPhone/);
});

/*
 * Moving a stage from a row menu.
 *
 * The full update is deliberately **not** partial - it validates the whole record and writes every
 * key it is handed - which is right for a form and wrong for a row menu holding a table row. Sent
 * there, a body carrying only a stage is refused for a missing name, and one carrying a name blanks
 * every other column. So the stage has a verb of its own, the way Tasks gives each of its four
 * transitions one.
 */

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "routes.js"), "utf8");
const { statusSchema } = require("../src/modules/hrm/interview/controller");

test("a stage moves on its own, applied partially so nothing else is written", () => {
  assert.match(ROUTES, /router\.patch\("\/candidates\/:id\/status", controller\.setStatus\);/);
  /*
   * `values` rather than `parsed.data`: the stage, plus the reason where the decision carried one.
   *
   * In `applyStatus` rather than inline in the handler, because the bulk move over a selection makes
   * the same move and the two must not differ about it - see `interview-select-all-rbac.test.js`.
   */
  assert.match(CONTROLLER, /service\.updateCandidate\(id, values, actor, \{ partial: true \}\)/);
  assert.match(CONTROLLER, /return res\.json\(\{ data: await applyStatus\(req\.params\.id, status, note, req\.user, \{ nextFollowUpDate \}\) \}\)/);
  // The full update stays non-partial; this is the only write that is not.
  assert.match(CONTROLLER, /service\.updateCandidate\(req\.params\.id, parsed\.data, req\.user\)/);
});

test("the stage route takes a stage and nothing else", () => {
  assert.equal(statusSchema.safeParse({ status: "Rejected" }).success, true);
  // A blank stage is refused rather than written as one, which would leave a row filed nowhere.
  assert.equal(statusSchema.safeParse({ status: "  " }).success, false);
  assert.equal(statusSchema.safeParse({}).success, false);
  // And nothing else rides along: an object schema drops what it does not name, so a body trying
  // to slip a name or an email through this route writes neither.
  const parsed = statusSchema.safeParse({ status: "On Hold", name: "Somebody Else", email: "x@y.z" });
  assert.deepEqual(parsed.data, { status: "On Hold" });
  /*
   * A reason may ride along, and only that: Selected, On Hold and Rejected ask for one in a dialog,
   * and it is appended to the candidate's decisions rather than written over the last. Undo sends
   * none, so moving a stage back does not add a second note about undoing the first.
   */
  assert.equal(statusSchema.safeParse({ status: "Rejected", note: "Asked for more than the band." }).success, true);
  assert.match(CONTROLLER, /values\.statusNotes = \[\.\.\.held, \{\s*\n\s*status,\s*\n\s*note,\s*\n\s*at: new Date\(\)\.toISOString\(\),/);
  /*
   * **Follow Up** rides this route too, and is the one stage that carries a date: chasing somebody
   * is the decision that they are worth another try, on this day. The key stays `undefined` unless a
   * caller sends it, so the three decisions that do not ask leave the column exactly as it was.
   */
  assert.equal("nextFollowUpDate" in statusSchema.safeParse({ status: "Rejected" }).data, false);
  assert.equal(statusSchema.safeParse({ status: "Follow Up", nextFollowUpDate: "2026-10-01" }).data.nextFollowUpDate, "2026-10-01");
});

test("the stage route is guarded by the same permission as everything beside it", () => {
  // It is a PATCH under a router that asks Read for a GET and Read / Write for anything else, so it
  // needed no guard of its own - and must not have one, since a second rule is a second thing to
  // keep in step.
  assert.match(ROUTES, /router\.use\(requireModule\("HRM", "Interview"\)\);/);
  assert.equal(/patch\([^)]*checkPermission/.test(ROUTES), false);
  assert.equal(/req\.user\.role/.test(CONTROLLER), false, "a controller may never read the role");
});
