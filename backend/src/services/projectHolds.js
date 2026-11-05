const prisma = require("../config/db");

/**
 * Where a project is held, by department - shown beside its name as "On Hold (Pre-Production)",
 * "On Hold (Production)", "On Hold (Accounts)" or several.
 *
 * A department holds the project when any of its live shoots is on Hold there: Pre Production's own
 * shoot status (`project_pre_production.shoot_status`), Production's - the shoot day's
 * (`project_production.shoot_status`) or the plan's (`project_production.plan_status`); Accounts'
 * when one of its scheduled payments is held (`project_payment_schedule.hold_at`). A Rejected
 * shoot stays the shoot's own and is not carried up. The project's own status is read from
 * `projectStatus` beside this; a Delivered project shows no hold, which the screens decide.
 *
 * `{ [projectId]: ["Pre-Production", "Production"] }`; a project held nowhere is left out.
 */
const DEPARTMENTS = ["Pre-Production", "Production", "Accounts"];

async function projectHoldSources(projectIds, { client = prisma } = {}) {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const [preProduction, production, accounts] = await Promise.all([
    client.projectPreProduction.findMany({
      where: { projectId: { in: ids }, shootStatus: "HOLD", shoot: { deletedAt: null } },
      select: { projectId: true },
    }),
    client.projectProduction.findMany({
      where: { salesProjectId: { in: ids }, OR: [{ shootStatus: "HOLD" }, { planStatus: "HOLD" }], shoot: { deletedAt: null } },
      select: { salesProjectId: true },
    }),
    client.projectPaymentSchedule.findMany({
      where: { projectId: { in: ids }, holdAt: { not: null }, deletedAt: null },
      select: { projectId: true },
    }),
  ]);
  const holds = {};
  const add = (projectId, department) => {
    holds[projectId] = holds[projectId] || [];
    if (!holds[projectId].includes(department)) holds[projectId].push(department);
  };
  for (const row of preProduction) add(row.projectId, "Pre-Production");
  for (const row of production) add(row.salesProjectId, "Production");
  for (const row of accounts) add(row.projectId, "Accounts");
  return holds;
}

/**
 * Where each project stands on the money it is owed - shown beside its name, as a hold is, as
 * "Overdue (Accounts)" or "Due (Accounts)". Overdue wins when it has both. Read from its scheduled
 * payments still to be received and not on hold (a held one says "On Hold (Accounts)" instead).
 *
 * `{ [projectId]: "Overdue" | "Due" }`; a project with neither is left out.
 */
async function projectPaymentsDue(projectIds, { client = prisma } = {}) {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  if (!ids.length) return {};
  // Required here rather than at the top: the scheduled payments service reaches the cash book.
  const { toPayment, scheduleSelect } = require("../modules/accounts/scheduled-payments/service");
  const rows = await client.projectPaymentSchedule.findMany({
    where: { projectId: { in: ids }, deletedAt: null, holdAt: null },
    select: { ...scheduleSelect, project: { select: { initialConvertedValue: true } } },
  });
  const due = {};
  for (const row of rows) {
    const { status } = toPayment(row, row.project.initialConvertedValue);
    if (status === "Overdue") due[row.projectId] = "Overdue";
    else if (status === "Due" && due[row.projectId] !== "Overdue") due[row.projectId] = "Due";
  }
  return due;
}

module.exports = { projectHoldSources, projectPaymentsDue, DEPARTMENTS };
