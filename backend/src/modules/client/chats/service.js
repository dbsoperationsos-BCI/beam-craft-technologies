const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { TYPES } = require("../../../services/notifications");
const clientPush = require("../../../services/clientPush");
const assistant = require("./assistant");

/*
 * Client chats: a client's conversation with the studio from their app, one per topic they open.
 *
 * The client writes from the app (`startThread`, `addMessage` with `fromClient`); the team answers on
 * Sales -> Client Chats. Who is told of a client's message follows the topic: Payment -> everybody with
 * Accounts (Cash Management), the shoot topics -> the project's own team (manager and coordinators),
 * Quotation -> its CRM - and always anybody holding `CLIENT / Client Chats` READ_WRITE is able to see and
 * answer every chat. The client is told of every reply (push, and the app's bell).
 */

const TOPICS = {
  "pre-production": "Pre Production",
  payment: "Payment",
  production: "Production",
  shoot: "Shoot details",
  // Asked from a booking's Services or Deliverables list in the app.
  services: "Services",
  deliverables: "Deliverables",
  quotation: "Quotation",
  other: "Other",
};
const MAX_BODY = 2000;
const topicLabel = (topic) => TOPICS[topic] || "Other";

function bodyOf(text) {
  const body = String(text || "").trim().slice(0, MAX_BODY);
  if (!body) {
    const error = new Error("Write a message first.");
    error.status = 400;
    throw error;
  }
  return body;
}

const messageOf = (message) => ({
  id: message.id,
  fromClient: message.fromClient,
  author: message.fromClient ? null : message.authorName || "Studio",
  body: message.body,
  at: message.createdAt.toISOString(),
});

/**
 * A thread as a list row, for either side: unread from the reader's side (`forClient`). For the team
 * Nebula's answers do not count as theirs - a chat it answered is read (`staffReadAt`), and one it
 * handed over is still waiting on the client's message.
 */
function threadRow(thread, { forClient }) {
  const last = thread.messages?.[0] || null;
  const readAt = forClient ? thread.clientReadAt : thread.staffReadAt;
  const latest = forClient ? last : thread.messages?.find((message) => message.authorName !== assistant.AUTHOR) || null;
  const unread = Boolean(latest && latest.fromClient !== forClient && (!readAt || readAt < latest.createdAt));
  return {
    id: thread.id,
    topic: thread.topic,
    topicLabel: topicLabel(thread.topic),
    status: thread.status,
    lastMessageAt: thread.lastMessageAt.toISOString(),
    lastMessage: last ? { body: last.body.slice(0, 140), fromClient: last.fromClient } : null,
    unread,
  };
}

// The newest few: the list shows the last, and the team's unread looks past Nebula's to the client's.
const lastMessage = { messages: { orderBy: { createdAt: "desc" }, take: 6 } };

/** Who is told of a client's message on this topic, for this project (login ids, minus nobody). */
async function audienceFor(project, topic) {
  const ids = new Set();
  const employeeIds = [];
  if (topic === "quotation") employeeIds.push(project.crmEmployeeId);
  else if (topic !== "payment") {
    employeeIds.push(project.projectManagerEmployeeId, project.preProductionCoordinatorEmployeeId, project.productionManagerEmployeeId, project.postProductionCoordinatorEmployeeId, project.creativeManagerEmployeeId);
  }
  const wanted = employeeIds.filter(Boolean);
  if (wanted.length) {
    const users = await prisma.user.findMany({ where: { linkedEmployeeId: { in: wanted }, status: "ACTIVE" }, select: { id: true } });
    users.forEach((user) => ids.add(user.id));
  }
  if (topic === "payment" || !ids.size) {
    // Payment, and any topic whose project has nobody on it yet: everybody who may answer client chats
    // and (for payment) handles the money.
    const staff = await prisma.user.findMany({ where: { status: "ACTIVE", role: { not: "CLIENT" } }, select: { id: true } });
    for (const user of staff) {
      const chats = await iamService.hasPermission(user.id, "CLIENT", "Client Chats", "READ_WRITE").catch(() => false);
      if (!chats) continue;
      const money = topic !== "payment" || await iamService.hasPermission(user.id, "ACCOUNTS", "Cash Management", "READ").catch(() => false);
      if (money) ids.add(user.id);
    }
  }
  return [...ids];
}

