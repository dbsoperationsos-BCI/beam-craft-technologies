const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { list, create, update, remove, restore, sync, preview, assignableEmployees } = require("./sheetLinksController");

const router = express.Router();

router.use(protect);
// Every route here answers for HRM / Interview: a GET needs Read, anything else Read / Write. The
// same pair that opens the Interview screen, because linking a sheet is how its rows arrive.
router.use(requireModule("HRM", "Interview"));
router.get("/", list);
// Who a candidate-assignment rule may name. Ahead of `/:id`, or it reads as a link id.
router.get("/assignable-employees", assignableEmployees);
router.post("/", create);
router.put("/:id", update);
router.post("/:id/sync", sync);
router.post("/:id/restore", restore);
router.get("/:id/import-preview", preview);
router.delete("/:id", remove);

module.exports = router;
