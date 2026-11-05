const prisma = require("../../../config/db");

/**
 * Sale Extras as Accounts reads them: the sum of a project's PUBLISHED, priced lines (an addition
 * raises it, a removal lowers it; an included line carries no amount). Summed over the rows, never the
 * revisions, so a line counts once however many revisions repeat it. Drafts never count.
 */
async function publishedSaleExtrasTotal(projectId, client = prisma) {
  if (!projectId) return 0;
  // A caller's transaction client, when it carries the table; the shared client otherwise.
  const db = client?.projectSaleExtra ? client : prisma;
  const result = await db.projectSaleExtra.aggregate({ where: { projectId: String(projectId), status: "PUBLISHED", parentExtraId: null }, _sum: { amount: true } });
  return Number(result._sum.amount || 0);
}

// What a changed line says to the client, in the studio's words. Option ids are left out: they name a
// setting, not something the client reads.
const DETAIL_LABELS = {
  quantity: "Quantity",
  quantitySessionTiming: "Session timing",
  durationHours: "Duration (hours)",
  durationMinutes: "Duration (minutes)",
  workDays: "Work days",
  timingMinutes: "Timing (minutes)",
  numberOfPhotos: "No. of photos",
  brandName: "Brand",
  size: "Size",
  frameInches: "Frame",
  videoLength: "Video length",
};

/** "Quantity 1 → 2" for a modified line, "Quantity 3" for an added or removed service or deliverable. */
function detailOf(kind, category, details) {
  const before = details?.before || {};
  const after = details?.after || {};
  if (kind === "MODIFIED") {
    const changed = Object.keys(DETAIL_LABELS)
      .filter((field) => String(before[field] ?? "") !== String(after[field] ?? ""))
      .map((field) => `${DETAIL_LABELS[field]} ${before[field] ?? "—"} → ${after[field] ?? "—"}`);
    return changed.length ? changed.join(" · ") : null;
  }
  // A shoot has no quantity, and neither has an extra quotation raised by hand (no category).
  if (category === "SHOOT" || !category) return null;
  const quantity = Number((kind === "REMOVED" ? before : after).quantity);
  return `Quantity ${Number.isFinite(quantity) && quantity > 0 ? quantity : 1}`;
}

/**
 * A revision's lines as the client's EXTRA section lists them: each item once, where it stands now -
 * including the items priced with another (a new shoot's services) - split into what is added (an
 * addition, or a changed scope) and what is removed. An item taken off and put back has a line for
 * every change; only its latest is listed, so it reads under Added Items while it is on and under
 * Removed Items while it is off, never in both. Corrections are money only and are not items. No
 * amount, code or id leaves here; `rowsById` gives each line the date it happened and what changed.
 */
function clientItems(lines = [], rowsById = new Map()) {
  const collected = lines.flatMap((line) => [line, ...(line.included || [])])
    .filter((line) => line.kind !== "CORRECTION")
    .map((line) => {
      const row = rowsById.get(line.extraId);
      return {
        // Which change is the item's latest: the revision it was published in, then when it was made.
        order: [Number(row?.publishedRevision?.revisionNumber ?? 0), new Date(row?.createdAt || row?.changedAt || 0).getTime()],
        kind: line.kind,
        item: line.itemName,
        detail: detailOf(line.kind, line.category, row?.details),
        category: line.category,
        relatedShoot: line.shootName || null,
        createdDate: row?.changedAt || null,
      };
    })
    .sort((a, b) => new Date(a.createdDate || 0) - new Date(b.createdDate || 0));
  // The latest line about each item - the same shoot, service or deliverable on the same shoot - by the
  // order it was published in, not by its date: an item added back keeps the date it was first added.
  const later = (a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1];
  const latest = new Map();
  for (const item of collected) {
    const key = `${item.category}|${item.relatedShoot || ""}|${item.item}`;
    if (!latest.has(key) || later(item, latest.get(key)) >= 0) latest.set(key, item);
  }
  const items = [...latest.values()].sort((a, b) => collected.indexOf(a) - collected.indexOf(b));
  // Each shoot's structure together: grouped by the shoot, in the order the shoot first appears; the
  // shoot itself first, then its services, then its deliverables, each in the order it happened.
  const firstSeen = new Map();
  items.forEach((item, index) => { if (!firstSeen.has(item.relatedShoot)) firstSeen.set(item.relatedShoot, index); });
  const RANK = { SHOOT: 0, SERVICE: 1, DELIVERABLE: 2 };
  const order = new Map(items.map((item, index) => [item, index]));
  items.sort((a, b) => firstSeen.get(a.relatedShoot) - firstSeen.get(b.relatedShoot) || (RANK[a.category] ?? 3) - (RANK[b.category] ?? 3) || order.get(a) - order.get(b));
  const strip = ({ kind: _kind, order: _order, ...item }) => item;
  return {
    added: items.filter((item) => item.kind !== "REMOVED").map(strip),
    removed: items.filter((item) => item.kind === "REMOVED").map(strip),
  };
}

const ROW_FIELD = { SERVICE: "serviceAllocationId", DELIVERABLE: "deliverableAllocationId" };

/**
 * The approved extra quotations on a project, as the client's EXTRA section reads them - lines in the
 * shape `clientItems` takes (no amount, code or id reaches the client) and their total.
 *
 * What an approved raised request added - its shoot, services and deliverables, each as approved - is
 * listed until a published Sale Extras line speaks for the same row (a published removal, say, which the
 * revision then lists). An extra quotation raised by hand, which names a service and perhaps a shoot but
 * no row, is listed by that name. Every approved one counts in the total, whatever it lists.
 */
