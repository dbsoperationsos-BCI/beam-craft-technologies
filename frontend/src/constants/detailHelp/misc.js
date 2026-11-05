/** Details-screen help for misc fields - see `index.js`. */
const HELP = {
  // Audit fields every record carries - filled in by the system, never typed by anyone.
  createdAt: "When this record was first saved. The system fills it in automatically.",
  updatedAt: "When this record was last changed. The system updates it on every save.",
  createdBy: "The person whose sign-in created this record. Recorded automatically.",
  updatedBy: "The person who made the most recent change to this record. Recorded automatically.",
  deletedAt: "When this record was removed. It is kept for history but no longer listed.",

  // Administration → User Activity Logs: one recorded request.
  "Request.username": "The sign-in name of the account that did this, as it was at that moment.",
  "Request.userName": "The full name on that account today, so you can tell who the person is.",
  "Request.branchName": "The home branch on that person's account, recorded with the action.",
  "Request.module": "The part of the application that was used, worked out from the screen's address.",
  "Request.action": "The exact operation the system ran for this request, such as saving or deleting.",
  "Request.method": "The kind of change asked for: POST adds, PUT or PATCH edits, DELETE removes.",
  "Request.path": "The system address that was called, with record ids shown as placeholders like :id.",
  "What changed.changes": "Which fields this save actually changed, each with what it was before and what it became - so \"he says he updated it\" can be checked. A save that changed nothing on a watched record, or that was refused, has none.",
  "Response.statusCode": "The result number the system answered with: 2xx worked, 4xx was refused, 5xx failed.",
  "Response.statusText": "The result number in words, for example OK, Forbidden or Not Found.",
  "Response.durationMs": "How long the system took to answer this request. Long times can point to a slow screen.",
  "Device.clientIp": "The network address the request came from, useful to spot sign-ins from unusual places.",
  "Device.userAgent": "The browser and device that made the request, as the browser describes itself.",
};

export default HELP;
