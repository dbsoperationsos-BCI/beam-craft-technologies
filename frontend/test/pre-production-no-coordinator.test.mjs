import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("the pre production form and read-back no longer ask for a Production Coordinator", () => {
  assert.doesNotMatch(read("constants/formPanelConfig.js"), /productionCoordinatorEmployeeId/);
  assert.doesNotMatch(read("components/project-management/PreProductionFormPanel.js"), /productionCoordinator/);
  const info = read("constants/infoPanelConfig.js");
  assert.doesNotMatch(info, /\["productionCoordinator", "Production Coordinator"\]/);
  // A different field, read from the project's assignment - left exactly as it was.
  assert.match(info, /\["productionCoordinator", "Assigned By \(Project Coordinator\)"\]/);
});

test("the pre production form, read-back and progress no longer ask for travel mode", () => {
  assert.doesNotMatch(read("constants/formPanelConfig.js"), /travelMode|travelVehicleAssetId/);
  assert.doesNotMatch(read("components/project-management/PreProductionFormPanel.js"), /travelMode|vehicles|travelVehicle/);
  assert.doesNotMatch(read("constants/infoPanelConfig.js"), /"travelMode"|"travelModeOther"|"travelVehicleName"/);
  assert.doesNotMatch(read("lib/preProductionProgress.js"), /travelMode/);
});

test("the production plan asks each travel mode for its own field, and only that one", () => {
  const config = read("constants/productionFormConfig.js");
  assert.match(config, /name: "vehicleNumberPlate"[^\n]*when: \(values\) => PLATE_MODES\.includes\(values\.travelMode\)/);
  assert.match(config, /name: "travelVehicleAssetId"[^\n]*options: "vehicles"[^\n]*searchable: true }[^\n]*when: \(values\) => values\.travelMode === "Office Vehicle"/);
  assert.match(config, /name: "travelModeOther"[^\n]*when: \(values\) => values\.travelMode === "Other"/);
});
