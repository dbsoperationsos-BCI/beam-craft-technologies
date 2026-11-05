const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { interviewPositions } = require("../prisma/seeds/interview-positions.seed");
const { definitions } = require("../src/modules/hrm/master-data/definitions");

/*
 * "General" is a position somebody applies for and never a designation anybody is employed as.
 *
 * Position Applied For reads the studio's designation list, which is right for almost every
 * application. It could not offer "General" - the answer to a hiring ad that names no role - and
 * the short way to fix that would have been a `designation` row, which is the wrong way: a row
 * there is also a row in every employee's designation picker, on an employee record and in the
 * Employee Repository's filters. Two questions with different answers get two lists.
 *
 * So the same three things have to hold here as for the sources: the value is a row rather than an
 * array, the migration writes what the seed writes (the seed cannot be run on the VPS), and the
 * options endpoint merges the two lists without offering a name twice.
 */

const MIGRATION = fs.readFileSync(
  path.join(__dirname, "..", "prisma", "migrations", "20260918180000_interview_position_list", "migration.sql"),
  "utf8",
);
const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "service.js"), "utf8");

test("the seed holds General, as a row rather than an array in the code", () => {
  const names = interviewPositions.map(([, name]) => name);
  assert.ok(names.includes("General"), "General should be a position the studio can pick");
  const codes = interviewPositions.map(([code]) => code);
  assert.equal(new Set(codes).size, codes.length, "one row per code, or the upsert fights itself");
  assert.deepEqual([...interviewPositions].sort((a, b) => a[2] - b[2]).map(([, name]) => name), names);
});

test("the migration writes what the seed writes, because the seed cannot be run on the VPS", () => {
  for (const [code, name] of interviewPositions) {
    assert.ok(MIGRATION.includes(`'${code}'`), `the migration is missing the code ${code}`);
    assert.ok(MIGRATION.includes(`'${name}'`), `the migration is missing ${name}`);
  }
  assert.match(MIGRATION, /CREATE TABLE `interview_position`/);
  // Re-running writes nothing, so it is safe on a database the seed already filled and on one the
  // studio has edited since.
  assert.match(MIGRATION, /WHERE NOT EXISTS \(SELECT 1 FROM `interview_position` `existing`\)/);
});

test("the list is editable master data, counted against the candidates who applied under it", () => {
  const definition = definitions["interview-positions"];
  assert.ok(definition, "Settings → Fields has no Positions list to edit");
  assert.equal(definition.model, "interviewPosition");
  // Deleting a position the studio has used says how many candidates applied under that word rather
  // than stranding them on one no list offers - live rows only.
  assert.deepEqual(definition.usedBy, [{ model: "hrmInterviewCandidate", field: "position", match: "exact", label: "candidate", where: { deletedAt: null } }]);
});

test("the designations come first and this list after, with nothing offered twice", () => {
  assert.match(SERVICE, /optionNames\("interviewPosition", \[\]\)/);
  /*
   * This is the list somebody **picks from** when writing an application down, which is why it is
   * the studio's maintained roles rather than whatever the register happens to hold: picking a
   * value here writes it onto a candidate, and a sheet's own wording is not a role anybody chose.
   *
   * What the register already holds is a different question, and the table's column filter asks it
   * of the column - see `candidateColumnValues`.
   */
  assert.match(SERVICE, /positions: mergeNames\(designations\.map\(\(row\) => row\.name\), extraPositions\)/);

  // The merge itself, on the arrangement that matters: a studio that has since made General a
  // designation as well must not be offered it twice, and case is not a difference.
  const { mergeNames } = require("../src/modules/hrm/interview/service");
  assert.deepEqual(mergeNames(["Photographer", "Editor"], ["General"]), ["Photographer", "Editor", "General"]);
  assert.deepEqual(mergeNames(["Photographer", "General"], ["general"]), ["Photographer", "General"]);
  assert.deepEqual(mergeNames([], ["General"]), ["General"]);
  assert.deepEqual(mergeNames(["  Editor  ", ""], []), ["Editor"]);
});

test("General is not a designation, which is the whole reason this list exists", () => {
  /*
   * Asserted against the migration's own words rather than the live table, because the point is
   * that nothing here ever writes to `designation` - a position nobody is employed as does not
   * belong in the list an employee record reads.
   */
  assert.equal(MIGRATION.includes("INSERT INTO `designation`"), false);
  assert.equal(MIGRATION.includes("UPDATE `designation`"), false);
});
