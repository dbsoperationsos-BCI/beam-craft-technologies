const test = require("node:test");
const assert = require("node:assert/strict");
const { dayRange, shapeCatalogue, shapeBookings, serviceDeliverables, quoteSchema } = require("../src/modules/sales/quotation-calculator/controller");

test("a day is bounded from its first millisecond to its last", () => {
  const range = dayRange("2026-08-17");
  assert.equal(range.start.toISOString(), "2026-08-17T00:00:00.000Z");
  assert.equal(range.end.toISOString(), "2026-08-17T23:59:59.999Z");
});

// A shoot saved through the project form lands on UTC midnight, so it has to fall inside the
// range for the day it was booked on - the boundary is where an off-by-one would hide.
test("a shoot stored at UTC midnight falls inside its own day", () => {
  const range = dayRange("2026-08-17");
  const shootDate = new Date("2026-08-17T00:00:00.000Z");
  assert.ok(shootDate >= range.start && shootDate <= range.end);
  const nextDay = new Date("2026-08-18T00:00:00.000Z");
  assert.ok(nextDay > range.end);
});

test("anything that is not a plain calendar date is refused", () => {
  assert.equal(dayRange(""), null);
  assert.equal(dayRange(null), null);
  assert.equal(dayRange("17-08-2026"), null);
  assert.equal(dayRange("2026-08-17T10:00:00Z"), null);
  assert.equal(dayRange("not a date"), null);
});

// `new Date("2026-02-30")` rolls forward to March rather than failing, so a well-formed
// impossibility would otherwise be accepted and quietly answer for the wrong day.
test("a date that does not exist is refused rather than rolled forward", () => {
  assert.equal(dayRange("2026-02-30"), null);
  assert.equal(dayRange("2026-13-01"), null);
  assert.ok(dayRange("2028-02-29"), "a real leap day is still a day");
});

test("a service is quoted as one line at its one price, whatever pricing lines it still stores", () => {
  const { services } = shapeCatalogue([
    { id: "s1", name: "Booth", price: "9000.00", sizeEnabled: true, pricing: [
      { shootType: "STUDIO", timingMode: "FULL_SESSION", duration: "8-10 Hours (Full)", size: "55 inch", price: 1 },
      { shootType: "STUDIO", timingMode: "HOURS_MINUTES", hours: 3, size: "55 inch", price: 2 },
    ] },
    { id: "s2", name: "Drone", price: "5000", pricing: [] },
    // Priced only per session until now: listed, unpriced, until its single Price is entered.
    { id: "s3", name: "Unpriced", price: null, pricing: [{ shootType: "STUDIO", timingMode: "HALF_SESSION", price: 4000 }] },
  ]);
  assert.deepEqual(services.map((service) => service.lines.map((line) => [line.id, line.shootType, line.timing, line.duration, line.size, line.price])), [
    [["s1:flat", "", "", "", "", 9000]],
    [["s2:flat", "", "", "", "", 5000]],
    [["s3:flat", "", "", "", "", null]],
  ]);
});

test("deliverables are the studio's own, as Settings describes and prices them", () => {
  const { deliverables } = shapeCatalogue([], [
    { id: "d1", name: "Acrylic Printing", mediaType: "IMAGE", brandName: "Canvera", imageSize: "12x18", videoLength: null, frameInches: "1.5 inch", price: "1200.00" },
    { id: "d2", name: "Teaser", mediaType: "VIDEO", brandName: null, imageSize: null, videoLength: "3 minutes", frameInches: null, price: null },
  ]);
  assert.deepEqual(deliverables, [
    { id: "d1", name: "Acrylic Printing", mediaType: "IMAGE", brandName: "Canvera", imageSize: "12x18", videoLength: "", frameInches: "1.5 inch", price: 1200, photoCountEnabled: null, remarksEnabled: null, brands: [] },
    { id: "d2", name: "Teaser", mediaType: "VIDEO", brandName: "", imageSize: "", videoLength: "3 minutes", frameInches: "", price: null, photoCountEnabled: null, remarksEnabled: null, brands: [] },
  ]);
});

