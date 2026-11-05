const { Prisma } = require("@prisma/client");
const { scopeOf, sameScope } = require("./rules");

/**
 * Sale Extras' recorder: the project's shoots, services and deliverables compared with what the
 * finalized quotation booked and what has already been published, written as DRAFT lines.
 *
 * It compares *outcomes*, not actions, so a change made on any screen - Edit Sale Details, Edit /
 * Start Project, an import, the client portal - is caught the same way, and so is a path added later.
 * For every row it asks two things:
 *
 *   - what has been **accounted** for it: its baseline (present, at the booked scope) or nothing,
 *     moved on by each PUBLISHED line about it in revision order (added / modified -> present at that
 *     scope, removed -> absent);
 *   - what it **is** now: present at its current scope, or absent (deleted).
 *
 * The difference is the line: absent -> present is ADDED, present -> absent is REMOVED, a scope
 * change is MODIFIED (a shoot has no scope; rescheduling it is not an extra). No difference, no line:
 * an addition removed again before publishing, or an edit put back, leaves nothing behind.
 *
 * Every shoot, service and deliverable is a line of its own, priced on its own - a new shoot's services
 * and deliverables too, and what was removed together with a shoot - so each is counted exactly once.
 * A draft that an earlier version of this recorder had folded under another (`parentExtraId`) is
 * made independent again; a published line is never rewritten.
 *
 * Runs under a lock on the project row, inside the caller's transaction. Idempotent. Writes nothing
 * to an operational row except `saleBaseline`, moved from a quoted row to the identical row that took
 * its place on the shoot (a recreate, or the quoted item added back - not a change).
 */

/**
 * The transaction options every caller of `reconcileSaleExtras` uses: a project's whole plan is read
 * and written under its lock, which can take longer than Prisma's 5-second default.
 */
const RECONCILE_TX = { timeout: 30000, maxWait: 10000 };

/**
 * A Sale Extras transaction, run again when InnoDB picks it as a deadlock victim (P2034): staff saving
 * or publishing on different projects at once contend for the shared code counter and its indexes. The
 * victim rolled back whole and every check inside it is re-read, so running it again is safe; jittered,
 * as image-selection's `finalize` does, so the colliders do not charge back in step.
 */
async function runLocked(client, work) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.$transaction(work, RECONCILE_TX);
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1) + Math.random() * 100));
    }
  }
}

// MySQL stores JSON with its keys re-ordered, so a stored value is compared key-order-independently.
const canonical = (value) => JSON.stringify(value, (key, inner) => (inner && typeof inner === "object" && !Array.isArray(inner)
  ? Object.fromEntries(Object.keys(inner).sort().map((name) => [name, inner[name]]))
  : inner));

const ROW_FIELD = { SHOOT: "shootId", SERVICE: "serviceAllocationId", DELIVERABLE: "deliverableAllocationId" };
const keyOf = (kind, category, rowId) => `${kind}:${category}:${rowId}`;
const lineKey = (line) => keyOf(line.kind, line.category, line[ROW_FIELD[line.category]]);

