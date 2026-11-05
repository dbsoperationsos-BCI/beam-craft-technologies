const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule, checkPermission } = require("../../../middleware/permissionMiddleware");
const controller = require("./controller");
// One action on a candidate that belongs to the invites module: reopening the application form they
// already submitted. Routed here rather than under `/invites`, because what the screen asking holds
// is the candidate's record and not a form id - the same way the Employee Repository's Send Back is
// a route on the employee while its handler lives with the onboarding invites.
const { resendSubmittedForm } = require("./invites");

const router = express.Router();
router.use(protect);
/*
 * One permission for the whole screen: `HRM / Interview` opens the register, and Read / Write on it
 * is what adding, editing, importing and deleting a candidate need. A GET reads, anything else
 * writes, and a route added here later is covered the moment it is written. The same pair guards
 * the application invites (`inviteRoutes.js`), the linked sheets (`sheetLinksRoutes.js`) and the
 * Google connection (`googleOAuthRoutes.js`) beside this.
 */
router.use(requireModule("HRM", "Interview"));

/*
 * One more permission on top of the screen's own, for what a **selection** does.
 *
 * `HRM / Interview Select All` Read / Write, carved out of `HRM / Interview` the way
 * `SALES / CRM Lead Select All` was carved out of the board beside it: working the register one
 * candidate at a time and acting on a whole stage at once are different jobs. The tick boxes change
 * nothing by themselves - what they lead to is a write over a set the reader never has to look at,
 * a stage moved across every candidate ticked or a delete that takes them all - so the guard is on
 * what the selection *does*, not on the boxes.
 *
 * It is the only thing deciding this: there is no role test below it, so a Super Admin passes
 * without being named and the studio hands it out from Role Management. The single-candidate routes
 * below deliberately keep the screen's own Read / Write, which is how somebody without this still
 * moves and deletes a candidate - one at a time, by name.
 */
const canSelectCandidates = checkPermission("HRM", "Interview Select All", "READ_WRITE");

// The static routes stay above `/candidates/:id`, or "options" would be read as a candidate id.
router.get("/options", controller.options);
/*
 * Who a Meet can be sent to: every working employee, with the address an invite belongs on.
 *
 * **A notch tighter than the router's own guard**, which would let any `HRM / Interview` Read serve
 * this - and the roster with everyone's work email in it is not something reading the register needs.
 * Only somebody actually booking an interview needs a guest list, so it asks for the Read / Write
 * that scheduling already needs. That is also why the option payload above does not carry it; see
 * `service.meetGuests`.
 */
router.get("/meet-guests", checkPermission("HRM", "Interview", "READ_WRITE"), controller.meetGuestOptions);
// The CSV import, on the two paths every module's import answers at (`services/tableImport.js`).
router.get("/import/template", controller.importTemplate);
router.post("/import", controller.importRows);
router.get("/candidates", controller.list);
// Before `/candidates/:id`, or "ids" is read as a candidate's id and answers 404.
router.get("/candidates/ids", controller.ids);
// Also above `/candidates/:id`, for the reason the two lines above it are.
router.get("/candidates/column-values", controller.columnValues);
// And this one: what the form asks as a number is typed, so it warns under the field rather than
// refusing a record somebody has finished filling in.
router.get("/candidates/duplicates", controller.duplicates);
router.post("/candidates", controller.create);
// Bulk Entry's batch. A fixed segment, so above `/:id`.
router.post("/candidates/bulk", controller.createBulk);
/*
 * What the tick boxes lead to, both fixed segments and so both above `/:id` - `bulk-status` read as
 * a candidate id would be a 404 that looked like a missing record rather than a route in the wrong
 * order. `POST /candidates/bulk` above keeps the screen's own Read / Write: typing a few candidates
 * into Bulk Entry is adding candidates, which is the job `HRM / Interview` is granted for.
 */
router.post("/candidates/bulk-status", canSelectCandidates, controller.bulkStatus);
router.delete("/candidates/bulk", canSelectCandidates, controller.removeBulk);
router.get("/candidates/:id", controller.get);
router.put("/candidates/:id", controller.update);
// The stage on its own, for a row menu that holds a table row rather than a form. A PATCH, so the
// router's own guard asks for Read / Write exactly as it does for the full update.
router.patch("/candidates/:id/status", controller.setStatus);
/*
 * Resend: reopen the application this candidate already submitted and email them their own link
 * again, so they correct what they typed rather than being asked for all of it a second time. A
 * POST, so the router's guard asks for Read / Write - it moves the candidate's stage and sends
 * them a mail, which is not a read by any reading.
 */
router.post("/candidates/:id/resend-form", resendSubmittedForm);
/*
 * Putting a round in the diary: the round written, the stage moved to Interview Scheduled, and the
 * Google Meet created or moved - one act, so a calendar Google refuses records no interview at all.
 * A POST, so the router's guard asks for Read / Write, which is right twice over: it writes the
 * register and it books a conference on the caller's own calendar. See `controller.schedule`.
 */
router.post("/candidates/:id/schedule", controller.schedule);
router.delete("/candidates/:id", controller.remove);

module.exports = router;
