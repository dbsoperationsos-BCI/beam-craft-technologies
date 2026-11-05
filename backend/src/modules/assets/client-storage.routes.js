const express = require("express");
const { protect } = require("../../middleware/authMiddleware"); const { requireModule } = require("../../middleware/permissionMiddleware");
const { mountBulkDelete } = require("../../services/bulkDelete");
const controller = require("./client-storage.controller");
const router = express.Router();
router.use(protect); router.use(requireModule("ASSET", "Client Storage"));
router.get("/", controller.list);
// Both sit above "/:storageId" so the literal paths are not swallowed by the parameter route.
router.get("/shoots", controller.shoots);
router.get("/options", controller.options);
router.get("/:storageId", controller.get);
router.post("/", controller.create);
// Behind the same guard the router already applies to everything else here.
router.get("/import/template", controller.importTemplate);
router.post("/import", controller.importRows);
router.patch("/:storageId", controller.update);
router.patch("/:storageId/status", controller.changeStatus);
// The ticked rows, removed together - above "/:storageId" for the same reason the literal GETs are.
// The router's `requireModule("ASSET", "Client Storage")` carries the Read / Write; `mountBulkDelete`
// adds `ADMIN / Table Select All`. `activeRecord` still scopes every id to this caller.
mountBulkDelete(router, { deleteOne: (id, req) => controller.removeStorageRecord(req, id), noun: "record" });
router.delete("/:storageId", controller.remove);
module.exports = router;
