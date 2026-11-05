const express = require("express");
const multer = require("multer");
const { protect } = require("../../../middleware/authMiddleware");
const { moveVertical, list, branches, getOne, duplicates, projects, listTableSettings, saveTableSettings, meetings, scheduleMeeting, removeMeeting, page, ids, columnValues, activity, callLogs, leadTranscripts, transcriptDetail, version, bulkStatus, bulkAssign, importCsv, cancelImportCsv, create, createBulk, update, remove, removeBulk, renameGroup, refresh, uploadRemarkAttachment, remarkAttachment } = require("./controller");
const { requireModule, checkPermission } = require("../../../middleware/permissionMiddleware");
const excluded = require("./excludedNumbersController");

// Held in memory and handed straight to R2 - the file is never written to this server's disk.
// 25MB is generous for a note's attachment and far below what would hurt to hold briefly.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 8 },
});

const router = express.Router();
router.use(protect);
// Every route here answers for SALES / CRM Leads: a GET needs Read, anything else Read / Write.
router.use(requireModule("SALES", "CRM Leads"));

/*
 * Deleting a lead asks for a second permission on top of the board's own.
 *
 * `SALES / CRM Lead Deletion` Read / Write, and it is deliberately not held by the roles that run
 * the CRM: a delete takes the lead, its remarks, its call logs and its follow-up history with it and
 * nothing brings them back, while the board offers a select-all over a whole vertical. This guard is
 * the only thing deciding it - there is no role test below it - so a Super Admin passes without
 * being named and the studio hands it out from Role Management.
 *
 * Both delete routes mount it, not just the bulk one. Gating the selection alone would leave the
 * same act available a row at a time through the row menu, which is not a guard.
 */
const canDeleteLeads = checkPermission("SALES", "CRM Lead Deletion", "READ_WRITE");
/*
 * Two more permissions on top of the board's own, carved out for the same reason deletion was - the
 * catalogue entries beside `CRM Lead Deletion` say why.
 *
 * `SALES / CRM Lead Select All` guards what a selection *does* rather than the ticking of the boxes:
 * a bulk status change, a bulk reassignment, a bulk delete. It deliberately does not guard
 * `GET /ids`, which is what resolves a whole-board selection into ids - the Quotation Generator
 * reads that same route to fill its Enquire ID picker, and a screen may not be given a finer
 * permission than the endpoint it shares with another (CLAUDE.md Rule 4). Ids are rows the caller
 * may already read; rewriting them all at once is the privileged act, and that is these three.
 *
 * `SALES / CRM Lead Import` guards the CSV alone. Bulk Entry (`POST /bulk`) stays on the board's own
 * Read / Write, because typing a handful of leads is adding leads.
 */
const canSelectLeads = checkPermission("SALES", "CRM Lead Select All", "READ_WRITE");
const canImportLeads = checkPermission("SALES", "CRM Lead Import", "READ_WRITE");
// Remark attachments. Above the ":id" routes, which would otherwise swallow them.
router.post("/remark-attachments", upload.single("file"), uploadRemarkAttachment);
router.get("/remark-attachments", remarkAttachment);
router.get("/", list);
router.get("/table-settings", listTableSettings);
// The branches Assigned Branch offers. A fixed segment, so it sits above the ":id" routes.
router.get("/branches", branches);
/*
 * Settings -> Exclude Phone Numbers: the numbers that must never become a lead.
 *
 * All of them above the ":id" routes, which would otherwise read "excluded-numbers" as a lead id.
 * `/bulk` is above `/:id` for the same reason one level down - it is a fixed segment, not an id.
 */
router.get("/excluded-numbers", excluded.list);
router.post("/excluded-numbers", excluded.create);
router.post("/excluded-numbers/import", excluded.importNumbers);
router.delete("/excluded-numbers/bulk", excluded.removeBulk);
router.put("/excluded-numbers/:id", excluded.update);
router.delete("/excluded-numbers/:id", excluded.remove);
// Keep above any ":id" route.
router.get("/version", version);
router.get("/page", page);
/*
 * What one filter dropdown offers: the values that column holds on the tab being read.
 *
 * Beside `/page` and guarded like it - the board's own permission, the board's own data scope - and
 * for the same reason: these are values off the rows this caller is already being served. A fixed
 * segment, so it stays above the ":id" routes.
 */
router.get("/column-values", columnValues);
router.get("/ids", ids);
router.get("/duplicates", duplicates);
router.post("/", create);
router.post("/bulk", createBulk);
router.post("/import-csv", canImportLeads, importCsv);
router.post("/import-csv/:batchId/cancel", canImportLeads, cancelImportCsv);
router.post("/bulk-status", canSelectLeads, bulkStatus);
router.post("/bulk-assign", canSelectLeads, bulkAssign);
router.post("/refresh", refresh);
router.put("/table-settings", saveTableSettings);
// Both guards, in that order: a delete over a selection is a selection first and a delete second,
// and a role holding only one of the two may do neither. The single delete below keeps deletion
// alone, which is how somebody without Select All still removes a lead - one at a time, by name.
router.delete("/bulk", canSelectLeads, canDeleteLeads, removeBulk);
router.patch("/groups/:groupId", renameGroup);
router.get("/:id/activity", activity);
router.get("/:id/call-logs", callLogs);
router.get("/:id/transcripts", leadTranscripts);
// Above the ":id" routes would be wrong - these are transcript ids, not lead ids, and the prefix
// keeps the two apart.
router.get("/transcripts/:transcriptId", transcriptDetail);
router.get("/:id/projects", projects);
router.get("/:id/meetings", meetings);
router.post("/:id/meetings", scheduleMeeting);
router.delete("/:id/meetings/:meetingId", removeMeeting);
router.get("/:id", getOne);
router.put("/:id", update);
// One lead to another vertical, from its popup - on the board's own Read / Write, as an edit is.
router.post("/:id/vertical", moveVertical);
router.delete("/:id", canDeleteLeads, remove);

module.exports = router;
