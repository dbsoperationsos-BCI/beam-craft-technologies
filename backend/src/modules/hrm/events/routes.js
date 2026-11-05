const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { listEvents, createEvent, deleteEvent, downloadEvent } = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * `HRM / Events` at Read is the whole of it: anybody who can open the page can see the events and
 * post one of their own - it is the studio's shared wall, not an HR noticeboard. Removing is still
 * decided per event in the controller: only the person who posted it, or an administrator.
 */
const canUseEvents = checkPermission("HRM", "Events", "READ");
/*
 * Taking an event's photos away is its own permission, granted in Role Management apart from seeing
 * them: Read is enough, as a download changes nothing. Asked after `HRM / Events`, so it never opens
 * an event to somebody who could not see the wall.
 */
const canDownloadEvents = checkPermission("HRM", "Event Download", "READ");

router.get("/", canUseEvents, listEvents);
router.post("/", canUseEvents, createEvent);
router.get("/:id/download", canUseEvents, canDownloadEvents, downloadEvent);
router.delete("/:id", canUseEvents, deleteEvent);

module.exports = router;
