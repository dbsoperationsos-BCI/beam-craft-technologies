const test = require("node:test");
const assert = require("node:assert/strict");
const { quotationPayloadSchema, quotationData, MAX_DISCOUNT_PERCENT } = require("../src/modules/sales/projects/controller");

/*
 * The extra discount a quotation may carry after its percentage: a reason and a rupee amount, kept
 * in the payload beside the discount so a version, an edit and a duplicate carry it along.
 */
const submission = { enquiryId: "ENQ-001", subtotal: 10000, discount: 10, amount: 8500, extraDiscountReason: "Referral adjustment", extraDiscountAmount: 500 };

test("the extra discount is kept in the payload, beside the percentage", () => {
  const data = quotationData(quotationPayloadSchema.parse(submission));
  assert.equal(data.discount, 10);
  assert.equal(data.amount, 8500);
  assert.equal(data.payload.extraDiscountReason, "Referral adjustment");
  assert.equal(data.payload.extraDiscountAmount, 500);
  // Duplicating puts the saved payload back through the schema, so it must pass again.
  assert.equal(quotationPayloadSchema.safeParse({ ...data.payload, enquiryId: "ENQ-002" }).success, true);
});

test("an older quotation with no extra discount still passes, and reads as none", () => {
  const parsed = quotationPayloadSchema.parse({ enquiryId: "ENQ-001", subtotal: 2000, discount: 10, amount: 1800 });
  assert.equal(parsed.extraDiscountAmount, undefined);
  assert.equal(parsed.extraDiscountReason, undefined);
});

test("an extra discount is a rupee amount that is never negative and never past what the discount leaves", () => {
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, extraDiscountAmount: -1 }).success, false);
  // 10% of 10,000 leaves 9,000: all of it may go as extras, and not a rupee more.
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, extraDiscountAmount: 9000 }).success, true);
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, extraDiscountAmount: 9001 }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, extraDiscountAmount: "abc" }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, extraDiscountReason: "x".repeat(192) }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...submission, extraDiscountReason: "", extraDiscountAmount: 0 }).success, true, "removed: saved empty");
});

test("a Performance Cost and up to three extra discounts are kept, and together with the discount never pass the cost", () => {
  // Cost 12,000 (Performance Cost included): 600 by the 5%, then 800 extra.
  const withList = { enquiryId: "ENQ-001", subtotal: 10000, performanceCost: 2000, discount: 5, amount: 10600, extraDiscounts: [{ reason: "Referral", amount: 500 }, { reason: "Management", amount: 300 }], extraDiscountAmount: 800 };
  const data = quotationData(quotationPayloadSchema.parse(withList));
  assert.equal(data.payload.performanceCost, 2000);
  assert.deepEqual(data.payload.extraDiscounts, [{ reason: "Referral", amount: 500 }, { reason: "Management", amount: 300 }]);
  assert.equal(quotationPayloadSchema.safeParse({ ...data.payload, enquiryId: "ENQ-002" }).success, true, "a duplicate passes again");
  // Four is one too many.
  assert.equal(quotationPayloadSchema.safeParse({ ...withList, extraDiscounts: [1, 2, 3, 4].map((n) => ({ reason: `r${n}`, amount: 10 })) }).success, false);
  // The extras are not held to the 15%: the 600 leaves 11,400 of the cost, Performance Cost included.
  assert.equal(quotationPayloadSchema.safeParse({ ...withList, extraDiscounts: [{ reason: "", amount: 11400 }], extraDiscountAmount: 11400 }).success, true);
  assert.equal(quotationPayloadSchema.safeParse({ ...withList, extraDiscounts: [{ reason: "", amount: 11401 }] }).success, false);
  // The legacy single extra discount is held the same way.
  assert.equal(quotationPayloadSchema.safeParse({ ...withList, extraDiscounts: undefined, extraDiscountAmount: 11401 }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...withList, performanceCost: -1 }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...withList, extraDiscounts: [{ reason: "x", amount: -5 }] }).success, false);
});

