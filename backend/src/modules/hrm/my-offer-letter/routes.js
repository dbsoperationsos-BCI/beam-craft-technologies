const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const controller = require("./controller");

/*
 * My Profile → Offer Letter, at /api/hrm/my-offer-letter: the signed-in employee's own offer letter,
 * and nobody else's - there is no id to ask for another's. Signed in is the whole of the guard, by
 * the studio's decision: every employee has their own offer letter on their profile by default, as
 * the employee directory answers anyone signed in. Nothing here reaches past the caller's own record.
 */
const router = express.Router();
router.use(protect);

router.get("/", controller.getMyOfferLetter);
router.get("/pdf", controller.downloadMyOfferLetter);

module.exports = router;