const PROJECT_TEAM = { id: true, eventId: true, whatsappGroupName: true, crmEmployeeId: true, projectManagerEmployeeId: true, preProductionCoordinatorEmployeeId: true, productionManagerEmployeeId: true, postProductionCoordinatorEmployeeId: true, creativeManagerEmployeeId: true };

/** Tells the team of a client's message (bell + phone). Never fails the message itself. */
async function tellTeam(thread, body) {
  try {
    const project = await prisma.salesProject.findUnique({ where: { id: thread.projectId }, select: PROJECT_TEAM });
    if (!project) return;
    const audience = await audienceFor(project, thread.topic);
    if (!audience.length) return;
    // One notice per chat in each bell: the newest replaces the last.
    await prisma.notification.deleteMany({ where: { type: TYPES.CLIENT_CHAT, entityType: "CLIENT_CHAT", entityId: String(thread.id) } });
    const notice = {
      type: TYPES.CLIENT_CHAT,
      title: `Client message - ${topicLabel(thread.topic)} (${project.eventId})`.slice(0, 200),
      body: body.slice(0, 180),
      entityType: "CLIENT_CHAT",
      entityId: String(thread.id),
      link: `/sales/client-chats?chat=${thread.id}`,
    };
    await prisma.notification.createMany({ data: audience.map((userId) => ({ userId, ...notice })) });
    clientPush.pushToStaff(audience, notice);
  } catch (error) {
    console.warn("Unable to tell the team of a client message:", error?.message || error);
  }
}

// ── The client's side ────────────────────────────────────────────────────────────────────────────

async function clientThreads(projectId) {
  const threads = await prisma.clientChatThread.findMany({ where: { projectId }, include: lastMessage, orderBy: { lastMessageAt: "desc" } });
  return threads.map((thread) => threadRow(thread, { forClient: true }));
}

/** Opens a chat on `topic` with its first message - or adds to the open one on that topic. */
async function startThread({ projectId, clientUserId, topic, body }) {
  const key = TOPICS[topic] ? topic : "other";
  const text = bodyOf(body);
  const existing = await prisma.clientChatThread.findFirst({ where: { projectId, topic: key, status: "open" }, orderBy: { lastMessageAt: "desc" } });
  const thread = existing || await prisma.clientChatThread.create({ data: { projectId, clientUserId, topic: key } });
  await addMessage({ thread, fromClient: true, authorUserId: clientUserId, body: text });
  return thread.id;
}

