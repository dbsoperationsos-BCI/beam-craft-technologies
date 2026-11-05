const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { availableEnquiryIds, create, createLink, createResponseLink, list, response } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();

router.use(protect);
// Every route here answers for SALES / CRD Documents: a GET needs Read, anything else Read / Write.
// `PROJECT`, not `SALES`: the screen these serve sits under Project Management in the menu,
// and Role Management lists a permission under the module its screen belongs to. Moved with
// migration 20260909130000, which carried every existing grant across.
router.use(requireModule("PROJECT", "CRD Documents"));
router.get("/", list);
router.get("/available-enquiry-ids", availableEnquiryIds);
// The client's own answers, and the read-only link that shares them. Both sit under this router's
// SALES / CRD Documents guard: reading a response needs Read, issuing its link is a write.
router.get("/:documentId/response", response);
router.post("/:documentId/response-link", createResponseLink);
// Creating a document for a client with no project yet, and issuing a project's link, are both
// writes against the same SALES / CRD Documents permission the router already guards.
router.post("/", create);
router.post("/:projectId/link", createLink);

module.exports = router;
