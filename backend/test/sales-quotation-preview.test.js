const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { previewQuotation } = require("../src/modules/sales/projects/controller");
const router = require("../src/modules/sales/projects/routes");

/*
 * Preview: the client's copy of the generator's unsaved form, written nowhere.
 *
 * Needs MySQL, like the other quotation tests that read settings: the preview reads the brand and
 * the studio's branding exactly as a save does, and must leave every table as it found it.
 */
const respond = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } });

test("Preview sits behind the quotations screen's own guard", () => {
  const layer = router.stack.find((entry) => entry.route?.path === "/quotations/preview" && entry.route.methods.post);
  assert.ok(layer, "POST /quotations/preview is mounted");
  assert.equal(layer.route.stack.length, 2, "the SALES / Quotation Management guard runs before the handler");
  // The very guard Save Draft runs behind - so exactly the people who may save a quotation may
  // preview one, and everyone it refuses for a draft it refuses here.
  const drafts = router.stack.find((entry) => entry.route?.path === "/quotations/drafts" && entry.route.methods.post);
  assert.equal(layer.route.stack[0].handle, drafts.route.stack[0].handle);
});

test("an unsaved quotation previews as the client's copy, and nothing is written", async () => {
  // Counted for this enquiry alone: the whole table moves while other test files run beside this one.
  const written = () => prisma.salesQuotation.count({ where: { enquiryId: "ENQ-PREVIEW" } });
  const before = await written();
  const res = respond();
  await previewQuotation({ body: { enquiryId: "ENQ-PREVIEW", subtotal: 18000, discount: 0, amount: 17900, roundOffDiscount: 100, additionalNotes: "சுவர்ண தானம் - Suvarna Daanam", shoots: [], services: [], deliverables: [] }, user: { id: 1 } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const data = res.body.data;
  assert.equal(data.preview, true);
  assert.equal(data.quotationId, "Preview", "no quotation number is drawn");
  assert.equal(data.amount, 17900, "the form's own total, unsaved edits and all");
  assert.equal(data.additionalNotes, "சுவர்ண தானம் - Suvarna Daanam");
  // Nothing a link has: no path, no download, no expiry - and nothing the client is never sent.
  assert.equal(data.publicPath, undefined);
  assert.equal(data.publicToken, null);
  assert.equal(data.allowClientDownload, false);
  assert.equal(data.linkExpiresAt, null);
  assert.equal("roundOffDiscount" in data.payload, false);
  assert.equal("discount" in data, false, "the percentage stays hidden, as on a client's link");
  assert.ok(data.brandSnapshot, "the brand's presentation, as the page needs it");
  assert.equal(await written(), before, "no row, number or version");
});

test("a figure a save would refuse is refused here too", async () => {
  const res = respond();
  await previewQuotation({ body: { subtotal: 1000, amount: 0, roundOffDiscount: -5 }, user: { id: 1 } }, res);
  assert.equal(res.statusCode, 400);
});

test.after(() => prisma.$disconnect());
