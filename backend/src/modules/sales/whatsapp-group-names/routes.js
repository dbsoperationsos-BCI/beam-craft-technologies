const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { listGroupNames, createGroupName } = require("./controller");
const { checkAnyPermission } = require("../../../middleware/permissionMiddleware");

const router = express.Router();

router.use(protect);

// Saved group names are picked from Sales Manager when a project is created and from Projects when
// one is started, so either permission reaches them - but reading the list and adding to it are not
// the same ask, and one guard at READ would have let a read-only viewer write.
const forEither = (level) => checkAnyPermission([
  { module: "SALES", feature: "Sales Manager", level },
  { module: "PROJECT", feature: "Projects", level },
]);
router.get("/", forEither("READ"), listGroupNames);
router.post("/", forEither("READ_WRITE"), createGroupName);

module.exports = router;
