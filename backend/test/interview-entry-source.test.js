const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { MANUAL_SOURCE, CSV_IMPORT_SOURCE, SHEET_SOURCE, APPLICATION_FORM_SOURCE } = require("../src/modules/hrm/interview/candidates");
const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", ...parts), "utf8");
const CONTROLLER = read("controller.js");
const SHEET_IMPORT = read("sheetImport.js");
const INVITES = read("invites.js");

/*
 * **How a row got here is never nothing.**
 *
 * The sheet stamped "Google sheet integration" and the public form stamped "Application Form", so
 * the Source column answered "where did this come from?" for everything an importer brought and for
 * nothing a person added - a candidate typed in by hand simply read "—". A column that is blank for
 * exactly the rows a person is responsible for is one nobody can read.
 */
test("every way into the register says which way it was", () => {
  assert.deepEqual(
    [MANUAL_SOURCE, CSV_IMPORT_SOURCE, SHEET_SOURCE, APPLICATION_FORM_SOURCE],
    ["Manual entry", "CSV import", "Google sheet integration", "Application Form"],
  );
  // Four ways in, four stamps, and no two of them the same word.
  assert.equal(new Set([MANUAL_SOURCE, CSV_IMPORT_SOURCE, SHEET_SOURCE, APPLICATION_FORM_SOURCE]).size, 4);

  // Add Application and Bulk Entry are the same act - somebody typing a candidate down - so they
  // stamp the same thing rather than telling the register which dialog was open.
  assert.match(CONTROLLER, /service\.createCandidate\(withSource\(parsed\.data, MANUAL_SOURCE\), req\.user\)/);
  assert.match(CONTROLLER, /parsed\.data\.records\.map\(\(record\) => withSource\(record, MANUAL_SOURCE\)\)/);
  assert.match(CONTROLLER, /service\.createCandidate\(withSource\(input, CSV_IMPORT_SOURCE\), req\.user\)/);
  // The two that already said so.
  assert.match(SHEET_IMPORT, /source: values\.source \|\| existingCandidate\.source \|\| SHEET_SOURCE/);
  assert.match(INVITES, /source: APPLICATION_FORM_SOURCE/);
});

test("the stamp is a fallback, never an override", () => {
  /*
   * A Source somebody named - Naukri, a referral, a walk-in - is theirs and is kept. The stamp
   * answers only where the question was left blank, which is the same rule the sheet importer has
   * always followed for a row carrying its own Source column.
   */
  assert.match(CONTROLLER, /const withSource = \(values, origin\) => \(\{ \.\.\.values, source: String\(values\?\.source \|\| ""\)\.trim\(\) \|\| origin \}\)/);

  // Applied at the way in rather than in the service, because the service cannot tell them apart:
  // a CSV row and a typed one are the same `createCandidate` call.
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", "service.js"), "utf8");
  assert.equal(/MANUAL_SOURCE|CSV_IMPORT_SOURCE/.test(service), false, "the service should write what it is given");
});
