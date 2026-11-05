/*
 * Pure HTTP-edge helpers shared by the production and pre production controllers: turn a thrown
 * `{ status, message, code }` (from `production/access.js`'s `fail`, or anything shaped like it)
 * into the right response, and report a failed zod parse the same way everywhere. No dependency on
 * either controller, so both may import this without creating a cycle between them.
 */
function respond(res, error, fallback) {
  // `details`: what a screen shows beside the message - the shoot a person is already on, for a swap.
  if (error?.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}), ...(error.details ? { details: error.details } : {}) });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}
// The first problem, in the schema's own words ("Enter the footage link as an http(s) URL."), is the
// message: a screen shows `message`, and "Validation failed" told the person nothing to fix.
const invalid = (res, parsed) => res.status(400).json({ message: parsed.error.issues[0]?.message || "Check the details and try again.", errors: parsed.error.flatten() });

module.exports = { respond, invalid };
