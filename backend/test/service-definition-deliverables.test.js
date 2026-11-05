const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Settings → Project → Services: one deliverables list per service.
 *
 * Shoot Type, Session Timing, Duration and Size left the service dialog, and with them the
 * per-booking pricing lines a mapping used to ride on. The service now carries its own list,
 * checked against the deliverables that exist, and a save that does not send `pricing` leaves the
 * stored pricing lines exactly as they were.
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);

const STORED_PRICING = [{ shootType: "STUDIO", timingMode: "HALF_SESSION", price: 4000, deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v1" }] }];
let existing;
const writes = [];
require.cache[dbPath].exports = {
  projectServiceDefinition: {
    findFirst: async () => existing,
    update: async ({ data }) => { writes.push(data); return { ...existing, ...data }; },
  },
  projectDeliverableDefinition: {
    findMany: async () => [{ id: "d1", brands: [{ id: "b1", variants: [{ id: "v1" }, { id: "v2" }] }] }],
  },
};

const { updateServiceDefinition } = require("../src/modules/sales/projects/controller");

async function save(body) {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  writes.length = 0;
  await updateServiceDefinition({ params: { definitionId: "s1" }, body }, res);
  return { res, data: writes[0] };
}

test.beforeEach(() => {
  existing = { id: "s1", name: "360 PhotoBooth", isActive: true, timingMode: "HALF_SESSION", deliverableAdded: true, pricing: STORED_PRICING };
});

test("the service's list is stored, each variant once, and only variants that exist", async () => {
  const { res, data } = await save({ deliverableAdded: true, deliverables: [
    { deliverableId: "d1", brandId: "b1", variantId: "v2" },
    { deliverableId: "d1", brandId: "b1", variantId: "v2" },
    // A variant under a brand that does not hold it, and one that does not exist.
    { deliverableId: "d1", brandId: "b9", variantId: "v1" },
    { deliverableId: "gone", brandId: "b1", variantId: "v1" },
  ] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(data.deliverables, [{ deliverableId: "d1", brandId: "b1", variantId: "v2" }]);
});

test("answered No, the list is cleared rather than kept where no screen shows it", async () => {
  const { data } = await save({ deliverableAdded: false, deliverables: [{ deliverableId: "d1", brandId: "b1", variantId: "v2" }] });
  assert.deepEqual(data.deliverables, []);
});

test("answered No without a list sent, the stored list is still cleared", async () => {
  const { data } = await save({ deliverableAdded: false });
  assert.deepEqual(data.deliverables, []);
});

test("a malformed or oversized list is refused, and a missing service is a 404", async () => {
  const entry = { deliverableId: "d1", brandId: "b1", variantId: "v1" };
  assert.equal((await save({ deliverables: [{ deliverableId: "d1" }] })).res.statusCode, 400);
  assert.equal((await save({ deliverables: Array.from({ length: 51 }, () => entry) })).res.statusCode, 400);
  existing = null;
  assert.equal((await save({ deliverables: [entry] })).res.statusCode, 404);
});

test("a save from the dialog leaves the stored pricing lines, timings and size untouched", async () => {
  const { data } = await save({ name: "360 PhotoBooth", price: 4500, remarksEnabled: null, deliverableAdded: true, complimentary: false, deliverables: [] });
  assert.equal(data.price, 4500);
  for (const field of ["pricing", "timingModes", "shootTypes", "sizeEnabled", "sizeOptionSetId", "defaultDurationHours", "defaultDurationMinutes"]) {
    assert.equal(field in data, false, `${field} was written`);
  }
});
