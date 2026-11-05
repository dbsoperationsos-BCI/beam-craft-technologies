const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermissions, requireModule } = require("../../../middleware/permissionMiddleware");
const iamService = require("../../../services/iam.service");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const controller = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * Two permissions, because the screen asks two different questions.
 *
 * `HRM / Task Management` is the screen itself: My Tasks, Tasks Given, giving a task, and finishing
 * or sending back one of your own. It is meant to be granted to every role - anybody in the studio
 * may ask anybody else to do something - and READ_WRITE is the ordinary grant, since a role that
 * could be given work but could not say it had done the work would be worse than no access at all.
 *
 * `HRM / All Tasks` is reading the whole studio's list, which is a supervisor's question rather
 * than the same one asked more widely. It has its own endpoint below rather than a wider answer
 * from the shared one, because a screen may never be given a finer permission than the endpoint it
 * reads: had All Tasks been a tab over the same list route, everybody holding Task Management would
 * have been served every task in the studio and the tab would have been decoration.
 *
 * Ownership - who may complete a task, who may cancel one - is decided in the service against the
 * signed-in user's id, never against `req.user.role`. A role check inside a controller sits below
 * the guard above it, silently overrules it, and cannot be granted to anybody.
 */

// Ahead of the router-wide guard, so it answers for its own permission rather than for the
// screen's. Both are required: All Tasks widens the Tasks screen, it is not a way around it.
router.get(
  "/all",
  checkPermissions([
    { module: "HRM", feature: "Task Management", level: "READ" },
    { module: "HRM", feature: "All Tasks", level: "READ" },
  ]),
  controller.listAll,
);

// Everything else: a GET reads, anything else writes, and a route added here later is covered the
// moment it is written.
router.use(requireModule("HRM", "Task Management"));

/**
 * Whether this reader may open a task they are neither side of.
 *
 * Read once per request and handed to the service, so "can this person see this task" is one
 * answer rather than a permission lookup scattered through the handlers. A failure to read it is
 * `false`: the narrow answer is the safe one, and the two people on the task can still reach it.
 */
router.use(async (req, res, next) => {
  try {
    req.canSeeAll = await iamService.hasPermission(req.user.id, "HRM", "All Tasks", "READ");
  } catch {
    req.canSeeAll = false;
  }
  next();
});

// The static routes stay above `/:id`, or "options" is read as a task id.
router.get("/options", controller.options);
router.get("/mine", controller.listMine);
router.get("/given", controller.listGiven);
// Before `/:id`, which would otherwise read "dashboard" as a task id.
router.get("/dashboard", controller.dashboard);
router.post("/", controller.createTask);
router.get("/:id", controller.getTask);
/*
 * Correcting what a task says. `PATCH`, not a verb under `/:id`: the four POSTs below are things
 * that happen *to* a task and each is a state change, where this only changes what it says. Covered
 * by the router-wide `requireModule` above as a non-GET, and narrowed further to the giver or a
 * Super Admin by `refusalFor` in the service - ownership the permission cannot express.
 */
router.patch("/:id", controller.updateTask);
/*
 * Each transition is its own verb rather than a status field on a PATCH.
 *
 * They are not edits of the same record by the same person: completing is the receiver's and
 * records who did it, reassigning demands a reason and a new person, cancelling is the
 * giver's alone. A single `PATCH { status }` would have made all four look like one thing anybody
 * on the task could do.
 */
router.post("/:id/start", controller.startTask);
router.post("/:id/complete", controller.completeTask);
router.post("/:id/approve", controller.approveTask);
router.post("/:id/revoke", controller.revokeTask);
// A feedback issue answered Issues sorted or Rejected by whoever holds it - a write, as every verb here.
router.post("/:id/feedback-outcome", controller.resolveFeedbackTask);
router.post("/:id/reassign", controller.reassignTask);
router.post("/:id/cancel", controller.cancelTask);
/*
 * Deleting one, which is not a fifth transition and so is not a verb under the id.
 *
 * `DELETE /:id` is the method the act actually is, and the router-wide `requireModule` reads it as
 * a write - so READ_WRITE on `HRM / Task Management` is needed to reach it at all, and the service
 * then narrows it to the task's giver or a Super Admin. Above the attachment routes only by
 * reading order; the paths cannot collide.
 */
/*
 * The ticked rows, deleted together. Above `/:id` because `/bulk` is a fixed segment.
 *
 * The router-wide `requireModule` reads a DELETE as a write, so Read / Write on
 * `HRM / Task Management` is still needed to reach this at all, and `mountBulkDelete` asks for
 * `ADMIN / Table Select All` on top. Who may delete *which* task is unchanged: `deleteTaskRecord`
 * runs the same service call `DELETE /:id` does, and it still narrows to the task's giver.
 */
mountBulkDelete(router, { deleteOne: (id, req) => controller.deleteTaskRecord(req, id), noun: "task" });
router.delete("/:id", controller.deleteTask);

/*
 * The files handed over with a task.
 *
 * They are read with the task - `GET /:id` carries the list - so there is no list route here, only
 * the three that move bytes. The download is a GET and needs only READ, because anybody who may
 * open a task may open what came with it; attaching and removing are writes, and the service
 * narrows them further to the two people on the task, the same way the four verbs are narrowed.
 *
 * `:attachmentId` sits under `:id` rather than at the top level on purpose: a file is addressed
 * through the task that owns it, so one belonging to a task this reader may not see answers the
 * same 404 the task itself does.
 */
router.post("/:id/attachments", controller.uploadSingle, controller.addAttachment);
router.get("/:id/attachments/:attachmentId", controller.downloadAttachment);
router.delete("/:id/attachments/:attachmentId", controller.deleteAttachment);

module.exports = router;
