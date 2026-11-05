const { z } = require("zod");
const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { TYPES } = require("../../../services/notifications");
const clientPush = require("../../../services/clientPush");
const { withUserNames } = require("../../../services/userNames");

/*
 * Client requests (Bookings -> Services / Deliverables in the client's app; Client Management ->
 * Client Requests in DBS).
 *
 * A client asks, about one of their shoots: to **add** something from the studio's own list (Settings
 * -> Project -> Services / Deliverables) or anything else, to **change** something they have booked,
 * or a **question** about it. The team answers: **accept** - at a price, which raises an extra
 * quotation on the booking for the project's own approval and billing, or free - **decline** with a
 * reason, or **reply** to a question. The client is told (push, and their bell) and sees where each
 * request stands on that shoot. Or the team approves several at once (`approveRequests`), at the
 * prices the client chose them at; they join the project and the team contacts the client.
 */

const KINDS = ["add", "change", "question"];
const ITEM_TYPES = ["service", "deliverable", "other"];
const STATUSES = ["pending", "accepted", "declined", "answered"];
const KIND_LABELS = { add: "Add", change: "Change", question: "Question" };

const fail = (status, message) => Object.assign(new Error(message), { status });
const money = (value) => (value === null || value === undefined ? null : Number(value));

// Several things at once: what the client ticks from the studio's lists, each with how many.
const pickSchema = z.object({
  itemType: z.enum(ITEM_TYPES).optional().default("other"),
  catalogId: z.string().trim().max(64).optional().nullable(),
  itemName: z.string().trim().max(191).optional().default(""),
  quantity: z.coerce.number().int().min(1, "At least 1.").max(99, "Up to 99.").optional().default(1),
  // The client's remark on this one item; without it, the request's own note.
  note: z.string().trim().max(500).optional(),
});
const requestSchema = z.object({
  shootId: z.string().trim().min(1, "Choose the shoot.").max(64),
  kind: z.enum(KINDS, { message: "Choose what you would like." }),
  itemType: z.enum(ITEM_TYPES).optional().default("other"),
  catalogId: z.string().trim().max(64).optional().nullable(),
  itemRefId: z.string().trim().max(64).optional().nullable(),
  itemName: z.string().trim().max(191).optional().default(""),
  quantity: z.coerce.number().int().min(1, "At least 1.").max(99, "Up to 99.").optional().default(1),
  items: z.array(pickSchema).max(30, "Up to 30 at a time.").optional().default([]),
  note: z.string().trim().max(1000).optional().default(""),
}).refine((input) => input.kind === "question" || input.items.length || input.itemName || input.catalogId || input.itemRefId, {
  message: "Choose what the request is about.",
  path: ["itemName"],
}).refine((input) => input.kind !== "question" || input.note, { message: "Write your question.", path: ["note"] });

/**
 * The studio's lists a client may choose from: active services and deliverables, each with its price
 * and whether it is complimentary - Settings -> Project -> Services / Deliverables, as they stand.
 */
/**
 * What one of the studio's list items costs: its Price in Settings, or - where it is priced per
 * session or size instead (`pricing` rows) - the lowest of those, marked `from`.
 */
function listPriceOf(row) {
  if (row.price !== null && row.price !== undefined) return { price: money(row.price), from: false };
  const rows = Array.isArray(row.pricing) ? row.pricing.map((entry) => Number(entry?.price)).filter((value) => Number.isFinite(value) && value > 0) : [];
  return rows.length ? { price: Math.min(...rows), from: true } : { price: null, from: false };
}