async function nextCode(tx) {
  const row = await tx.appSequence.upsert({
    where: { key: "PROJECT_SALE_EXTRA_ID" },
    create: { key: "PROJECT_SALE_EXTRA_ID", currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  return `SXT-${String(row.currentValue).padStart(6, "0")}`;
}

/** The finalized quotation version a project is booked on, or null - and with it, whether it is tracked. */
async function trackedQuotation(tx, projectId) {
  const project = await tx.salesProject.findFirst({ where: { id: String(projectId), deletedAt: null }, select: { id: true, quotationId: true } });
  if (!project?.quotationId) return null;
  return tx.salesQuotation.findFirst({ where: { quotationId: project.quotationId, deletedAt: null, finalizedAt: { not: null }, unfinalizedAt: null } });
}

const deliverableVariant = (row) => [row.deliverableDefinitionId || row.deliverableName, row.brandName, row.size, row.frameInches, row.videoLength].map((part) => part || "").join("|");
const serviceIdentity = (row) => row.serviceDefinitionId || row.serviceName;

/**
 * A quoted row deleted, and the same item on the same shoot there again - recreated by a screen that
 * saves that way, or added back by hand later (picked again in Service Creation, or Restore on its
 * Removed line) - is one item, not a removal and an addition: its baseline moves to the live row, so
 * the removal and the addition both go and the item reads as quoted. Only while the removal is
 * unpublished: once the client has been shown it gone, putting it back is an extra like any other.
 */
async function moveReplacedBaselines(tx, rows, model, identity, publishedRowIds) {
  const taken = new Set();
  for (const old of rows.filter((row) => row.deletedAt && row.saleBaseline && !publishedRowIds.has(row.id))) {
    const replacement = rows.find((row) => !row.deletedAt && !row.saleBaseline && !taken.has(row.id) && !publishedRowIds.has(row.id)
      && row.shootId === old.shootId && identity(row) === identity(old));
    if (!replacement) continue;
    taken.add(replacement.id);
    await tx[model].update({ where: { id: replacement.id }, data: { saleBaseline: old.saleBaseline } });
    await tx[model].update({ where: { id: old.id }, data: { saleBaseline: Prisma.DbNull } });
    replacement.saleBaseline = old.saleBaseline;
    old.saleBaseline = null;
  }
}

/**
 * What the published lines say about a row: present at a scope, or absent - and, while present, where
 * it came from (`QUOTATION` for the finalized quotation's own row, `EXTRA` for one published as added)
 * and the published lines since then that priced it (`pricedBy`: its addition, a scope change) - or,
 * while absent, the published removal that took it off (`removedBy`).
 */
function accountedFor(category, row, publishedLines) {
  let state = row.saleBaseline
    ? { present: true, scope: category === "SHOOT" ? {} : scopeOf(category, row.saleBaseline), source: "QUOTATION", pricedBy: [] }
    : { present: false, scope: null, source: null, pricedBy: [] };
  for (const line of publishedLines) {
    if (line[ROW_FIELD[category]] !== row.id || line.category !== category) continue;
    if (line.kind === "REMOVED") state = { present: false, scope: null, source: null, pricedBy: [], removedBy: line };
    else if (line.kind === "ADDED") state = { present: true, scope: line.details?.after ?? scopeOf(category, row), source: "EXTRA", pricedBy: [line] };
    else state = { present: true, scope: line.details?.after ?? state.scope ?? scopeOf(category, row), source: state.source || "EXTRA", pricedBy: [...state.pricedBy, line] };
  }
  return state;
}

/** The line a row needs, or null. */
function wantedFor(category, row, accounted) {
  if (accounted.present && row.deletedAt) return { kind: "REMOVED", changedAt: row.deletedAt, details: { before: accounted.scope, source: accounted.source } };
  if (!accounted.present && !row.deletedAt) return { kind: "ADDED", changedAt: row.saleBaseline ? row.updatedAt : row.createdAt, details: { after: scopeOf(category, row) } };
  if (accounted.present && !row.deletedAt && category !== "SHOOT" && !sameScope(category, accounted.scope, row)) {
    return { kind: "MODIFIED", changedAt: row.updatedAt, details: { before: accounted.scope, after: scopeOf(category, row) } };
  }
  return null;
}

const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const money = (value) => Math.round(Number(value) * 100) / 100;

/**
 * What the finalized quotation priced a quoted row at: its line's unit price x quantity, 0 where the
 * line was complimentary - the line's own price, before the quotation's overall discount. Found by the
 * same service (or deliverable and variant) under the shoot of the same name, else the one line there
 * is for it; null where the quotation does not say (a plan baselined from a quotation linked later).
 */
function quotedValueOf(category, row, quotation, shootName) {
  const payload = quotation?.payload || {};
  const shootNames = new Map((Array.isArray(payload.shoots) ? payload.shoots : []).map((shoot) => [shoot.id, norm(shoot.shoot)]));
  const lines = category === "SERVICE" ? payload.services : payload.deliverables;
  const same = category === "SERVICE"
    ? (line) => Boolean(line.serviceDefinitionId) && line.serviceDefinitionId === row.serviceDefinitionId
    : (line) => Boolean(line.deliverableDefinitionId) && line.deliverableDefinitionId === row.deliverableDefinitionId
      && norm(line.deliverableBrandName) === norm(row.brandName) && norm(line.size) === norm(row.size)
      && norm(line.frameInches) === norm(row.frameInches) && norm(line.videoLength) === norm(row.videoLength);
  const candidates = (Array.isArray(lines) ? lines : []).filter(same);
  const underShoot = candidates.filter((line) => shootNames.get(line.shootId) === norm(shootName));
  const line = underShoot[0] || (candidates.length === 1 ? candidates[0] : null);
  if (!line) return null;
  if (line.complimentary === true) return 0;
  const unit = Number(line.unitPrice);
  return Number.isFinite(unit) ? money(unit * (Number(line.quantity) || 1)) : null;
}

/**
 * The value a removed row stood at: what the quotation priced it at (a quoted row) or nothing (one
 * published as added), plus every published line that priced it since - its addition, a scope change -
 * each with the corrections made to it. What a Removed line starts at; the studio may change it.
 */
function removedValueOf(category, row, accounted, { quotation, shootName, corrections }) {
  const base = accounted.source === "QUOTATION" ? quotedValueOf(category, row, quotation, shootName) : 0;
  if (base === null && !accounted.pricedBy.length) return null;
  const priced = accounted.pricedBy.reduce((sum, line) => sum + Number(line.amount || 0) + (corrections.get(line.id) || 0), 0);
  return money((base || 0) + priced);
}

/**
 * The approved items of the project's raised requests (Client Requests -> Raised Requests), by the row
 * each wrote: `SERVICE:<allocation id>`, `DELIVERABLE:<deliverable id>`, `SHOOT:<shoot id>`. Those rows
 * are priced on the request's extra quotation, so Sale Extras reads them as such - shown as already
 * counted while on the plan, and taken off at the amount approved for them once removed.
 */
async function approvedRequestItems(client, projectId) {
  const items = await client.projectChangeRequestItem.findMany({
    where: { decision: "APPROVED", appliedRecordId: { not: null }, itemType: { in: ["SHOOT", "SERVICE", "DELIVERABLE"] }, request: { projectId: String(projectId), status: { in: ["ACCEPTED", "PARTIALLY_ACCEPTED"] } } },
    select: { id: true, itemType: true, itemName: true, approvedAmount: true, approvedQuantity: true, appliedRecordId: true, request: { select: { requestCode: true, decidedAt: true, extraQuotation: { select: { requestCode: true, status: true, deletedAt: true } } } } },
  });
  return new Map(items.map((item) => [`${item.itemType}:${item.appliedRecordId}`, item]));
}

/** What a request item is known by: its extra quotation's code, or - priced at nothing - the request's. */
const requestReferenceOf = (item) => (item.request.extraQuotation && !item.request.extraQuotation.deletedAt ? item.request.extraQuotation.requestCode : item.request.requestCode);

async function reconcileSaleExtras(tx, projectId, { userId = null } = {}) {
  // The lock comes first, before anything is read: under REPEATABLE READ a read taken before it would
  // fix the transaction's snapshot, and two readers waiting on each other would both see "no line yet".
  await tx.$queryRaw`SELECT id FROM sales_project WHERE id = ${String(projectId)} FOR UPDATE`;
  const quotation = await trackedQuotation(tx, projectId);
  if (!quotation) return { tracked: false, quotation: null };

  const where = { projectId: String(projectId) };
  const [shoots, services, deliverables, lines] = await Promise.all([
    tx.projectShoot.findMany({ where, select: { id: true, shootId: true, shoot: true, saleBaseline: true, createdAt: true, updatedAt: true, deletedAt: true } }),
    tx.projectPostProductionAllocation.findMany({ where }),
    tx.projectShootDeliverable.findMany({ where }),
    tx.projectSaleExtra.findMany({ where, include: { publishedRevision: { select: { revisionNumber: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  // Corrections are typed by the studio, not found in the plan: reconcile neither reads nor cancels them.
  const planLines = lines.filter((line) => line.kind !== "CORRECTION");
  const published = planLines.filter((line) => line.status === "PUBLISHED")
    .sort((a, b) => (a.publishedRevision?.revisionNumber || 0) - (b.publishedRevision?.revisionNumber || 0) || a.createdAt - b.createdAt);
  const publishedRowIds = new Set(published.flatMap((line) => [line.serviceAllocationId, line.deliverableAllocationId]).filter(Boolean));
  await moveReplacedBaselines(tx, services, "projectPostProductionAllocation", serviceIdentity, publishedRowIds);
  await moveReplacedBaselines(tx, deliverables, "projectShootDeliverable", deliverableVariant, publishedRowIds);

  // Each published line's corrections, so a removal starts at what the line stands at now.
  const corrections = new Map();
  for (const line of lines.filter((entry) => entry.kind === "CORRECTION" && entry.status === "PUBLISHED" && entry.correctsExtraId)) {
    corrections.set(line.correctsExtraId, (corrections.get(line.correctsExtraId) || 0) + Number(line.amount || 0));
  }
  const fromRequests = await approvedRequestItems(tx, projectId);
  const shootById = new Map(shoots.map((shoot) => [shoot.id, shoot]));
  const shootName = (shootId) => shootById.get(shootId)?.shoot || shootById.get(shootId)?.shootId || null;
  const wanted = new Map();
  const want = (category, row, itemName) => {
    const accounted = accountedFor(category, row, published);
    const line = wantedFor(category, row, accounted);
    if (!line) return null;
    const requested = line.kind === "REMOVED" && accounted.source === "QUOTATION" ? fromRequests.get(`${category}:${row.id}`) : null;
    if (requested) {
      // Written by an approved raised request: taken off at the amount approved for it there.
      const priced = accounted.pricedBy.reduce((sum, entry) => sum + Number(entry.amount || 0) + (corrections.get(entry.id) || 0), 0);
      line.value = money(Number(requested.approvedAmount || 0) + priced);
      line.details = { ...line.details, source: "EXTRA_QUOTATION", reference: requestReferenceOf(requested), value: line.value };
    } else if (line.kind === "REMOVED" && category !== "SHOOT") {
      line.value = removedValueOf(category, row, accounted, { quotation, shootName: shootName(row.shootId), corrections });
      line.details = { ...line.details, value: line.value };
    }
    // Added back after its removal was published: an addition again, starting at what that removal took
    // off (with its corrections) - so taking it off and putting it back nets to nothing.
    if (line.kind === "ADDED" && category !== "SHOOT" && accounted.removedBy) {
      const removedBy = accounted.removedBy;
      // Dated when it was put back (the row's last change), not when the row was first created.
      line.changedAt = row.updatedAt;
      line.value = money(Math.abs(Number(removedBy.amount || 0) + (corrections.get(removedBy.id) || 0)));
      line.details = { ...line.details, addedBack: true, value: line.value };
    }
    const key = keyOf(line.kind, category, row.id);
    wanted.set(key, { ...line, key, category, row, itemName, shootId: category === "SHOOT" ? row.id : row.shootId });
    return wanted.get(key);
  };

  for (const shoot of shoots) want("SHOOT", shoot, shoot.shoot || shoot.shootId);
  for (const service of services) want("SERVICE", service, service.serviceName);
  for (const row of deliverables) want("DELIVERABLE", row, [row.deliverableName, row.size || row.brandName].filter(Boolean).join(" · "));

  // Write: keep each matching draft (and the amount typed on it), create the missing, cancel the rest.
  // One draft per key. A second for the same key (left by a reader before the lock was first-read) is
  // cancelled, so it can never be priced and counted twice.
  const drafts = new Map();
  const duplicates = [];
  for (const line of planLines.filter((entry) => entry.status === "DRAFT")) {
    if (drafts.has(lineKey(line))) duplicates.push(line.id);
    else drafts.set(lineKey(line), line);
  }
  if (duplicates.length) await tx.projectSaleExtra.updateMany({ where: { id: { in: duplicates } }, data: { status: "CANCELLED", parentExtraId: null } });
  const ids = new Map();
  for (const line of wanted.values()) {
    const data = {
      itemName: String(line.itemName || "Item").slice(0, 191),
      shootName: shootName(line.shootId),
      details: line.details,
      changedAt: line.changedAt,
    };
    const existing = drafts.get(line.key);
    if (existing) {
      // Written only when something moved, so a draft's `updatedAt` says when it last really changed
      // - which is what publishing compares against what the studio reviewed.
      const moved = existing.itemName !== data.itemName || (existing.shootName || null) !== (data.shootName || null)
        || canonical(existing.details ?? null) !== canonical(data.details ?? null)
        || new Date(existing.changedAt).getTime() !== new Date(data.changedAt).getTime();
      // A removal (or an item added back after a published removal) not priced yet starts at its value.
      const prefill = existing.amount === null && Number.isFinite(line.value) ? { amount: line.kind === "REMOVED" ? -Math.abs(line.value) : Math.abs(line.value) } : {};
      if (moved || prefill.amount !== undefined) await tx.projectSaleExtra.update({ where: { id: existing.id }, data: { ...data, ...prefill } });
      ids.set(line.key, existing.id);
      drafts.delete(line.key);
    } else {
      const created = await tx.projectSaleExtra.create({ data: {
        ...data,
        code: await nextCode(tx),
        projectId: String(projectId),
        kind: line.kind,
        category: line.category,
        shootId: line.shootId,
        ...(line.category === "SERVICE" ? { serviceAllocationId: line.row.id } : {}),
        ...(line.category === "DELIVERABLE" ? { deliverableAllocationId: line.row.id } : {}),
        // A removal starts at the value the item stood at, and an item added back after its removal was
        // published at the value it had; the studio may change either before publishing.
        ...(Number.isFinite(line.value) ? { amount: line.kind === "REMOVED" ? -Math.abs(line.value) : Math.abs(line.value) } : {}),
        createdBy: userId,
      } });
      ids.set(line.key, created.id);
    }
  }
  // A draft folded under another by an earlier version is a line of its own now (it was never priced).
  const folded = [...ids.values()].filter((id) => lines.find((line) => line.id === id)?.parentExtraId);
  if (folded.length) await tx.projectSaleExtra.updateMany({ where: { id: { in: folded }, status: "DRAFT" }, data: { parentExtraId: null } });
  if (drafts.size) await tx.projectSaleExtra.updateMany({ where: { id: { in: [...drafts.values()].map((line) => line.id) } }, data: { status: "CANCELLED", parentExtraId: null } });
  return { tracked: true, quotation };
}

module.exports = { reconcileSaleExtras, trackedQuotation, nextCode, runLocked, RECONCILE_TX, approvedRequestItems, requestReferenceOf };
