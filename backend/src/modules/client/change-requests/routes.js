const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermission } = require("../../../middleware/permissionMiddleware");
const { listServiceDefinitions, listDeliverableDefinitions } = require("../../sales/projects/controller");
const controller = require("./controller");

/*
 * Client Management -> Client Requests -> Raised Requests.
 *
 *   CLIENT / Client Requests   Read to see the requests on the projects you reach; Read / Write to
 *                              raise one (and to answer a reviewer's question on it).
 *   CLIENT / Request Approval  Read / Write to price each item, approve or reject it, ask the requester
 *                              for more, and submit the decision that writes the approved items.
 *
 * Each guard is `checkPermission`, which hands the permission on (`req.permission`): the service
 * narrows the projects a person reaches to that permission's own scope.
 */
const router = express.Router();
router.use(protect);
const reads = checkPermission("CLIENT", "Client Requests", "READ");
const raises = checkPermission("CLIENT", "Client Requests", "READ_WRITE");
const decides = checkPermission("CLIENT", "Request Approval", "READ_WRITE");

router.get("/", reads, controller.list);
// What raising one needs: the projects to choose from, a project's shoots, the studio's lists.
router.get("/projects", raises, controller.projects);
router.get("/projects/:projectId/shoots", raises, controller.shoots);
router.get("/masters/services", raises, listServiceDefinitions);
router.get("/masters/deliverables", raises, listDeliverableDefinitions);
router.post("/", raises, controller.raise);
router.get("/:id", reads, controller.show);
router.post("/:id/reply", raises, controller.reply);
router.patch("/:id/review", decides, controller.review);
router.post("/:id/ask", decides, controller.ask);
router.post("/:id/decide", decides, controller.decide);

module.exports = router;
