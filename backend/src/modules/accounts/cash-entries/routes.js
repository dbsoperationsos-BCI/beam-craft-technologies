const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
// Every route here answers for ACCOUNTS / Cash Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("ACCOUNTS", "Cash Management"));
// Keep this static route above the identifier routes below it.
router.get("/options", controller.options);
router.get("/", controller.listEntries);
router.post("/", controller.createEntry);
// Importing a cash book, behind the same guard `POST /` answers to.
router.get("/import/template", controller.importTemplate);
router.post("/import", controller.importEntries);
router.get("/:id", controller.getEntry);
router.patch("/:id", controller.updateEntry);
// The ticked rows, removed together - above "/:id", since "/bulk" is a fixed segment. The router's
// own `requireModule("ACCOUNTS", "Cash Management")` carries the Read / Write a DELETE needs;
// `mountBulkDelete` adds `ADMIN / Table Select All`. `scopedEntry` still narrows every id.
mountBulkDelete(router, { deleteOne: (id, req) => controller.deleteEntryRecord(req, id), noun: "entry", plural: "entries" });
router.delete("/:id", controller.deleteEntry);

module.exports = router;
