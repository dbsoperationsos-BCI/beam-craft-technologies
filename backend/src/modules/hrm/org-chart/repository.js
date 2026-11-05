const prisma = require("../../../config/db");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");

/**
 * What a node of the chart is drawn from.
 *
 * Deliberately narrow. The chart is a picture of who reports to whom, so it carries the name, the
 * label under it and nothing else — an employee row also holds salary, Aadhaar and PAN, and none of
 * that belongs in a response whose whole purpose is to be shown as a diagram.
 */
const NODE_SELECT = {
  id: true,
  employeeId: true,
  employeeName: true,
  designation: true,
  department: true,
  employmentStatus: true,
  reportsToEmployeeId: true,
  // Read as the card's own "branch": the same field a payment request or a cash entry with no
  // project falls back to for whose books it belongs in.
  workBaseLocation: true,
  // The face on the node's avatar; initials stand in where nobody uploaded one.
  profilePhotoUrl: true,
};

/**
 * Who is a node of the chart at all: the people working here.
 *
 * Archived rows were the only ones left out, which is not the same question. A row exists in the
 * repository from the moment HR sends an onboarding invite, and it stays after somebody leaves - so
 * the chart drew candidates who had not filled their form in yet, and colleagues who had been
 * relieved, fired or had absconded, as though they were still part of the organisation. A chart is a
 * picture of who reports to whom *now*.
 *
 * The three working statuses - Active, in Training, PIP - rather than Active alone, which is the
 * same list HR's own Active tab groups and every employee picker offers. Somebody in training
 * occupies a real place in the structure and people report to them; drawing the chart without them
 * would leave those reports hanging off nobody.
 *
 * Read per call rather than held: the studio maintains these in Settings, and a status added there
 * must not need a restart to appear here.
 */
async function drawnEmployeeWhere() {
  return { archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } };
}

function createOrgChartRepository(client = prisma) {
  /*
   * A chain that runs up through somebody who has left stops at the last person still working here,
   * rather than carrying on through them - `findNode` answering nothing for such a row is what the
   * walk in `service.js` reads as the top of the chain.
   */
  const findNode = async (id) => client.employee.findFirst({ where: { id, ...(await drawnEmployeeWhere()) }, select: NODE_SELECT });

  const listDirectReports = async (managerId) => client.employee.findMany({
    where: { reportsToEmployeeId: managerId, ...(await drawnEmployeeWhere()) },
    select: NODE_SELECT,
    orderBy: [{ employeeName: "asc" }],
  });

  /**
   * How many people report to each of `ids`, as a Map.
   *
   * One grouped query rather than one count per node: the chart draws a chain that can be many
   * levels deep, and asking per node turned a single screen into a query per person on it.
   */
  const countReportsFor = async (ids) => {
    if (!ids.length) return new Map();
    // Counted over the same people the chart draws, or a node would read "3" and open on one: the
    // number under a card is a promise about what clicking it shows.
    const rows = await client.employee.groupBy({
      by: ["reportsToEmployeeId"],
      where: { reportsToEmployeeId: { in: ids }, ...(await drawnEmployeeWhere()) },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.reportsToEmployeeId, row._count._all]));
  };

  /**
   * The sign-in username behind each of `ids`, as a Map.
   *
   * `User.linkedEmployeeId` is a plain column with no declared Prisma relation — the same reason
   * every other reader of it, `requesterOf` in Payment Requests among them, resolves it with its
   * own query rather than an include — so this is one grouped lookup for the whole chart rather
   * than one per node. Missing for anybody with no login yet, which is most of a chart's nodes
   * long before it is anybody's fault.
   */
  const usernamesFor = async (ids) => {
    if (!ids.length) return new Map();
    const rows = await client.user.findMany({
      where: { linkedEmployeeId: { in: ids } },
      select: { linkedEmployeeId: true, username: true },
    });
    return new Map(rows.filter((row) => row.username).map((row) => [row.linkedEmployeeId, row.username]));
  };

  return { findNode, listDirectReports, countReportsFor, usernamesFor };
}

module.exports = createOrgChartRepository();
module.exports.drawnEmployeeWhere = drawnEmployeeWhere;
module.exports.createOrgChartRepository = createOrgChartRepository;
module.exports.NODE_SELECT = NODE_SELECT;
