const test = require("node:test");
const assert = require("node:assert/strict");
const { codeFor } = require("../src/modules/sales/projects/controller");

/*
 * A deliverable, service or option's code is built from its name (up to 191 characters) into a
 * VARCHAR(100) column. A long name used to make a code the database refused (P2000), and the add
 * failed with "Unable to add deliverable." in production.
 */
const LONG = "Premium Leather Bound Wedding Album With Gold Foil Embossing And Custom Engraved Cover Plate Deluxe Edition";

test("a code that fits is exactly what it always was", () => {
  assert.equal(codeFor("DELIVERABLE", "Album Printing"), "DELIVERABLE_ALBUM_PRINTING");
  assert.equal(codeFor("SERVICE", "Candid Photography"), "SERVICE_CANDID_PHOTOGRAPHY");
  assert.equal(codeFor("OPTION", "12 x 36"), "OPTION_12_X_36");
});

test("a long name's code fits the column, is the same every time, and differs from a similar name's", () => {
  for (const prefix of ["DELIVERABLE", "SERVICE", "OPTION"]) {
    const code = codeFor(prefix, LONG);
    assert.ok(code.length <= 100, `${prefix}: ${code.length}`);
    assert.ok(code.startsWith(`${prefix}_PREMIUM_LEATHER_BOUND`));
    assert.equal(codeFor(prefix, LONG), code, "the duplicate check relies on this");
    assert.notEqual(codeFor(prefix, `${LONG} Two`), code);
  }
  assert.ok(codeFor("DELIVERABLE", "x".repeat(191)).length <= 100, "the longest name the form allows");
});
