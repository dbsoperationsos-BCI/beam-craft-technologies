const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The server invents no quotation rate. The studio's Quotation settings answer what is stored and
 * null for what is not - never an assumed ₹2,000, ₹1,000, 20% or 18% - and a version's GST is what
 * the generator priced with, the brand's or the studio's, and null where none sets one.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "../src/modules/sales", ...parts), "utf8");

test("quotation settings answer stored values, and null for anything not set", () => {
  const controller = read("quotation-settings", "controller.js");
  assert.doesNotMatch(controller, /\?\?\s*(2000|1000|20|18)\b/);
  for (const field of ["serviceRate", "deliverableRate", "defaultDiscountPercent", "gstPercent"]) {
    assert.match(controller, new RegExp(`${field}: numberOrNull\\(row\\?\\.${field}\\),`), field);
  }
  // The helper itself, as written.
  const numberOrNull = new Function(`${controller.match(/const numberOrNull = [^\n]+/)[0]} return numberOrNull;`)();
  assert.equal(numberOrNull(undefined), null);
  assert.equal(numberOrNull(null), null);
  assert.equal(numberOrNull("2000.00"), 2000);
  assert.equal(numberOrNull(0), 0);
});

test("a version's GST is the configured one, and null rather than 18 where none is configured", () => {
  const service = read("quotation-brands", "service.js");
  const body = service.slice(service.indexOf("function gstPercentFor("), service.indexOf("\n}\n", service.indexOf("function gstPercentFor(")) + 3);
  assert.doesNotMatch(body, /\b18\b/);
  const gstPercentFor = new Function(`${body} return gstPercentFor;`)();
  assert.equal(gstPercentFor({ rates: { gstPercent: 12 } }, { gstPercent: 5 }, { gstPercent: 18 }), 12);
  assert.equal(gstPercentFor({}, { gstPercent: 5 }, { gstPercent: 18 }), 5);
  assert.equal(gstPercentFor({}, { gstPercent: null }, { gstPercent: 18 }), 18, "the studio's stored rate");
  assert.equal(gstPercentFor({}, null, null), null, "nothing configured: no rate assumed");
  assert.equal(gstPercentFor({ rates: { gstPercent: 0 } }, null, null), 0, "a configured 0 is a rate");
});
