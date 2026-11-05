const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { limits } = require("../../sales/whatsapp-chat/security");
const { session, connect, linkAllGroups } = require("./controller");

/*
 * This coordinator's own WhatsApp, as Image Selection sees it.
 *
 * The session is the same one the CRM chat pairs - one per signed-in person - but it is read here
 * behind this module's own guard: a post-production coordinator holds Image Selection and not
 * necessarily CRM Leads, and a screen may not be given a finer permission than the endpoint it
 * reads. Mounted at /api/image-selection/whatsapp, beside the per-project routes.
 */
const router = express.Router();
router.use(protect);
// Every route here answers for IMAGE_SELECTION / Project Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("IMAGE_SELECTION", "Project Management"));
router.get("/session", limits.read, session);
router.post("/session/connect", connect);
router.post("/link-all", linkAllGroups);

module.exports = router;
