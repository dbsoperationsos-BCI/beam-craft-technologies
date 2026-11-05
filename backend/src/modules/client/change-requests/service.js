const { z } = require("zod");
const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { TYPES, notify } = require("../../../services/notifications");
const { withUserNames } = require("../../../services/userNames");
const { projectAccessWhere } = require("../../../services/projectScope");
const { logProjectActivity } = require("../../../services/projectActivity");
const { everyChunk } = require("../../../services/wordChunks");

/*
 * Client Management -> Client Requests -> Raised Requests.
 *
 * Somebody in the studio asks, for a booked project, for:
 *
 *   - SHOOT        a new shoot, with the services and deliverables it needs;
 *   - SERVICE      services for one of the project's shoots;
 *   - DELIVERABLE  deliverables for one of the project's shoots;
 *   - OTHER        a correction (album, photo, video, client or project details, anything else).
 *
 * Raising one writes nothing to the project and carries no price: it is a request, WAITING, with one
 * item for each thing asked (the shoot itself is an item of a SHOOT request). Whoever holds
 * `CLIENT / Request Approval` reviews it item by item - approve at an amount (₹0 is complimentary)
 * and a quantity, or reject with a reason - saving as they go (IN_PROGRESS), and submits the final
 * decision once every item has one. That decision, in one transaction:
 *
 *   - writes the approved shoot, services and deliverables into the project
 *     (`applyRequestedPlan`, the projects module's own helpers) and nothing rejected;
 *   - records the approved amounts as one approved extra quotation on the project, so they count on
 *     its Payments once - the rows written are Sale Extras baseline and are not priced there again;
 *   - gives an approved correction to the project's Project Manager as a task (HRM -> Tasks);
 *   - sets the request ACCEPTED, PARTIALLY_ACCEPTED or DECLINED.
 *
 * A request is decided once: the decision locks its row and refuses a second (`409`), and every write
 * checks the `version` the reviewer loaded, so two reviewers cannot overwrite each other unseen. The
 * requester never edits a request after raising it, and `ProjectChangeRequestEvent` records every step.
 */

const REQUEST_TYPES = ["SHOOT", "SERVICE", "DELIVERABLE", "OTHER"];
const STATUSES = ["WAITING", "IN_PROGRESS", "ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED"];
const FINAL_STATUSES = ["ACCEPTED", "PARTIALLY_ACCEPTED", "DECLINED"];
const DECISIONS = ["APPROVED", "REJECTED"];
const CORRECTION_CATEGORIES = ["Album correction", "Photo correction", "Video correction", "Client information correction", "Project detail correction", "Other correction"];
const TYPE_LABELS = { SHOOT: "Shoot", SERVICE: "Services", DELIVERABLE: "Deliverables", OTHER: "Other" };
const STATUS_LABELS = { WAITING: "Waiting", IN_PROGRESS: "In progress", ACCEPTED: "Accepted", PARTIALLY_ACCEPTED: "Partially accepted", DECLINED: "Declined" };
const MAX_ATTACHMENTS = 5;
const ATTACHMENT_FOLDER = "client/change-requests";

// The two permissions: raising and reading, and deciding.
const RAISE = { module: "CLIENT", feature: "Client Requests" };
const APPROVE = { module: "CLIENT", feature: "Request Approval" };

const fail = (status, message) => Object.assign(new Error(message), { status });
const money = (value) => (value === null || value === undefined ? null : Number(value));
const rupees = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

// The projects module is large and reaches back into client modules: required where used.
const projects = () => require("../../sales/projects/controller");

// ── Raising ──────────────────────────────────────────────────────────────────────────────────────

const optionalId = z.string().trim().max(191).optional().nullable();

const raiseSchema = z.object({
  requestType: z.enum(REQUEST_TYPES, { message: "Choose what the request is for." }),
  projectId: z.string().trim().min(1, "Choose the project.").max(191),
  shootId: optionalId,
  // A SHOOT request's shoot, as the Add Shoot dialog fills it in - checked against `projectShootSchema`.
  shoot: z.record(z.string(), z.unknown()).optional().nullable(),
  services: z.array(z.unknown()).max(40, "Up to 40 services at a time.").optional().default([]),
  deliverables: z.array(z.unknown()).max(60, "Up to 60 deliverables at a time.").optional().default([]),
  correctionCategory: z.string().trim().max(60).optional().nullable(),
  remarks: z.string().trim().max(5000).optional().default(""),
  attachments: z.array(z.string().min(1)).max(MAX_ATTACHMENTS, `Attach at most ${MAX_ATTACHMENTS} files.`).optional().default([]),
});

/** The first problem a zod result reports, in the words the form shows. */
const firstIssue = (parsed, fallback) => parsed.error?.issues?.[0]?.message || fallback;

/**
 * What a raise asks for, checked: the shoot it names belongs to the project, every service and
 * deliverable is one the studio offers, and nothing is asked twice. Resolves to the request's items,
 * in order - the shoot itself first for a SHOOT request.
 */
