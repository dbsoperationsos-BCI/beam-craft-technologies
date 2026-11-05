const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { checkPermissions } = require("../../../middleware/permissionMiddleware");
const { list, create, update, remove, readSettings, writeSettings } = require("./controller");

const router = express.Router();

router.use(protect);
// Client Management -> Client Offers, on its own permission: Read to see them, Read / Write to change them.
const level = (access) => checkPermissions([{ module: "CLIENT", feature: "Client Offers", level: access }]);
// The client app's settings: before `/:id`, which would otherwise take "settings" for an offer.
router.get("/settings", level("READ"), readSettings);
router.put("/settings", level("READ_WRITE"), writeSettings);
router.get("/", level("READ"), list);
router.post("/", level("READ_WRITE"), create);
router.put("/:id", level("READ_WRITE"), update);
router.delete("/:id", level("READ_WRITE"), remove);

module.exports = router;
