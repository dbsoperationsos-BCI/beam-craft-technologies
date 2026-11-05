const prisma = require("../../../config/db");
const { projectAccessWhere } = require("../../../services/projectScope");
const { logProjectActivity } = require("../../../services/projectActivity");
const quotationBrands = require("../quotation-brands/service");
const { reconcileSaleExtras, trackedQuotation, nextCode, runLocked, approvedRequestItems, requestReferenceOf } = require("./reconcile");
const { signedAmount, amountProblem, revisionTotals, snapshotLines, round2 } = require("./rules");

/**
 * Sale Extras for Edit Sale Details: the section's state, a hand-typed amount on a draft, and
 * publishing a revision onto the client's existing quotation link.
 *
 * Every read reconciles first (`reconcile.js`), so what the section shows is what the project's rows
 * say now, whichever screen changed them. Money reads PUBLISHED lines only, summed as rows - never
 * revisions - so each counts once. The original quotation is never written; nothing is sent to the client.
 */

const fail = (status, message) => Object.assign(new Error(message), { status });
const sameSet = (a, b) => {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return a.length === left.length && b.length === right.length && left.length === right.length && left.every((id, index) => id === right[index]);
};

async function reachableProject(projectId, userId, { forWrite = false } = {}) {
  return prisma.salesProject.findFirst({
    where: { id: String(projectId), deletedAt: null, AND: [await projectAccessWhere({ userId: Number(userId), forWrite })] },
    select: { id: true },
  });
}

