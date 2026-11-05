const express = require("express");
const { protect } = require("../../middleware/authMiddleware");
const { checkBranchAccess, checkPermission } = require("../../middleware/permissionMiddleware");

/*
 * The permission every branch check on this router is asked against.
 *
 * Branch reach is per-permission now: somebody may hold CRM Leads across all six branches through
 * one role and Asset Management in Coimbatore through another, and a guard that did not say which
 * of the two it meant would take the wider answer. Named once here so the eleven guards below
 * cannot drift apart from each other.
 */
const ASSETS = { module: "ASSET", feature: "Asset Management" };

// Registering an asset is its own permission, so the branch on a create is measured against that
// one - a holder of Administration in a branch and not Management must not be refused their own act.
const ASSET_ADMIN = { module: "ASSET", feature: "Asset Administration" };
const { mountBulkDelete } = require("../../services/bulkDelete");
const controller = require("./assets.controller");
const inspections = require("./inspections.controller");

const router = express.Router();
router.use(protect);

// Asset Management - READ
router.get(
  "/",
  checkBranchAccess("branchId", ASSETS),
  checkPermission("ASSET", "Asset Management", "READ"),
  controller.listAssets
);

/*
 * Putting equipment ON the register is `Asset Administration`, not `Asset Management`.
 *
 * `Asset Management` is held widely - it is how somebody sees the camera in their hands, reports it
 * faulty and asks for a new lens - and `READ_WRITE` on it used to carry Add Asset too, so anybody
 * who could raise a request could also register equipment and name its manager. Deciding what the
 * studio owns is a different job from looking after a piece of it.
 *
 * Everything else on this router stays on `Asset Management`: the guard answers "may you open the
 * register at all", and which rows you may then change is decided per record by `capabilitiesFor`.
 */
router.post(
  "/bulk",
  // The branch is measured against the permission this route requires, not the register's.
  checkBranchAccess("branchId", ASSET_ADMIN),
  checkPermission("ASSET", "Asset Administration", "READ_WRITE"),
  controller.createAssetsBulk
);

router.post(
  "/",
  checkBranchAccess("branchId", ASSET_ADMIN),
  checkPermission("ASSET", "Asset Administration", "READ_WRITE"),
  controller.createAsset
);

/*
 * Importing a spreadsheet of assets.
 *
 * No `checkBranchAccess` here, and that is not an omission. It reads one `branchId` off the request
 * body, and an import carries a branch *per row* - by name, since that is what a spreadsheet holds.
 * The check that matters is done for every row inside `createAssetRecord`, which resolves the name
 * to a branch and then calls `branchIsReachable` exactly as a single create does. A row naming a
 * branch this person's roles do not reach is refused and named in the result.
 */
router.get(
  "/import/template",
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.importTemplate
);
router.post(
  "/import",
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.importRows
);

router.patch(
  "/:assetId/status",
  checkBranchAccess("branchId", ASSETS),
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.changeStatus
);

router.patch(
  "/:assetId",
  checkBranchAccess("branchId", ASSETS),
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.updateAsset
);

/*
 * The ticked rows, deleted together.
 *
 * Above `DELETE /:assetId` because `/bulk` is a fixed segment: matched the other way round it reads
 * as an asset with the id "bulk" and answers 404, which looks like a missing record rather than a
 * route in the wrong order.
 *
 * Two permissions, and both are needed. `mountBulkDelete` asks for `ADMIN / Table Select All` -
 * acting on a selection at all - and the guards named here are the register's own, so deleting
 * forty assets in one press is only for somebody who could have deleted each of them by hand. The
 * per-asset rules stay where they were: `deleteAssetRecord` is the same function `DELETE /:assetId`
 * runs, so `capabilitiesFor` still refuses an asset this person may not retire, and an id in the
 * body that names an asset outside their branches is refused by `scopedAsset` exactly as it would
 * be in the URL.
 */
mountBulkDelete(router, {
  guard: [checkBranchAccess("branchId", ASSETS), checkPermission("ASSET", "Asset Management", "READ_WRITE")],
  deleteOne: (id, req) => controller.deleteAssetRecord(req, Number(id)),
  noun: "asset",
});

router.delete(
  "/:assetId",
  checkBranchAccess("branchId", ASSETS),
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  controller.deleteAsset
);

// Inspections are part of the same screen and the same permission.
router.get(
  "/:assetId/inspections/context",
  checkBranchAccess("branchId", ASSETS),
  checkPermission("ASSET", "Asset Management", "READ"),
  inspections.context
);

router.post(
  "/:assetId/inspections",
  checkBranchAccess("branchId", ASSETS),
  checkPermission("ASSET", "Asset Management", "READ_WRITE"),
  inspections.create
);

// Who has held an asset, read alongside the asset itself.
router.get(
  "/:assetId/custody",
  checkBranchAccess("branchId", ASSETS),
  checkPermission("ASSET", "Asset Management", "READ"),
  controller.assetCustody
);

module.exports = router;