async function itemsFor(input, project, client = prisma) {
  const { projectShootSchema, projectShootServiceInputSchema, projectShootDeliverableInputSchema, deliverableVariantSnapshotFor, deliverableLineKey } = projects();
  const items = [];

  if (input.requestType === "OTHER") {
    if (!CORRECTION_CATEGORIES.includes(input.correctionCategory)) throw fail(400, "Choose the correction category.");
    if (!input.remarks) throw fail(400, "Describe the correction.");
    return [{ itemType: "CORRECTION", itemName: input.correctionCategory, quantity: 1, config: null }];
  }

  if (input.requestType === "SHOOT") {
    const parsed = projectShootSchema.safeParse(input.shoot || {});
    if (!parsed.success) throw fail(400, firstIssue(parsed, "Fill in the shoot's details."));
    items.push({ itemType: "SHOOT", itemName: parsed.data.shoot, quantity: 1, config: null });
  }

  const services = input.requestType === "DELIVERABLE" ? [] : input.services;
  const deliverables = input.requestType === "SERVICE" ? [] : input.deliverables;
  if (input.requestType === "SERVICE" && !services.length) throw fail(400, "Add at least one service.");
  if (input.requestType === "DELIVERABLE" && !deliverables.length) throw fail(400, "Add at least one deliverable.");

  const seenServices = new Set();
  for (const raw of services) {
    const parsed = projectShootServiceInputSchema.safeParse(raw);
    if (!parsed.success) throw fail(400, "Check the services' details.");
    const line = parsed.data;
    if (seenServices.has(line.serviceDefinitionId)) throw fail(400, "A service is listed twice. Remove the copy.");
    seenServices.add(line.serviceDefinitionId);
    const definition = await client.projectServiceDefinition.findFirst({ where: { id: line.serviceDefinitionId, isActive: true }, select: { id: true, name: true } });
    if (!definition) throw fail(400, "A service is no longer offered. Remove it and choose again.");
    items.push({ itemType: "SERVICE", serviceDefinitionId: definition.id, itemName: definition.name, quantity: line.quantity || 1, config: line });
  }

  const seenDeliverables = new Set();
  const deliverableKeys = new Map();
  for (const raw of deliverables) {
    const parsed = projectShootDeliverableInputSchema.safeParse(raw);
    if (!parsed.success) throw fail(400, "Check the deliverables' details.");
    const line = parsed.data;
    const definition = await client.projectDeliverableDefinition.findFirst({ where: { id: line.deliverableDefinitionId, isActive: true }, include: { brands: { include: { variants: true } } } });
    if (!definition) throw fail(400, "A deliverable is no longer offered. Remove it and choose again.");
    const variant = deliverableVariantSnapshotFor(definition, line.variant);
    const key = deliverableLineKey(definition.id, variant);
    if (seenDeliverables.has(key)) throw fail(400, "A deliverable is listed twice. Remove the copy.");
    seenDeliverables.add(key);
    const variantName = [variant.brandName, variant.size, variant.frameInches, variant.videoLength].filter(Boolean).join(" | ");
    const item = { itemType: "DELIVERABLE", deliverableDefinitionId: definition.id, itemName: `${definition.name}${variantName ? ` | ${variantName}` : ""}`.slice(0, 191), quantity: line.quantity || 1, config: line };
    deliverableKeys.set(item, key);
    items.push(item);
  }

  // The shoot a SERVICE or DELIVERABLE request adds to is the project's own, and live.
  if (["SERVICE", "DELIVERABLE"].includes(input.requestType)) {
    if (!input.shootId) throw fail(400, "Choose the shoot.");
    const shoot = await client.projectShoot.findFirst({ where: { id: input.shootId, projectId: project.id, deletedAt: null }, select: { id: true } });
    if (!shoot) throw fail(400, "That shoot is not on this project. Choose it again.");
    // Nothing the shoot already has: approving it could add nothing, and must not be charged for.
    const lineWhere = { shootId: shoot.id, deletedAt: null };
    const heldServices = new Set((await client.projectPostProductionAllocation.findMany({ where: lineWhere, select: { serviceDefinitionId: true } })).map((row) => row.serviceDefinitionId));
    const heldDeliverables = new Set((await client.projectShootDeliverable.findMany({ where: lineWhere, select: { deliverableDefinitionId: true, brandName: true, size: true, frameInches: true, videoLength: true } })).map((row) => deliverableLineKey(row.deliverableDefinitionId, row)));
    const already = items.find((item) => (item.itemType === "SERVICE" && heldServices.has(item.serviceDefinitionId)) || (item.itemType === "DELIVERABLE" && heldDeliverables.has(deliverableKeys.get(item))));
    if (already) throw fail(400, `"${already.itemName}" is already on this shoot. Remove it from the request.`);
  }
  return items;
}

