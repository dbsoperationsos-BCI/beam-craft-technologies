const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { listBranches, createBranch, updateBranch } = require("./controller");

const router = express.Router();

router.use(protect);
/*
 * ADMIN / System Settings, for the whole router: a GET needs Read, anything else Read / Write.
 *
 * The same permission the rest of Settings answers to, and the same one that decides whether the
 * Organization section is offered at all — so the screen and the endpoint behind it cannot disagree.
 * Mounted on the router rather than per route, so a route added here later is guarded the moment
 * it is written.
 *
 * This is not the read that feeds a branch *picker*: `GET /api/hrm/branches` already does that for
 * every signed-in user, and is what Role Management, User Management, Assets and the rest read.
 * Keeping the register's own endpoints separate is what lets managing branches be an administrator's
 * job while choosing one stays everybody's.
 */
router.use(requireModule("SETTINGS", "Organization"));

router.get("/", listBranches);
router.post("/", createBranch);
router.patch("/:id", updateBranch);

// There is no delete. A branch is taken out of use by disabling it - `PATCH { isActive: false }` -
// because everything that points at one, from a user's home branch to a year of quotations, has to
// go on pointing at it and stay readable.

module.exports = router;
