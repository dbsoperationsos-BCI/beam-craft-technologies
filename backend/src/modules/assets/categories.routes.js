const express = require("express");
const { protect } = require("../../middleware/authMiddleware"); const { requireModule } = require("../../middleware/permissionMiddleware");
const controller = require("./categories.controller");
const router = express.Router();
router.use(protect); router.use(requireModule("ASSET", "Asset Management"));
router.get("/", controller.list);
router.get("/tree", controller.tree);
router.get("/:categoryId/children", controller.children);
module.exports = router;
