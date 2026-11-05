const { ALBUM_STATES, ALBUM_TRANSITIONS } = require("./constants");

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

const label = (state) => String(state || "").replaceAll("_", " ").toLowerCase();

/**
 * The one gate every status change walks through. Services never write `status` directly — they
 * ask for a transition, and an impossible one (DRAFT → CLIENT_APPROVED, a second approval, a
 * publish before QC) dies here with a 409 that names both ends. Idempotence is the caller's
 * choice: `assertTransition` treats from === to as a no-op the caller may skip on.
 */
function assertTransition(from, to) {
  if (!ALBUM_STATES.includes(to)) throw httpError(400, `Unknown album status: ${to}`);
  if (from === to) return false;
  const allowed = ALBUM_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) throw httpError(409, `An album that is ${label(from)} cannot move to ${label(to)}.`);
  return true;
}

const canTransition = (from, to) => (ALBUM_TRANSITIONS[from] || []).includes(to);
const allowedTransitions = (from) => ALBUM_TRANSITIONS[from] || [];

module.exports = { assertTransition, canTransition, allowedTransitions };
