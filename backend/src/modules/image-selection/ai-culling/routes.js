const express = require("express");
const { requireWorkspaceAccess } = require("../projects/modules");
const { requireProjectLink } = require("../projects/moduleLinks");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { requireProjectEnabled } = require("../projectEnabled");
const { gate, desktopAiEnabled, ingestLimiter } = require("../../desktop/flags");
const { recordViews, getOverview, startSession, getSession, cancelSession, listResults, listGroups, getGroup, setDecision, bulkDecision, setGroupBest, finalizeSession, reopenSession, streamSession, listPending, ingestSignals, runSession, listPeople, setPersonRole, getPreferences, setPreferences, resetPreferences, updateSession, sendKeepsToPhotoSelection } = require("./controller");

const router = express.Router({ mergeParams: true });
router.use(protect);
// AI Culling is a module of its own: its own permission runs it, for a project in AI Culling - a GET
// needs Read, starting, deciding, finalizing or cancelling a run needs Read / Write. Photo
// Selection's permission no longer opens culling, and AI Culling's is all a culler needs.
router.use(requireWorkspaceAccess(["culling"]));
router.get("/", getOverview);
// The project's people (the People filter's clusters). The role PATCH is kept for older desktop
// builds only: it is stored, and no culling run reads it. Reading needs Read, labelling Read / Write.
router.get("/people", listPeople);
router.patch("/people/:personId", setPersonRole);
// The signed-in photographer's own learned preferences (Phase 8): reading needs Read, the switch
// and the reset Read / Write. Always the caller's own — the user comes from the token, never a param.
router.get("/preferences", getPreferences);
router.patch("/preferences", setPreferences);
router.post("/preferences/reset", resetPreferences);
router.post("/sessions", startSession);
// The desktop hand-off: what is still unanalyzed and the numbers coming back. Behind the same
// DESKTOP_AI_ENABLED switch as the face hand-off — a plain 404 while off. `run` stays open to
// every app: it is also the "let the server finish" fallback for a waiting desktop run.
router.get("/sessions/:sessionId/pending", gate(desktopAiEnabled), ingestLimiter, listPending);
router.post("/sessions/:sessionId/signals", gate(desktopAiEnabled), ingestLimiter, ingestSignals);
router.post("/sessions/:sessionId/run", runSession);
// The mode of a run that is still waiting - for its photos (a run that began with the import) or for its workstation.
router.patch("/sessions/:sessionId", updateSession);
router.get("/sessions/:sessionId", getSession);
router.get("/sessions/:sessionId/events", streamSession);
router.get("/sessions/:sessionId/results", listResults);
router.patch("/sessions/:sessionId/results/:resultId/decision", setDecision);
router.post("/sessions/:sessionId/decisions", bulkDecision);
// Photos seen or opened during review, batched by the app: training-label quality only.
router.post("/sessions/:sessionId/views", recordViews);
router.get("/sessions/:sessionId/groups", listGroups);
router.get("/sessions/:sessionId/groups/:groupId", getGroup);
router.post("/sessions/:sessionId/groups/:groupId/best", setGroupBest);
router.post("/sessions/:sessionId/finalize", finalizeSession);
// A finalized run's Keeps straight to Photo Selection - a write into Photo Selection, so the
// module's Read / Write (the same permission AI Editing's own send asks for).
// Only into a Photo Selection the project is linked to (projects/modules.js).
// Writing into Photo Selection also needs its own Read / Write.
router.post("/sessions/:sessionId/send-to-photo-selection", checkPermission("IMAGE_SELECTION", "Project Management", "READ_WRITE"), requireProjectEnabled, requireProjectLink([["culling", "photos"]]), sendKeepsToPhotoSelection);
router.post("/sessions/:sessionId/reopen", reopenSession);
router.post("/sessions/:sessionId/cancel", cancelSession);

module.exports = router;
