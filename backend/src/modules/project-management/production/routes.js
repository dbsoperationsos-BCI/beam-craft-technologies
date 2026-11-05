const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkAnyPermission, requireModule } = require("../../../middleware/permissionMiddleware");
const { createRateLimiter } = require("../../../middleware/rateLimit");
const controller = require("./controller");
const { handlerFor } = require("../departmentStatus");
const productionImport = require("./import");

const router = express.Router();
router.use(protect);

// Each file upload is a compression + R2 round trip; a per-user bucket keeps one phone's retries
// from crowding out everybody else's without needing a shared store for something this cheap to
// let lapse on restart.
const fileUploadLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keys: (req) => [`production-files:${req.user?.id}`],
  message: (minutes) => `Too many uploads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

// The studio's WhatsApp number is bannable, so a retry is never let loose on a button mash - one
// bucket per person, cheap enough that losing it on a restart costs nothing.
const messageRetryLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  keys: (req) => [`production-message-retry:${req.user?.id}`],
  message: (minutes) => `Too many retries. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * The production board answers for PROJECT / Production, which already exists in the catalogue.
 * `requireModule` reads GET at READ and everything else at READ_WRITE, and covers any route added
 * below the moment it is written. Past the guard, being named on the shoot decides who may change
 * it - the project's Production Manager the plan, the plan's Production Coordinator the steps -
 * and that is checked in the services against the record, never by role here.
 */
/*
 * The shoot day's own writes - its steps, its status, File in and its photos - answer to either
 * Production at Read / Write (which includes the execution) or Production Execution at Read / Write
 * (the execution alone), so they sit above the router's guard. Who on the shoot may run them is
 * still `accessFor(...).canRunSteps`, checked in `execution.js`; a TICKET upload is the plan's, and
 * `execution.js` asks it the plan's `canEditPlan` and Production at Read / Write.
 */
const runsExecution = checkAnyPermission([
  { module: "PROJECT", feature: "Production", level: "READ_WRITE" },
  { module: "PROJECT", feature: "Production Execution", level: "READ_WRITE" },
]);
router.post("/shoots/:shootId/files", runsExecution, fileUploadLimiter, controller.addFiles);
router.delete("/shoots/:shootId/files/:fileId", runsExecution, controller.removeFile);
// File in as it stands, with the step left where it is; completing it is the POST below.
router.patch("/shoots/:shootId/footage", runsExecution, controller.saveFootage);
router.post("/shoots/:shootId/steps/:step", runsExecution, controller.completeStep);
// Pausing the shoot and resuming it: not a step, a switch across the one the shoot is on.
router.patch("/shoots/:shootId/pause", runsExecution, controller.pauseShoot);

router.use(requireModule("PROJECT", "Production"));

// Import of the studio's old production sheet, one template per vertical, linked to the shoots Pre
// Production → Import made. Under the router's guard: write for the POST.
router.get("/vertical/:vertical/import/template", productionImport.importTemplate);
router.post("/vertical/:vertical/import", productionImport.importProduction);

router.get("/options", controller.listOptions);
router.get("/shoots", controller.listShoots);
router.get("/shoots/:shootId", controller.getShoot);
router.get("/shoots/:shootId/activity", controller.listActivity);
router.get("/shoots/:shootId/files/:fileId/download", controller.downloadFile);
// The project's overall Production status, set by hand for one or several projects - never a shoot.
router.post("/project-status", handlerFor("production"));
router.patch("/shoots/:shootId/plan", controller.savePlan);
// One service's own person, from the Production Schedule - the plan's rules, the Production Manager's.
router.patch("/shoots/:shootId/seat", controller.saveSeat);
// "Use the same team as above": the services it shares with another shoot of the project take its people.
router.post("/shoots/:shootId/copy-team", controller.copyTeam);
// Two services' people swapped, on one shoot or across two - both plans the caller's (swap.js).
router.post("/seat-swap", controller.swapSeats);
// The plan's own Hold / Rejected (or back to automatic) - the Production Manager's, checked in plan.js.
router.patch("/shoots/:shootId/plan-status", controller.setPlanStatus);
router.post("/shoots/:shootId/messages/:step/retry", messageRetryLimiter, controller.retryMessage);

module.exports = router;
