const express = require("express");
const { protect } = require("../../middleware/authMiddleware");
const { gate, virtualCurationEnabled, runtimeModelLimiter } = require("./flags");
const { getCapabilities, getRuntimeManifest, getRuntimeModelFile, getRuntimeEngineScript, getRuntimeEditEngineScript } = require("./controller");

/**
 * Mounted at /api/desktop: what this server offers the Virtual Curation desktop app, and the
 * managed Local AI runtime it installs from here.
 *
 * Behind `protect` alone, by design rather than by omission: none of these answers holds a row of
 * any table - which switches are on, the face model name and two thresholds, and the engine
 * script and open-source model files the server itself runs (published weights, not studio data) -
 * and every signed-in user's desktop has to read them before it knows which module routes to call.
 * Those routes carry their own permissions (Image Selection / Project Management, AI Face
 * Management), which is where access to anything real is decided. Off
 * (`DESKTOP_VIRTUAL_CURATION_ENABLED` unset), every route here answers the JSON 404 an unknown
 * path gets.
 *
 * The model download is the one that costs disk reads by the hundred megabytes, so it alone is
 * rate-limited per person; the manifest and the script are a cached digest and a 10 KB file.
 */
const router = express.Router();
router.use(protect);
router.get("/capabilities", gate(virtualCurationEnabled), getCapabilities);
router.get("/runtime/manifest", gate(virtualCurationEnabled), getRuntimeManifest);
router.get("/runtime/models/:file", gate(virtualCurationEnabled), runtimeModelLimiter, getRuntimeModelFile);
router.get("/runtime/face-engine.py", gate(virtualCurationEnabled), getRuntimeEngineScript);
router.get("/runtime/edit-engine.py", gate(virtualCurationEnabled), getRuntimeEditEngineScript);

module.exports = router;
