import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shootProgress } from "../src/lib/preProductionProgress.js";
import { preProductionFormSections, venueFieldName, withShootVenues } from "../src/constants/formPanelConfig.js";

/*
 * A shoot held at several places (Add / Edit Shoot → Location: Multiple) is asked its Location
 * Address and Link under each name in Pre Production, and counts as placed only once every name has one.
 */
const venues = [
  { shoot: "Haldi", locationAddress: "Hall A, Chennai", locationLink: null },
  { shoot: "Mehandi", locationAddress: null, locationLink: null },
];

test("the Location section asks a link and then an address under each name, in the name's order", () => {
  const location = withShootVenues(preProductionFormSections, venues).find((section) => section.id === "location");
  assert.deepEqual(location.fields.map((field) => field.name), [
    venueFieldName("locationLink", 0), venueFieldName("locationAddress", 0),
    venueFieldName("locationLink", 1), venueFieldName("locationAddress", 1),
  ]);
  assert.deepEqual(location.fields.map((field) => field.label), ["Haldi - Location Link", "Haldi - Location Address", "Mehandi - Location Link", "Mehandi - Location Address"]);
  assert.equal(location.fields[1].required, true, "each address is marked as the one address was");
});

test("a shoot at one place keeps the one Location Address and Link", () => {
  assert.equal(withShootVenues(preProductionFormSections, null), preProductionFormSections);
});

test("a shoot held at several places is short of its venue until every name has an address", () => {
  const row = { subEventDate: "2026-11-02", eventStartTime: "10:00", eventEndTime: "18:00", reportingTime: "09:00", studioStartDate: "2026-11-01", studioStartTime: "07:00", locationAddress: "Haldi: Hall A, Chennai" };
  assert.equal(shootProgress({ ...row, locations: venues }).pending, 1, "the joined address does not stand for Mehandi's");
  assert.equal(shootProgress({ ...row, locations: [venues[0], { ...venues[1], locationAddress: "Hall B, Madurai" }] }).pending, 0);
});

test("Edit Shoot on a project's plan saves each name's place, so Pre Production can ask a venue for each", () => {
  const plan = readFileSync(new URL("../src/components/project-management/useProjectPlan.js", import.meta.url), "utf8");
  assert.match(plan, /updateProjectShoot\(projectId, shoot\.id, \{[^}]*shootLocations: nextShoot\.shootLocations \|\| null/);
});
