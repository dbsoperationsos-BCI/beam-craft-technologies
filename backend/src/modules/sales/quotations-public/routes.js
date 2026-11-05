const express = require("express");
const { publicQuotation, publicQuotationPdf } = require("../projects/controller");
const { publicQuotationPayment } = require("./controller");
const { createRateLimiter, createPublicLinkLimiter, clientIp } = require("../../../middleware/rateLimit");

const router = express.Router();

/*
 * One budget of misses across the sheet, its PDF and its payment details, so guessing cannot move
 * to whichever route is limited least: all three answer 404 for a token that does not exist.
 * Misses only, so a family reopening its quotation is never refused.
 */
const linkLimiter = createPublicLinkLimiter("quotation");

/*
 * The PDF is drawn by the headless browser Download Album also prints with, so each fetch is real
 * work on the server. Counted per caller and per quotation: a family re-saving its own quotation
 * never meets the ceiling, and one link held by a stranger cannot keep the browser printing.
 */
const pdfLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  // The token is read before the controller checks it, so anything not shaped like a link token
  // shares one bucket - made-up tokens cannot each open a fresh budget, or grow the limiter's memory.
  keys: (req) => [`quotation-pdf:${clientIp(req)}:${/^[A-Za-z0-9_-]{8}$/.test(String(req.params.token || "")) ? req.params.token : "invalid"}`],
  message: (minutes) => `Too many downloads. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

// Above "/:token", which would otherwise match "<token>/pdf" or "<token>/payment" as a token of its own.
router.get("/:token/pdf", linkLimiter, pdfLimiter, publicQuotationPdf);
/*
 * Where to pay: the Assigned Branch's account, UPI ID and QR, by the quotation's own token. Rate
 * limited on its own because it hands out bank details: a scanner walking the token space is what
 * the ceiling is for, and the quotation itself is not held to it - the sheet is opened and reopened
 * far more often, and says nothing a scanner could bank.
 *
 * Sized the way every per-address budget here is sized (see `.env.example`): behind nginx the
 * address is the proxy's for everyone unless `TRUST_PROXY_HEADER` is on, so this bucket may be
 * every client of the studio at once, and a ceiling that fits one client would refuse the rest.
 * Three hundred a quarter-hour is nothing to a 48-bit token and plenty for every client who is
 * paying that afternoon.
 */
router.get("/:token/payment", linkLimiter, createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keys: (req) => [`quotation-payment:${clientIp(req)}`],
  message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
}), publicQuotationPayment);
router.get("/:token", linkLimiter, publicQuotation);

module.exports = router;
