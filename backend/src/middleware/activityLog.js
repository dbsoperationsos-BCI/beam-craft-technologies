const { entryForRequest, recordActivity } = require("../services/activityLog");

/**
 * Records each finished `/api` request made by somebody signed in, for Administration → User
 * Activity Logs.
 *
 * Mounted once in `server.js`, ahead of every router, so it sees every request; it decides what to
 * record only when the response has finished, by which time `protect` has set `req.user` (or not -
 * an unauthenticated request is not recorded) and the route that answered is known. Everything it
 * does is after the answer has gone, so it adds nothing to the request's time and cannot change its
 * outcome. What is recorded, and the polls that are deliberately not, live in
 * `src/services/activityLog.js`.
 */
function activityLog(req, res, next) {
  if (!String(req.originalUrl || "").startsWith("/api/")) return next();
  const startedAt = Date.now();
  res.on("finish", () => {
    try {
      const entry = entryForRequest(req, res, startedAt);
      if (entry) recordActivity(entry);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") console.warn("[activity-log] could not record a request:", error?.message || error);
    }
  });
  return next();
}

module.exports = { activityLog };
