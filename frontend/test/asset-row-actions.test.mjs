import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * What the ⋮ menu offers on one row of the Assets table.
 *
 * The menu is drawn per row from the `capabilities` the API sends with it: an asset is yours to
 * manage if you are the employee named as its manager or the login that added it, and everything
 * else you can see is yours to look at and report faulty. The rule itself is the backend's and is
 * tested there - what matters here is that the screen renders the answer it was given rather than
 * working one out, because a screen with an opinion of its own is how the old bug happened: this
 * file held its own copy of the status transition map, so it hid "Dispose" from somebody who only
 * held the asset while the PATCH behind it accepted Dispose from them quite happily.
 *
 * `AssetManagementPage.js` is a React module and this suite has no renderer, so the two
 * declarations the menu is made of are lifted out of the source and evaluated on their own, with
 * the state setters they close over passed in as stubs. What runs below is the code that ships.
 */

const PAGE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "components", "assets", "AssetManagementPage.js"),
  "utf8",
);

/** One declaration, from its opening line to the line that closes it at the same indent. */
function declaration(opening, closing) {
  const start = PAGE.indexOf(opening);
  assert.notEqual(start, -1, `${opening} was not found in AssetManagementPage.js`);
  const end = PAGE.indexOf(closing, start);
  assert.notEqual(end, -1, `${opening} was never closed`);
  return PAGE.slice(start, end + closing.length);
}

const SETTERS = ["setViewingRow", "setFormAsset", "setFormOpen", "setInspectionAsset", "setStatusChange", "setAssetToDelete"];

const build = new Function(
  "maintenanceCheck",
  ...SETTERS,
  `${declaration("const assetStatusActions = [", "];")}
   ${declaration("  function assetActionItems(asset)", "\n  }")}
   return assetActionItems;`,
);

// Nothing is due, so Start Inspection turns only on the capability rather than on the date.
const actionsFor = (asset, inspectionStatus = "OK") =>
  build(() => ({ status: inspectionStatus }), ...SETTERS.map(() => () => {}))(asset)
    .map((item) => item.label.trim());

const asset = (capabilities, status = "ACTIVE") => ({ id: 1, status, nextInspectionDate: null, capabilities });

const MANAGES = { canManage: true, canEdit: true, canInspect: true, canDelete: false, allowedTransitions: ["UNDER_REPAIR", "IN_TRANSIT", "LOST", "SOLD", "DISPOSED", "UNASSIGNED"] };
const HOLDS = { canManage: false, canEdit: false, canInspect: false, canDelete: false, allowedTransitions: ["UNDER_REPAIR"] };
const READS = { canManage: false, canEdit: false, canInspect: false, canDelete: false, allowedTransitions: [] };

test("somebody who only holds the asset gets View and Under Repair, and nothing else", () => {
  assert.deepEqual(actionsFor(asset(HOLDS)), ["View", "Under Repair"]);
});

test("the asset's manager gets the record and every move the server allowed - but not Delete", () => {
  const labels = actionsFor(asset(MANAGES), "OVERDUE");
  assert.deepEqual(labels, ["View", "Edit", "Start Inspection", "Under Repair", "In Transit", "Lost", "Sold", "Disposed", "Unassigned"]);
  assert.equal(labels.includes("Delete"), false);
});

test("Delete appears only where the server said it may", () => {
  assert.equal(actionsFor(asset(MANAGES)).includes("Delete"), false);
  assert.equal(actionsFor(asset({ ...MANAGES, canDelete: true })).includes("Delete"), true);
});

test("a reader gets View alone, so no control is shown that would then be refused", () => {
  assert.deepEqual(actionsFor(asset(READS)), ["View"]);
});

test("a row that arrived without capabilities offers nothing but View", () => {
  // A row spliced into the table by a write that forgot to carry them: the menu must fall shut
  // rather than open up. Every asset response attaches them, and this is the floor if one does not.
  assert.deepEqual(actionsFor({ id: 1, status: "ACTIVE", nextInspectionDate: null }), ["View"]);
});

test("Start Inspection still waits for the inspection to be due", () => {
  assert.equal(actionsFor(asset(MANAGES), "OK").includes("Start Inspection"), false);
  assert.equal(actionsFor(asset(MANAGES), "DUE").includes("Start Inspection"), true);
});

test("Add Asset reads Asset Administration, not the widely-held permission", () => {
  // Asset Management is how somebody sees the camera in their hands and reports it faulty, and it
  // is meant to be held widely. Putting equipment ON the register is a different job, so Add Asset
  // moved to its own permission; raising a request did not. If these two ever read the same
  // permission again, everybody who can ask for a lens can also register one.
  const addLine = PAGE.split("\n").find((line) => line.includes(">Add Asset<"));
  assert.ok(addLine, "the Add Asset button was not found");
  assert.match(addLine, /^\s*\{canAdminister &&/, "Add Asset must be gated on canAdminister");

  const requestLine = PAGE.split("\n").find((line) => line.includes(">Asset Request<"));
  assert.ok(requestLine, "the Asset Request button was not found");
  assert.match(requestLine, /^\s*\{canWrite &&/, "Asset Request stays on Asset Management");

  assert.match(PAGE, /const \{ canWrite: canAdminister \} = useModuleAccess\("ASSET", "Asset Administration"\)/);
});

test("the screen keeps no status transition map of its own", () => {
  // The map is the backend's rule and arrives per row as `allowedTransitions`. A copy here is what
  // let the menu and the endpoint disagree, so its absence is the thing worth asserting.
  assert.equal(PAGE.includes("allowedAssetStatusTransitions"), false);
  assert.equal(PAGE.includes("allowedTransitions"), true);
});
