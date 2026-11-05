const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { getClientPageImages, saveClientPageImages } = require("./controller");

/*
 * Settings → Project Management → Client page images. Its own permission, not Organization's: the
 * studio may hand somebody the client page's pictures without the logo, the branches and the
 * storage paths the rest of this settings record holds. A GET needs Read, a PUT Read / Write.
 *
 * Mounted ahead of `/api/image-selection/settings` in server.js, whose router would otherwise
 * answer this path first and ask for Organization instead.
 */
const router = express.Router();

router.use(protect);
router.use(requireModule("SETTINGS", "Client Page Images"));
router.get("/", getClientPageImages);
router.put("/", saveClientPageImages);

module.exports = router;