/*
 * The calculator picks deliverables the way the Quotation Generator does - one entry per brand and
 * variant - so the catalogue carries every brand and variant a deliverable is sold as, at its own
 * price, with the No. of Count answer and the Settings note the generator's option label reads.
 */
test("a deliverable carries its brands and variants, each at its own price", () => {
  const { deliverables } = shapeCatalogue([], [{
    id: "d1", name: "Album Printing", mediaType: "IMAGE", brandName: "Canvera", imageSize: "12x18", frameInches: "1 inch", price: "2200", photoCountEnabled: "Yes", remarksEnabled: "Sent flat.",
    brands: [
      { id: "b1", name: "Canvera", variants: [{ id: "v1", size: "12x18", frameInches: "1 inch", videoLength: null, price: "2200.00" }, { id: "v2", size: "16x24", frameInches: null, videoLength: null, price: null }] },
      { id: "b2", name: null, variants: [] },
    ],
  }]);
  assert.equal(deliverables[0].photoCountEnabled, "Yes");
  assert.equal(deliverables[0].remarksEnabled, "Sent flat.");
  assert.deepEqual(deliverables[0].brands, [
    { id: "b1", name: "Canvera", variants: [
      { id: "v1", size: "12x18", frameInches: "1 inch", videoLength: "", price: 2200 },
      { id: "v2", size: "16x24", frameInches: "", videoLength: "", price: null },
    ] },
    { id: "b2", name: "", variants: [] },
  ]);
});

/*
 * What a service brings with it is the service's own list, and only where it answered Deliverable
 * Added - the rule the Quotation Generator's `serviceMappedDeliverableRows` applies.
 */
test("a service carries its deliverables only where it says it brings any", () => {
  const list = [
    { deliverableId: "d1", brandId: "b1", variantId: "v1" },
    // Half-written, as the settings form would have dropped it: not a mapping.
    { deliverableId: "d2", brandId: "", variantId: "v2" },
  ];
  const [brings] = shapeCatalogue([{ id: "s1", name: "Booth", deliverableAdded: true, deliverables: list, pricing: [] }]).services;
  assert.deepEqual(brings.lines[0].deliverables, [{ deliverableId: "d1", brandId: "b1", variantId: "v1" }]);
  const [keeps] = shapeCatalogue([{ id: "s1", name: "Booth", deliverableAdded: null, deliverables: list }]).services;
  assert.deepEqual(keeps.lines[0].deliverables, []);
  assert.deepEqual(serviceDeliverables({ deliverableAdded: true, deliverables: null }), []);
  // Saved while the mapping rode on its pricing lines: every variant they named, each once.
  const legacy = { deliverableAdded: true, pricing: [{ deliverables: [list[0]] }, { deliverables: [list[0], { deliverableId: "d3", brandId: "b3", variantId: "v3" }] }] };
  assert.deepEqual(serviceDeliverables(legacy).map((entry) => entry.variantId), ["v1", "v3"]);
  // Its own list, once saved, wins over whatever the lines still carry.
  assert.deepEqual(serviceDeliverables({ ...legacy, deliverables: [] }), []);
});

/*
 * The draft applied to a lead now carries the counts, the auto-added rows and the priced lines
 * behind the total - and still accepts the draft every earlier version of the calculator saved.
 */
