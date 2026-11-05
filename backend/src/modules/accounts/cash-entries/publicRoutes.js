const express = require("express");
const { publicInvoice, publicInvoicePdf } = require("./controller");
const { createRateLimiter, createPublicLinkLimiter, clientIp } = require("../../../middleware/rateLimit");
const { TOKEN_PATTERN } = require("./invoiceLink");

const router = express.Router();

/*
 * A payment's invoice, opened by the client from the link in their receipt - no sign-in, the token
 * is the credential. One budget of misses across both routes, so guessing cannot move to whichever is
 * limited least; misses only, so a client reopening their invoice is never refused.
 */
const linkLimiter = createPublicLinkLimiter("invoice");

// The PDF is drawn on each fetch, so it is counted per caller and per invoice as the quotation's is.
// Anything not shaped like a token shares one bucket, so made-up tokens cannot each open a budget.
const pdfLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keys: (req) => [`invoice-pdf:${clientIp(req)}:${TOKEN_PATTERN.test(String(req.params.token || "")) ? req.params.token : "invalid"}`],
  message: (minutes) => `Too many downloads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

// Above "/:token", which would otherwise match "<token>/pdf" as a token of its own.
router.get("/:token/pdf", linkLimiter, pdfLimiter, publicInvoicePdf);
router.get("/:token", linkLimiter, publicInvoice);

module.exports = router;
