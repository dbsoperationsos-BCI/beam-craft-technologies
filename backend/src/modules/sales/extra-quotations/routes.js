const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * Extra quotations answer for PROJECT / Projects: an extra is a change to what a project is selling,
 * so it belongs to the screen that plans the project rather than to Accounts.
 *
 * The permission decides who may raise one and who may see them. Who may *decide* one is a narrower
 * question the controller answers for itself — the manager named on that project, or a super admin —
 * because holding the module permission is not the same as running that particular project.
 */
router.use(requireModule("PROJECT", "Projects"));
// Keep this static route above the identifier routes below it.
router.get("/options", controller.options);
// The two long pickers, searched on the server - `options` carries only a page to open on.
router.get("/projects", controller.searchProjectOptions);
router.get("/shoots", controller.searchShootOptions);
router.get("/", controller.listExtras);
router.post("/", controller.createExtra);
// Correcting one is an ordinary edit and stays a PATCH; only a decision is its own verb below.
router.patch("/:id", controller.updateExtra);
// Deciding is its own verb rather than a status field on a PATCH: rejecting demands a reason, and
// neither decision is an edit the person who raised it could have made.
router.post("/:id/approve", controller.approveExtra);
router.post("/:id/reject", controller.rejectExtra);
router.delete("/:id", controller.withdrawExtra);

module.exports = router;