test("the applied draft accepts what the calculator now sends, and what it used to", () => {
  const before = quoteSchema.safeParse({ amount: 100, draft: { serviceQuantities: { "s1:0": 1 }, deliverableQuantities: { d1: 2 }, basePackagePrice: "10", extras: "", discountPercent: "0" } });
  assert.ok(before.success);
  const now = quoteSchema.safeParse({ amount: 100, draft: {
    serviceQuantities: { "s1:0": 1 },
    serviceRows: [{ serviceId: "s1", lineId: "s1:0", quantity: 1 }, { serviceId: "s2", lineId: "", quantity: 1 }],
    deliverableQuantities: { "d1::b1::v1": 2 },
    deliverableCounts: { "d1::b1::v1": 10 },
    autoDeliverables: { "d1::b1::v1": "s1:0" },
    lines: [
      { kind: "SERVICE", id: "s1:0", name: "Booth", detail: "Studio / In-House · Full Session", quantity: 1, count: null, unitPrice: 9000, total: 9000 },
      { kind: "DELIVERABLE", id: "d1::b1::v1", name: "Album Printing", detail: "Canvera · 12x18", quantity: 2, count: 10, unitPrice: 2200, total: 44000 },
    ],
  } });
  assert.ok(now.success, JSON.stringify(now.error?.issues));
  // A variant nobody has priced is stored as the null it is, not coerced into a free line.
  assert.equal(quoteSchema.safeParse({ amount: 0, draft: { lines: [{ kind: "DELIVERABLE", id: "x", name: "x", detail: "", quantity: 1, unitPrice: null, total: 0 }] } }).data.draft.lines[0].unitPrice, null);
  assert.equal(quoteSchema.safeParse({ amount: 0, draft: { lines: [{ kind: "OTHER", id: "x", name: "x", detail: "", quantity: 1, unitPrice: 1, total: 1 }] } }).success, false);
});

test("an empty catalogue is empty, and does not throw", () => {
  const shaped = shapeCatalogue(undefined, undefined);
  assert.deepEqual(shaped.services, []);
  assert.deepEqual(shaped.deliverables, []);
});

test("a booking carries its project's branch and vertical", () => {
  assert.deepEqual(
    shapeBookings([
      { id: "1", shootId: "11111", shoot: "Haldi", project: { sourceBranch: "Erode", vertical: "Dum Dum" } },
    ]),
    [{ id: "1", bookingId: "11111", branch: "Erode", vertical: "Dum Dum", details: "Haldi" }],
  );
});

// `vertical` is nullable on a project, and the calculator prints what it is given.
test("a missing branch or vertical reads as empty rather than undefined", () => {
  const [booking] = shapeBookings([{ id: "1", shootId: "22222", shoot: "", project: { sourceBranch: "Coimbatore", vertical: null } }]);
  assert.equal(booking.vertical, "");
  assert.equal(booking.details, "");
  assert.equal(booking.branch, "Coimbatore");
});

test("a shoot whose project did not come back does not throw", () => {
  const [booking] = shapeBookings([{ id: "1", shootId: "33333", shoot: "New Born Shoot", project: null }]);
  assert.equal(booking.branch, "");
  assert.equal(booking.vertical, "");
  assert.equal(booking.details, "New Born Shoot");
});

/*
 * An album is quoted in sheets, and a tier is bound up to its own limit and no further.
 *
 * The quantity against an album row is the number of sheets in it - at most 35 for the three top
 * tiers, at most 25 for the two covers - so the answers there run from 0 to that number. Reaching
 * one used to mean pressing `+` thirty-five times; the box is typed into now, and the ceiling it is
 * held to travels with the product rather than being read back out of its name, because parsing the
 * label would make renaming a product a silent change to what the studio may quote.
 */

test("the number a row states in words is the number it enforces", () => {
  // The two cannot be allowed to drift: the name is what the studio reads and the number is what
  // the box holds people to, and a product renamed to 40 sheets with the limit left at 35 refuses
  // a quotation its own label says is fine.
  for (const group of shapeCatalogue([]).deliverables) {
    for (const item of group.items) {
      const stated = /(\d+) Sheets/.exec(item.name);
      if (stated) assert.equal(item.max, Number(stated[1]), `${item.name} says ${stated[1]} and enforces ${item.max}`);
    }
  }
});

test("a limit is either a usable number or none at all", () => {
  // A ceiling of 0 would be a row that can only ever hold nothing, which is worse than uncapped.
  for (const group of shapeCatalogue([]).deliverables) {
    for (const item of group.items) {
      assert.ok(item.max === null || (Number.isInteger(item.max) && item.max >= 1), `${item.name} has an unusable limit: ${item.max}`);
    }
  }
});