async function nextRequestCode(client) {
  const row = await client.appSequence.upsert({
    where: { key: "PROJECT_CHANGE_REQUEST_ID" },
    create: { key: "PROJECT_CHANGE_REQUEST_ID", currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  return `CRQ-${String(row.currentValue).padStart(6, "0")}`;
}

/**
 * Raises a request. `permission` is what the route guarded with, and narrows which projects the
 * person may raise one on to the ones they reach. Nothing is written to the project.
 */
async function raiseRequest({ userId, permission, input }) {
  const { attachFiles, discardUploads } = require("../../../services/uploadMetadata");
  const access = await projectAccessWhere({ userId, permissions: permission || { ...RAISE, level: "READ_WRITE" } });
  const project = await prisma.salesProject.findFirst({ where: { id: input.projectId, deletedAt: null, AND: [access] }, select: { id: true, eventId: true, whatsappGroupName: true } });
  if (!project) throw fail(404, "That project could not be found. Choose it again.");
  if (input.requestType === "OTHER" && input.shootId) {
    const shoot = await prisma.projectShoot.findFirst({ where: { id: input.shootId, projectId: project.id, deletedAt: null }, select: { id: true } });
    if (!shoot) throw fail(400, "That shoot is not on this project. Choose it again.");
  }
  const items = await itemsFor(input, project);

  const attached = input.attachments.length ? await attachFiles(input.attachments, null, { folder: ATTACHMENT_FOLDER, userId }) : { files: [], uploads: [] };
  try {
    const created = await prisma.$transaction(async (tx) => {
      const request = await tx.projectChangeRequest.create({
        data: {
          requestCode: await nextRequestCode(tx),
          projectId: project.id,
          requestType: input.requestType,
          shootId: input.requestType === "SHOOT" ? null : input.shootId || null,
          shootDetails: input.requestType === "SHOOT" ? input.shoot : undefined,
          correctionCategory: input.requestType === "OTHER" ? input.correctionCategory : null,
          remarks: input.remarks || null,
          attachments: attached.files.length ? attached.files : undefined,
          requestedById: userId,
          items: { create: items.map((item, index) => ({ ...item, config: item.config || undefined, sortOrder: index })) },
        },
        select: { id: true, requestCode: true },
      });
      await tx.projectChangeRequestEvent.create({ data: { requestId: request.id, action: "RAISED", detail: `${TYPE_LABELS[input.requestType]} request raised with ${items.length} item${items.length === 1 ? "" : "s"}.`, actorUserId: userId } });
      return request;
    });
    await tellApprovers(created, project, userId).catch((error) => console.warn("Unable to tell the approvers of a raised request:", error?.message || error));
    return created;
  } catch (error) {
    await discardUploads(attached.uploads);
    throw error;
  }
}

// ── Notices ──────────────────────────────────────────────────────────────────────────────────────

const linkTo = (request) => `/client-management/client-requests?view=raised&request=${request.id}`;

/**
 * Everybody who may decide this request: active staff holding `CLIENT / Request Approval` at Read /
 * Write whose reach includes the project. Told in the bell and on their phone.
 */
async function tellApprovers(request, project, actorId) {
  const staff = await prisma.user.findMany({ where: { status: "ACTIVE", role: { not: "CLIENT" } }, select: { id: true } });
  const permission = { ...APPROVE, level: "READ_WRITE" };
  for (const user of staff) {
    if (user.id === actorId) continue;
    if (!(await iamService.hasPermission(user.id, APPROVE.module, APPROVE.feature, "READ_WRITE").catch(() => false))) continue;
    const reach = await projectAccessWhere({ userId: user.id, permissions: permission }).catch(() => null);
    if (!reach || !(await prisma.salesProject.findFirst({ where: { id: project.id, AND: [reach] }, select: { id: true } }))) continue;
    await notify(null, {
      userId: user.id,
      actorId,
      type: TYPES.CHANGE_REQUEST,
      title: `Request to review - ${request.requestCode} (${project.eventId || "project"})`,
      body: `${project.whatsappGroupName || project.eventId || "A project"}: waiting for your decision.`,
      entityType: "CHANGE_REQUEST",
      entityId: request.id,
      link: linkTo(request),
    });
  }
}

/** The person who raised it hears of the decision, or that more is asked of them. */
async function tellRequester(request, { title, body }, actorId) {
  await notify(null, { userId: request.requestedById, actorId, type: TYPES.CHANGE_REQUEST, title, body, entityType: "CHANGE_REQUEST", entityId: request.id, link: linkTo(request) });
}

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true, requestCode: true, projectId: true, requestType: true, shootId: true, shootDetails: true, correctionCategory: true,
  status: true, requestedById: true, requestedAt: true, reviewedById: true, decidedAt: true, updatedAt: true,
  project: { select: { eventId: true, whatsappGroupName: true } },
  shoot: { select: { shootId: true, shoot: true } },
  items: { select: { decision: true, approvedAmount: true } },
};

function listRow(row) {
  const approved = row.items.filter((item) => item.decision === "APPROVED");
  return {
    id: row.id,
    requestCode: row.requestCode,
    projectId: row.projectId,
    eventId: row.project?.eventId || "",
    clientName: row.project?.whatsappGroupName || "",
    requestType: row.requestType,
    shootName: row.requestType === "SHOOT" ? row.shootDetails?.shoot || "" : row.shoot?.shoot || "",
    shootCode: row.shoot?.shootId || "",
    correctionCategory: row.correctionCategory || "",
    status: row.status,
    itemCount: row.items.length,
    approvedCount: approved.length,
    // What has been approved so far - final once the request is decided.
    approvedAmount: approved.reduce((sum, item) => sum + (money(item.approvedAmount) || 0), 0),
    requestedById: row.requestedById,
    requestedAt: row.requestedAt.toISOString(),
    reviewedById: row.reviewedById,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The requests on every project this person reaches, newest first. */
async function listRequests({ userId, permission }) {
  const access = await projectAccessWhere({ userId, permissions: permission || { ...RAISE, level: "READ" } });
  const rows = await prisma.projectChangeRequest.findMany({
    where: { project: { deletedAt: null, AND: [access] } },
    select: LIST_SELECT,
    orderBy: { requestedAt: "desc" },
    take: 1000,
  });
  return withUserNames(rows.map(listRow), { fields: ["requestedById", "reviewedById"] });
}

const DETAIL_SELECT = {
  ...LIST_SELECT,
  remarks: true, attachments: true, version: true, decisionRemarks: true, createdShootId: true, taskId: true, extraQuotationId: true,
  project: { select: { eventId: true, whatsappGroupName: true, projectManagerEmployeeId: true, vertical: true, groupType: true } },
  createdShoot: { select: { shootId: true, shoot: true } },
  extraQuotation: { select: { requestCode: true, amount: true, status: true } },
  task: { select: { taskCode: true, status: true, assignedToName: true } },
  items: { orderBy: { sortOrder: "asc" }, select: { id: true, itemType: true, serviceDefinitionId: true, deliverableDefinitionId: true, itemName: true, quantity: true, config: true, decision: true, approvedAmount: true, approvedQuantity: true, managerRemarks: true, rejectionReason: true, decidedById: true, decidedAt: true, appliedRecordId: true } },
  events: { orderBy: { createdAt: "asc" }, select: { id: true, itemId: true, action: true, detail: true, changes: true, actorUserId: true, createdAt: true } },
};

async function findReachable(id, { userId, permission, client = prisma, select = DETAIL_SELECT }) {
  const access = await projectAccessWhere({ userId, permissions: permission });
  return client.projectChangeRequest.findFirst({ where: { id: Number(id) || 0, project: { deletedAt: null, AND: [access] } }, select });
}

/** One request, every item and its history - or null where the person does not reach its project. */
async function getRequest(id, { userId, permission }) {
  const row = await findReachable(id, { userId, permission: permission || { ...RAISE, level: "READ" } });
  if (!row) return null;
  const items = await withUserNames(row.items.map((item) => ({
    ...item,
    approvedAmount: money(item.approvedAmount),
    decidedAt: item.decidedAt ? item.decidedAt.toISOString() : null,
  })), { fields: ["decidedById"] });
  const events = await withUserNames(row.events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })), { fields: ["actorUserId"] });
  const [base] = await withUserNames([listRow(row)], { fields: ["requestedById", "reviewedById"] });
  return {
    ...base,
    version: row.version,
    shootDetails: row.shootDetails || null,
    vertical: row.project?.groupType || row.project?.vertical || "",
    remarks: row.remarks || "",
    attachments: Array.isArray(row.attachments) ? row.attachments.map((file) => ({ url: file.url, name: file.originalName || file.name || "Attachment", mimeType: file.mimeType || "" })) : [],
    decisionRemarks: row.decisionRemarks || "",
    createdShoot: row.createdShoot || null,
    extraQuotation: row.extraQuotation ? { ...row.extraQuotation, amount: money(row.extraQuotation.amount) } : null,
    task: row.task || null,
    items,
    events,
  };
}

/** The projects a person may raise a request on, matching what they typed: Event ID, name or number. */
async function searchProjects({ userId, permission, search = "" }) {
  const access = await projectAccessWhere({ userId, permissions: permission || { ...RAISE, level: "READ_WRITE" } });
  const chunks = everyChunk(search, (chunk) => ({ OR: [{ eventId: { contains: chunk } }, { whatsappGroupName: { contains: chunk } }, { enquiryId: { contains: chunk } }, { clientMainNumber: { contains: chunk } }] }));
  const rows = await prisma.salesProject.findMany({
    where: { deletedAt: null, AND: [access, ...chunks] },
    select: { id: true, eventId: true, whatsappGroupName: true, clientMainNumber: true, projectStatus: true, vertical: true, groupType: true, _count: { select: { shoots: { where: { deletedAt: null } } } } },
    orderBy: { createdAt: "desc" },
    // The picker searches what it holds as it is typed into, so with nothing typed it is handed every
    // project in reach (newest first); a typed search narrows here as well.
    take: search ? 50 : 1000,
  });
  return rows.map((row) => ({ id: row.id, eventId: row.eventId || "", clientName: row.whatsappGroupName || "", clientNumber: row.clientMainNumber || "", status: row.projectStatus || "", vertical: row.groupType || row.vertical || "", shootCount: row._count.shoots }));
}

/** A project's live shoots, for the request to name one - only on a project the person reaches. */
async function projectShoots(projectId, { userId, permission }) {
  const access = await projectAccessWhere({ userId, permissions: permission || { ...RAISE, level: "READ_WRITE" } });
  const project = await prisma.salesProject.findFirst({ where: { id: String(projectId), deletedAt: null, AND: [access] }, select: { id: true } });
  if (!project) return null;
  const live = { deletedAt: null };
  const shoots = await prisma.projectShoot.findMany({
    where: { projectId: project.id, deletedAt: null },
    select: {
      id: true, shootId: true, shoot: true, dateCreated: true, shootPlace: true, sessionTimings: true, shootTypes: true,
      // What the shoot already has, so the form can keep a request from asking for it again.
      postProductionAllocations: { where: live, select: { serviceDefinitionId: true, serviceName: true } },
      deliverables: { where: live, select: { deliverableDefinitionId: true, deliverableName: true, brandName: true, size: true, frameInches: true, videoLength: true } },
    },
    orderBy: [{ sortOrder: "asc" }, { dateCreated: "asc" }, { createdAt: "asc" }],
  });
  return shoots.map(({ postProductionAllocations, deliverables, ...shoot }) => ({
    ...shoot,
    dateCreated: shoot.dateCreated ? shoot.dateCreated.toISOString() : null,
    heldServices: postProductionAllocations.map((row) => ({ id: row.serviceDefinitionId, name: row.serviceName })),
    heldDeliverables: deliverables.map((row) => ({ id: row.deliverableDefinitionId, name: row.deliverableName, brandName: row.brandName, size: row.size, frameInches: row.frameInches, videoLength: row.videoLength })),
  }));
}

// ── Reviewing ────────────────────────────────────────────────────────────────────────────────────

const decisionSchema = z.object({
  id: z.coerce.number().int().positive(),
  decision: z.enum(DECISIONS).nullable().optional(),
  approvedAmount: z.union([z.literal(null), z.literal(""), z.coerce.number().min(0, "An amount cannot be negative.").max(999_999_999)]).optional(),
  approvedQuantity: z.union([z.literal(null), z.literal(""), z.coerce.number().int().min(1, "A quantity is at least 1.").max(999)]).optional(),
  managerRemarks: z.string().trim().max(2000).optional().nullable(),
  rejectionReason: z.string().trim().max(2000).optional().nullable(),
});
const reviewSchema = z.object({
  version: z.coerce.number().int().min(0),
  items: z.array(decisionSchema).max(200).default([]),
  decisionRemarks: z.string().trim().max(5000).optional().nullable(),
});
const messageSchema = z.object({ message: z.string().trim().min(1, "Write the message.").max(2000) });

const blankToNull = (value) => (value === "" || value === undefined ? null : value);

/** The item as the reviewer's form left it, over what was saved. */
function decidedValues(saved, change) {
  if (!change) return { decision: saved.decision, approvedAmount: money(saved.approvedAmount), approvedQuantity: saved.approvedQuantity, managerRemarks: saved.managerRemarks || null, rejectionReason: saved.rejectionReason || null };
  const decision = change.decision === undefined ? saved.decision : change.decision || null;
  return {
    decision,
    // A rejected item holds no amount or quantity; an approved one keeps what was typed.
    approvedAmount: decision === "REJECTED" ? null : blankToNull(change.approvedAmount === undefined ? money(saved.approvedAmount) : change.approvedAmount),
    approvedQuantity: decision === "REJECTED" ? null : blankToNull(change.approvedQuantity === undefined ? saved.approvedQuantity : change.approvedQuantity),
    managerRemarks: change.managerRemarks === undefined ? saved.managerRemarks || null : change.managerRemarks || null,
    rejectionReason: decision === "REJECTED" ? (change.rejectionReason === undefined ? saved.rejectionReason || null : change.rejectionReason || null) : null,
  };
}

const sameValue = (a, b) => (a === null || a === undefined ? null : String(a)) === (b === null || b === undefined ? null : String(b));
const FIELDS = ["decision", "approvedAmount", "approvedQuantity", "managerRemarks", "rejectionReason"];

/**
 * What a final decision cannot go ahead with, in the reviewer's words - or "" when it can. Every
 * item decided; an approved one priced (₹0 for complimentary); a rejected one with its reason; and a
 * rejected shoot taking its services and deliverables with it, since they would have nowhere to go.
 */
function finalProblem(request, values) {
  for (const item of request.items) {
    const value = values.get(item.id);
    if (!value.decision) return `Approve or reject every item - "${item.itemName}" has no decision yet.`;
    if (value.decision === "APPROVED" && (value.approvedAmount === null || !Number.isFinite(Number(value.approvedAmount)))) return `Enter the approved amount for "${item.itemName}" (₹0 if it is complimentary).`;
    if (value.decision === "REJECTED" && !value.rejectionReason) return `Give the reason "${item.itemName}" is rejected.`;
  }
  const shoot = request.items.find((item) => item.itemType === "SHOOT");
  if (shoot && values.get(shoot.id).decision === "REJECTED" && request.items.some((item) => item.itemType !== "SHOOT" && values.get(item.id).decision === "APPROVED")) {
    return "The shoot is rejected, so its services and deliverables cannot be approved. Reject them too, or approve the shoot.";
  }
  return "";
}

/** ACCEPTED, DECLINED or PARTIALLY_ACCEPTED, from decisions that are all in. */
function finalStatus(decisions) {
  if (decisions.every((decision) => decision === "APPROVED")) return "ACCEPTED";
  if (decisions.every((decision) => decision === "REJECTED")) return "DECLINED";
  return "PARTIALLY_ACCEPTED";
}

/** The lines `values` changes on `request`, written with their history; returns the items' new values. */
async function writeDecisions(tx, request, input, actorId) {
  const changes = new Map((input.items || []).map((change) => [change.id, change]));
  const unknown = [...changes.keys()].find((id) => !request.items.some((item) => item.id === id));
  if (unknown) throw fail(400, "An item does not belong to this request. Reload and try again.");
  const values = new Map();
  const now = new Date();
  for (const item of request.items) {
    const next = decidedValues(item, changes.get(item.id));
    values.set(item.id, next);
    const before = decidedValues(item, null);
    const changed = FIELDS.filter((field) => !sameValue(before[field], next[field]));
    if (!changed.length) continue;
    await tx.projectChangeRequestItem.update({
      where: { id: item.id },
      data: {
        decision: next.decision,
        approvedAmount: next.approvedAmount === null ? null : Number(next.approvedAmount).toFixed(2),
        approvedQuantity: next.approvedQuantity === null ? null : Number(next.approvedQuantity),
        managerRemarks: next.managerRemarks,
        rejectionReason: next.rejectionReason,
        decidedById: actorId,
        decidedAt: now,
      },
    });
    await tx.projectChangeRequestEvent.create({
      data: {
        requestId: request.id,
        itemId: item.id,
        action: "ITEM_DECIDED",
        detail: `${item.itemName}: ${next.decision === "APPROVED" ? `approved${next.approvedAmount !== null ? ` at ${rupees(next.approvedAmount)}` : ""}` : next.decision === "REJECTED" ? "rejected" : "decision cleared"}.`,
        changes: Object.fromEntries(changed.map((field) => [field, { from: before[field], to: next[field] }])),
        actorUserId: actorId,
      },
    });
  }
  return values;
}

/**
 * Loads a request for a write, locked, checked live and at the version the reviewer saw.
 *
 * The row lock is the transaction's **first** read, and the status and version are read by it: under
 * MySQL's repeatable read a plain read taken before the lock would fix the transaction's snapshot
 * there, and a second decision waiting on the lock would then still see the request open.
 */
async function lockForWrite(tx, id, { userId, permission, version }) {
  const [locked] = await tx.$queryRaw`SELECT id, status, version FROM project_change_request WHERE id = ${Number(id) || 0} FOR UPDATE`;
  if (!locked || !(await findReachable(locked.id, { userId, permission, client: tx, select: { id: true } }))) throw fail(404, "Request not found.");
  if (FINAL_STATUSES.includes(locked.status)) throw fail(409, `This request has already been decided (${STATUS_LABELS[locked.status]}). Reload to see the decision.`);
  if (version !== undefined && Number(locked.version) !== version) throw fail(409, "Somebody else has saved this request since you opened it. Reload to see their changes.");
  return tx.projectChangeRequest.findUnique({ where: { id: Number(locked.id) }, include: { items: { orderBy: { sortOrder: "asc" } }, project: { select: { id: true, eventId: true, whatsappGroupName: true, projectManagerEmployeeId: true, branchId: true, sourceBranch: true, branch: { select: { name: true } } } } } });
}

/** Saves the reviewer's decisions so far, without deciding the request. */
async function saveReview(id, { userId, permission, input }) {
  return prisma.$transaction(async (tx) => {
    const request = await lockForWrite(tx, id, { userId, permission, version: input.version });
    await writeDecisions(tx, request, input, userId);
    await tx.projectChangeRequest.update({ where: { id: request.id }, data: { status: "IN_PROGRESS", reviewedById: userId, version: { increment: 1 }, ...(input.decisionRemarks !== undefined ? { decisionRemarks: input.decisionRemarks || null } : {}) } });
    if (request.status === "WAITING") await tx.projectChangeRequestEvent.create({ data: { requestId: request.id, action: "REVIEWED", detail: "Review started.", actorUserId: userId } });
    return { id: request.id };
  });
}

/** The approved items of a request, as `applyRequestedPlan` takes them. */
function planOf(request, values) {
  const approved = (type) => request.items.filter((item) => item.itemType === type && values.get(item.id).decision === "APPROVED");
  const line = (item) => {
    const quantity = values.get(item.id).approvedQuantity;
    return { key: item.id, line: { ...(item.config || {}), ...(quantity ? { quantity } : {}) } };
  };
  return { services: approved("SERVICE").map(line), deliverables: approved("DELIVERABLE").map(line) };
}

/** The correction's task, for the project's Project Manager - or, where it has none who signs in, the reviewer. */
async function correctionTask(tx, request, item, values, reviewer) {
  const tasks = require("../../hrm/tasks/service");
  const select = { id: true, name: true, username: true, email: true, status: true, linkedEmployeeId: true };
  const manager = request.project.projectManagerEmployeeId
    ? await tx.user.findFirst({ where: { linkedEmployeeId: request.project.projectManagerEmployeeId, status: "ACTIVE", role: { not: "CLIENT" } }, select })
    : null;
  const assignee = manager || await tx.user.findUnique({ where: { id: reviewer.id }, select });
  const shoot = request.shootId ? await tx.projectShoot.findUnique({ where: { id: request.shootId }, select: { shootId: true, shoot: true } }) : null;
  const value = values.get(item.id);
  const task = await tasks.insertTask(tx, {
    title: `${request.correctionCategory}: ${request.project.eventId || request.project.whatsappGroupName || "project"} (${request.requestCode})`.slice(0, 200),
    description: [
      `${request.requestCode} on ${[request.project.whatsappGroupName, request.project.eventId && `(${request.project.eventId})`].filter(Boolean).join(" ")}${shoot ? `, shoot ${[shoot.shootId, shoot.shoot && `(${shoot.shoot})`].filter(Boolean).join(" ")}` : ""}.`,
      `What is to be corrected: ${request.remarks || "-"}`,
      Number(value.approvedAmount) > 0 ? `Approved at ${rupees(value.approvedAmount)}.` : "Approved as a free correction.",
      value.managerRemarks ? `Reviewer's remarks: ${value.managerRemarks}` : "",
    ].filter(Boolean).join("\n\n"),
    taskType: "Client",
    priority: "HIGH",
    department: null,
    branch: request.project.branch?.name || request.project.sourceBranch || null,
    branchId: request.project.branchId ?? null,
  }, assignee, reviewer);
  return { task, assignedToManager: Boolean(manager) };
}

/**
 * The final decision: every item decided, the approved ones written into the project and priced on
 * one approved extra quotation, a correction given to the Project Manager, the request closed - all
 * in one transaction, once. Resolves to the request's new state and what was created.
 */
async function decideRequest(id, { userId, permission, input }) {
  const reviewer = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, username: true, email: true, linkedEmployee: { select: { employeeName: true } } } });
  if (!reviewer) throw fail(401, "The signed-in user no longer exists.");
  const actor = { id: reviewer.id, name: reviewer.linkedEmployee?.employeeName || reviewer.name, username: reviewer.username, email: reviewer.email };

  const outcome = await prisma.$transaction(async (tx) => {
    const request = await lockForWrite(tx, id, { userId, permission, version: input.version });
    const values = await writeDecisions(tx, request, input, userId);
    const problem = finalProblem(request, values);
    if (problem) throw fail(400, problem);

    const status = finalStatus(request.items.map((item) => values.get(item.id).decision));
    const created = { shootId: null, shootCode: null, extra: null, task: null, assignedToManager: false };
    const plan = planOf(request, values);
    const shootItem = request.items.find((item) => item.itemType === "SHOOT");
    const shootApproved = shootItem && values.get(shootItem.id).decision === "APPROVED";

    // The project's plan: a new shoot with what was approved under it, or lines on the existing shoot.
    if (shootApproved || (!shootItem && (plan.services.length || plan.deliverables.length))) {
      const result = await projects().applyRequestedPlan(tx, {
        projectId: request.projectId,
        shoot: shootApproved ? request.shootDetails : null,
        shootId: shootApproved ? null : request.shootId,
        services: plan.services,
        deliverables: plan.deliverables,
        userId,
      });
      created.shootId = result.shootId;
      created.shootCode = result.shootCode;
      if (shootApproved) await tx.projectChangeRequestItem.update({ where: { id: shootItem.id }, data: { appliedRecordId: result.shootId } });
      // An approved item that could not be added - on the shoot since it was asked for, or withdrawn
      // from Settings - would be charged for nothing: the whole decision is refused, nothing is kept,
      // and the reviewer rejects it instead.
      const [notAdded] = [...result.applied].filter(([, applied]) => !applied.id);
      if (notAdded) {
        const item = request.items.find((entry) => entry.id === notAdded[0]);
        throw fail(409, `"${item?.itemName || "An item"}" cannot be added: ${notAdded[1].note === "Already on the shoot" ? "it is already on the shoot" : "it is no longer offered in Settings"}. Reject it with that reason, then submit again.`);
      }
      for (const [itemId, applied] of result.applied) {
        await tx.projectChangeRequestItem.update({ where: { id: itemId }, data: { appliedRecordId: applied.id } });
      }
      const written = result.applied.size + (shootApproved ? 1 : 0);
      await tx.projectChangeRequestEvent.create({ data: { requestId: request.id, action: "APPLIED", detail: `Added to the project${result.created ? ` as shoot ${result.shootCode}` : ` on shoot ${result.shootCode}`}: ${written} item${written === 1 ? "" : "s"}.`, actorUserId: userId } });
    }

    // A correction: a task for the Project Manager.
    const correction = request.items.find((item) => item.itemType === "CORRECTION");
    if (correction && values.get(correction.id).decision === "APPROVED") {
      const { task, assignedToManager } = await correctionTask(tx, request, correction, values, actor);
      created.task = task;
      created.assignedToManager = assignedToManager;
      await tx.projectChangeRequestItem.update({ where: { id: correction.id }, data: { appliedRecordId: String(task.id) } });
      await tx.projectChangeRequestEvent.create({ data: { requestId: request.id, action: "APPLIED", detail: `Task ${task.taskCode} given to ${task.assignedToName}${assignedToManager ? " (Project Manager)" : " - the project has no Project Manager who signs in"}.`, actorUserId: userId } });
    }

    // The approved amounts: one approved extra quotation, counted once on the project's Payments.
    const priced = request.items.filter((item) => values.get(item.id).decision === "APPROVED" && Number(values.get(item.id).approvedAmount) > 0);
    const total = priced.reduce((sum, item) => sum + Number(values.get(item.id).approvedAmount), 0);
    if (total > 0) {
      const { recordApprovedExtra } = require("../../sales/extra-quotations/controller");
      const requester = await tx.user.findUnique({ where: { id: request.requestedById }, select: { name: true, linkedEmployee: { select: { id: true, employeeName: true, archivedAt: true } } } });
      const employee = requester?.linkedEmployee && !requester.linkedEmployee.archivedAt ? requester.linkedEmployee : null;
      const subject = request.requestType === "SHOOT" ? `New shoot: ${shootItem.itemName}` : request.requestType === "OTHER" ? request.correctionCategory : `${TYPE_LABELS[request.requestType]}: ${priced.map((item) => item.itemName).join(", ")}`;
      created.extra = await recordApprovedExtra(tx, {
        projectId: request.projectId,
        shootId: created.shootId || request.shootId || null,
        service: `${request.requestCode} · ${subject}`,
        amount: total,
        remarks: [`Raised request ${request.requestCode}, decided by ${actor.name}.`, ...priced.map((item) => `${item.itemName}${values.get(item.id).approvedQuantity > 1 ? ` x${values.get(item.id).approvedQuantity}` : ""}: ${rupees(values.get(item.id).approvedAmount)}`)].join("\n"),
        requestedById: employee?.id || null,
        requestedByName: employee?.employeeName || requester?.name || "",
        decidedById: userId,
        decisionRemarks: input.decisionRemarks || null,
        createdBy: userId,
      });
      await tx.projectChangeRequestEvent.create({ data: { requestId: request.id, action: "APPLIED", detail: `Extra quotation ${created.extra.requestCode} recorded, approved at ${rupees(total)}.`, actorUserId: userId } });
    }

    const decidedAt = new Date();
    await tx.projectChangeRequest.update({
      where: { id: request.id },
      data: {
        status,
        reviewedById: userId,
        decidedAt,
        decisionRemarks: input.decisionRemarks === undefined ? request.decisionRemarks : input.decisionRemarks || null,
        version: { increment: 1 },
        createdShootId: shootApproved ? created.shootId : null,
        extraQuotationId: created.extra?.id || null,
        taskId: created.task?.id || null,
      },
    });
    await tx.projectChangeRequestEvent.create({ data: { requestId: request.id, action: "DECIDED", detail: `${STATUS_LABELS[status]}${total > 0 ? ` - approved ${rupees(total)}` : ""}.`, actorUserId: userId } });
    return { request, status, total, created };
  }, { timeout: 30000 });

  const { request, status, total, created } = outcome;
  // Done; the notices and the project's activity follow, and never undo it.
  await prisma.notification.deleteMany({ where: { type: TYPES.CHANGE_REQUEST, entityType: "CHANGE_REQUEST", entityId: String(request.id), userId: { not: request.requestedById } } }).catch(() => {});
  const headline = { ACCEPTED: "accepted", PARTIALLY_ACCEPTED: "partly accepted", DECLINED: "declined" }[status];
  await tellRequester(request, {
    title: `Your request ${request.requestCode} is ${headline}`,
    body: `${request.project.whatsappGroupName || request.project.eventId || "Project"}${total > 0 ? ` · approved ${rupees(total)}` : ""}${input.decisionRemarks ? ` - ${input.decisionRemarks}` : ""}`.slice(0, 180),
  }, userId).catch(() => {});
  if (created.shootId) {
    await logProjectActivity({ projectId: request.projectId, shootId: created.shootId, area: "PROJECT", action: "CHANGE_REQUEST_APPLIED", detail: `Raised request ${request.requestCode} ${headline}: approved items added${created.shootCode ? ` (shoot ${created.shootCode})` : ""}.`, userId }).catch(() => {});
  }
  return { id: request.id, status, approvedAmount: total, extraQuotation: created.extra?.requestCode || null, task: created.task?.taskCode || null, shootCode: created.shootCode };
}

