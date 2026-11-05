const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listDeliverables, listAllocatedServices, synchronizeDeliverables, saveDeliverableOverrides, addManualDeliverable, removeManualDeliverable } = require("./controller");
const { requireWorkspaceAccess } = require("../projects/modules");
const router = express.Router({ mergeParams: true });
router.use(protect);
// Which modules a project from Project Management is in - and which shoots each works on - is read
// by every module's workspace, so each module's own permission reads it, for a project in that module.
router.get("/allocated-services", requireWorkspaceAccess(), listAllocatedServices);
// Everything else is Photo Selection's selection items: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", listDeliverables);
router.post("/synchronize", synchronizeDeliverables);
router.patch("/overrides", saveDeliverableOverrides);
// Only a manually named project has selection items of its own to add or remove; the service
// refuses both on a project linked to Project Management.
router.post("/", addManualDeliverable);
router.delete("/:configId", removeManualDeliverable);
module.exports = router;