/** The quotation's GST rate exactly as its client page states it - the version's own snapshot first. */
async function gstPercentOf(quotation) {
  const presentation = await quotationBrands.presentationForQuotation(quotation);
  const value = presentation?.gstPercent ?? quotation.payload?.rates?.gstPercent ?? quotation.payload?.gstPercent ?? 0;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

const quantityOf = (row) => {
  if (row.category === "SHOOT") return null;
  const scope = row.kind === "REMOVED" ? row.details?.before : row.details?.after;
  const value = Number(scope?.quantity);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const text = (value) => String(value ?? "").trim();
const byBooking = (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id));

/**
 * The shoots the Extras cards are drawn for: each shoot something was added to, removed from or
 * changed on - its own lines are grouped under it on screen - as Service Creation heads its card: the
 * name, then id, date and place. A shoot that is itself an extra is ADDED; a booked one taken off, or
 * an extra taken off again, is REMOVED. Booked shoots first, then those added since, each in the
 * order it was created.
 */
function extraShootsOf({ shoots = [], lines = [], requestedShootIds = new Set() }) {
  const used = new Set(lines.map((line) => line.shootId).filter(Boolean));
  return shoots.filter((shoot) => used.has(shoot.id))
    .sort((a, b) => Number(!a.saleBaseline) - Number(!b.saleBaseline) || byBooking(a, b))
    .map((shoot) => ({
      id: shoot.id,
      name: text(shoot.shoot) || "Shoot",
      shootCode: shoot.shootId || null,
      date: shoot.dateCreated || null,
      place: [text(shoot.shootPlace), text(shoot.district), text(shoot.state)].filter(Boolean).join(", ") || null,
      // A shoot a raised request added is an extra shoot too, though Sale Extras does not price it.
      status: shoot.deletedAt ? "REMOVED" : shoot.saleBaseline && !requestedShootIds.has(shoot.id) ? null : "ADDED",
    }));
}

// The related shoot's id, read with every line a route answers with.
const LINE_SHOOT = { shoot: { select: { shootId: true } } };

const toLine = (row) => ({
  id: row.id,
  code: row.code,
  kind: row.kind,
  category: row.category,
  itemName: row.itemName,
  shootName: row.shootName,
  // The related shoot's own id - "DBS-SID-…" - read through the link, so a renamed shoot keeps it.
  shootCode: row.shoot?.shootId || null,
  // The project shoot the line belongs to, so the screen draws it in that shoot's card.
  shootRef: row.shootId || null,
  details: row.details,
  // The item's quantity as the change left it (as it was, for a removal); a shoot has none.
  quantity: quantityOf(row),
  amount: row.amount === null ? null : Number(row.amount),
  remarks: row.remarks || "",
  status: row.status,
  changedAt: row.changedAt,
  updatedAt: row.updatedAt,
  publishedRevisionNumber: row.publishedRevision?.revisionNumber ?? null,
  correctsExtraId: row.correctsExtraId || null,
});

const serializeRevision = (revision) => ({
  ...revision,
  originalAmount: Number(revision.originalAmount),
  netAdjustment: Number(revision.netAdjustment),
  updatedTotal: Number(revision.updatedTotal),
  gstPercent: Number(revision.gstPercent),
});

/** Priced lines with their included lines nested under them. */
function nest(rows) {
  const lines = rows.map(toLine);
  const byParent = new Map();
  for (const [index, row] of rows.entries()) {
    if (!row.parentExtraId) continue;
    byParent.set(row.parentExtraId, [...(byParent.get(row.parentExtraId) || []), lines[index]]);
  }
  return rows.map((row, index) => (row.parentExtraId ? null : { ...lines[index], included: byParent.get(row.id) || [] })).filter(Boolean);
}

/**
 * Each published, priced line with the amount it stands at now - its own and every correction made to
 * it since (`effectiveAmount`): what its Amount box shows, and what an edit is measured against.
 */
function withEffectiveAmounts(lines) {
  const corrections = lines.filter((line) => line.kind === "CORRECTION");
  return lines.map((line) => (line.status !== "PUBLISHED" || line.kind === "CORRECTION" ? line : {
    ...line,
    effectiveAmount: round2(corrections.filter((other) => other.correctsExtraId === line.id).reduce((sum, other) => sum + Number(other.amount || 0), Number(line.amount || 0))),
  }));
}

/** Why the drafts cannot be published right now, or "" when they can. */
function publishBlocker(drafts) {
  if (!drafts.length) return "Nothing new to publish.";
  const unpriced = drafts.filter((line) => line.amount === null);
  if (unpriced.length) return `Enter the amount for ${unpriced.map((line) => line.itemName).join(", ")} before publishing.`;
  return "";
}

/**
 * The Extra section of Edit Sale Details for one project, or null when the reader cannot reach it.
 * `{ tracked: false }` for a project with no finalized quotation (no section, nothing recorded).
 */
async function saleExtrasState(projectId, { userId }) {
  const project = await reachableProject(projectId, userId);
  if (!project) return null;
  const { tracked, quotation } = await runLocked(prisma, (tx) => reconcileSaleExtras(tx, project.id, { userId }));
  if (!tracked) return { tracked: false };
  const where = { projectId: project.id };
  const [rows, revisions, shoots] = await Promise.all([
    prisma.projectSaleExtra.findMany({ where: { projectId: project.id, status: { in: ["DRAFT", "PUBLISHED"] } }, include: { publishedRevision: { select: { revisionNumber: true } }, ...LINE_SHOOT }, orderBy: [{ changedAt: "asc" }, { createdAt: "asc" }] }),
    prisma.projectSaleExtraRevision.findMany({ where: { projectId: project.id }, orderBy: { revisionNumber: "asc" } }),
    prisma.projectShoot.findMany({ where, select: { id: true, shootId: true, shoot: true, dateCreated: true, district: true, state: true, shootPlace: true, saleBaseline: true, deletedAt: true, createdAt: true } }),
  ]);
  const actions = await lineActions(rows);
  const requested = await requestedLines(project.id, { rows, shoots });
  const extraQuotations = await prisma.projectExtraQuotation.aggregate({ where: { projectId: project.id, status: "APPROVED", deletedAt: null }, _sum: { amount: true } });
  const priced = rows.filter((row) => !row.parentExtraId);
  const draftLines = priced.filter((row) => row.status === "DRAFT");
  const publishedNet = round2(priced.filter((row) => row.status === "PUBLISHED").reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const original = Number(quotation.amount || 0);
  return {
    tracked: true,
    // The token is the client's link, opened from the section after publishing (this route is signed-in).
    quotation: { id: quotation.id, quotationId: quotation.quotationId, version: quotation.version, amount: original, publicToken: quotation.publicToken },
    extraShoots: extraShootsOf({ shoots, lines: [...rows, ...requested.map((line) => ({ shootId: line.shootRef }))], requestedShootIds: new Set(requested.filter((line) => line.category === "SHOOT").map((line) => line.shootRef)) }),
    gstPercent: await gstPercentOf(quotation),
    lines: [...withEffectiveAmounts(nest(rows)).map((line) => ({ ...line, action: actions.get(line.id) || null })), ...requested],
    // The approved extra quotations - counted on the project's Payments, not here - so the section's
    // Updated Total can say what the project now comes to.
    extraQuotationTotal: round2(Number(extraQuotations._sum.amount || 0)),
    draftTotal: round2(draftLines.reduce((sum, row) => sum + Number(row.amount || 0), 0)),
    publishedNet,
    updatedTotal: round2(original + publishedNet),
    latestRevisionNumber: revisions.length ? revisions[revisions.length - 1].revisionNumber : 0,
    // Published priced lines - whether Shedule Payment shows Net Extra and Updated Total at all.
    publishedCount: priced.filter((row) => row.status === "PUBLISHED").length,
    // Each revision carries its cumulative net and total (every line published so far); its own
    // change is the difference from the revision before it.
    revisions: revisions.map(serializeRevision).map((revision, index, all) => ({
      ...revision,
      revisionAdjustment: round2(revision.netAdjustment - (index ? all[index - 1].netAdjustment : 0)),
    })),
    canPublishReason: publishBlocker(draftLines.map(toLine)),
  };
}

/**
 * A hand-typed amount (and remarks) on one unpublished line, inside the caller's locked transaction;
 * its sign follows the kind of change. ₹0 is an amount; only an empty box is "not priced yet".
 */
async function applyAmount(tx, projectId, { id, amount, remarks }) {
  const line = await tx.projectSaleExtra.findFirst({ where: { id: String(id), projectId } });
  if (!line) throw fail(404, "Extra not found.");
  if (line.status === "CANCELLED") throw fail(409, `${line.itemName} has changed since this screen was loaded. Reload to see it as it is now.`);
  if (line.status !== "DRAFT") throw fail(409, `${line.itemName} is published and cannot be changed. Use Correct to put its amount right in the next revision.`);
  if (line.parentExtraId) throw fail(400, `${line.itemName} is included in the price of the line above it.`);
  // An amount left out of the request is left as it is (a remarks-only save); null or "" clears it.
  const data = remarks !== undefined ? { remarks: remarks ? String(remarks).slice(0, 2000) : null } : {};
  if (amount !== undefined) {
    const value = amount === null || amount === "" ? null : signedAmount(line.kind, amount);
    if (value !== null) {
      const problem = amountProblem(value);
      if (problem) throw fail(400, `${line.itemName}: ${problem}`);
    }
    if (value === null && line.kind === "CORRECTION") throw fail(400, "A correction needs its amount.");
    data.amount = value === null ? null : value.toFixed(2);
  }
  if (Object.keys(data).length) await tx.projectSaleExtra.update({ where: { id: line.id }, data });
  return toLine(await tx.projectSaleExtra.findUnique({ where: { id: line.id }, include: LINE_SHOOT }));
}

/**
 * A published line's Amount box changed: the line itself never changes - the difference between what
 * was typed and what the line stands at (its amount and its published corrections) becomes a
 * CORRECTION line published with this revision, in place of any correction not yet published for it.
 * Remarks are internal and are kept on the row. Inside the publish transaction.
 */
async function applyPublishedEdit(tx, projectId, { id, amount, remarks }, userId) {
  const line = await tx.projectSaleExtra.findFirst({ where: { id: String(id), projectId } });
  if (!line) throw fail(404, "Extra not found.");
  if (line.status !== "PUBLISHED" || line.kind === "CORRECTION" || line.parentExtraId) throw fail(409, `${line.itemName} has changed since this screen was loaded. Reload to see it as it is now.`);
  let remarked = false;
  if (remarks !== undefined) {
    const next = remarks ? String(remarks).slice(0, 2000) : null;
    if ((line.remarks || null) !== next) { await tx.projectSaleExtra.update({ where: { id: line.id }, data: { remarks: next } }); remarked = true; }
  }
  if (amount === undefined) return { remarked };
  if (amount === null || amount === "") throw fail(400, `Enter the amount for ${line.itemName}.`);
  const value = signedAmount(line.kind, amount);
  const problem = amountProblem(value);
  if (problem) throw fail(400, `${line.itemName}: ${problem}`);
  const corrections = await tx.projectSaleExtra.findMany({ where: { projectId, correctsExtraId: line.id, status: "PUBLISHED" }, select: { amount: true } });
  const standing = round2(corrections.reduce((sum, row) => sum + Number(row.amount || 0), Number(line.amount || 0)));
  const difference = round2(value - standing);
  await tx.projectSaleExtra.updateMany({ where: { projectId, correctsExtraId: line.id, status: "DRAFT" }, data: { status: "CANCELLED" } });
  if (difference === 0) return { remarked };
  await tx.projectSaleExtra.create({ data: {
    code: await nextCode(tx),
    projectId,
    kind: "CORRECTION",
    category: line.category,
    shootId: line.shootId,
    itemName: `${line.itemName} (correction)`.slice(0, 191),
    shootName: line.shootName,
    amount: difference.toFixed(2),
    changedAt: new Date(),
    correctsExtraId: line.id,
    createdBy: userId || null,
  } });
  return { remarked };
}

/**
 * Publish Updated Quotation: the amounts and remarks typed on screen, and the reviewed lines, as the
 * project's next revision - one transaction that reconciles under the project lock and then locks the
 * quotation version (which unfinalizing locks too). Anything moved since the review - a line added,
 * removed or edited, another revision landed - is refused (409). The typed values are applied next:
 * each unpublished line's amount (required; ₹0 is an amount) and remarks (`lines`), and each published
 * line's edit (`published`), which becomes a correction. A line still without its amount, or nothing
 * new, is refused (400) and nothing is kept. The unique revision number is the last guard. No
 * notification is sent. Changed remarks alone, with nothing to publish, are kept and answered
 * `{ remarksOnly: true }`.
 */
async function publish(projectId, { draftIds = [], reviewed = {}, expectedRevision = 0, lines: typed = [], published: edits = [] }, user) {
  const project = await reachableProject(projectId, user.id, { forWrite: true });
  if (!project) throw fail(404, "Project not found.");
  const account = await prisma.user.findUnique({ where: { id: Number(user.id) }, select: { id: true, name: true } });
  const STALE = "These extras have changed since you reviewed them. Review them again before publishing.";
  const ids = [...typed, ...edits].map((entry) => String(entry.id));
  if (new Set(ids).size !== ids.length) throw fail(400, "Each item can be sent once.");
  // Read before the transaction, so the publish holds one connection; checked against the locked row below.
  const expectedQuotation = await trackedQuotation(prisma, project.id);
  const gstPercent = expectedQuotation ? await gstPercentOf(expectedQuotation) : 0;
  try {
    return await runLocked(prisma, async (tx) => {
      const { tracked, quotation } = await reconcileSaleExtras(tx, project.id, { userId: account?.id });
      if (!tracked) throw fail(400, "This project has no finalized quotation to publish onto.");
      // Locked and read again: an unfinalize that landed since is refused here rather than published past.
      await tx.$queryRaw`SELECT id FROM sales_quotation WHERE id = ${quotation.id} FOR UPDATE`;
      const lockedQuotation = await tx.salesQuotation.findUnique({ where: { id: quotation.id }, select: { finalizedAt: true, unfinalizedAt: true, deletedAt: true } });
      if (!lockedQuotation?.finalizedAt || lockedQuotation.unfinalizedAt || lockedQuotation.deletedAt) throw fail(409, "The project's quotation is no longer finalized, so there is nothing to publish onto.");
      if (expectedQuotation?.id !== quotation.id) throw fail(409, STALE);
      const latest = await tx.projectSaleExtraRevision.findFirst({ where: { projectId: project.id }, orderBy: { revisionNumber: "desc" }, select: { revisionNumber: true } });
      const current = latest?.revisionNumber || 0;
      if (current !== Number(expectedRevision)) throw fail(409, STALE);

      const reviewedDrafts = await tx.projectSaleExtra.findMany({ where: { projectId: project.id, status: "DRAFT" } });
      const reviewedPriced = reviewedDrafts.filter((row) => !row.parentExtraId);
      if (!sameSet(reviewedPriced.map((row) => row.id), draftIds)) throw fail(409, STALE);
      if (reviewedPriced.some((row) => !reviewed?.[row.id] || new Date(reviewed[row.id]).getTime() !== row.updatedAt.getTime())) throw fail(409, STALE);
      // What was typed on screen, applied now; a refusal rolls all of it back.
      const reviewedIds = new Set(reviewedPriced.map((row) => row.id));
      for (const entry of typed) {
        if (!reviewedIds.has(String(entry.id))) throw fail(409, STALE);
        await applyAmount(tx, project.id, entry);
      }
      let remarked = false;
      for (const entry of edits) remarked = (await applyPublishedEdit(tx, project.id, entry, account?.id)).remarked || remarked;
      const drafts = await tx.projectSaleExtra.findMany({ where: { projectId: project.id, status: "DRAFT" } });
      const priced = drafts.filter((row) => !row.parentExtraId);
      if (!priced.length && remarked) return { remarksOnly: true };
      const blocked = publishBlocker(priced.map(toLine));
      if (blocked) throw fail(400, blocked);

      const { count } = await tx.projectSaleExtra.updateMany({ where: { id: { in: drafts.map((row) => row.id) }, status: "DRAFT" }, data: { status: "PUBLISHED" } });
      if (count !== drafts.length) throw fail(409, STALE);
      const published = await tx.projectSaleExtra.findMany({
        where: { projectId: project.id, status: "PUBLISHED" },
        include: { publishedRevision: { select: { revisionNumber: true } } },
        orderBy: [{ changedAt: "asc" }, { createdAt: "asc" }],
      });
      const lines = snapshotLines(published.map((row) => ({ ...row, publishedIn: row.publishedRevision?.revisionNumber ?? current + 1 })));
      const totals = revisionTotals(quotation.amount, lines);
      const revision = await tx.projectSaleExtraRevision.create({ data: {
        projectId: project.id,
        salesQuotationId: quotation.id,
        revisionNumber: current + 1,
        originalAmount: totals.originalAmount.toFixed(2),
        netAdjustment: totals.netAdjustment.toFixed(2),
        updatedTotal: totals.updatedTotal.toFixed(2),
        gstPercent: gstPercent.toFixed(2),
        lines,
        publishedById: account?.id || null,
        publishedByName: account?.name || "Unknown",
      } });
      await tx.projectSaleExtra.updateMany({ where: { id: { in: drafts.map((row) => row.id) } }, data: { publishedRevisionId: revision.id } });
      await logProjectActivity({
        projectId: project.id,
        area: "PROJECT",
        action: "SALE_EXTRAS_PUBLISHED",
        detail: `Extras R${revision.revisionNumber} published on ${quotation.quotationId}: net ${totals.netAdjustment}, updated total ${totals.updatedTotal}`,
        userId: account?.id || null,
      }, { client: tx });
      return serializeRevision(revision);
    });
  } catch (error) {
    if (error.code === "P2002") throw fail(409, "These extras have just been published by someone else. Reload to see the new revision.");
    throw error;
  }
}

const ROW_OF = { SERVICE: "serviceAllocationId", DELIVERABLE: "deliverableAllocationId" };

/**
 * What approved raised requests put on the plan, as read-only Added lines (`status: "EXTRA_QUOTATION"`):
 * priced on the request's extra quotation and counted on Payments, so never typed or counted again here.
 * Only while the row is on its shoot and nothing in Sale Extras speaks for it - removed, it is a Removed
 * line like any other; changed and priced here, that line is the one shown. Ids are `request-item-<id>`.
 */
async function requestedLines(projectId, { rows, shoots }) {
  const items = [...(await approvedRequestItems(prisma, projectId)).values()];
  if (!items.length) return [];
  const idsOf = (type) => items.filter((item) => item.itemType === type).map((item) => item.appliedRecordId);
  const select = { id: true, shootId: true, deletedAt: true };
  const [services, deliverables] = await Promise.all([
    prisma.projectPostProductionAllocation.findMany({ where: { id: { in: idsOf("SERVICE") } }, select }),
    prisma.projectShootDeliverable.findMany({ where: { id: { in: idsOf("DELIVERABLE") } }, select }),
  ]);
  const shootById = new Map(shoots.map((shoot) => [shoot.id, shoot]));
  const rowOf = new Map([...services.map((row) => [`SERVICE:${row.id}`, row]), ...deliverables.map((row) => [`DELIVERABLE:${row.id}`, row]), ...shoots.map((shoot) => [`SHOOT:${shoot.id}`, { id: shoot.id, shootId: shoot.id, deletedAt: shoot.deletedAt }])]);
  const spoken = new Set(rows.filter((row) => row.kind !== "CORRECTION").map((row) => (row.category === "SHOOT" ? `SHOOT:${row.shootId}` : `${row.category}:${row[ROW_OF[row.category]]}`)));
  return items.flatMap((item) => {
    const key = `${item.itemType}:${item.appliedRecordId}`;
    const row = rowOf.get(key);
    const shoot = row && shootById.get(row.shootId);
    if (!row || row.deletedAt || !shoot || shoot.deletedAt || spoken.has(key)) return [];
    return [{
      id: `request-item-${item.id}`,
      code: item.request.requestCode,
      kind: "ADDED",
      category: item.itemType,
      itemName: item.itemName,
      shootName: shoot.shoot || null,
      shootCode: shoot.shootId || null,
      shootRef: row.shootId,
      details: { source: "EXTRA_QUOTATION", reference: requestReferenceOf(item), request: item.request.requestCode },
      quantity: item.itemType === "SHOOT" ? null : item.approvedQuantity || null,
      amount: Number(item.approvedAmount || 0),
      remarks: "",
      status: "EXTRA_QUOTATION",
      changedAt: item.request.decidedAt,
      updatedAt: item.request.decidedAt,
      publishedRevisionNumber: null,
      correctsExtraId: null,
      // Taken off from here as any service or deliverable is; a whole shoot goes from Service Creation.
      action: item.itemType === "SHOOT" ? null : "REMOVE",
    }];
  });
}

/**
 * What each line's ⋮ offers, by id: `REMOVE` on the newest line about a service or deliverable that is
 * on its shoot (an addition or a scope change, published or not), `ADD_BACK` on the newest line about
 * one that is off (its removal, published or not). Older lines about the same item, corrections, shoots
 * and an item whose shoot was removed offer nothing - so an item can be taken off and put back any
 * number of times, always from its latest line.
 */
async function lineActions(rows, client = prisma) {
  const newer = (a, b) => (a.status === "DRAFT") !== (b.status === "DRAFT") ? a.status === "DRAFT" : new Date(a.createdAt) > new Date(b.createdAt);
  const latest = new Map();
  for (const line of rows) {
    const field = ROW_OF[line.category];
    if (!field || !line[field] || line.kind === "CORRECTION" || !["DRAFT", "PUBLISHED"].includes(line.status)) continue;
    const key = `${line.category}:${line[field]}`;
    if (!latest.has(key) || newer(line, latest.get(key))) latest.set(key, line);
  }
  const idsOf = (category) => [...latest.values()].filter((line) => line.category === category).map((line) => line[ROW_OF[category]]);
  const select = { id: true, shootId: true, deletedAt: true };
  const [services, deliverables] = await Promise.all([
    client.projectPostProductionAllocation.findMany({ where: { id: { in: idsOf("SERVICE") } }, select }),
    client.projectShootDeliverable.findMany({ where: { id: { in: idsOf("DELIVERABLE") } }, select }),
  ]);
  const items = new Map([...services, ...deliverables].map((row) => [row.id, row]));
  const liveShoots = new Set((await client.projectShoot.findMany({ where: { id: { in: [...new Set([...items.values()].map((row) => row.shootId))] }, deletedAt: null }, select: { id: true } })).map((shoot) => shoot.id));
  const actions = new Map();
  for (const line of latest.values()) {
    const row = items.get(line[ROW_OF[line.category]]);
    if (!row || !liveShoots.has(row.shootId)) continue;
    if (!row.deletedAt && (line.kind === "ADDED" || line.kind === "MODIFIED")) actions.set(line.id, "REMOVE");
    if (row.deletedAt && line.kind === "REMOVED") actions.set(line.id, "ADD_BACK");
  }
  return actions;
}

/** A raised request's item still on its shoot, as a line `removeAdded` can take off - refused otherwise. */
async function requestedItemFor(tx, projectId, extraId) {
  const item = await tx.projectChangeRequestItem.findFirst({ where: { id: Number(String(extraId).replace("request-item-", "")) || 0, decision: "APPROVED", itemType: { in: ["SERVICE", "DELIVERABLE"] }, request: { projectId } }, select: { itemType: true, itemName: true, appliedRecordId: true } });
  const sameRow = item ? await tx.projectSaleExtra.findFirst({ where: { projectId, status: { in: ["DRAFT", "PUBLISHED"] }, kind: { not: "CORRECTION" }, [ROW_OF[item.itemType]]: item.appliedRecordId } }) : null;
  if (!item || sameRow) throw fail(409, "This item is no longer listed that way. Reload to see the extras as they stand.");
  return { category: item.itemType, itemName: item.itemName, kind: "ADDED", status: "EXTRA_QUOTATION", [ROW_OF[item.itemType]]: item.appliedRecordId, shootId: null };
}

/** The line, read in the transaction, with the action its ⋮ offers now - refused when it offers another. */
async function lineFor(tx, projectId, extraId, action) {
  const rows = await tx.projectSaleExtra.findMany({ where: { projectId } });
  const line = rows.find((row) => row.id === String(extraId));
  if (!line || (await lineActions(rows, tx)).get(line.id) !== action) {
    throw fail(409, action === "ADD_BACK" ? "This item is no longer off its shoot. Reload to see the extras as they stand." : "This item is no longer on its shoot. Reload to see the extras as they stand.");
  }
  return line;
}

/**
 * Add back, in a Removed line's ⋮: the service or deliverable put back on its shoot exactly as it was -
 * the same row and its configuration. While its removal is unpublished the removal simply goes and
 * nothing reads as added: a quoted item is back as quoted, an extra at the amount it was published at
 * (that line still stands). Once its removal was published the client has been shown it gone, so it
 * comes back as an addition, starting at the value it had. A quoted service also brings back the
 * post-production work rows its removal closed and the deliverables it brings with it, as adding it does
 * (any of those that were quoted come back as quoted, `moveReplacedBaselines`); an extra's own
 * deliverables are each added back from their own line. As often as it is taken off.
 */
async function restoreRemoved(projectId, extraId, { userId }) {
  const project = await reachableProject(projectId, userId, { forWrite: true });
  if (!project) return null;
  const restored = await runLocked(prisma, async (tx) => {
    // The lock is reconcile's first read, and the line is read as it stands after it.
    await reconcileSaleExtras(tx, project.id, { userId });
    const line = await lineFor(tx, project.id, extraId, "ADD_BACK");
    const isService = line.category === "SERVICE";
    const model = isService ? tx.projectPostProductionAllocation : tx.projectShootDeliverable;
    const row = await model.findFirst({ where: { id: line[ROW_OF[line.category]], projectId: project.id } });
    const live = await model.findMany({ where: { projectId: project.id, shootId: row.shootId, deletedAt: null } });
    const projects = require("../projects/controller");
    const sameItem = isService
      ? (other) => (other.serviceDefinitionId || other.serviceName) === (row.serviceDefinitionId || row.serviceName)
      : (other) => projects.deliverableLineKey(other.deliverableDefinitionId || other.deliverableName, other) === projects.deliverableLineKey(row.deliverableDefinitionId || row.deliverableName, row);
    if (live.some(sameItem)) throw fail(409, `${line.itemName} is already back on the shoot.`);

    await model.update({ where: { id: row.id }, data: { deletedAt: null } });
    if (isService) {
      // What its removal closed at the same moment, and the deliverables the service brings.
      await tx.projectPostProductionWorkflowAllocation.updateMany({ where: { serviceAllocationId: row.id, projectId: project.id, deletedAt: row.deletedAt }, data: { deletedAt: null } });
      if (row.saleBaseline) await projects.syncAutoDeliverablesForShoot(tx, project.id, row.shootId);
    }
    await reconcileSaleExtras(tx, project.id, { userId });
    return { itemName: line.itemName, category: line.category, shootId: row.shootId, source: line.details?.source || (row.saleBaseline ? "QUOTATION" : "EXTRA"), afterPublishedRemoval: line.status === "PUBLISHED" };
  });
  await logProjectActivity({ projectId: project.id, shootId: restored.shootId, area: "PROJECT", action: restored.category === "SERVICE" ? "SERVICE_ADDED" : "DELIVERABLE_ADDED", detail: `${restored.category === "SERVICE" ? "Service" : "Deliverable"} added back from Sale Extras: ${restored.itemName}`, userId }).catch(() => {});
  return restored;
}

/**
 * Remove, in an Added line's ⋮: the service or deliverable taken off its shoot exactly as Service
 * Creation takes one off (`removeServiceAllocationInTx` / `removeDeliverableAllocationInTx`). An addition
 * never published simply goes; anything the client has been shown becomes a Removed line, starting at
 * the value it stood at, with Add back in its own ⋮.
 */
async function removeAdded(projectId, extraId, { userId }) {
  const project = await reachableProject(projectId, userId, { forWrite: true });
  if (!project) return null;
  const removed = await runLocked(prisma, async (tx) => {
    await reconcileSaleExtras(tx, project.id, { userId });
    const line = String(extraId).startsWith("request-item-") ? await requestedItemFor(tx, project.id, extraId) : await lineFor(tx, project.id, extraId, "REMOVE");
    const projects = require("../projects/controller");
    const result = line.category === "SERVICE"
      ? await projects.removeServiceAllocationInTx(tx, project.id, line.serviceAllocationId)
      : await projects.removeDeliverableAllocationInTx(tx, project.id, line.deliverableAllocationId);
    if (result.count !== 1) throw fail(409, "This item is no longer on its shoot. Reload to see the extras as they stand.");
    await reconcileSaleExtras(tx, project.id, { userId });
    return { itemName: line.itemName, category: line.category, shootId: line.shootId, neverPublished: line.kind === "ADDED" && line.status === "DRAFT" };
  });
  await logProjectActivity({ projectId: project.id, shootId: removed.shootId, area: "PROJECT", action: removed.category === "SERVICE" ? "SERVICE_REMOVED" : "DELIVERABLE_REMOVED", detail: `${removed.category === "SERVICE" ? "Service" : "Deliverable"} removed from Sale Extras: ${removed.itemName}`, userId }).catch(() => {});
  return removed;
}

module.exports = { saleExtrasState, extraShootsOf, publish, serializeRevision, restoreRemoved, removeAdded };
