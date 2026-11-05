const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { createRateLimiter } = require("../../../middleware/rateLimit");
const controller = require("./controller");

const router = express.Router();
router.use(protect);

/*
 * The bar on every page listing the messages that could not find their group.
 *
 * **Above the router-wide guard on purpose, and deliberately on no permission of its own.** Who may
 * read the whole log of every WhatsApp message the studio has sent is not the same question as who
 * should be told, on every screen, that a message never went - tied together, the only way to show
 * the bar to a project manager was to hand them the entire activity log.
 *
 * It was then given a permission of its own, and that was the wrong shape for the question.
 * [IAM.md - Whose records](../../../../../docs/project-state/IAM.md) draws the line: a permission
 * answers *may you open this screen*, and this is not a screen anybody opens - it is a strip about
 * **your own** work, and whose rows you get "has one answer for everybody, no setting, per role or
 * otherwise". A tickable gate in front of that could only ever hide a project manager's own row from
 * them, which is exactly what it did: the migration granted it to SUPER_ADMIN alone, as a new
 * permission must, so the project manager of a project whose message never went was told nothing
 * until somebody ticked a box nobody knew about.
 *
 * So this route carries `protect` and nothing more, and `listGroupFailures` is the access control:
 * it answers with the rows the caller's **own name** is on - the projects they are project manager
 * of - and widens only for `PROJECT / Show All Projects`, which is already the deliberate widener
 * for the project register. **There is no call that returns somebody else's row**, so there is no
 * privilege here to hold or to grant. An employee on no project gets an empty list and no bar.
 *
 * This is a considered exception to Rule 4's "every route mounts a permission guard", in the shape
 * the same rule already allows for data scope and that IAM.md keeps for a task, which "is always
 * readable by the two people it is between". Retrying is unaffected and still answers to the owning
 * module's permission - sending a project's message and linking its group are acts, which is what a
 * permission is for.
 */
router.get("/group-failures", controller.groupFailures);

/*
 * Settings → User Settings → WhatsApp Activity Log, behind `SETTINGS / WhatsApp Activity Log`:
 * reading the log needs Read, sending a failed message again Read / Write. `requireModule` follows
 * the method, so a route added here later is guarded the moment it is written.
 */
router.use(requireModule("SETTINGS", "WhatsApp Activity Log"));

/*
 * Resend is a WhatsApp send from somebody's paired number, and the number's standing is what a
 * burst of them puts at risk - so it is held tighter than the manual send buttons are
 * (`whatsapp-chat/security.js` allows 30 a minute): ten a minute, per person. The service's own
 * 30-second gap per message is what stops the same one being hammered.
 */
const resendLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keys: (req) => [`whatsapp-activity-resend:${req.user?.id || "anon"}`],
  message: () => "You are resending too quickly. Wait a minute before trying again.",
});

router.get("/", controller.list);
router.get("/summary", controller.summary);
router.get("/options", controller.options);
// The values a filter box may offer - above `/:id`, so "facets" is never read as a message id.
router.get("/facets", controller.facets);
router.get("/:id", controller.detail);
router.post("/:id/resend", resendLimiter, controller.resend);

module.exports = router;
