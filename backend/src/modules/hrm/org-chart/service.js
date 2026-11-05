const repository = require("./repository");

/**
 * The reporting chart around one employee.
 *
 * Read from `employee.reportsToEmployeeId`, one manager per person, which is what makes this a tree
 * with a top to arrive at rather than a graph. One request answers one view of it: the chain from
 * the employee up to whoever reports to nobody, and the people reporting directly to the employee.
 * Clicking another node asks for that person's chart instead — the chart is never held whole,
 * because a studio-wide tree is far more than any one screen needs.
 */

/**
 * A chain longer than this is treated as broken rather than drawn.
 *
 * The walk upward already refuses to visit anybody twice, which catches a true loop. This is the
 * second bound, for the chain that is not a loop but is still nonsense — an import that strung
 * every employee into one line, say. Without it a corrupted table would be answered with a chart
 * thousands of nodes tall.
 */
const MAX_CHAIN_DEPTH = 64;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function createOrgChartService(repo = repository) {
  /**
   * Walks from `start` up to the root, nearest manager first.
   *
   * `seen` is not defensive habit. `reports_to_employee_id` is a plain nullable column: the form
   * refuses to write a cycle, but a direct database edit, a restored backup or a bulk import can
   * still leave one, and an unguarded walk would loop until the request timed out. A cycle is
   * reported rather than hidden, so the chart can say the chain is broken instead of quietly
   * drawing a shorter one that looks correct.
   */
  async function chainAbove(start) {
    const managers = [];
    const seen = new Set([start.id]);
    let cursor = start;
    let brokenAt = null;

    while (cursor.reportsToEmployeeId) {
      if (seen.has(cursor.reportsToEmployeeId)) { brokenAt = "cycle"; break; }
      if (managers.length >= MAX_CHAIN_DEPTH) { brokenAt = "too-deep"; break; }
      const manager = await repo.findNode(cursor.reportsToEmployeeId);
      /*
       * The row points at somebody the chart does not draw: archived, since deleted, still
       * onboarding, or no longer working here. The chain stops at the last person still with the
       * studio, which is the truthful answer rather than a gap in the middle of the chart - and it
       * is `brokenAt` that says a chain was cut short for a reason worth reporting, which this is
       * not. A manager who has left is a vacancy, not a fault.
       */
      if (!manager) break;
      seen.add(manager.id);
      managers.push(manager);
      cursor = manager;
    }

    return { managers, brokenAt };
  }

  async function chartFor(employeeId) {
    const employee = await repo.findNode(employeeId);
    /*
     * Nobody to draw: an id naming nobody, or - since the chart became a picture of who reports to
     * whom *now* - somebody it does not draw: a candidate still onboarding, or a colleague who has
     * left.
     *
     * The wording covers both, deliberately. "Employee not found" is what this said, and it is a
     * strange thing to read while looking at that employee's own record, which is exactly where this
     * is reached from: HR opens the chart tab on somebody they are reviewing or offboarding. What is
     * true in every case is that they are not on the chart.
     */
    if (!employee) throw httpError(404, "That employee is not on the reporting chart.");

    const { managers, brokenAt } = await chainAbove(employee);
    const directReports = await repo.listDirectReports(employee.id);
    /*
     * Who the employee works with: everybody else reporting to the same manager. The top of the
     * chart — reporting to nobody — has no peers by this reading rather than the whole studio, which
     * is the honest answer for somebody with no manager to share.
     */
    const peers = employee.reportsToEmployeeId
      ? (await repo.listDirectReports(employee.reportsToEmployeeId)).filter((peer) => peer.id !== employee.id)
      : [];

    const allIds = [employee.id, ...managers.map((m) => m.id), ...directReports.map((r) => r.id), ...peers.map((p) => p.id)];
    // Every node on screen says how many people report to it, so a report with a team of their own
    // is visibly worth clicking into and a leaf is visibly not. Counted for the whole view in one
    // query rather than per node, and the sign-in username behind each node the same way.
    const counts = await repo.countReportsFor(allIds);
    const usernames = await repo.usernamesFor(allIds);
    const withExtras = (node) => ({ ...node, directReportCount: counts.get(node.id) || 0, username: usernames.get(node.id) || null });

    return {
      employee: withExtras(employee),
      // Nearest manager first, so the client can draw upward from the employee without reversing.
      managers: managers.map(withExtras),
      directReports: directReports.map(withExtras),
      peers: peers.map(withExtras),
      // Null when the chain ran cleanly to a root. Set, the client says the chain is broken above
      // this point rather than presenting a truncated one as the whole truth.
      chainBrokenAt: brokenAt,
    };
  }

  return { chartFor, chainAbove };
}

module.exports = { ...createOrgChartService(), createOrgChartService, MAX_CHAIN_DEPTH };
