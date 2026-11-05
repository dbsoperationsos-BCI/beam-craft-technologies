const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listGifts, setGiftStatus, giftOptions } = require("./controller");

const router = express.Router();

router.use(protect);
// Every route here answers for PROJECT / Client Gifts: a GET needs Read, moving a gift along the
// three tabs is a write. Mounted on the router so a route added later is guarded the moment it is
// written rather than the moment somebody remembers.
router.use(requireModule("PROJECT", "Client Gifts"));
router.get("/options", giftOptions);
router.get("/:gift", listGifts);
router.patch("/:gift/:projectId/status", setGiftStatus);

module.exports = router;
