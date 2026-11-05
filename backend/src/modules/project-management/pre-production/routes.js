const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule, checkPermission } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");
const { handlerFor } = require("../departmentStatus");
const { logAfterSuccess } = require("../../../services/projectActivity");
const preProductionImport = require("./import");
const { setGiftStatus } = require("../client-gifts/controller");
const clientStorage = require("../../assets/client-storage.controller");

const router = express.Router();
router.use(protect);

/*
 * The pre production board answers for PROJECT / Pre Production, the permission the four board
 * routes already sit behind.
 *
 * `requireModule` reads GET at READ and everything else at READ_WRITE, which is exactly the split
 * this screen wants: anyone who may see the board may see it, and only somebody granted READ_WRITE
 * may fill a row in. It also covers any route added below later, the moment it is written.
 *
 * Nothing here can reach the sale. The project's own columns are read through the row's links and
 * returned read-only, except the General items below; changing a coordinator, a shoot or a
 * deliverable is still PROJECT / Projects' and still lives on the sales router.
 */
router.use(requireModule("PROJECT", "Pre Production"));

/*
 * Import, one template per vertical. It creates bookings and shoots as well as filling pre
 * production in, so on top of this router's Pre Production (READ_WRITE for the POST) it answers to
 * SALES / Sales Manager write - the permission `POST /api/sales/projects/import` already asks to
 * create a booking. Neither alone is enough.
 */
const salesManagerWrite = checkPermission("SALES", "Sales Manager", "READ_WRITE");
router.get("/vertical/:vertical/import/template", salesManagerWrite, preProductionImport.importTemplate);
router.post("/vertical/:vertical/import", salesManagerWrite, preProductionImport.importPreProduction);

// Above `/:shootId`, or the word "options" is read as a shoot id.
router.get("/options", controller.listOptions);
router.get("/rows", controller.listRows);
// A project's Activity tab on Pre Production.
router.get("/projects/:projectId/activity", controller.listProjectActivity);
// Under `/projects/…`, so they never collide with the single-segment shoot route below. Follow-ups
// belong to the project, not to any one of its shoots.
router.post("/projects/:projectId/followups", controller.addProjectFollowup);
router.patch("/projects/:projectId/followups/:followupId/done", controller.completeProjectFollowup);
// A pending follow-up's date or remarks corrected, or the follow-up removed - Read / Write, through
// the router's own guard.
router.patch("/projects/:projectId/followups/:followupId", controller.updateProjectFollowup);
router.delete("/projects/:projectId/followups/:followupId", controller.deleteProjectFollowup);
/*
 * The General panel. Whoever may write this screen may change what it shows, so its items save here
 * under `PROJECT / Pre Production` rather than under Projects, Client Gifts and Client Storage. Each
 * route reuses that module's own handler, which scopes the project or the disk by `req.permission` -
 * this router's permission - so a caller reaches only the projects this screen reaches.
 */
router.patch("/projects/:projectId/general", controller.saveGeneral);
// The project's WhatsApp group, picked from the caller's own paired WhatsApp. Under PROJECT /
// Pre Production like the rest of General: reading the list needs READ, linking READ_WRITE.
router.get("/projects/:projectId/whatsapp-groups", controller.listWhatsappGroups);
router.patch("/projects/:projectId/whatsapp-group", logAfterSuccess({ area: "PRE_PRODUCTION", action: "WHATSAPP_LINKED", describe: () => "WhatsApp group linked" }), controller.linkWhatsappGroup);
router.patch("/projects/:projectId/whatsapp-group/invite-link", logAfterSuccess({ area: "PRE_PRODUCTION", action: "WHATSAPP_INVITE_LINK", describe: () => "WhatsApp group invite link saved" }), controller.saveWhatsappInviteLink);
router.post("/projects/:projectId/whatsapp-group/auto", logAfterSuccess({ area: "PRE_PRODUCTION", action: "WHATSAPP_LINKED", describe: () => "WhatsApp group linked automatically" }), controller.autoLinkWhatsappGroup);
router.patch("/projects/:projectId/gifts/:gift/status", logAfterSuccess({ area: "PRE_PRODUCTION", action: "GIFT_STATUS_CHANGED", describe: (req) => [`${req.params.gift === "welcome" ? "Welcome" : "Shoot completed"} gift`, req.body?.status && `set to ${req.body.status}`].filter(Boolean).join(" ") }), setGiftStatus);
/*
 * The project's hard disk, read-only.
 *
 * This board does not run the Client Storage flow. It sets one status and sets it from the shoot: a
 * coordinator answering Hard Disk: Handed Over moves that shoot's record from "Yet to Receive" to
 * "Yet to Start" (`startStorageForHandover`), and the eight-status journey from there belongs to
 * Client Storage and its own permission. The status route that used to sit here let anybody with
 * Pre Production write make any move on it, which is the rule this board is not allowed to make.
 */
router.get("/projects/:projectId/storage/:storageId", controller.storageOfProject, clientStorage.get);
// The shoot's pre production status set by hand (WCR / Hold / Rejected), above the row's own save.
// The project's overall Pre Production status, set by hand for one or several projects - never a shoot.
router.post("/project-status", handlerFor("preProduction"));
router.patch("/:shootId/status", controller.setShootStatus);
// The shoot's details, sent to the client's app to fill in, and what they have filled in so far.
router.post("/:shootId/send-to-client", controller.sendToClient);
router.get("/:shootId/client-form", controller.clientForm);
router.get("/:shootId/client-files/:fileId", controller.downloadClientFile);
// The shoot's whole pre production form as a PDF.
router.get("/:shootId/form-pdf", controller.downloadFormPdf);
router.patch("/:shootId", controller.updateRow);

module.exports = router;
