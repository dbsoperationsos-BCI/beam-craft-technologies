const express = require("express");
const { protect } = require("../../../middleware/authMiddleware");
const { requireModule } = require("../../../middleware/permissionMiddleware");
const { createRateLimiter } = require("../../../middleware/rateLimit");
const controller = require("./controller");

/*
 * A batch is ten files and a few password retries; sixty in ten minutes is a long morning of
 * statements, and short of anyone feeding the parser on repeat.
 */
const extractLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  keys: (req) => [`statement-import:${req.user.id}`],
  message: (minutes) => `Too many files read. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

const router = express.Router();
router.use(protect);
// Reading a statement is the first half of recording what it shows, so it answers to the same
// ACCOUNTS / Cash Management the cash entries do - and, being a POST, to its Read / Write.
router.use(requireModule("ACCOUNTS", "Cash Management"));
router.post("/extract", extractLimiter, controller.extract);

module.exports = router;
