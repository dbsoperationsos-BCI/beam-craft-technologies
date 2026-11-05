const test = require("node:test");
const assert = require("node:assert/strict");
const { quotationPayloadSchema, quotationData } = require("../src/modules/sales/projects/controller");

/*
 * A quotation shoot's Additional Text ("Bride Varatham" beside Rituals) lives on the shoot inside the
 * payload, apart from the shoot's own name, and must survive a save and a duplicate - which puts the
 * stored payload back through the same schema.
 */
test("a shoot's customText is kept on save and on duplicate, and an old shoot without it still passes", () => {
  const shoots = [
    { id: "s1", shoot: "Wedding", customText: "Muhurtham", isMainEvent: true },
    { id: "s2", shoot: "Rituals", customText: "Bride Varatham" },
    { id: "s3", shoot: "Rituals", customText: "Groom Varatham" },
    { id: "s4", shoot: "Reception" },
  ];
  const data = quotationData(quotationPayloadSchema.parse({ enquiryId: "ENQ-1", subtotal: 0, amount: 0, shoots }));
  assert.deepEqual(data.payload.shoots.map((shoot) => [shoot.shoot, shoot.customText ?? null]), [["Wedding", "Muhurtham"], ["Rituals", "Bride Varatham"], ["Rituals", "Groom Varatham"], ["Reception", null]]);
  const duplicate = quotationPayloadSchema.parse({ ...data.payload, enquiryId: "ENQ-2" });
  assert.deepEqual(duplicate.shoots, data.payload.shoots);
});
