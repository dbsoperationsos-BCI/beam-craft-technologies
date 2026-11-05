const { scopeOf } = require("./rules");

/**
 * Sale Extras at booking: which of Create Project's rows are the quotation's own, and so the baseline.
 *
 * Create Project marks the shoots a finalized quotation laid down (`fromQuotation`) and locks them -
 * their services and deliverables are the quotation's too. The mark is honoured only with a finalized
 * quotation linked, and for no more shoots than that quotation holds, so a booking cannot make a shoot
 * added by hand look as if it had been quoted.
 */

/**
 * The finalized quotation's own plan, shoot by shoot in its order: for each quoted shoot, how many of
 * each service and deliverable definition the quotation lists under it. A booking's marked shoots are
 * matched to these in order, and a line under a marked shoot is baseline only when the quotation
 * lists that definition under that shoot - so nothing added by hand can be passed off as quoted.
 */
async function quotedPlan(tx, quotationId) {
  if (!quotationId) return [];
  const quotation = await tx.salesQuotation.findFirst({ where: { quotationId, deletedAt: null, finalizedAt: { not: null } }, select: { payload: true } });
  const payload = quotation?.payload || {};
  const count = (rows, field) => {
    const counts = new Map();
    for (const row of rows) if (row?.[field]) counts.set(row[field], (counts.get(row[field]) || 0) + 1);
    return counts;
  };
  return (Array.isArray(payload.shoots) ? payload.shoots : []).map((shoot) => ({
    services: count((payload.services || []).filter((row) => row?.shootId === shoot.id), "serviceDefinitionId"),
    deliverables: count((payload.deliverables || []).filter((row) => row?.shootId === shoot.id), "deliverableDefinitionId"),
  }));
}

/** Takes one of a definition from a quoted shoot's list; true when the quotation listed it. */
function takeQuoted(counts, definitionId) {
  const left = counts?.get(definitionId) || 0;
  if (!left) return false;
  counts.set(definitionId, left - 1);
  return true;
}

/** The baseline snapshot to write on a booked row, or nothing for a row that is an extra. */
const baselineFor = (isBaseline, category, row) => (isBaseline ? { saleBaseline: category === "SHOOT" ? {} : scopeOf(category, row) } : {});

/**
 * A quotation linked to a project after booking - or changed for another before anything was
 * published - describes the project as it now stands, so its plan at that moment becomes the baseline:
 * every live row is snapshotted, deleted rows hold none, and drafts measured from the old baseline go.
 */
async function rebaselineProject(tx, projectId) {
  const where = { projectId: String(projectId) };
  const [shoots, services, deliverables] = await Promise.all([
    tx.projectShoot.findMany({ where, select: { id: true, deletedAt: true } }),
    tx.projectPostProductionAllocation.findMany({ where }),
    tx.projectShootDeliverable.findMany({ where }),
  ]);
  const { Prisma } = require("@prisma/client");
  const snapshot = (category, row) => (row.deletedAt ? Prisma.DbNull : category === "SHOOT" ? {} : scopeOf(category, row));
  for (const row of shoots) await tx.projectShoot.update({ where: { id: row.id }, data: { saleBaseline: snapshot("SHOOT", row) } });
  for (const row of services) await tx.projectPostProductionAllocation.update({ where: { id: row.id }, data: { saleBaseline: snapshot("SERVICE", row) } });
  for (const row of deliverables) await tx.projectShootDeliverable.update({ where: { id: row.id }, data: { saleBaseline: snapshot("DELIVERABLE", row) } });
  await tx.projectSaleExtra.updateMany({ where: { ...where, status: "DRAFT" }, data: { status: "CANCELLED", parentExtraId: null } });
}

module.exports = { quotedPlan, takeQuoted, baselineFor, rebaselineProject };
