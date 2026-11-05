import test from "node:test";
import assert from "node:assert/strict";
import { savedShootLocations, shootLocationsError, shootLocationsFor, shootLocationsSummary, shootNamesOf } from "../src/lib/shootLocations.mjs";

test("a combined shoot's names are read back from its name", () => {
  assert.deepEqual(shootNamesOf("Haldi + Mehandi"), ["Haldi", "Mehandi"]);
  assert.deepEqual(shootNamesOf("Haldi"), ["Haldi"]);
  assert.deepEqual(shootNamesOf(""), []);
});

test("each name gets its own place, and the joined place lines up with the name", () => {
  const locations = shootLocationsFor(["Haldi", "Mehandi"], {
    Haldi: { shootPlace: " Home ", district: "Chennai", state: "Tamil Nadu" },
    Mehandi: { shootPlace: "Home", district: "", state: "Tamil Nadu" },
  });
  assert.deepEqual(locations, [
    { shoot: "Haldi", shootPlace: "Home", district: "Chennai", state: "Tamil Nadu" },
    { shoot: "Mehandi", shootPlace: "Home", district: null, state: "Tamil Nadu" },
  ]);
  assert.deepEqual(shootLocationsSummary(locations), { shootPlace: "Home + Home", district: "Chennai", state: "Tamil Nadu" });
});

test("a shoot with no place for one of its names is refused, by that name", () => {
  const locations = shootLocationsFor(["Haldi", "Mehandi"], { Haldi: { shootPlace: "Home" } });
  assert.equal(shootLocationsError(locations), "Enter the Shoot Place for Mehandi.");
  assert.equal(shootLocationsError(shootLocationsFor(["Haldi"], { Haldi: { shootPlace: "Home" } })), "");
});

test("only a shoot saved at two or more places opens on Multiple", () => {
  assert.deepEqual(savedShootLocations({ shootLocations: null }), []);
  assert.deepEqual(savedShootLocations({ shootLocations: [{ shoot: "Haldi", shootPlace: "Home" }] }), []);
  assert.equal(savedShootLocations({ shootLocations: [{ shoot: "Haldi" }, { shoot: "Mehandi" }] }).length, 2);
});
