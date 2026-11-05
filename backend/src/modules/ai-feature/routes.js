const express = require("express");
const { protect } = require("../../middleware/authMiddleware");
const { requireModule, checkPermission } = require("../../middleware/permissionMiddleware");
const { MODULE, FEATURE, FACE_FEATURE } = require("./shared/permissions");
const { gate, desktopAiEnabled, ingestLimiter } = require("../desktop/flags");
const events = require("./events/controller");
const subEvents = require("./sub-events/controller");
const guests = require("./guests/controller");
const media = require("./media/controller");
const people = require("./people/controller");
const matches = require("./matches/controller");
const share = require("./share/controller");
const activity = require("./activity/controller");
const overview = require("./overview/controller");

/**
 * Everything under /api/ai-feature that a signed-in member of staff calls. The whole router answers
 * for IMAGE_SELECTION / AI Feature - a GET needs Read, anything else Read / Write - and the People
 * and match routes ask for AI Face Management on top, because deciding whose face is whose is a
 * different job from running the event. The defaults live on their own router with their own
 * permission (`default-settings/routes.js`), and the guest surface on `public/routes.js`.
 */
const router = express.Router();
router.use(protect);
router.use(requireModule(MODULE, FEATURE));

router.get("/overview", overview.getOverview);
router.get("/overview/activity", overview.getRecentActivity);

router.get("/events", events.listEvents);
router.post("/events", events.createEvent);
router.get("/events/:eventId", events.getEvent);
router.patch("/events/:eventId", events.updateEvent);
router.delete("/events/:eventId", events.deleteEvent);
router.post("/events/:eventId/duplicate", events.duplicateEvent);
router.post("/events/:eventId/archive", events.archiveEvent);
router.post("/events/:eventId/restore", events.restoreEvent);
router.get("/events/:eventId/settings", events.getSettings);
router.put("/events/:eventId/settings", events.saveSettings);
router.get("/events/:eventId/activity", activity.listActivity);
router.get("/events/:eventId/detection", overview.getEventDetection);

router.get("/events/:eventId/sub-events", subEvents.listSubEvents);
router.post("/events/:eventId/sub-events", subEvents.createSubEvent);
router.put("/events/:eventId/sub-events/reorder", subEvents.reorderSubEvents);
router.patch("/events/:eventId/sub-events/:subEventId", subEvents.updateSubEvent);
router.delete("/events/:eventId/sub-events/:subEventId", subEvents.deleteSubEvent);

router.get("/events/:eventId/guests", guests.listGuests);
router.post("/events/:eventId/guests", guests.createGuest);
router.post("/events/:eventId/guests/import", guests.importGuests);
router.patch("/events/:eventId/guests/:guestId", guests.updateGuest);
router.delete("/events/:eventId/guests/:guestId", guests.deleteGuest);
router.get("/events/:eventId/guest-groups", guests.listGroups);
router.post("/events/:eventId/guest-groups", guests.createGroup);
router.patch("/events/:eventId/guest-groups/:groupId", guests.updateGroup);
router.delete("/events/:eventId/guest-groups/:groupId", guests.deleteGroup);

router.get("/events/:eventId/folders", media.listFolders);
router.post("/events/:eventId/folders", media.createFolder);
router.patch("/events/:eventId/folders/:folderId", media.updateFolder);
router.delete("/events/:eventId/folders/:folderId", media.deleteFolder);
router.get("/events/:eventId/media", media.listMedia);
router.post("/events/:eventId/media/upload", media.uploadMedia);
router.post("/events/:eventId/media/batch", media.noteBatch);
router.get("/events/:eventId/media/:mediaId", media.getMedia);
router.delete("/events/:eventId/media/:mediaId", media.deleteMedia);
router.get("/events/:eventId/processing", media.getProcessing);

router.get("/events/:eventId/share", share.getShare);
router.get("/events/:eventId/share/poster", share.getSharePoster);
router.post("/events/:eventId/share", share.createShare);
router.patch("/events/:eventId/share", share.updateShare);
router.delete("/events/:eventId/share", share.revokeShare);

// Faces and people: Read on AI Face Management to look, Read / Write to decide. Retrying failed
// processing sits here too - it is a face-pipeline decision, not an upload.
const faceRead = checkPermission(MODULE, FACE_FEATURE, "READ");
const faceWrite = checkPermission(MODULE, FACE_FEATURE, "READ_WRITE");
router.post("/events/:eventId/processing/retry-failed", faceWrite, media.retryFailed);
// The Virtual Curation desktop's hand-off of one photo's faces, found with this server's own engine
// on the original. A face-pipeline write like retry-failed, so AI Face Management Read / Write; the
// gate keeps the path a 404 until both desktop switches (DESKTOP_VIRTUAL_CURATION_ENABLED,
// DESKTOP_AI_ENABLED) are on - before the permission, so a switched-off server answers exactly as
// it did when the route did not exist.
router.post("/events/:eventId/media/:mediaId/faces", gate(desktopAiEnabled), ingestLimiter, faceWrite, media.ingestFaces);
router.get("/events/:eventId/faces/:faceId/thumbnail", faceRead, media.faceThumbnail);
router.get("/events/:eventId/people", faceRead, people.listPeople);
router.get("/events/:eventId/people/:personId", faceRead, people.getPerson);
router.patch("/events/:eventId/people/:personId", faceWrite, people.renamePerson);
router.post("/events/:eventId/people/:personId/hide", faceWrite, people.hidePerson);
router.post("/events/:eventId/people/:personId/merge", faceWrite, people.mergePeople);
router.post("/events/:eventId/people/:personId/split", faceWrite, people.splitPerson);
router.post("/events/:eventId/people/:personId/link-guest", faceWrite, people.linkPerson);
router.get("/events/:eventId/matches", faceRead, matches.listMatches);
router.patch("/events/:eventId/matches/:matchId", faceWrite, matches.decideMatch);

module.exports = router;