test("a discount typed in rupees is kept beside the percentage it came to, and held to 15% of the cost", () => {
  // Cost 22,000 (Performance Cost included): at most 3,300 may come off.
  const typed = { enquiryId: "ENQ-001", subtotal: 20000, performanceCost: 2000, discount: 13.64, discountInputSource: "AMOUNT", discountAmount: 3000, amount: 19000 };
  const data = quotationData(quotationPayloadSchema.parse(typed));
  assert.equal(data.discount, 13.64, "the column still holds a percentage");
  assert.equal(data.payload.discountInputSource, "AMOUNT");
  assert.equal(data.payload.discountAmount, 3000);
  assert.equal(quotationPayloadSchema.safeParse({ ...data.payload, enquiryId: "ENQ-002" }).success, true, "a duplicate passes again");
  // Up to the cap, Performance Cost included, and no further.
  assert.equal(quotationPayloadSchema.safeParse({ ...typed, discountAmount: 3300, discount: 15 }).success, true);
  assert.equal(quotationPayloadSchema.safeParse({ ...typed, discountAmount: 3301, discount: 15 }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...typed, discountAmount: -1 }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...typed, discountInputSource: "FREE" }).success, false);
  // Small rupees cannot carry a percentage above the cap beside them.
  assert.equal(quotationPayloadSchema.safeParse({ ...typed, discount: 40 }).success, false);
  assert.equal(quotationPayloadSchema.safeParse({ ...typed, discountInputSource: "PERCENTAGE", discount: 15, discountAmount: 3300 }).success, true);
  // An older quotation carries no source, and passes as it always did when within the cap.
  const older = quotationPayloadSchema.parse({ enquiryId: "ENQ-001", subtotal: 2000, discount: 10, discountAmount: 200, amount: 1800 });
  assert.equal(older.discountInputSource, undefined);
  assert.equal(older.discountAmount, 200);
});

test("the discount is at most 15%: 0, 10 and exactly 15 pass; 16, 20, 50 and a negative are refused", () => {
  assert.equal(MAX_DISCOUNT_PERCENT, 15);
  const at = (discount) => quotationPayloadSchema.safeParse({ enquiryId: "ENQ-001", subtotal: 129204, discount, amount: 0 });
  for (const discount of [0, 10, 15]) assert.equal(at(discount).success, true, `${discount}% passes`);
  for (const discount of [15.01, 16, 20, 50, -1]) assert.equal(at(discount).success, false, `${discount}% is refused`);
  // The refusal says why, so a request made outside the generator is told what to change.
  assert.match(at(20).error.issues.find((issue) => issue.code === "custom").message, /15%/);
});

test("15% of the cost, to the whole rupee as the generator rounds it, and never more", () => {
  // The task's own example: 15% of ₹1,29,204 is ₹19,380.60, which a 15% discount rounds to ₹19,381.
  const typed = (discountAmount, extra = 0) => quotationPayloadSchema.safeParse({ enquiryId: "ENQ-001", subtotal: 129204, discount: 15, discountInputSource: "AMOUNT", discountAmount, extraDiscounts: extra ? [{ reason: "x", amount: extra }] : [], amount: 0 }).success;
  assert.equal(typed(19381), true);
  assert.equal(typed(19382), false);
  // The cap is the Discount's alone: a ₹4,500 Diwali offer beside a full 15% is allowed...
  assert.equal(typed(19381, 4500), true);
  assert.equal(quotationPayloadSchema.safeParse({ enquiryId: "ENQ-001", subtotal: 129204, discount: 15, extraDiscounts: [{ reason: "Diwali offer", amount: 4500 }], amount: 0 }).success, true);
  assert.equal(quotationPayloadSchema.safeParse({ enquiryId: "ENQ-001", subtotal: 129204, discount: 10, extraDiscounts: [{ reason: "Diwali offer", amount: 4500 }], amount: 0 }).success, true);
  // ...and the extras may take the total to nothing, and no further.
  assert.equal(typed(19381, 129204 - 19381), true);
  assert.equal(typed(19381, 129204 - 19381 + 1), false);
  // 16% is still refused, whatever the extras are.
  assert.equal(quotationPayloadSchema.safeParse({ enquiryId: "ENQ-001", subtotal: 129204, discount: 16, extraDiscounts: [], amount: 0 }).success, false);
  // Rupees sent beside a percentage are what the client's copy prints, so they are held to it too.
  assert.equal(quotationPayloadSchema.safeParse({ enquiryId: "ENQ-001", subtotal: 129204, discount: 5, discountAmount: 50000, amount: 0 }).success, false);
});