async function approvedExtraQuotationsFor(projectId) {
  const { approvedRequestItems } = require("./reconcile");
  const [items, extras, published] = await Promise.all([
    approvedRequestItems(prisma, projectId),
    prisma.projectExtraQuotation.findMany({ where: { projectId, status: "APPROVED", deletedAt: null }, select: { id: true, service: true, amount: true, decidedAt: true, createdAt: true, shoot: { select: { shoot: true } }, changeRequest: { select: { id: true } } } }),
    prisma.projectSaleExtra.findMany({ where: { projectId, status: "PUBLISHED", kind: { not: "CORRECTION" } }, select: { category: true, shootId: true, serviceAllocationId: true, deliverableAllocationId: true } }),
  ]);
  const spoken = new Set(published.map((line) => (line.category === "SHOOT" ? `SHOOT:${line.shootId}` : `${line.category}:${line[ROW_FIELD[line.category]]}`)));
  const requested = [...items.values()].filter((item) => !spoken.has(`${item.itemType}:${item.appliedRecordId}`));
  const idsOf = (type) => requested.filter((item) => item.itemType === type).map((item) => item.appliedRecordId);
  const [services, deliverables] = await Promise.all([
    prisma.projectPostProductionAllocation.findMany({ where: { id: { in: idsOf("SERVICE") } }, select: { id: true, shootId: true } }),
    prisma.projectShootDeliverable.findMany({ where: { id: { in: idsOf("DELIVERABLE") } }, select: { id: true, shootId: true } }),
  ]);
  const shootOf = new Map([...services, ...deliverables].map((row) => [row.id, row.shootId]));
  const shootIds = [...new Set([...shootOf.values(), ...idsOf("SHOOT")])];
  const shootNames = new Map((await prisma.projectShoot.findMany({ where: { id: { in: shootIds } }, select: { id: true, shoot: true } })).map((shoot) => [shoot.id, shoot.shoot]));

  const lines = [];
  const rows = new Map();
  for (const item of requested) {
    const extraId = `request-item-${item.id}`;
    const shootId = item.itemType === "SHOOT" ? item.appliedRecordId : shootOf.get(item.appliedRecordId);
    lines.push({ extraId, kind: "ADDED", itemName: item.itemName, category: item.itemType, shootName: shootNames.get(shootId) || null });
    rows.set(extraId, { changedAt: item.request.decidedAt, details: item.itemType === "SHOOT" ? {} : { after: { quantity: item.approvedQuantity || 1 } } });
  }
  for (const extra of extras.filter((entry) => !entry.changeRequest)) {
    const extraId = `extra-quotation-${extra.id}`;
    lines.push({ extraId, kind: "ADDED", itemName: extra.service, category: null, shootName: extra.shoot?.shoot || null });
    rows.set(extraId, { changedAt: extra.decidedAt || extra.createdAt, details: {} });
  }
  const dates = extras.map((extra) => extra.decidedAt || extra.createdAt).filter(Boolean);
  return {
    lines,
    rows,
    total: extras.reduce((sum, extra) => sum + Number(extra.amount || 0), 0),
    latestAt: dates.length ? new Date(Math.max(...dates.map((date) => new Date(date).getTime()))) : null,
  };
}

/**
 * What the client's quotation link shows: the latest published revision of the live project booked on
 * this exact, finalized version - read from the revision's frozen lines only, so a draft cannot reach
 * it - with what the project's approved extra quotations added beside it, and the updated total that
 * counts both (the figure Payments and Edit Sale Details show). Null where there is neither, and the
 * page renders exactly as it always has. The client reads the items and the updated total with its
 * date: no amounts per item, no net, no revision number, no internal id.
 */
async function publicSaleExtrasFor(quotation) {
  if (!quotation?.finalizedAt || quotation.unfinalizedAt || quotation.deletedAt) return null;
  const project = await prisma.salesProject.findFirst({ where: { quotationId: quotation.quotationId, deletedAt: null }, select: { id: true } });
  if (!project) return null;
  const revision = await prisma.projectSaleExtraRevision.findFirst({
    where: { salesQuotationId: quotation.id, projectId: project.id },
    orderBy: { revisionNumber: "desc" },
  });
  const quoted = await approvedExtraQuotationsFor(project.id);
  if (!revision && !quoted.lines.length && !quoted.total) return null;
  const lines = revision && Array.isArray(revision.lines) ? revision.lines : [];
  const ids = lines.flatMap((line) => [line, ...(line.included || [])]).map((line) => line.extraId).filter(Boolean);
  const rows = ids.length
    ? await prisma.projectSaleExtra.findMany({ where: { id: { in: ids }, projectId: project.id, status: "PUBLISHED" }, select: { id: true, changedAt: true, createdAt: true, details: true, publishedRevision: { select: { revisionNumber: true } } } })
    : [];
  const dates = [revision?.publishedAt, quoted.latestAt].filter(Boolean).map((date) => new Date(date).getTime());
  return {
    ...clientItems([...lines, ...quoted.lines], new Map([...rows.map((row) => [row.id, row]), ...quoted.rows])),
    publishedAt: dates.length ? new Date(Math.max(...dates)) : null,
    updatedTotal: Number(revision ? revision.updatedTotal : quotation.amount || 0) + quoted.total,
    gstPercent: revision ? Number(revision.gstPercent) : null,
  };
}

module.exports = { publishedSaleExtrasTotal, publicSaleExtrasFor, clientItems };
