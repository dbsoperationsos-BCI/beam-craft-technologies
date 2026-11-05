const express = require("express");
const controller = require("./public.controller");

// The client's proof API: no login — the token names the proof, the PIN (rate limited, bcrypt)
// opens a scoped JWT session, and every route re-resolves the publication so a revoked or expired
// link stops answering immediately. Sequential database ids never appear here.
const router = express.Router({ mergeParams: true });

router.get("/:token", controller.meta);
router.post("/:token/verify-pin", controller.verifyPin);
router.get("/:token/proof", controller.proof);
router.post("/:token/corrections", controller.addCorrection);
router.patch("/:token/corrections/:correctionId", controller.editCorrection);
router.delete("/:token/corrections/:correctionId", controller.deleteCorrection);
router.post("/:token/submit-corrections", controller.submitCorrections);
router.post("/:token/approve", controller.approve);

module.exports = router;
