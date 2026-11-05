const express = require("express");
const { publicDocument, publicResponse, savePublicDocument, submitPublicDocument } = require("./controller");

// Public by design: the client has no account, so the 16-character token in the URL is what
// authorises reading, saving and submitting. Deliberately not behind `protect`.
const router = express.Router();

// Before `/:token`, or the word "response" would be read as somebody's document token. This one
// answers for the share token instead, and only ever reads a submitted response.
router.get("/response/:token", publicResponse);
router.get("/:token", publicDocument);
// Saving progress is separate from submitting, because two people fill this document at different
// times and neither should have to finish it in one sitting.
router.patch("/:token", savePublicDocument);
router.post("/:token", submitPublicDocument);

module.exports = router;
