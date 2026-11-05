const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { interviewSources } = require("../prisma/seeds/interview-sources.seed");
const { definitions } = require("../src/modules/hrm/master-data/definitions");
const candidates = require("../src/modules/hrm/interview/candidates");

/*
 * Where an application came from is a list the studio maintains, not an array in the code.
 *
 * It was the same eleven values in `hrm/interview/candidates.js` and again in the browser's
 * `interviewConfig.js`, which is two faults rather than one: a studio that started advertising
 * somewhere new could not say so, and the two copies could disagree about what the picker offered.
 *
 * Three things have to hold, and each of them has been the fault somewhere in this codebase before:
 * the values live in one place, the migration writes what the seed writes (because the seed cannot
 * be run on the VPS), and the two sources the *application* stamps on a candidate stay in code
 * where a rename in Field Settings cannot reach them.
 */

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260918160000_interview_source_list", "migration.sql"),
  "utf8",
);
const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "service.js"), "utf8");
const CANDIDATES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "candidates.js"), "utf8");

test("the seed holds the sources, and Meta Ads is one of them", () => {
  const names = interviewSources.map(([, name]) => name);
  assert.ok(names.includes("Meta Ads"), "Meta Ads should be a source the studio can pick");
  // The values the arrays held, so nothing a candidate already answered stops matching the list.
  for (const name of ["Naukri", "LinkedIn", "Indeed", "Social Media", "Website", "Campus", "Referral", "Walk-in", "Other"]) {
    assert.ok(names.includes(name), `${name} should still be offered`);
  }
  // One row per code, or the upsert would fight itself.
  const codes = interviewSources.map(([code]) => code);
  assert.equal(new Set(codes).size, codes.length);
  // The order is the answer's own: Other last wherever the list ends up, since sorting the words
  // would put it in the middle.
  assert.equal(names.at(-1), "Other");
  assert.deepEqual([...interviewSources].sort((a, b) => a[2] - b[2]).map(([, name]) => name), names);
});

test("the migration writes what the seed writes, because the seed cannot be run on the VPS", () => {
  /*
   * The same rule IAM.md step 10 gives for a permission: the seed reaches a developer's machine and
   * nowhere else, so a list that lives only there is a list production does not have. A name in one
   * and not the other is exactly the drift this asserts against.
   */
  for (const [code, name] of interviewSources) {
    assert.ok(MIGRATION.includes(`'${code}'`), `the migration is missing the code ${code}`);
    assert.ok(MIGRATION.includes(`'${name}'`), `the migration is missing ${name}`);
  }
  assert.match(MIGRATION, /CREATE TABLE `interview_source`/);
  // Re-running writes nothing, which is what makes it safe on a database the seed has already filled
  // and on one where the studio has edited the list since.
  assert.match(MIGRATION, /WHERE NOT EXISTS \(SELECT 1 FROM `interview_source` `existing`\)/);
});

test("the list is editable master data, counted against the candidates naming it", () => {
  const definition = definitions["interview-sources"];
  assert.ok(definition, "Settings → Fields has no Sources list to edit");
  assert.equal(definition.model, "interviewSource");
  // Deleting a source the studio has used says how many candidates name it rather than stranding
  // them on a word no list offers - the same guard the lead lists carry, on the live rows only.
  assert.deepEqual(definition.usedBy, [{ model: "hrmInterviewCandidate", field: "source", match: "exact", label: "candidate", where: { deletedAt: null } }]);
});

test("nothing hardcodes the sources any more, and the fallback is nothing rather than an array", () => {
  assert.equal("CANDIDATE_SOURCES" in candidates, false, "the module should not export a hardcoded source list");
  assert.equal(CANDIDATES.includes("CANDIDATE_SOURCES"), false);
  // Read from the list, and falling back to nothing: an array here would be the hardcoding back,
  // one read failure away from being what the studio is offered. Source is an optional combobox
  // everywhere it is asked, so an empty list is a box somebody types into.
  assert.match(SERVICE, /optionNames\("interviewSource", \[\]\)/);
});

test("the two sources the application stamps for itself stay in code", () => {
  /*
   * "Application Form" and "Google sheet integration" are not choices anybody makes - they are what
   * the public form and the sheet importer write on a candidate, and what the code then compares
   * against. A studio renaming a row in Field Settings must not change what an importer writes, so
   * neither is a row.
   */
  assert.equal(candidates.APPLICATION_FORM_SOURCE, "Application Form");
  assert.equal(candidates.SHEET_SOURCE, "Google sheet integration");
  const names = interviewSources.map(([, name]) => name);
  assert.equal(names.includes(candidates.APPLICATION_FORM_SOURCE), false);
  assert.equal(names.includes(candidates.SHEET_SOURCE), false);
});
