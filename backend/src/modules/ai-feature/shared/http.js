const { expiredLinkBody } = require("../../../services/expiredLink");
/**
 * The three helpers every AI Feature controller repeats: a typed HTTP error, zod validation that
 * answers the request itself, and one place a thrown error becomes a response.
 *
 * Kept inside this module rather than lifted into `src/services`: Image Selection carries its own
 * copies and is not to be refactored by this feature (CLAUDE.md, "Existing module safety").
 */
const httpError = (status, message, details) => Object.assign(new Error(message), { status, ...(details ? { details } : {}) });

function validate(schema, value, res, message = "Invalid request.") {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  res.status(400).json({ message, errors: parsed.error.flatten() });
  return null;
}

function handleError(error, res, action) {
  if (res.headersSent) { console.error(`Unable to ${action} (AI Feature):`, error); return undefined; }
  if (error.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}), ...expiredLinkBody(error) });
  if (error.code === "P2002") return res.status(409).json({ message: "That already exists." });
  if (error.code === "P2025") return res.status(404).json({ message: "Not found." });
  console.error(`Unable to ${action} (AI Feature):`, error);
  return res.status(500).json({ message: `Unable to ${action}.` });
}

/** Wraps an async handler so a rejection becomes a JSON error rather than a hung request. */
const route = (action, handler) => async (req, res) => { try { await handler(req, res); } catch (error) { handleError(error, res, action); } };

module.exports = { httpError, validate, handleError, route };
