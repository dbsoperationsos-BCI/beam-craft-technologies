const { REPORTS, reportOptions, resolveEmployeeFilter } = require("./service");
const dataScope = require("../../../services/dataScope.service");
// Required here rather than added to REPORTS, which is the table of *table* reports - the
// dashboard answers with a composite of several and has no rows of its own.
const { dashboard: buildDashboard } = require("./dashboard");

/**
 * The CRM's Reports page, answered from the studio's own call log.
 *
 * Every route is a `GET` with the filters in the query string, deliberately. A report is a read:
 * `requireModule` grants a GET on Read and everything else on Read/Write, so a POST carrying a
 * filter body would have demanded write access to look at a chart. It also makes a report a link -
 * one that can be bookmarked, sent to somebody and reloaded into the same numbers.
 */

function sendError(res, error, fallback) {
  console.error(fallback, error?.message || error);
  return res.status(500).json({ message: fallback });
}

/**
 * The employees, verticals and call kinds the filter bar offers.
 *
 * Narrowed by the same scope the reports are, so every name in the dropdown is one whose figures the
 * reader will actually be shown: their own, their team's, and a branch administrator's branches. An
 * option that answers an empty table reads as "this person did nothing", which is the opposite of
 * what it means.
 */
async function options(req, res) {
  try {
    return res.json({ data: await reportOptions(await reportScope(req)) });
  } catch (error) {
    return sendError(res, error, "Unable to load the report filters.");
  }
}

/**
 * Whose leads a report counts: the resolver's answer for the permission this router is guarded
 * with (`SALES / CRM Leads`), the same one the board resolves - so a total can never leak what
 * the list hides. Applied to the lead side of every call query; the usage reports read logins,
 * not leads, and carry no lead scope.
 */
const reportScope = (req) => dataScope.resolve({ userId: Number(req.user.id), module: req.permission.module, feature: req.permission.feature, columns: { branch: "branchId", employee: "ownerEmployeeId", user: "createdByUserId" } });

/** The Sales dashboard: the CRM in one screen, every figure from the query that already makes it. */
async function dashboard(req, res) {
  try {
    const scope = await reportScope(req);
    return res.json({ data: await buildDashboard(await resolveEmployeeFilter(req.query || {}, scope), scope) });
  } catch (error) {
    return sendError(res, error, "Unable to load the dashboard.");
  }
}

/**
 * One report.
 *
 * The name is checked against the table of reports rather than used to reach into it, so a request
 * for `__proto__` or `constructor` finds nothing - a lookup on a plain object by a name off the URL
 * is otherwise a way to reach something that is not a report at all.
 */
async function report(req, res) {
  const name = String(req.params.report || "").trim();
  const run = Object.prototype.hasOwnProperty.call(REPORTS, name) ? REPORTS[name] : null;
  if (!run) {
    return res.status(404).json({
      message: `Unknown report. Available reports: ${Object.keys(REPORTS).join(", ")}.`,
    });
  }
  try {
    /*
     * The Employee filter arrives as a name - the Employee Repository's own, which is the list the
     * filter bar offers - and is resolved to that person's contact number here, once, before any
     * report reads it. Callyzer labels a call with whatever the handset is called, so the name on
     * its own finds only the rows where the two spellings happen to agree.
     */
    const scope = await reportScope(req);
    return res.json({ data: await run(await resolveEmployeeFilter(req.query || {}, scope), scope) });
  } catch (error) {
    return sendError(res, error, "Unable to build that report.");
  }
}

module.exports = { options, dashboard, report };
