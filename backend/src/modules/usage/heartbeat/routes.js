const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { beat } = require("./controller");

const router = express.Router();
/*
 * Behind the JWT and nothing else.
 *
 * There is no module permission here on purpose: this records that *the caller* was using the
 * application, about themselves and nobody else, and every signed-in person does that whatever
 * they are allowed to open. Reading what it records is the privileged half, and that lives behind
 * the reports.
 */
router.use(protect);
router.post("/heartbeat", beat);

module.exports = router;