/** One chat for the client, its messages oldest first; reading it marks it read on their side. */
async function clientThread(projectId, id) {
  const thread = await prisma.clientChatThread.findFirst({ where: { id, projectId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!thread) return null;
  await prisma.clientChatThread.update({ where: { id: thread.id }, data: { clientReadAt: new Date() } });
  return { id: thread.id, topic: thread.topic, topicLabel: topicLabel(thread.topic), status: thread.status, messages: thread.messages.map(messageOf) };
}

// ── Both sides ───────────────────────────────────────────────────────────────────────────────────

/**
 * Adds one message to `thread`. A client's tells the team, and Nebula answers it in the background
 * (`assistant.answer`); a team member's - or Nebula's - tells the client. Writing reopens a closed chat,
 * and marks it read by the writer. Nebula handing a question to the team (`handOff`) leaves the chat
 * unanswered for the team, its notices in their bells.
 */
async function addMessage({ thread, fromClient, authorUserId = null, authorName = null, body, byAssistant = false, handOff = false }) {
  const text = bodyOf(body);
  const now = new Date();
  const message = await prisma.clientChatMessage.create({ data: { threadId: thread.id, fromClient, authorUserId, authorName, body: text, createdAt: now } });
  await prisma.clientChatThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: now, status: "open", ...(fromClient ? { clientReadAt: now } : byAssistant && handOff ? {} : { staffReadAt: now }) },
  });
  if (fromClient) {
    await tellTeam(thread, text);
    setImmediate(() => { void assistant.answer(thread); });
  } else {
    // Answered: the notices about this chat leave the team's bells - unless Nebula handed it to them.
    if (!(byAssistant && handOff)) await prisma.notification.deleteMany({ where: { type: TYPES.CLIENT_CHAT, entityType: "CLIENT_CHAT", entityId: String(thread.id) } }).catch(() => {});
    // Every reply is told (no ten-minute hold, unlike a button pressed twice): kept for the app's bell
    // first, then pushed to the client's phones without holding the reply up.
    const message = { title: `Reply from the studio - ${topicLabel(thread.topic)}`, body: text.slice(0, 160), data: { type: "chat", chatId: thread.id } };
    await clientPush.record({ salesProjectId: thread.projectId, ...message });
    clientPush.notifyProject(thread.projectId, message).catch(() => {});
  }
  return messageOf(message);
}

// ── The team's side ──────────────────────────────────────────────────────────────────────────────

/**
 * The team's side reads only chats of live projects: a project in Resource Management → Recycling
 * Bin keeps its chats - Restore brings them back - but they are off the list and cannot be opened,
 * answered or closed while it is there.
 */
const LIVE_PROJECT = { project: { deletedAt: null } };

/** Every chat, newest first, with its project's code and name. `unreadOnly` narrows to unanswered. */
async function teamThreads({ unreadOnly = false } = {}) {
  // Not a chat of a project in Resource Management → Recycling Bin (`LIVE_PROJECT`).
  const threads = await prisma.clientChatThread.findMany({ where: LIVE_PROJECT, include: lastMessage, orderBy: { lastMessageAt: "desc" }, take: 300 });
  const projects = await prisma.salesProject.findMany({ where: { id: { in: [...new Set(threads.map((t) => t.projectId))] } }, select: { id: true, eventId: true, whatsappGroupName: true } });
  const byId = new Map(projects.map((project) => [project.id, project]));
  return threads
    .map((thread) => ({ ...threadRow(thread, { forClient: false }), eventId: byId.get(thread.projectId)?.eventId || "", projectName: byId.get(thread.projectId)?.whatsappGroupName || "" }))
    .filter((row) => !unreadOnly || row.unread);
}

/** One chat for the team; reading it marks it read on the studio's side and clears its notices. */
async function teamThread(id) {
  const thread = await prisma.clientChatThread.findFirst({ where: { id, ...LIVE_PROJECT }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!thread) return null;
  const project = await prisma.salesProject.findUnique({ where: { id: thread.projectId }, select: { eventId: true, whatsappGroupName: true } });
  await prisma.clientChatThread.update({ where: { id: thread.id }, data: { staffReadAt: new Date() } });
  await prisma.notification.deleteMany({ where: { type: TYPES.CLIENT_CHAT, entityType: "CLIENT_CHAT", entityId: String(thread.id) } }).catch(() => {});
  return { id: thread.id, topic: thread.topic, topicLabel: topicLabel(thread.topic), status: thread.status, eventId: project?.eventId || "", projectName: project?.whatsappGroupName || "", messages: thread.messages.map(messageOf) };
}

async function setStatus(id, status) {
  const thread = await prisma.clientChatThread.findFirst({ where: { id, ...LIVE_PROJECT } });
  if (!thread) return null;
  await prisma.clientChatThread.update({ where: { id }, data: { status: status === "closed" ? "closed" : "open" } });
  return status === "closed" ? "closed" : "open";
}

module.exports = { LIVE_PROJECT, TOPICS, topicLabel, clientThreads, startThread, clientThread, addMessage, teamThreads, teamThread, setStatus, audienceFor };
