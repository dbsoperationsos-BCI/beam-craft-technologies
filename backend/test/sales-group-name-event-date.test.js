const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGeneratedName, groupNameSchema } = require("../src/modules/sales/whatsapp-group-names/controller");

/*
 * A group is often opened before the couple have fixed the day, so Event Date Known can be off and
 * the name then carries no date. What is pinned here is that dropping it drops the separator with
 * it - a name ending "| Erode |" is the failure this guards against, and it is the kind that only
 * shows up on a client's phone.
 */

const dumDum = { groupType: "Dum Dum", tier: "1t1", branch: "Erode", groomName: "Arun", brideName: "Priya", socialMediaPosting: "SM", place: "Erode" };
const quaQua = { groupType: "Qua Qua", branch: "Erode", clientName: "Meena", eventName: "Birthday", socialMediaPosting: "NSM", houseType: "IH", gou: true, place: "Erode" };
const corp = { groupType: "Corp", branch: "Erode", clientName: "Acme", place: "Erode" };
const day = new Date("2026-10-04T00:00:00Z");

test("a known date is the last segment of the name", () => {
  assert.equal(buildGeneratedName({ ...dumDum, mainEventDate: day }), "WED 1t1 Erode Arun & Priya | SM | Erode | 4-Oct-2026");
  assert.equal(buildGeneratedName({ ...quaQua, mainEventDate: day }), "QQErode Meena | Birthday | NSM | IH | GOU | Erode | 4-Oct-2026");
  assert.equal(buildGeneratedName({ ...corp, mainEventDate: day }), "CORP Erode Acme | Erode | 4-Oct-2026");
});

test("an unknown date takes its separator with it", () => {
  for (const form of [dumDum, quaQua, corp]) {
    for (const missing of [null, undefined]) {
      const name = buildGeneratedName({ ...form, mainEventDate: missing });
      assert.ok(!name.endsWith("|"), `${name} ends in a dangling separator`);
      assert.ok(!name.includes("| |"), `${name} has an empty segment`);
      assert.ok(!name.includes("undefined") && !name.includes("Invalid"), `${name} leaked a missing date`);
    }
  }
  assert.equal(buildGeneratedName({ ...dumDum, mainEventDate: null }), "WED 1t1 Erode Arun & Priya | SM | Erode");
  assert.equal(buildGeneratedName({ ...corp, mainEventDate: null }), "CORP Erode Acme | Erode");
});

test("the offer name still sits inside the first segment when there is no date", () => {
  assert.equal(
    buildGeneratedName({ ...dumDum, offerName: "Diwali", mainEventDate: null }),
    "WED 1t1 Erode Diwali Arun & Priya | SM | Erode",
  );
});

// The browser sends no date at all when Event Date Known is off, so the schema has to accept its
// absence - and must still refuse a date that is not one.
test("the schema accepts a group name with no date and refuses a bad one", () => {
  const base = { ...dumDum, enquiryId: "DBS-DD-EID-0001" };
  assert.equal(groupNameSchema.safeParse(base).success, true, "no date at all");
  assert.equal(groupNameSchema.safeParse({ ...base, mainEventDate: null }).success, true, "an explicit null");
  assert.equal(groupNameSchema.safeParse({ ...base, mainEventDate: "2026-10-04" }).success, true, "a real date");
  assert.equal(groupNameSchema.safeParse({ ...base, mainEventDate: "not a date" }).success, false, "nonsense is still refused");
});
