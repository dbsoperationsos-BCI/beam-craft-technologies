const express = require("express");
const { protect } = require("../../middleware/authMiddleware"); const { requireModule, checkAnyPermission } = require("../../middleware/permissionMiddleware");
const { mountBulkDelete } = require("../../services/bulkDelete");
const controller = require("./vendors.controller");
const router = express.Router();
router.use(protect);

// Two of these are reference data rather than vendor records: the form's dropdown vocabulary, and
// the names an asset is sent to for service. Servicing an asset is Asset Management's business, so
// both are reachable by either permission - otherwise splitting vendors off would have broken the
// asset status dialog for everybody who does not administer vendors.
const readsForEitherScreen = checkAnyPermission([
  { module: "ASSET", feature: "Vendor Management", level: "READ" },
  { module: "ASSET", feature: "Asset Management", level: "READ" },
]);
router.get("/options", readsForEitherScreen, controller.options);
router.get("/picker", readsForEitherScreen, controller.picker);

// The vendor records themselves, and every change to them, are Vendor Management's alone.
router.use(requireModule("ASSET", "Vendor Management"));
router.get("/", controller.list);
router.get("/:vendorId", controller.get);
router.post("/", controller.create);
// The importer's own two: the template a studio downloads to fill in, and the rows it sends back.
// Both sit behind the same Vendor Management guard the router already applies.
router.get("/import/template", controller.importTemplate);
router.post("/import", controller.importRows);
router.patch("/:vendorId/status", controller.changeStatus);
router.patch("/:vendorId", controller.update);
/*
 * The ticked rows, removed together. Above `/:vendorId` because `/bulk` is a fixed segment.
 *
 * No extra guard named here: the router's own `requireModule("ASSET", "Vendor Management")` already
 * asks for Read / Write on anything that is not a GET, so this route carries it like every other
 * write on the router - and `mountBulkDelete` adds `ADMIN / Table Select All` on top. The reason
 * the removal is audited under rides in the body beside the ids, where `deleteInput` reads it.
 */
mountBulkDelete(router, { deleteOne: (id, req) => controller.removeVendorRecord(req, id), noun: "vendor" });
router.delete("/:vendorId", controller.remove);
module.exports = router;
