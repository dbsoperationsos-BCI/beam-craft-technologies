const express = require("express");
const { requireTemplateOn } = require("../../../services/messageTemplateSwitches");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { mountBulkDelete } = require("../../../services/bulkDelete");
const { limits: whatsappLimits } = require("../../sales/whatsapp-chat/security");
const controller = require("./controller");

const router = express.Router();
router.use(protect);
// Every route here answers for ACCOUNTS / Cash Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("ACCOUNTS", "Cash Management"));
// Keep this static route above the identifier routes below it.
router.get("/options", controller.options);
/*
 * The form's two long pickers, searched on the server - `options` carries only a page for them to
 * open on. Above the `/:id` routes, or "projects" is read as an entry id. See `searchProjectOptions`.
 */
router.get("/projects", controller.searchProjectOptions);
router.get("/shoots", controller.searchShootOptions);
router.get("/", controller.listEntries);
router.post("/", controller.createEntry);
// Importing a cash book, behind the same guard `POST /` answers to.
router.get("/import/template", controller.importTemplate);
router.post("/import", controller.importEntries);
router.get("/:id", controller.getEntry);
// The entry's payment receipt as a PDF - a read, so Cash Management Read is enough.
router.get("/:id/receipt", controller.downloadReceipt);
// Share invoice: the receipt message with the client's invoice link - a write, since it hands the
// invoice out (`POST`, so Read / Write). Then which WhatsApp group it would go to, and the send into
// it, paced like every WhatsApp send.
router.post("/:id/share", controller.shareInvoice);
router.get("/:id/whatsapp-group", whatsappLimits.read, controller.invoiceGroup);
router.post("/:id/whatsapp-group", requireTemplateOn("CASH_RECEIVED"), whatsappLimits.send, controller.sendInvoiceToGroup);
router.patch("/:id", controller.updateEntry);
// The ticked rows, removed together - above "/:id", since "/bulk" is a fixed segment. The router's
// own `requireModule("ACCOUNTS", "Cash Management")` carries the Read / Write a DELETE needs;
// `mountBulkDelete` adds `ADMIN / Table Select All`. `scopedEntry` still narrows every id.
mountBulkDelete(router, { deleteOne: (id, req) => controller.deleteEntryRecord(req, id), noun: "entry", plural: "entries" });
router.delete("/:id", controller.deleteEntry);

module.exports = router;
