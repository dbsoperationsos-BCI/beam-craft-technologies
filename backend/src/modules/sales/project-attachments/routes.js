const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { uploadSingle, createProjectAttachment, deleteProjectAttachment, listProjectAttachments } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();

router.use(protect);
// Every route here answers for SALES / CRM Leads: a GET needs Read, anything else Read / Write.
router.use(requireModule("SALES", "CRM Leads"));
router.get("/projects/:id/attachments", listProjectAttachments);
router.post("/projects/:id/attachments", uploadSingle, createProjectAttachment);
router.delete("/projects/:id/attachments/:attachmentId", deleteProjectAttachment);

module.exports = router;
