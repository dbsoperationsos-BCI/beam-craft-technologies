const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { list } = require("./controller");

const router = express.Router();
router.use(protect);
/*
 * `SALES / Contacts` - the directory's own permission, because the directory is its own entry in
 * the Sales & CRM menu and a screen the menu lists has to be grantable on its own. It answered for
 * `CRM Leads` until then, which meant the only way to give somebody the directory was to give them
 * the lead board with it.
 *
 * This is the guard on *opening* the directory, and deliberately not the guard on what is in it:
 * the service checks each module's own permission before that module's numbers are read - leads
 * still need `SALES / CRM Leads`, employees still need `HRM / Employee Management` - so holding
 * this permission alone opens an empty directory rather than a way past another module's guard.
 */
router.use(requireModule("SALES", "Contacts"));
router.get("/", list);

module.exports = router;