async function catalog() {
  const [services, deliverables] = await Promise.all([
    prisma.projectServiceDefinition.findMany({ where: { isActive: true }, select: { id: true, name: true, price: true, pricing: true, complimentary: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.projectDeliverableDefinition.findMany({ where: { isActive: true }, select: { id: true, name: true, price: true, pricing: true, complimentary: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const shape = (row) => {
    const { price, from } = listPriceOf(row);
    return { id: row.id, name: row.name, price, priceFrom: from, complimentary: row.complimentary === true };
  };
  return { services: services.map(shape), deliverables: deliverables.map(shape) };
}

/** An approved (accepted) request is on the client's booking - added to the project when approved. */
function stageOf(row) {
  return row.status === "accepted" ? "added" : row.status;
}

function serialize(row, shootNames = new Map()) {
  return {
    id: row.id,
    shootId: row.shootId,
    shootName: shootNames.get(row.shootId) || null,
    kind: row.kind,
    itemType: row.itemType,
    catalogId: row.catalogId,
    itemRefId: row.itemRefId,
    itemName: row.itemName,
    quantity: row.quantity,
    note: row.note || "",
    status: STATUSES.includes(row.status) ? row.status : "pending",
    price: money(row.price),
    reply: row.reply || "",
    complimentary: Boolean(row.complimentary),
    stage: stageOf(row),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── The client's ──

/** The studio's answers the client has not opened yet - what waits in their Action Needed. */
async function unseenAnswers(projectId) {
  const rows = await prisma.clientServiceRequest.findMany({ where: { projectId, status: { not: "pending" }, clientSeenAt: null }, orderBy: { decidedAt: "desc" }, take: 20 });
  const shoots = await prisma.projectShoot.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.shootId).filter(Boolean))] } }, select: { id: true, shoot: true } });
  const names = new Map(shoots.map((shoot) => [shoot.id, shoot.shoot]));
  return rows.map((row) => serialize(row, names));
}

/** The client has seen the studio's answers on their booking: they leave Action Needed. */
async function markAnswersSeen(projectId) {
  await prisma.clientServiceRequest.updateMany({ where: { projectId, status: { not: "pending" }, clientSeenAt: null }, data: { clientSeenAt: new Date() } });
}

/** A booking's requests, newest first, and the studio's lists to ask from. */
async function clientRequests(projectId) {
  const [rows, shoots, lists] = await Promise.all([
    prisma.clientServiceRequest.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.projectShoot.findMany({ where: { projectId, deletedAt: null }, select: { id: true, shoot: true } }),
    catalog(),
  ]);
  const names = new Map(shoots.map((shoot) => [shoot.id, shoot.shoot]));
  return { requests: rows.map((row) => serialize(row, names)), catalog: lists };
}

/**
 * A client raises a request about one of their shoots - or several at once, one for each thing they
 * ticked (`items`); the team is told of each. Resolves to the first (a single request) and all of them.
 */
async function createRequests({ projectId, userId, input }) {
  if (!input.items?.length) {
    const one = await createRequest({ projectId, userId, input });
    return { request: one, requests: [one] };
  }
  const made = [];
  for (const item of input.items) {
    made.push(await createRequest({ projectId, userId, input: { ...input, kind: "add", ...item, items: [] }, quiet: true }));
  }
  // Everything sent together is one notice to the team, not one per item.
  const shoot = await prisma.projectShoot.findFirst({ where: { id: input.shootId, projectId }, select: { id: true, shoot: true } });
  if (shoot && made.length) await tellTeam(made, shoot).catch((error) => console.warn("Unable to tell the team of a client request:", error?.message || error));
  return { request: made[0], requests: made };
}

/** A client raises a request about one of their shoots; the team is told. */
async function createRequest({ projectId, userId, input, quiet = false }) {
  const shoot = await prisma.projectShoot.findFirst({ where: { id: input.shootId, projectId, deletedAt: null }, select: { id: true, shoot: true } });
  if (!shoot) throw fail(404, "This shoot could not be found on your booking.");
  // A pick from the studio's list is named as the list names it, whatever the app sent - and costed as
  // Settings prices it now (its price for the quantity asked, or complimentary), so the studio receives
  // it already priced.
  let itemName = input.itemName;
  let costed = { price: null, complimentary: false };
  if (input.kind === "add" && input.catalogId && input.itemType !== "other") {
    const select = { name: true, price: true, pricing: true, complimentary: true };
    const entry = input.itemType === "service"
      ? await prisma.projectServiceDefinition.findFirst({ where: { id: input.catalogId, isActive: true }, select })
      : await prisma.projectDeliverableDefinition.findFirst({ where: { id: input.catalogId, isActive: true }, select });
    if (!entry) throw fail(400, "That item is no longer offered. Please choose another.");
    itemName = entry.name;
    const { price } = listPriceOf(entry);
    costed = { complimentary: entry.complimentary === true, price: entry.complimentary === true ? 0 : price === null ? null : price * (input.quantity || 1) };
  }
  const row = await prisma.clientServiceRequest.create({
    data: {
      projectId,
      shootId: shoot.id,
      clientUserId: userId || null,
      kind: input.kind,
      itemType: input.itemType,
      catalogId: input.kind === "add" ? input.catalogId || null : null,
      itemRefId: input.kind === "add" ? null : input.itemRefId || null,
      itemName: (itemName || (input.kind === "question" ? "Question" : "Request")).slice(0, 191),
      quantity: input.kind === "question" ? 1 : input.quantity,
      note: input.note || null,
      price: costed.price,
      complimentary: costed.complimentary,
    },
  });
  if (!quiet) await tellTeam([row], shoot).catch((error) => console.warn("Unable to tell the team of a client request:", error?.message || error));
  return serialize(row, new Map([[shoot.id, shoot.shoot]]));
}

/**
 * A client sent a request (or several at once): the studio's owners (Super Admin and Admin), the
 * project's manager, and the project's own team who answer client requests hear of it at once - one
 * notice each, in the bell and as a push.
 */
async function tellTeam(rows, shoot) {
  const [first] = rows;
  const project = await prisma.salesProject.findUnique({
    where: { id: first.projectId },
    select: { eventId: true, whatsappGroupName: true, projectManagerEmployeeId: true, preProductionCoordinatorEmployeeId: true, productionManagerEmployeeId: true, postProductionCoordinatorEmployeeId: true, crmEmployeeId: true },
  });
  const staff = await prisma.user.findMany({ where: { status: "ACTIVE", role: { not: "CLIENT" } }, select: { id: true, role: true, linkedEmployeeId: true } });
  const team = new Set([project?.projectManagerEmployeeId, project?.preProductionCoordinatorEmployeeId, project?.productionManagerEmployeeId, project?.postProductionCoordinatorEmployeeId, project?.crmEmployeeId].filter(Boolean));
  const audience = new Set();
  for (const user of staff) {
    if (["SUPER_ADMIN", "ADMIN"].includes(user.role)) audience.add(user.id);
    else if (project?.projectManagerEmployeeId && user.linkedEmployeeId === project.projectManagerEmployeeId) audience.add(user.id);
    else if (team.has(user.linkedEmployeeId) && await iamService.hasPermission(user.id, "CLIENT", "Client Requests", "READ").catch(() => false)) audience.add(user.id);
  }
  if (!audience.size) return;
  const names = rows.map((row) => `${row.itemName}${row.quantity > 1 ? ` x${row.quantity}` : ""}`);
  const notice = {
    type: TYPES.CLIENT_REQUEST,
    title: `Client request - ${rows.length > 1 ? `${rows.length} items` : `${KIND_LABELS[first.kind]}: ${first.itemName}`} (${project?.eventId || "booking"})`.slice(0, 200),
    body: `${shoot.shoot} · ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}${first.note && rows.length === 1 ? ` - ${first.note}` : ""}`.slice(0, 180),
    entityType: "CLIENT_REQUEST",
    entityId: String(first.id),
    link: `/client-management/client-requests?request=${first.id}`,
  };
  const ids = [...audience];
  await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, ...notice })) });
  clientPush.pushToStaff(ids, notice);
  // WhatsApp to the owners, the project manager and the client - only once it is switched on (whatsapp.js).
  await require("./whatsapp").afterRequest({ rows, shoot });
}

