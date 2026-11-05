const express = require("express");
const { protect } = require("../../middleware/authMiddleware");
const controller = require("./controller");

const router = express.Router();

/*
 * ── The bell: signed in at the door, and gated per source inside ──────────────────────────────
 *
 * The bell hangs off the topbar, which is on every screen, so the only thing this router can
 * require of a caller is that they are signed in. What they are actually *told* is decided one
 * source at a time in the controller, against that source's own module permission - which is what
 * stops the bell being a way around the guard on the module a notice is about.
 *
 * That includes the stored task notifications, which this router used to gate on
 * `HRM / Task Management` for the whole endpoint. The reasoning was right and the placement was
 * not: it was true that only Tasks wrote notifications, and it stopped being true the moment the
 * bell also carried follow-ups, WhatsApp replies, unread calls and asset approvals. Left here, a
 * role with the CRM and no Tasks would have had every one of its own notices refused - 403 on the
 * topbar of every screen in the application, which is worse than no bell at all.
 *
 * So the guard moved inward rather than away. `HRM / Task Management` still decides the task rows,
 * and each other module decides its own; a role that holds none of them gets an empty bell, which
 * is the honest answer and the one case the panel names.
 *
 * Marking read is a POST that only ever touches the caller's own rows - scoped to `req.user.id` in
 * the query itself, with no request shape that names somebody else's - so it is not a write that
 * needs READ_WRITE anywhere.
 */
router.use(protect);

router.get("/", controller.list);
router.post("/read-all", controller.markAllRead);
router.post("/:id/read", controller.markRead);

module.exports = router;
