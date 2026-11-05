const test = require("node:test");
const assert = require("node:assert/strict");
const { eventsForShoots, inEventOrder } = require("../src/modules/sales/crd-documents/events");
const { documentSchemaFor } = require("../src/modules/sales/crd-documents/verticalDocument");

/*
 * A CRD document asks about every shoot of its project - five shoots, five events - each with its
 * own start, end and venue link, the client's answers kept per shoot as the project's shoots change.
 */
const shoots = [
  { id: "s1", shoot: "Engagement", dateCreated: new Date("2026-11-18T00:00:00Z"), eventStartTime: "10:00", eventEndTime: "13:00", isMainEvent: false },
  { id: "s2", shoot: "Wedding", dateCreated: new Date("2026-11-20T00:00:00Z"), eventStartTime: "06:30", eventEndTime: null, isMainEvent: true },
  { id: "s3", shoot: "Reception", dateCreated: null, eventStartTime: null, eventEndTime: null, isMainEvent: false },
];

test("one event per shoot, in order, its date and two times apart, filled from what the studio knows", () => {
  assert.deepEqual(eventsForShoots(shoots, []), [
    { shootRef: "s1", shoot: "Engagement", eventDate: "2026-11-18", startTime: "10:00", endTime: "13:00", eventAddressLink: "" },
    // No end time on the shoot: none is invented.
    { shootRef: "s2", shoot: "Wedding", eventDate: "2026-11-20", startTime: "06:30", endTime: "", eventAddressLink: "" },
    // No date yet: the client's to give.
    { shootRef: "s3", shoot: "Reception", eventDate: "", startTime: "", endTime: "", eventAddressLink: "" },
  ]);
});

test("the client's answers stay with their shoot; a removed shoot's event goes, an added one appears", () => {
  const saved = [
    { shootRef: "s2", shoot: "Old name", eventDate: "2026-11-21", startTime: "07:00", endTime: "23:00", eventAddressLink: "https://maps.example/hall" },
    { shootRef: "gone", shoot: "Deleted", eventDate: "", startTime: "", endTime: "", eventAddressLink: "https://maps.example/x" },
  ];
  const events = eventsForShoots(shoots, saved);
  assert.equal(events.length, 3);
  assert.deepEqual(events[1], { shootRef: "s2", shoot: "Wedding", eventDate: "2026-11-21", startTime: "07:00", endTime: "23:00", eventAddressLink: "https://maps.example/hall" });
  assert.ok(!events.some((event) => event.shootRef === "gone"));
});

test("an older document's one event seeds the main shoot's end time and venue - not its start", () => {
  const legacy = { eventStartAt: "2026-11-20T00:00", eventEndAt: "2026-11-21T01:00", eventAddressLink: "https://maps.example/venue" };
  const events = eventsForShoots(shoots, [], legacy);
  assert.deepEqual(events[1], { shootRef: "s2", shoot: "Wedding", eventDate: "2026-11-20", startTime: "06:30", endTime: "01:00", eventAddressLink: "https://maps.example/venue" });
  assert.equal(events[0].eventAddressLink, "", "only the main event takes it");
});

test("both document shapes carry the events, and keep them optional", () => {
  const dumDum = documentSchemaFor("DD").safeParse({ common: { events: [{ shootRef: "s1", shoot: "Haldi", eventDate: "2026-11-18", startTime: "10:00" }] } });
  assert.equal(dumDum.success, true);
  assert.equal(dumDum.data.common.events[0].eventAddressLink, "");
  const quaQua = documentSchemaFor("QQ").safeParse({ events: [{ shootRef: "s1", shoot: "Baby Shoot" }] });
  assert.equal(quaQua.success, true);
  assert.deepEqual(documentSchemaFor("QQ").safeParse({}).data.events, []);
});

test("events run in the order the shoots happen, a shoot with no date yet last", () => {
  const ordered = inEventOrder([shoots[2], shoots[1], { ...shoots[0], id: "s0", eventStartTime: "18:00" }, shoots[0]]);
  assert.deepEqual(ordered.map((shoot) => shoot.id), ["s1", "s0", "s2", "s3"]);
});
