const { z } = require("zod");
const { GIFT_KEYS, GIFT_STATUSES, listGiftProjects, updateGiftStatus } = require("./service");
const { projectAccessWhere } = require("../../../services/projectScope");

const statusSchema = z.object({ status: z.enum(GIFT_STATUSES) });

function sendError(res, error, fallback) {
  if (error.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

// One gift's projects. The gift is a path segment rather than a query string because it is what
// the row *is*, not a filter over a shared list — the two gifts are tracked separately.
async function listGifts(req, res) {
  try {
    // A gift is a column on a project, so it is seen exactly when the project is: chasing a
    // welcome gift is part of running that wedding, not a separate list everybody shares.
    return res.json({ data: await listGiftProjects(req.params.gift, { where: await projectAccessWhere({ userId: req.user.id, permissions: req.permission }) }) });
  } catch (error) {
    return sendError(res, error, "Unable to load client gifts.");
  }
}

// Moving a row between the three tabs. The dates are stamped by the service, so a screen cannot
// claim a gift was sent on a day it chooses.
async function setGiftStatus(req, res) {
  const parsed = statusSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Validation failed", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await updateGiftStatus(req.params.gift, req.params.projectId, parsed.data.status, { userId: req.user.id, permissions: req.permission }) });
  } catch (error) {
    return sendError(res, error, "Unable to update the gift status.");
  }
}

// What the screen draws its dropdown and its tabs from, so the two sides cannot drift apart.
function giftOptions(_req, res) {
  return res.json({ data: { gifts: GIFT_KEYS, statuses: GIFT_STATUSES } });
}

module.exports = { listGifts, setGiftStatus, giftOptions };
