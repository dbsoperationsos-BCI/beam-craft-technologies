const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { list, create, update, remove, restore, sync, preview, assignableEmployees } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();

router.use(protect);
// Every route here answers for SALES / CRM Leads: a GET needs Read, anything else Read / Write.
router.use(requireModule("SALES", "CRM Leads"));
router.get("/", list);
// Who a lead-assignment rule may name. Served here rather than reused from /api/sales/crm-employees,
// which answers to a different permission this router's holders need not have.
router.get("/assignable-employees", assignableEmployees);
router.post("/", create);
router.put("/:id", update);
router.post("/:id/sync", sync);
router.post("/:id/restore", restore);
router.get("/:id/import-preview", preview);
router.delete("/:id", remove);

module.exports = router;
