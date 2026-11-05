const express = require("express");
const payments = require("./service");

/**
 * POST /api/public/photo-selling/webhooks/cashfree - Cashfree's payment notifications.
 *
 * The signature is computed over the exact bytes Cashfree sent, so this needs `req.rawBody`, which
 * server.js's JSON parser keeps for this path alone (its `verify` hook). A notification is never
 * believed as it stands: it is recorded once, and then Cashfree is asked what actually happened
 * (payments/service.handleWebhook). Answers 200 to anything it has dealt with, so Cashfree stops
 * retrying, and 5xx only when it should retry.
 */
const router = express.Router();

router.post("/", async (req, res) => {
  if (!req.rawBody || !req.rawBody.length) return res.status(400).json({ message: "Expected a signed JSON body." });
  try {
    const { status, body } = await payments.handleWebhook({ rawBody: req.rawBody, headers: req.headers });
    return res.status(status).json(body);
  } catch (error) {
    console.error("[photo-selling] webhook failed:", error.message);
    return res.status(500).json({ message: "Try again." });
  }
});

module.exports = router;
