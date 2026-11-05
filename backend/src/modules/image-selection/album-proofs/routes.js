const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission, checkAnyPermission } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");
const projects = require("./projects.controller");
// The upload dock is Image Selection's; it is mounted here a second time, under this module's own
// grant, so an album page never needs the Project Management permission. Optional for the same
// reason server.js treats it as optional: a checkout without the uploads module still boots.
let createUploadsRouter = null;
try { ({ createUploadsRouter } = require("../uploads/routes")); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }

/**
 * Album Proofing's own permission surface, seeded in iam-roles-permissions.js:
 *  - IMAGE_SELECTION / "Album Proofing"     — admins and designers running the workflow
 *  - IMAGE_SELECTION / "Album Proofing QC"  — QC leads reviewing and deciding
 * Reading is open to either role; the write guards below are per responsibility, and QC decision
 * routes (later phases) demand the QC feature specifically. No hardcoded users anywhere.
 */
const READ_ANY = checkAnyPermission([
  { module: "IMAGE_SELECTION", feature: "Album Proofing", level: "READ" },
  { module: "IMAGE_SELECTION", feature: "Album Proofing QC", level: "READ" },
]);
const WRITE = checkPermission("IMAGE_SELECTION", "Album Proofing", "READ_WRITE");
const QC_WRITE = checkPermission("IMAGE_SELECTION", "Album Proofing QC", "READ_WRITE");

const router = express.Router();
router.use(protect);

// Album Proofing's own projects — the sidebar list, New Project, edit, archive and delete — ahead
// of the album routes so "projects" is never read as an album id. Image Selection's project
// routes know nothing about these rows and cannot reach them.
router.get("/projects", READ_ANY, projects.listProjects);
router.post("/projects", WRITE, projects.createProject);
router.patch("/projects/:projectId", WRITE, projects.editProject);
router.delete("/projects/:projectId", WRITE, projects.deleteProject);
router.post("/projects/:projectId/archive", WRITE, projects.archiveProject);
router.post("/projects/:projectId/restore", WRITE, projects.restoreProject);
// Album pages arrive through the upload dock mounted under this module: a read needs READ on
// either album grant, everything else the Album Proofing write.
if (createUploadsRouter) router.use("/projects/:projectId/uploads", createUploadsRouter((req, res, next) => (req.method === "GET" || req.method === "HEAD" ? READ_ANY : WRITE)(req, res, next)));

router.get("/", READ_ANY, controller.listAlbums);
router.post("/", WRITE, controller.createAlbum);
router.get("/activity", READ_ANY, controller.listActivity);
// The dashboard summarises what the list above answers, under the same grant; declared ahead of
// the album-id routes so "dashboard" is never read as an album id.
router.get("/dashboard", READ_ANY, controller.dashboard);
router.get("/:albumId", READ_ANY, controller.getAlbum);
router.patch("/:albumId", WRITE, controller.editAlbum);
router.delete("/:albumId", WRITE, controller.deleteAlbum);
router.post("/:albumId/archive", WRITE, controller.archiveAlbum);
router.post("/:albumId/restore", WRITE, controller.restoreAlbum);

router.get("/:albumId/folders", READ_ANY, controller.folderTree);
router.post("/:albumId/folders", WRITE, controller.createFolder);
router.patch("/:albumId/folders/:folderId", WRITE, controller.renameFolder);
router.delete("/:albumId/folders/:folderId", WRITE, controller.deleteFolder);

// Import and the processing pipeline. Browsing the storage path is a write-permission action —
// it maps the studio's drive layout, which is nobody else's business.
router.get("/:albumId/browse-originals", WRITE, controller.browseOriginals);
router.post("/:albumId/import", WRITE, controller.importPages);
// The upload dock posts each page's derivatives to the uploads router; this is the album-level
// half of that arrival, recording the import and moving the album on.
router.post("/:albumId/pages-uploaded", WRITE, controller.pagesUploaded);
router.get("/:albumId/processing", READ_ANY, controller.processingStatus);
router.post("/:albumId/retry-failed", WRITE, controller.retryFailed);
router.get("/:albumId/pages", READ_ANY, controller.listPages);
router.post("/:albumId/send-to-qc", WRITE, controller.sendToQc);

// QC review and the correction engine. Ruling — pins, request-changes, approve, reopen — demands
// the QC permission specifically; working the fixes is the admin/designer grant.
router.get("/:albumId/version", READ_ANY, controller.currentVersion);
router.get("/:albumId/versions/:versionId", READ_ANY, controller.versionDetail);
router.get("/:albumId/corrections", READ_ANY, controller.listCorrections);
router.post("/:albumId/qc/corrections", QC_WRITE, controller.addQcCorrection);
// Until the ruling is sent, QC's pins are drafts: reword, move or remove — the QC grant alone.
router.patch("/:albumId/qc/corrections/:correctionId", QC_WRITE, controller.editQcCorrection);
router.delete("/:albumId/qc/corrections/:correctionId", QC_WRITE, controller.deleteQcCorrection);
router.post("/:albumId/qc/request-changes", QC_WRITE, controller.qcRequestChanges);
router.post("/:albumId/qc/approve", QC_WRITE, controller.qcApprove);
router.post("/:albumId/corrections/:correctionId/reopen", QC_WRITE, controller.reopenCorrection);
router.post("/:albumId/qc/start-fixes", WRITE, controller.startFixes);
router.patch("/:albumId/corrections/:correctionId", WRITE, controller.updateCorrection);
router.post("/:albumId/reprocess", WRITE, controller.reprocessPages);
// The corrected spreads have been uploaded: freeze them as the next version. This is the only
// route that creates a version out of a correction round — resubmit below merely sends it.
router.post("/:albumId/revised-version", WRITE, controller.createRevisedVersion);
router.post("/:albumId/resubmit-qc", WRITE, controller.resubmitToQc);

// Client publication. Revealing credentials is a write action by design; granting an extra
// revision round is audited and never resets the used count.
router.post("/:albumId/publish", WRITE, controller.publishToClient);
router.get("/:albumId/publication", READ_ANY, controller.publicationInfo);
router.post("/:albumId/publication/reveal", WRITE, controller.revealPublication);
router.post("/:albumId/publication/reset-pin", WRITE, controller.resetPublicationPin);
router.patch("/:albumId/publication/expiry", WRITE, controller.updatePublicationExpiry);
router.post("/:albumId/publication/revoke", WRITE, controller.revokePublication);
router.post("/:albumId/grant-revision", WRITE, controller.grantRevision);

// The revision loop's staff transitions, the audited reopen, completion, and the final copy of
// originals by their paths — the download never touches R2 proofs.
router.post("/:albumId/start-revision", WRITE, controller.startRevision);
router.post("/:albumId/revision-ready", WRITE, controller.markRevisionReady);
router.post("/:albumId/reopen", WRITE, controller.reopenApproved);
router.post("/:albumId/complete", WRITE, controller.completeAlbum);
router.post("/:albumId/download-final", WRITE, controller.downloadFinal);

module.exports = router;
