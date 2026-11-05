const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listDeliverables, listAllocatedServices, synchronizeDeliverables, saveDeliverableOverrides, addManualDeliverable, removeManualDeliverable } = require("./controller");
const router = express.Router({ mergeParams: true });
router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/", listDeliverables);
router.get("/allocated-services", listAllocatedServices);
router.post("/synchronize", synchronizeDeliverables);
router.patch("/overrides", saveDeliverableOverrides);
// Only a manually named project has selection items of its own to add or remove; the service
// refuses both on a project linked to Project Management.
router.post("/", addManualDeliverable);
router.delete("/:configId", removeManualDeliverable);
module.exports = router;
