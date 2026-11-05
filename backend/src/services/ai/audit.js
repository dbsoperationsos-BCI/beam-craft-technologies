/**
 * What the assistant was asked to do, and what it was allowed to do.
 *
 * Structured lines rather than a table, because an audit trail nobody can read is not one - these
 * land in the same PM2 logs the rest of the backend uses, and can be grepped by request id.
 *
 * What is never written: the question, the answer, or anything a tool returned. Those are the
 * client's own words and the studio's own data, and a log file is read by more people and kept for
 * longer than anyone intends. What a denied cross-module attempt needs to record is that it
 * happened, by whom, and against what - not what they hoped to read.
 */

/*
 * A short id per request, so one turn's lines can be found together.
 *
 * Not a uuid: this is for grepping a log, and eight characters of base36 is enough to separate
 * concurrent turns on a box that runs a handful at a time.
 */
function newRequestId() {
  return Math.random().toString(36).slice(2, 10);
}

function line(event, fields) {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${typeof value === "string" && value.includes(" ") ? JSON.stringify(value) : value}`);
  console.log(`[ai:audit] ${event} ${parts.join(" ")}`);
}

/** A turn beginning. Records who and where, never what. */
function requestStarted({ requestId, userId, module, isSuperAdmin }) {
  line("request", { id: requestId, user: userId, module, superAdmin: Boolean(isSuperAdmin) });
}

/** A turn finishing, with what it cost. */
function requestFinished({ requestId, userId, module, ms, toolCount, ok }) {
  line("done", { id: requestId, user: userId, module, ms, tools: toolCount, ok: ok !== false });
}

/**
 * A tool that ran, or was refused.
 *
 * The refusals are the ones worth having. A CRM session repeatedly asking for HRM tools is either a
 * confused model or somebody probing, and neither is visible without this.
 */
function toolCall({ requestId, userId, module, tool, ms, allowed, code }) {
  line(allowed ? "tool" : "tool-denied", {
    id: requestId, user: userId, module, tool, ms, code,
  });
}

/** A request refused before it reached the model at all. */
function accessDenied({ requestId, userId, module, code }) {
  line("denied", { id: requestId, user: userId, module, code });
}

module.exports = { newRequestId, requestStarted, requestFinished, toolCall, accessDenied };
