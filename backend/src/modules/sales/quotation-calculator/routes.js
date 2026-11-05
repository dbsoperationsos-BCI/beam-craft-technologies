const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { catalogue, bookings, getQuote, saveQuote } = require("./controller");
const { requireModule } = require("../../../middleware/permissionMiddleware");

const router = express.Router();
router.use(protect);
// Every route here answers for SALES / Quotation Management: a GET needs Read, anything else Read / Write.
router.use(requireModule("SALES", "Quotation Management"));
router.get("/catalogue", catalogue);
router.get("/bookings", bookings);
// What a lead was quoted, and applying a quote to it: Read to look, Read / Write to apply, both
// within the caller's own lead scope.
router.get("/leads/:leadId", getQuote);
router.post("/leads/:leadId", saveQuote);

module.exports = router;
