const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkAnyPermission, checkPermission } = require("../../../middleware/permissionMiddleware");
const { getCompression, saveCompression } = require("./controller");

/**
 * /api/image-selection/compression - the studio's compression presets for Image Selection, Album
 * Proofing and Signature Album uploads.
 *
 * Reading is open to anybody who can upload into any of the three: the browser and the desktop
 * ask here before every batch, and an uploader with Project Management alone must not be refused
 * the recipe the studio chose for them. Writing is the Settings panel's, behind the same
 * ADMIN / System Settings permission (`SETTINGS / Organization`) that opens the rest of that panel.
 */
const router = express.Router();
router.use(protect);
router.get("/", checkAnyPermission([
  { module: "IMAGE_SELECTION", feature: "Project Management", level: "READ" },
  { module: "IMAGE_SELECTION", feature: "Album Proofing", level: "READ" },
  { module: "IMAGE_SELECTION", feature: "Signature Album", level: "READ" },
  // AI Culling and AI Editing import photos too (the desktop compresses their previews), and each
  // is now opened by its own permission rather than Project Management's.
  { module: "IMAGE_SELECTION", feature: "AI Culling", level: "READ" },
  { module: "IMAGE_SELECTION", feature: "AI Editing", level: "READ" },
  { module: "SETTINGS", feature: "Organization", level: "READ" },
]), getCompression);
router.put("/", checkPermission("SETTINGS", "Organization", "READ_WRITE"), saveCompression);

module.exports = router;