// ── The team's ──

const answerSchema = z.object({
  action: z.enum(["accept", "decline", "answer"]),
  price: z.union([z.literal(null), z.coerce.number().min(0, "The price cannot be negative.").max(10000000)]).optional(),
  reply: z.string().trim().max(1000).optional().default(""),
}).refine((input) => input.action !== "decline" || input.reply, { message: "Tell the client why.", path: ["reply"] })
  .refine((input) => input.action !== "answer" || input.reply, { message: "Write your answer.", path: ["reply"] });

/** Every request, those waiting first, with the booking and shoot named. */
async function teamRequests() {
  const rows = await prisma.clientServiceRequest.findMany({
    where: { project: { deletedAt: null } },
    include: { project: { select: { eventId: true, clientMainNumber: true, whatsappGroupName: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const shoots = await prisma.projectShoot.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.shootId).filter(Boolean))] } }, select: { id: true, shoot: true } });
  const names = new Map(shoots.map((shoot) => [shoot.id, shoot.shoot]));
  // The studio's list price and complimentary answer, to start the team's quotation from.
  const lists = await catalog();
  const fromList = new Map([...lists.services, ...lists.deliverables].map((entry) => [entry.id, entry]));
  // The extra quotation each priced one raised, by its code and where it stands, for the View panel.
  const extras = new Map((await prisma.projectExtraQuotation.findMany({ where: { id: { in: rows.map((row) => row.extraQuotationId).filter(Boolean) } }, select: { id: true, requestCode: true, status: true } })).map((extra) => [extra.id, extra]));
  const order = (row) => (row.status === "pending" ? 0 : 1);
  const listed = rows
    .sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt)
    .map((row) => ({
      ...serialize(row, names),
      eventId: row.project?.eventId || "",
      groupName: row.project?.whatsappGroupName || "",
      extraQuotationId: row.extraQuotationId || null,
      extraQuotation: row.extraQuotationId ? extras.get(row.extraQuotationId) || null : null,
      catalogPrice: row.catalogId ? fromList.get(row.catalogId)?.price ?? null : null,
      catalogComplimentary: Boolean(row.catalogId && fromList.get(row.catalogId)?.complimentary),
      decidedBy: row.decidedBy ?? null,
      clientSeenAt: row.clientSeenAt ? row.clientSeenAt.toISOString() : null,
      updatedAt: row.updatedAt.toISOString(),
    }));
  return withUserNames(listed, { fields: ["decidedBy"] });
}

