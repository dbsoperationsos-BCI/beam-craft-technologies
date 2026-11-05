const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, checkAnyPermission } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");
const { mountBulkDelete } = require("../../../services/bulkDelete");

const router = express.Router();
router.use(protect);

const canSubmit = checkPermission("HRM", "Speak-up", "READ_WRITE");
const canReadMine = checkPermission("HRM", "Speak-up", "READ");
const canReview = checkPermission("HRM", "Speak-up Review", "READ");
// Deciding one - and listing who an assignment can go to - is the review permission with write.
const canDecide = checkPermission("HRM", "Speak-up Review", "READ_WRITE");
// Either permission may open an attachment - `checkPermission` answers only one question and
// writes its own 403 without calling `next(err)`, so a manual "try one, fall back to the other"
// composition can't work here the way it might with a callback-style guard. `checkAnyPermission`
// is this codebase's actual OR-guard. The controller then asks a second, finer question of its own
// (see `attachment` in controller.js) to decide whether the row has to be the caller's own.
const canOpenAttachment = checkAnyPermission([
  { module: "HRM", feature: "Speak-up", level: "READ" },
  { module: "HRM", feature: "Speak-up Review", level: "READ" },
]);

/*
 * The tick boxes' Delete, one path per screen, because the two are different acts (see
 * `deleteSpeakUpRecord`): `/mine/bulk` takes back your own while it is still pending, `/bulk` is
 * HR clearing a record it is finished with. `mountBulkDelete` adds `ADMIN / Table Select All` to
 * whatever guard is named here, and both sit above `/:id` so "bulk" is never read as an id.
 */
mountBulkDelete(router, { path: "/mine/bulk", guard: canSubmit, deleteOne: (id, req) => controller.deleteSpeakUpRecord(req, id, { own: true }), noun: "Speak-up" });
mountBulkDelete(router, { guard: canDecide, deleteOne: (id, req) => controller.deleteSpeakUpRecord(req, id), noun: "Speak-up" });

router.post("/", canSubmit, controller.create);
router.get("/mine", canReadMine, controller.mine);
router.get("/", canReview, controller.all);
router.get("/assignees", canDecide, controller.assignees);
router.post("/:id/review", canDecide, controller.review);
router.get("/:id/attachment", canOpenAttachment, controller.attachment);

module.exports = router;
