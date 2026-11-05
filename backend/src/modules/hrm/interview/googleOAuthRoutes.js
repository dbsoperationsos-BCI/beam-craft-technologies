const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { connection, disconnect, pickerToken, spreadsheetTabs } = require("../../sales/google-oauth/controller");
const { startOAuth, OAUTH_PURPOSE_INTERVIEW } = require("../../sales/google-oauth/service");

/**
 * The Google account behind the Interview integration, reached under the Interview permission.
 *
 * It is the **same** account and the same stored connection the CRM's integration uses - one
 * Google login per person serves both - so the handlers are the CRM's own, mounted a second time
 * behind `HRM / Interview` rather than `SALES / CRM Leads`. An HR role need not hold the CRM to
 * connect the account its own sheets are read through, and the Settings → Integrations → Interview
 * panel calls these paths rather than the CRM's, which would refuse it.
 *
 * `start` is the one handler of its own: the consent is asked for with the Interview purpose, so
 * Google sends the person back to the Interview screen rather than the CRM. The callback itself
 * stays the single public one under `/api/sales/google-oauth/callback`.
 */
async function start(req, res) {
  try {
    const { authUrl } = await startOAuth(req.user, { purpose: OAUTH_PURPOSE_INTERVIEW });
    return res.json({ data: { authUrl } });
  } catch (error) {
    console.error("Unable to start Google OAuth for Interview:", error);
    return res.status(error.status || 500).json({ message: error.message || "Unable to start Google OAuth." });
  }
}

const router = express.Router();
router.use(protect);
router.use(requireModule("HRM", "Interview"));
router.post("/start", start);
router.get("/connection", connection);
router.delete("/connection", disconnect);
router.get("/picker-token", pickerToken);
router.get("/spreadsheets/:spreadsheetId/tabs", spreadsheetTabs);

module.exports = router;