/**
 * The team answers a request. Accepted at a price: an extra quotation is raised on the booking (for
 * the project's own approval, as every extra is) and the client sees the price. The client is told.
 */
async function answerRequest(id, actorId, input) {
  const row = await prisma.clientServiceRequest.findFirst({ where: { id: Number(id) || 0, project: { deletedAt: null } } });
  if (!row) return null;
  if (row.status !== "pending") throw fail(409, "This request has already been answered.");
  const data = { decidedBy: actorId || null, decidedAt: new Date(), reply: input.reply || null };
  if (input.action === "accept") {
    Object.assign(data, { status: "accepted", price: input.price ?? row.price ?? null });
  } else if (input.action === "decline") {
    data.status = "declined";
  } else {
    data.status = "answered";
  }
  const saved = await prisma.clientServiceRequest.update({ where: { id: row.id }, data });
  // Accepted: it joins the project's shoot now.
  if (saved.status === "accepted") await addToProject(saved, actorId);
  await prisma.notification.deleteMany({ where: { type: TYPES.CLIENT_REQUEST, entityType: "CLIENT_REQUEST", entityId: String(row.id) } }).catch(() => {});
  const told = {
    accepted: { title: "Your request is approved", body: `Our team will contact you soon. (${row.itemName})${input.reply ? ` - ${input.reply}` : ""}` },
    declined: { title: "About your request", body: `${row.itemName}: ${input.reply}` },
    answered: { title: "The studio answered", body: input.reply },
  }[saved.status];
  // Kept in the app's bell (and its Action Needed until opened), and sent to the client's phones.
  const message = { title: told.title, body: told.body.slice(0, 180), data: { type: "client-request", requestId: row.id, shootId: row.shootId } };
  await clientPush.record({ salesProjectId: row.projectId, ...message });
  clientPush.notifyProject(row.projectId, message).catch(() => {});
  return serialize(saved);
}

const approveSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1, "Choose at least one request.").max(50, "Up to 50 at a time."),
  note: z.string().trim().max(1000).optional().default(""),
});

/**
 * The team approves a client's requests (Client Requests -> Respond): each at the price the client
 * sent it with - Settings' price for the quantity, or complimentary - so nothing is priced here. Each
 * is added to its shoot in the project at once (Edit Project's Services / Deliverables), and the client
 * is told once that it is approved and the team will contact them. No quotation is raised.
 */
