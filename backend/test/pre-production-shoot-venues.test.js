const test = require("node:test");
const assert = require("node:assert/strict");
const { shootVenues, shootVenuesIssue, shootVenueLengthIssue, shootVenueColumns } = require("../src/services/shootLocations");
const { formFor } = require("../src/modules/client/portal/preProduction");

/*
 * A shoot held at several places (Add / Edit Shoot → Location: Multiple) has a venue per name in Pre
 * Production - the team's form, the client's and the PDF alike - kept beside the one address every
 * other reader still reads.
 */
const shoot = {
  id: "s1", shootId: "SH1", shoot: "Haldi + Mehandi", dateCreated: null, shootType: "Outdoor / On-Location", shootTypes: [],
  shootLocations: [{ shoot: "Haldi", shootPlace: "Chennai" }, { shoot: "Mehandi", shootPlace: "Madurai" }],
};

test("a shoot at one place has no venues", () => {
  assert.equal(shootVenues({ ...shoot, shootLocations: null }, { locationAddress: "Hall" }), null);
});

test("saved venues are matched by name, and a name added since starts blank", () => {
  const venues = shootVenues(shoot, { locations: [{ shoot: "Mehandi", locationAddress: "Hall B", locationLink: "https://maps/b" }] });
  assert.deepEqual(venues, [
    { shoot: "Haldi", locationAddress: null, locationLink: null },
    { shoot: "Mehandi", locationAddress: "Hall B", locationLink: "https://maps/b" },
  ]);
});

test("a shoot never asked per name starts each name on the one address it had", () => {
  const venues = shootVenues(shoot, { locations: null, locationAddress: "Hall", locationLink: null });
  assert.deepEqual(venues.map((venue) => venue.locationAddress), ["Hall", "Hall"]);
});

test("the two columns hold the venues labelled, one per line, and blank is null", () => {
  const columns = shootVenueColumns([
    { shoot: "Haldi", locationAddress: " Hall A ", locationLink: "" },
    { shoot: "Mehandi", locationAddress: "Hall B", locationLink: "https://maps/b" },
  ]);
  assert.deepEqual(columns.locations[0], { shoot: "Haldi", locationAddress: "Hall A", locationLink: null });
  assert.equal(columns.locationAddress, "Haldi: Hall A\nMehandi: Hall B");
  assert.equal(columns.locationLink, "Mehandi: https://maps/b");
});

test("venues are refused for a shoot at one place, or for names that are not the shoot's", () => {
  assert.match(shootVenuesIssue({ ...shoot, shootLocations: null }, [{ shoot: "Haldi" }, { shoot: "Mehandi" }]), /one place/);
  assert.match(shootVenuesIssue(shoot, [{ shoot: "Mehandi" }, { shoot: "Haldi" }]), /changed/);
  assert.equal(shootVenuesIssue(shoot, [{ shoot: "Haldi" }, { shoot: "Mehandi" }]), "");
});

test("the client's form asks a link and then an address under each name, and owes each address", () => {
  const pre = { locations: [{ shoot: "Haldi", locationAddress: "Hall A", locationLink: null }, { shoot: "Mehandi", locationAddress: null, locationLink: null }] };
  const form = formFor({ shoot, pre, uploads: [], vertical: null });
  const location = form.sections.find((section) => section.id === "location");
  assert.deepEqual(location.fields.map((field) => field.label), ["Haldi - Location Link", "Haldi - Location Address", "Mehandi - Location Link", "Mehandi - Location Address"]);
  assert.equal(location.fields[1].value, "Hall A");
  assert.equal(location.fields[1].locked, true, "an address already given is not asked again");
  assert.ok(form.pending.includes("Mehandi - Location Address"));
  assert.ok(!form.pending.includes("Haldi - Location Address"));
});

test("venues too long to keep together are refused, the team's and the client's alike", () => {
  const long = (key, size) => [{ shoot: "Haldi", [key]: "x".repeat(size) }, { shoot: "Mehandi", [key]: "y".repeat(size) }];
  assert.match(shootVenueLengthIssue(long("locationLink", 1100)), /Links are too long/);
  assert.match(shootVenueLengthIssue(long("locationAddress", 10100)), /Addresses are too long/);
  assert.match(shootVenuesIssue(shoot, long("locationLink", 1100)), /Links are too long/);
  assert.equal(shootVenueLengthIssue(long("locationAddress", 4000)), "");
});
