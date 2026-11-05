const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermissions } = require("../../../middleware/permissionMiddleware");
const { teamList, teamAnswer, teamApprove, teamRemove } = require("./controller");

// Client Management -> Client Requests, on its own permission: Read to see them, Read / Write to answer.
const router = express.Router();
router.use(protect);
const level = (access) => checkPermissions([{ module: "CLIENT", feature: "Client Requests", level: access }]);
router.get("/", level("READ"), teamList);
router.post("/:id/answer", level("READ_WRITE"), teamAnswer);
// Several of one client's requests approved together - each added to the project.
router.post("/approve", level("READ_WRITE"), teamApprove);
router.post("/delete", level("READ_WRITE"), teamRemove);

module.exports = router;