async function approveRequests(actorId, input) {
  const ids = [...new Set(input.ids)];
  const rows = await prisma.clientServiceRequest.findMany({ where: { id: { in: ids }, project: { deletedAt: null } } });
  if (rows.length !== ids.length) throw fail(404, "A request could not be found. Please reload.");
  if (new Set(rows.map((row) => row.projectId)).size > 1) throw fail(400, "Approve one client's requests at a time.");
  if (rows.some((row) => row.status !== "pending")) throw fail(409, "A request has already been answered. Please reload.");
  if (rows.some((row) => row.kind === "question")) throw fail(400, "Questions are answered on their own.");
  const decidedAt = new Date();
  const saved = [];
  for (const row of rows) {
    const done = await prisma.clientServiceRequest.update({
      where: { id: row.id },
      data: { status: "accepted", price: row.complimentary ? 0 : row.price, reply: input.note || null, decidedBy: actorId || null, decidedAt },
    });
    await addToProject(done, actorId);
    saved.push(done);
  }
  await prisma.notification.deleteMany({ where: { type: TYPES.CLIENT_REQUEST, entityType: "CLIENT_REQUEST", entityId: { in: ids.map(String) } } }).catch(() => {});
  const names = saved.map((row) => `${row.itemName}${row.quantity > 1 ? ` x${row.quantity}` : ""}`);
  // The team contacts the client (a call or WhatsApp) about what was approved.
  const message = {
    title: "Your request is approved",
    body: `Our team will contact you soon. (${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""})${input.note ? ` - ${input.note}` : ""}`.slice(0, 180),
    data: { type: "client-request", requestId: saved[0].id, shootId: saved[0].shootId },
  };
  await clientPush.record({ salesProjectId: saved[0].projectId, ...message });
  clientPush.notifyProject(saved[0].projectId, message).catch(() => {});
  return { approved: saved.length, requests: saved.map((row) => serialize(row)) };
}

/** The team deletes requests (ticked in the table); an extra quotation already raised from one stays with its project. */
async function teamRemoveRequests(ids) {
  const wanted = [...new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!wanted.length) return [];
  const found = await prisma.clientServiceRequest.findMany({ where: { id: { in: wanted } }, select: { id: true } });
  const gone = found.map((row) => row.id);
  if (!gone.length) return [];
  await prisma.clientServiceRequest.deleteMany({ where: { id: { in: gone } } });
  await prisma.notification.deleteMany({ where: { type: TYPES.CLIENT_REQUEST, entityType: "CLIENT_REQUEST", entityId: { in: gone.map(String) } } }).catch(() => {});
  return gone;
}

/**
 * A request now on the booking - paid and approved, or given free: its service or deliverable is added
 * to the shoot in the project (Edit Project's Services / Deliverables, Post Production), as the team
 * would add it. Only a pick from the studio's list can be; "something not listed" stays with the team.
 * Never fails what called it; an item already on the shoot is left as it is.
 */
async function addToProject(row, userId = null) {
  if (!row?.catalogId || !row.shootId || !["service", "deliverable"].includes(row.itemType)) return null;
  try {
    // Required here, not at the top: the projects module is large and reaches back into client modules.
    const { addApprovedLine } = require("../../sales/projects/controller");
    return await addApprovedLine({ projectId: row.projectId, shootId: row.shootId, itemType: row.itemType, definitionId: row.catalogId, quantity: row.quantity || 1, remarks: row.note ? `Client: ${row.note}`.slice(0, 500) : null, userId });
  } catch (error) {
    console.error("A client's approved request could not be added to the project:", error.message);
    return null;
  }
}

/**
 * A client deletes one of their own requests - only while it waits for the studio; once answered (and
 * perhaps an extra quotation raised from it) it stays. Resolves to false when it is not theirs.
 */
async function removeRequest(id, projectId) {
  const row = await prisma.clientServiceRequest.findFirst({ where: { id: Number(id) || 0, projectId } });
  if (!row) return false;
  if (row.status !== "pending") throw fail(409, "The studio has already answered this request, so it can no longer be deleted.");
  await prisma.clientServiceRequest.delete({ where: { id: row.id } });
  return true;
}

module.exports = { requestSchema, answerSchema, approveSchema, approveRequests, teamRemoveRequests, catalog, clientRequests, createRequest, createRequests, removeRequest, unseenAnswers, markAnswersSeen, teamRequests, answerRequest, KINDS };
