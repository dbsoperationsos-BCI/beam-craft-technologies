const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
// The board is read-only; anything added here later is covered the moment it is written.
router.use(requireModule("PROJECT", "Shoot Board"));

router.get("/shoots", controller.listShoots);

module.exports = router;
