const test = require("node:test");
const assert = require("node:assert/strict");
const { Prisma } = require("@prisma/client");
const { shootLocationColumns, shootLocationsIssue } = require("../src/services/shootLocations");
const { projectShootSchema, projectShootData } = require("../src/modules/sales/projects/controller");

const shoot = {
  dateCreated: "2026-11-02", shoot: "Haldi + Mehandi", shootPlace: "Chennai + Madurai",
  shootTypes: ["Studio / In-House"], sessionTimings: ["Full Session"], preference: "Both",
};
const locations = [
  { shoot: "Haldi", shootPlace: "Chennai", district: "Chennai", state: "Tamil Nadu" },
  { shoot: "Mehandi", shootPlace: "Madurai", district: "Madurai", state: "Tamil Nadu" },
];

test("a combined shoot at several places stays one shoot, with each name's place kept and the columns joined in the name's order", () => {
  const parsed = projectShootSchema.safeParse({ ...shoot, shootLocations: locations });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  const data = projectShootData(parsed.data);
  assert.equal(data.shoot, "Haldi + Mehandi");
  assert.deepEqual(data.shootLocations, locations);
  assert.equal(data.shootPlace, "Chennai + Madurai");
  assert.equal(data.district, "Chennai + Madurai");
  assert.equal(data.state, "Tamil Nadu", "a state both shoots share is named once");
});

test("the joined place keeps a repeat, so each shoot's place still lines up with its name", () => {
  const columns = shootLocationColumns({ shoot: "Haldi + Mehandi + Wedding", shootLocations: [
    { shoot: "Haldi", shootPlace: "Home", district: "", state: "" },
    { shoot: "Mehandi", shootPlace: "Home", district: null, state: null },
    { shoot: "Wedding", shootPlace: "Hall", district: "Chennai", state: null },
  ] });
  assert.equal(columns.shootPlace, "Home + Home + Hall");
  assert.equal(columns.district, "Chennai");
  assert.equal(columns.state, null, "no state given is none, never an empty string");
  assert.equal(columns.shootLocations[0].district, null);
});

test("one place is the shoot as it always was, and clears any places it held before", () => {
  const data = projectShootData(projectShootSchema.parse({ ...shoot, shootPlace: "Chennai", district: "Chennai", state: "" }));
  assert.equal(data.shootLocations, Prisma.DbNull);
  assert.equal(data.shootPlace, "Chennai");
  assert.equal(data.state, null);
});

test("locations that do not match the shoot's names, or leave a place blank, are refused", () => {
  assert.match(shootLocationsIssue({ shoot: "Haldi", shootLocations: [locations[0]] }), /several shoots/);
  assert.match(shootLocationsIssue({ shoot: "Haldi + Mehandi", shootLocations: [locations[1], locations[0]] }), /location of its own/);
  assert.match(shootLocationsIssue({ shoot: "Haldi + Mehandi + Wedding", shootLocations: locations }), /location of its own/);
  assert.equal(projectShootSchema.safeParse({ ...shoot, shootLocations: [locations[0], { ...locations[1], shootPlace: " " }] }).success, false);
  const long = "x".repeat(100);
  assert.match(shootLocationsIssue({ shoot: "Haldi + Mehandi", shootLocations: locations.map((location) => ({ ...location, shootPlace: long })) }), /too long together/);
});