/** The reviewer asks the requester for more: the request stays open, and the requester is told. */
async function askForInformation(id, { userId, permission, message }) {
  const request = await prisma.$transaction(async (tx) => {
    const locked = await lockForWrite(tx, id, { userId, permission });
    await tx.projectChangeRequest.update({ where: { id: locked.id }, data: { status: "IN_PROGRESS", reviewedById: userId, version: { increment: 1 } } });
    await tx.projectChangeRequestEvent.create({ data: { requestId: locked.id, action: "INFO_REQUESTED", detail: message, actorUserId: userId } });
    return locked;
  });
  await tellRequester(request, { title: `More information needed - ${request.requestCode}`, body: message.slice(0, 180) }, userId).catch(() => {});
  return { id: request.id };
}

/** The requester (or anyone raising requests on the project) answers; the reviewer is told. */
async function giveInformation(id, { userId, permission, message }) {
  const request = await prisma.$transaction(async (tx) => {
    const locked = await lockForWrite(tx, id, { userId, permission });
    await tx.projectChangeRequest.update({ where: { id: locked.id }, data: { version: { increment: 1 } } });
    await tx.projectChangeRequestEvent.create({ data: { requestId: locked.id, action: "INFO_GIVEN", detail: message, actorUserId: userId } });
    return locked;
  });
  if (request.reviewedById) {
    await notify(null, { userId: request.reviewedById, actorId: userId, type: TYPES.CHANGE_REQUEST, title: `Reply on ${request.requestCode}`, body: message.slice(0, 180), entityType: "CHANGE_REQUEST", entityId: request.id, link: linkTo(request) });
  }
  return { id: request.id };
}

module.exports = {
  REQUEST_TYPES, STATUSES, FINAL_STATUSES, CORRECTION_CATEGORIES, RAISE, APPROVE,
  raiseSchema, reviewSchema, messageSchema,
  raiseRequest, listRequests, getRequest, searchProjects, projectShoots,
  saveReview, decideRequest, askForInformation, giveInformation,
  // For the tests.
  finalProblem, finalStatus, decidedValues, itemsFor,
};
