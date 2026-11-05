const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermissions } = require("../../../middleware/permissionMiddleware");
const { teamList, teamRead, teamReply, teamStatus } = require("./controller");

// Client Management -> Client Chats: Read to see the chats, Read / Write to answer them.
const router = express.Router();
router.use(protect);
const level = (access) => checkPermissions([{ module: "CLIENT", feature: "Client Chats", level: access }]);
router.get("/", level("READ"), teamList);
router.get("/:id", level("READ"), teamRead);
router.post("/:id/messages", level("READ_WRITE"), teamReply);
router.patch("/:id/status", level("READ_WRITE"), teamStatus);

module.exports = router;
