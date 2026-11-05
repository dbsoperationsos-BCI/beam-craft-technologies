const express = require("express");
const { publicQuotation, publicQuotationPdf } = require("../projects/controller");

const router = express.Router();

// Above "/:token", which would otherwise match "<token>/pdf" as a token of its own.
router.get("/:token/pdf", publicQuotationPdf);
router.get("/:token", publicQuotation);

module.exports = router;
