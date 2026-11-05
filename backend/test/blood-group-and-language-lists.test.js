const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { FALLBACK_BLOOD_GROUPS, FALLBACK_LANGUAGES, publicOnboardingOptionLists } = require("../src/services/employeeOptionLists");
const { definitions } = require("../src/modules/hrm/master-data/definitions");

/*
 * Blood Group and Languages Known: the last two employee dropdowns the studio could not maintain.
 *
 * `20260910120000_employee_option_lists` moved six of the employee form's lists out of the browser
 * and into tables Settings → Field Settings can edit, and left these two behind in different
 * states. Blood group had no table at all - eight values compiled into the browser and nowhere
 * else. Languages had a table, a master-data definition and routes since the HRM foundation, and
 * not one row had ever been written to it, so the form went on reading the seventeen names in the
 * browser. Both are lists now, and what is asserted here is what makes that safe:
 *
 *   * every screen that asks reads the table, and falls back to exactly what the browser held;
 *   * the column is wide enough for what the studio can put on the list; and
 *   * a value in use cannot be deleted out from under the records holding it.
 */

const readSource = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const readFrontend = (...parts) => fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", ...parts), "utf8");

const MIGRATION = readSource("prisma", "migrations", "20260910160000_blood_group_and_language_lists", "migration.sql");
const SCHEMA = readSource("prisma", "schema.prisma");
const EMPLOYEE_OPTIONS = readFrontend("constants", "employeeOptions.js");

/** The names one INSERT seeds, read out of the migration. */
function seededNames(table) {
  const insert = MIGRATION.split(`INSERT INTO \`${table}\``)[1];
  assert.ok(insert, `the migration seeds no ${table}`);
  const block = insert.split("WHERE NOT EXISTS")[0];
  return [...block.matchAll(/'[A-Z_]+'(?: AS `code`)?,\s*'([^']+)'/g)].map((match) => match[1]);
}

/** A `const NAME = [ ... ];` array of strings in a frontend constants file. */
function frontendArray(source, name) {
  const start = source.indexOf(`export const ${name} = [`);
  assert.ok(start >= 0, `${name} is no longer exported`);
  const block = source.slice(start, source.indexOf("];", start));
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("both lists are maintained through the master data, and know where their values are used", () => {
  /*
   * Without `usedBy`, deleting an entry strands every record naming it and renaming one leaves them
   * on the old word - the fault `usage.js` exists to prevent, and one these two lists would have
   * arrived carrying. Languages are several to a record and comma separated, so a use of "Tamil"
   * must be looked for entry by entry rather than with a `contains` that would find it inside a
   * longer word.
   */
  const blood = definitions["blood-groups"];
  assert.ok(blood, "blood groups are not a master-data resource, so Field Settings cannot edit them");
  assert.equal(blood.model, "bloodGroup");
  assert.deepEqual(blood.usedBy, [{ model: "employee", field: "bloodGroup", match: "exact", label: "employee" }]);

  const languages = definitions.languages;
  assert.equal(languages.model, "language");
  assert.deepEqual(languages.usedBy, [{ model: "employee", field: "languagesKnown", match: "csv", label: "employee" }]);
});

test("the fallbacks are exactly what the browser used to hold", () => {
  // The one property that keeps an unseeded database behaving as it did: both the server's fallback
  // and the array still in the browser have to be the old list, entry for entry and in order.
  assert.deepEqual(FALLBACK_BLOOD_GROUPS, ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]);
  assert.deepEqual(frontendArray(EMPLOYEE_OPTIONS, "bloodGroupOptions"), FALLBACK_BLOOD_GROUPS);
  assert.equal(FALLBACK_LANGUAGES.length, 17);
  assert.deepEqual(frontendArray(EMPLOYEE_OPTIONS, "languageOptions"), FALLBACK_LANGUAGES);
});

test("the seeded rows are those same lists, so nothing already answered stops matching", () => {
  // An employee whose record says "A+" or "English, Tamil" has to go on matching the list on the
  // day the migration runs, or they read as holding a value no list offers.
  assert.deepEqual(seededNames("blood_group").sort(), [...FALLBACK_BLOOD_GROUPS].sort());
  assert.deepEqual(seededNames("language").sort(), [...FALLBACK_LANGUAGES].sort());
});

test("a seed only fills a table nobody has touched", () => {
  // `language` is an old table. A studio that has already put its own rows in it must not have the
  // seventeen appended underneath them.
  const guards = MIGRATION.match(/WHERE NOT EXISTS \(SELECT 1 FROM `(blood_group|language)` `existing`\);/g) || [];
  assert.equal(guards.length, 2, "both seeds must be guarded against a table that already has rows");
});

test("the blood group column is wide enough for what the list can hold", () => {
  /*
   * It was VARCHAR(10) - sized for "AB+" when the eight values were fixed. A maintained list takes
   * a name of up to 120 characters, so an entry like "AB Positive" would have been cut short or
   * refused on save. The public submission schema has to agree with the column, or a candidate is
   * offered a value the endpoint then rejects.
   */
  assert.match(SCHEMA, /bloodGroup\s+String\?\s+@map\("blood_group"\)\s+@db\.VarChar\(50\)/);
  assert.match(MIGRATION, /ALTER TABLE `employee` MODIFY `blood_group` VARCHAR\(50\) NULL;/);
  const onboarding = readSource("src", "modules", "hrm", "onboarding-invites", "controller.js");
  assert.match(onboarding, /bloodGroup: requiredSubmissionText\.max\(50\)/, "the submission still caps the blood group below what the list allows");
});

test("a candidate is offered the studio's two lists as well", async () => {
  // The apply page has no session and cannot read the master data, so the invite carries the lists.
  // Without these keys HR would edit a blood group the candidate is never offered.
  const lists = await publicOnboardingOptionLists();
  for (const key of ["bloodGroups", "languages"]) {
    assert.ok(Array.isArray(lists[key]) && lists[key].length, `the invite carries no ${key}`);
  }
  const config = readFrontend("constants", "onboardingFormConfig.js");
  assert.match(config, /name: "bloodGroup".*options: "bloodGroups"/, "the apply page still reads a compiled-in blood group array");
  assert.doesNotMatch(config, /bloodGroupOptions/, "the apply page still imports the fallback array directly");
});

test("both lists reach the employee form, and say which field each fills", () => {
  // `employeeOptionResources` is what the form loops over; a list missing from it is a field still
  // offering the array in the browser however well the table behind it is maintained.
  for (const [resource, field] of [["blood-groups", "bloodGroup"], ["languages", "languagesKnown"]]) {
    const entry = new RegExp(`resource: "${resource}",[^}]*fields: \\["${field}"\\]`);
    assert.match(EMPLOYEE_OPTIONS, entry, `${resource} is not wired to the ${field} field`);
  }
});
