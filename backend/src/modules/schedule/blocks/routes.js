const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

/*
 * Calendar → Block Period, at /api/schedule/blocks, behind `SALES / Block Period`: `requireModule` on
 * the whole router - a GET reads the branches a block may be made in (Read), a POST blocks a period
 * and a DELETE frees one (Read / Write). The blocks themselves reach the calendar through
 * `/api/schedule`, as its "block" source, under the same permission.
 */
const router = express.Router();
router.use(protect);
router.use(requireModule("SALES", "Block Period"));

router.get("/branches", controller.branches);
router.post("/", controller.create);
router.delete("/:id", controller.remove);

module.exports = router;
