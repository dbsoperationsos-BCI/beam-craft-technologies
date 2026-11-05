const test = require("node:test");
const assert = require("node:assert/strict");
const { quotationPayloadSchema, quotationData, clientFacingQuotation } = require("../src/modules/sales/projects/controller");

/*
 * The Round Off Discount: one rupee figure taken off last to bring the total to a round number,
 * kept in the payload so a draft, an edit, a version and a duplicate carry it, and never sent to the
 * client - the total already has it taken off.
 */
// Cost 10,000: 10% off (1,000), an extra 500, then a round off of 99 - a total of 8,401.
const submission = { enquiryId: "ENQ-001", subtotal: 10000, discount: 10, discountAmount: 1000, extraDiscounts: [{ reason: "Referral", amount: 500 }], extraDiscountAmount: 500, roundOffDiscount: 99, amount: 8401 };

test("the round off discount is kept in the payload beside the other discounts", () => {
  const data = quotationData(quotationPayloadSchema.parse(submission));
  assert.equal(data.amount, 8401);
  assert.equal(data.payload.roundOffDiscount, 99);
  assert.equal(data.payload.discountAmount, 1000, "the regular discount is untouched");
  assert.deepEqual(data.payload.extraDiscounts, [{ reason: "Referral", amount: 500 }], "the extra discounts are untouched");
  // Duplicating puts the saved payload back through the schema, so it must pass again, unchanged.
  const again = quotationPayloadSchema.safeParse({ ...data.payload, enquiryId: "ENQ-002" });
  assert.equal(again.success, true);
  assert.equal(again.data.roundOffDiscount, 99);
});

test("an older quotation with no round off discount still passes, and reads as none", () => {
  const parsed = quotationPayloadSchema.parse({ enquiryId: "ENQ-001", subtotal: 2000, discount: 10, amount: 1800 });
  assert.equal(parsed.roundOffDiscount, undefined);
});

test("a round off discount is a rupee amount, never negative or malformed, and never past what the others leave", () => {
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, roundOffDiscount: -1 }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, roundOffDiscount: "abc" }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, roundOffDiscount: Number.NaN }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, roundOffDiscount: 0 }).success, true, "nothing taken off");
  // 10,000 less 1,000 and 500 leaves 8,500: all of it may go, and not a rupee more.
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, roundOffDiscount: 8500, amount: 0 }).success, true);
  const over = quotationPayloadSchema.safeParse({ ...submission, roundOffDiscount: 8501, amount: 0 });
  assert.equal(over.success, false);
  assert.deepEqual(over.error.issues.map((issue) => issue.path.join(".")), ["roundOffDiscount"]);
});

test("the client is never sent the round off discount; the total already has it taken off", () => {
  const out = clientFacingQuotation({ amount: 8401, subtotal: 10000, discount: 10, payload: { ...submission } });
  assert.equal(out.amount, 8401);
  assert.equal("roundOffDiscount" in out.payload, false);
  assert.equal(JSON.stringify(out).includes("roundOff"), false);
  // The listed discounts the client does see are as they were.
  assert.equal(out.payload.discountAmount, 1000);
  assert.deepEqual(out.payload.extraDiscounts, [{ reason: "Referral", amount: 500 }]);
});
