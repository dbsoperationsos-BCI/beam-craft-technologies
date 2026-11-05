const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { culling, editing, signatureAlbum } = require("./controller");

/**
 * The AI Culling, AI Editing and Signature Album dashboards - one read each, each behind the
 * permission its sidebar entry opens on. The stages' own tabs and endpoints keep the guards they
 * always had (culling: Project Management; editing: AI Editing; album: Signature Album); these
 * routes only summarise, and write nothing.
 */
const router = express.Router();

router.use(protect);
router.get("/ai-culling", requireModule("IMAGE_SELECTION", "AI Culling"), culling);
router.get("/ai-editing", requireModule("IMAGE_SELECTION", "AI Editing"), editing);
router.get("/signature-album", requireModule("IMAGE_SELECTION", "Signature Album"), signatureAlbum);

module.exports = router;
