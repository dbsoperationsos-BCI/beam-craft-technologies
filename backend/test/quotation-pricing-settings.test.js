const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_PDF_CONTENT, PRICING_PDF_CONTENT_KEYS, BRAND_PDF_CONTENT_KEYS, GENERAL_PDF_CONTENT_KEYS, SECTION_KEYS, mergePdfSections, pdfContentOverrides } = require("../src/modules/sales/quotation-brands/defaults");

/*
 * The Pricing & Total card on Settings -> Quotation Settings -> General: its words, set once for
 * every brand, and its switches. The defaults are the words the card always printed.
 */

test("the card's words default to what it always printed", () => {
  assert.equal(DEFAULT_PDF_CONTENT.pricingLabel, "Pricing & Total of Services and Deliverables");
  assert.equal(DEFAULT_PDF_CONTENT.gstText, "+ {gst}% GST APPLICABLE");
  assert.equal(DEFAULT_PDF_CONTENT.paymentLabel, "For Payment");
  assert.equal(DEFAULT_PDF_CONTENT.validityMonths, "3");
  assert.equal(DEFAULT_PDF_CONTENT.validityText.replace("{months}", DEFAULT_PDF_CONTENT.validityMonths), "This Quotation Valid up-to 3 Months from the Date Created");
});

test("General holds the card's words; a brand's own heading and validity line still answer for it", () => {
  assert.deepEqual(PRICING_PDF_CONTENT_KEYS, ["pricingLabel", "gstText", "paymentLabel", "validityMonths", "validityText"]);
  for (const key of ["pricingLabel", "validityText"]) assert.ok(BRAND_PDF_CONTENT_KEYS.includes(key), `${key} is still a brand's to set`);
  for (const key of PRICING_PDF_CONTENT_KEYS) assert.ok(!GENERAL_PDF_CONTENT_KEYS.includes(key), `${key} is not a shared-only key`);
  // Read in the order brand, then General, then the template: General's first, the brand's laid over it.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "service.js"), "utf8");
  const general = source.indexOf("pdfContentOverrides(settings?.pdfContent || null, PRICING_PDF_CONTENT_KEYS)");
  const brand = source.indexOf("pdfContentOverrides(brand?.pdfOverrides || null, BRAND_PDF_CONTENT_KEYS)");
  assert.ok(general > -1 && brand > general, "the brand's own words are laid over General's");
  const settings = { pricingLabel: "Your Investment", validityText: "General's line" };
  const brandWords = { validityText: "The brand's own line" };
  const merged = { ...pdfContentOverrides(settings, PRICING_PDF_CONTENT_KEYS), ...pdfContentOverrides(brandWords, BRAND_PDF_CONTENT_KEYS) };
  assert.deepEqual(merged, { pricingLabel: "Your Investment", validityText: "The brand's own line" });
});

test("the card and its three lines each have a switch, on unless switched off", () => {
  for (const key of ["pricing", "gst", "payment", "validity"]) assert.ok(SECTION_KEYS.includes(key));
  const sections = mergePdfSections({ gst: false });
  assert.equal(sections.gst, false);
  assert.equal(sections.pricing, true);
  // A settings row - or a version - from before the switches existed prints the whole card.
  assert.equal(mergePdfSections(null).validity, true);
});

test("General saves the card's words and refuses a validity outside 1-60 whole months", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "controller.js"), "utf8");
  assert.match(source, /pdfContentOverrides\(data\.pdfContent \|\| \{\}, \[\.\.\.GENERAL_PDF_CONTENT_KEYS, \.\.\.PRICING_PDF_CONTENT_KEYS\]\)/);
  assert.match(source, /Validity must be a whole number of months from 1 to \$\{MAX_VALIDITY_MONTHS\}\./);
});
