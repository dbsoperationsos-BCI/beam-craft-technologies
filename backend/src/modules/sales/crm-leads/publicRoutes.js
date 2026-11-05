const express = require("express");
const { ingestCallyzerWebhook } = require("./controller");

const router = express.Router();

/*
 * The body, whatever Callyzer labels it.
 *
 * The app's global `express.json()` only parses a request that declares a JSON content type.
 * Callyzer's test posts JSON without one - and body-parser, seeing a type it was not asked to
 * handle, leaves `req.body` undefined. The payload then failed validation and the webhook
 * answered "Invalid Callyzer webhook payload" with a 400, which reads as our end rejecting the
 * data when nothing had ever been read.
 *
 * The wildcard `type` below parses the body on this one route regardless of the header. It is
 * scoped to the webhook rather than applied globally so no other endpoint's expectations change,
 * and it is harmless where the global parser already ran: body-parser marks a request it has
 * read and the second parser steps over it.
 *
 * Bounded well below the global limit. A batch of call logs is text, and a webhook nobody has to
 * sign in to reach should not be a way to hand this server fifty megabytes.
 */
router.post(
  "/webhook/callyzer",
  // A request with no `Content-Type` at all matches no type, wildcard included - so there is
  // nothing for the parser below to act on. Naming one is the only way to give it something to
  // match, and this route accepts nothing but JSON anyway.
  (req, _res, next) => {
    if (!req.headers["content-type"]) req.headers["content-type"] = "application/json";
    next();
  },
  // `strict: false` accepts a body that is a bare JSON string, which is how some senders post a
  // payload - the handler unwraps it. Left strict, body-parser refuses it before the handler is
  // ever reached, and the delivery fails on a technicality.
  // Same capture as the global parser: this one runs only when Callyzer omits the content type,
  // and the signature still has to be checked against the bytes that arrived.
  express.json({
    type: "*/*",
    strict: false,
    limit: "2mb",
    verify: (req, _res, buffer) => { if (buffer?.length) req.rawBody = buffer; },
  }),
  ingestCallyzerWebhook,
);

module.exports = router;
