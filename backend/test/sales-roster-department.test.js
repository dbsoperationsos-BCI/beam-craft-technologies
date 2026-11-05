const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isSalesDepartment } = require("../src/services/employeeOptionLists");

/*
 * Who counts as a Sales employee.
 *
 * An employee holds **several** departments, joined by ", " - the form asks for them with the same
 * searchable multi-select `skills` and `languagesKnown` use, which is why the column is Text. Three
 * separate readers compared the whole column against "Sales" instead, so anybody carrying a second
 * department was not a salesperson to any of them: they were missing from the CRM's Assign To, from
 * the project register's CRM picker, and from the WhatsApp roster - silently, with the picker
 * simply listing fewer people than the studio employs.
 */

test("a department list containing Sales is Sales", () => {
  assert.equal(isSalesDepartment("Sales"), true);
  assert.equal(isSalesDepartment("Sales, Technical"), true);
  assert.equal(isSalesDepartment("Management, Sales"), true);
  assert.equal(isSalesDepartment("Data Management, Sales, Technical"), true);
});

test("spacing and case are not part of the answer", () => {
  // The column is written by the form, by imports and by hand, and has held all three spellings.
  assert.equal(isSalesDepartment("SALES"), true);
  assert.equal(isSalesDepartment("Technical,Sales"), true);
  assert.equal(isSalesDepartment("  sales  "), true);
});

test("a department that merely contains the word is not Sales", () => {
  // The database narrows with a LIKE before this runs, so this is the test that stops
  // `LIKE '%Sales%'` from being the whole rule.
  assert.equal(isSalesDepartment("Salesforce Admin"), false);
  assert.equal(isSalesDepartment("Pre Sales Support"), false);
});

test("no department is not Sales", () => {
  assert.equal(isSalesDepartment(""), false);
  assert.equal(isSalesDepartment(null), false);
  assert.equal(isSalesDepartment(undefined), false);
});

test("the roster asks the option list who counts as working", () => {
  /*
   * The other half of the invariant `employee-option-lists.test.js` holds over the three readers:
   * they are allowed to reach the working statuses through this helper rather than naming them, so
   * this is what makes that indirection safe. Written into the code, the statuses stop following
   * Settings the day the studio renames one.
   */
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "employeeOptionLists.js"), "utf8");
  const roster = source.slice(source.indexOf("async function salesEmployees("), source.indexOf("module.exports"));
  assert.ok(roster, "salesEmployees has been renamed; this pin no longer reads it");
  assert.match(roster, /workingEmployeeStatuses\(\)/, "the Sales roster no longer asks which statuses mean somebody is working here");
  assert.doesNotMatch(roster, /\[\s*"Active",\s*"in Training",\s*"PIP"\s*\]/, "the working statuses are written into the roster again");
});

test("every reader of the Sales roster asks the same function", () => {
  /*
   * The three used to write the same `where` clause separately, which is how they came to disagree.
   * A fourth copy is a fourth picker that lists a different set of people from the other three.
   */
  const readers = [
    "src/modules/sales/projects/controller.js",
    "src/modules/sales/whatsapp-chat/controller.js",
    "src/modules/sales/google-sheet-links/controller.js",
  ];
  for (const reader of readers) {
    const source = fs.readFileSync(path.join(__dirname, "..", reader), "utf8");
    assert.match(source, /salesEmployees\(/, `${reader} no longer reads the shared Sales roster`);
    assert.doesNotMatch(
      source,
      /department:\s*\{\s*in:\s*\[/,
      `${reader} has gone back to comparing the whole department column`,
    );
  }
});
