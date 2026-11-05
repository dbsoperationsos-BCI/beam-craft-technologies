const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const clientPush = require("../src/services/clientPush");
const chats = require("../src/modules/client/chats/service");
const assistant = require("../src/modules/client/chats/assistant");
const provider = require("../src/services/ai/provider");
const { clientRoutes, teamReply, teamRead } = require("../src/modules/client/chats/controller");
const { protect } = require("../src/middleware/authMiddleware");

/*
 * Client chats: the client opens a chat on a topic from their app, the team is told and answers on
 * Sales -> Client Chats, and the client is told of the reply. Another client cannot read or write it.
 * Nothing reaches Expo (the sender is replaced), nor the AI (Nebula is off but where a test stubs it).
 * Real rows, removed at the end.
 */
process.env.CLIENT_CHAT_AI = "false";
// CI runs with no JWT_SECRET; the route check below signs a client's token, as the app's login would.
process.env.JWT_SECRET = process.env.JWT_SECRET || "client-chats-test-secret";
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCC-${STAMP}-${name}`;
const NUMBER = `94${STAMP}12`.slice(0, 10);
const F = {};

const answer = async (handler, req) => {
  const out = { code: 200 };
  const res = { status: (c) => { out.code = c; return res; }, json: (b) => { out.body = b; return res; }, set: () => res };
  await handler(req, res);
  return out;
};
const own = (projectId) => async () => (projectId ? { id: projectId } : null);

before(async () => {
  clientPush.setSender(async (messages) => messages.map(() => ({ status: "ok" })));
  await prisma.salesCrmLead.upsert({ where: { enquiryId: tag("enq") }, create: { enquiryId: tag("enq"), name: tag("enq") }, update: {} });
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq"), eventId: tag("ev"), whatsappGroupName: `WED ${STAMP}`, clientMainNumber: `+91 ${NUMBER}`,
    sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Work in Progress",
  } });
  F.client = await prisma.user.create({ data: { name: "C", email: null, username: NUMBER, password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.project.id } });
  F.admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN", status: "ACTIVE" }, select: { id: true } });
});

after(async () => {
  clientPush.setSender(null);
  const threads = await prisma.clientChatThread.findMany({ where: { projectId: { in: [F.project?.id].filter(Boolean) } }, select: { id: true } });
  await prisma.notification.deleteMany({ where: { entityType: "CLIENT_CHAT", entityId: { in: threads.map((t) => String(t.id)) } } });
  await prisma.clientChatThread.deleteMany({ where: { projectId: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.clientNotification.deleteMany({ where: { salesProjectId: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.client?.id].filter(Boolean) } } });
  await prisma.salesProject.deleteMany({ where: { id: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: tag("enq") } });
  await prisma.$disconnect();
});

test("a client opens a chat, the team is told and answers, the client is told", async () => {
  const mine = clientRoutes(own(F.project.id));
  const asClient = (extra = {}) => ({ user: { id: F.client.id, role: "CLIENT" }, query: {}, params: {}, body: {}, ...extra });
  assert.equal((await answer(mine.start, asClient({ body: { topic: "payment", body: "   " } }))).code, 400, "an empty message is refused");

  const started = await answer(mine.start, asClient({ body: { topic: "payment", body: "When is the next instalment due?" } }));
  assert.equal(started.code, 201);
  const chatId = started.body.data.id;
  assert.equal(started.body.data.topicLabel, "Payment");
  assert.ok((await prisma.notification.count({ where: { type: "CLIENT_CHAT", entityId: String(chatId) } })) >= 1, "the team is told in the bell");

  // A second message on the same topic goes to the same chat.
  await answer(mine.start, asClient({ body: { topic: "payment", body: "And can I pay by UPI?" } }));
  assert.equal(await prisma.clientChatThread.count({ where: { projectId: F.project.id } }), 1);

  // The team sees it unread, reads it (the notices go), and answers.
  assert.ok((await chats.teamThreads({ unreadOnly: true })).some((row) => row.id === chatId));
  assert.equal((await answer(teamRead, { params: { id: String(chatId) } })).body.data.messages.length, 2);
  assert.equal(await prisma.notification.count({ where: { type: "CLIENT_CHAT", entityId: String(chatId) } }), 0, "read: the notices leave the bells");
  const reply = await answer(teamReply, { user: { id: F.admin.id }, params: { id: String(chatId) }, body: { body: "It is due on 10 Dec. UPI works." } });
  assert.equal(reply.code, 201);
  assert.equal(await prisma.clientNotification.count({ where: { salesProjectId: F.project.id, type: "chat" } }), 1, "the client is told of the reply");

  // The client sees the reply, unread until opened.
  const list = (await answer(mine.list, asClient())).body.data;
  assert.equal(list.chats[0].unread, true);
  const thread = (await answer(mine.read, asClient({ params: { id: String(chatId) } }))).body.data;
  assert.deepEqual(thread.messages.map((m) => m.fromClient), [true, true, false]);
  assert.equal((await answer(mine.list, asClient())).body.data.chats[0].unread, false, "read once opened");
});

test("another client cannot read or write the chat, and only the client's routes are open", async () => {
  const thread = await prisma.clientChatThread.findFirst({ where: { projectId: F.project.id } });
  const theirs = clientRoutes(own(null));
  const asOther = { user: { id: 0, role: "CLIENT" }, query: {}, params: { id: String(thread.id) }, body: { body: "hello" } };
  assert.equal((await answer(theirs.read, asOther)).code, 404);
  assert.equal((await answer(theirs.reply, asOther)).code, 404);

  const route = async (method, url) => {
    let outcome = null;
    const res = { status: (c) => { outcome = c; return res; }, json: () => res };
    const token = require("jsonwebtoken").sign({ id: F.client.id, role: "CLIENT" }, process.env.JWT_SECRET, { expiresIn: "5m" });
    await protect({ method, originalUrl: url, headers: { authorization: `Bearer ${token}` } }, res, () => { outcome = "next"; });
    return outcome;
  };
  assert.equal(await route("POST", `/api/client/chats/${thread.id}/messages`), "next");
  assert.equal(await route("GET", `/api/client/chats/${thread.id}`), "next");
  assert.equal(await route("POST", `/api/sales/client-chats/${thread.id}/messages`), 403, "a client cannot answer as the studio");
});

test("Nebula answers from the client's own booking, hands the rest to the team, and steps back for a person", async () => {
  const realComplete = provider.completeJson;
  let asked = null;
  let next = { reply: "Your Haldi shoot is on 12 Dec. The balance due is Rs 1,000.", handOff: false };
  provider.completeJson = async (options) => { asked = options; if (next instanceof Error) throw next; return next; };
  try {
    await prisma.projectShoot.create({ data: { shootId: tag("sid"), projectId: F.project.id, shoot: "Haldi", dateCreated: new Date("2026-12-12") } });
    const threadId = await chats.startThread({ projectId: F.project.id, clientUserId: F.client.id, topic: "shoot", body: "When is my shoot?" });
    const thread = await prisma.clientChatThread.findUnique({ where: { id: threadId } });
    process.env.CLIENT_CHAT_AI = "true";

    // Answered: from the booking's facts, as Nebula, the client told, the chat answered for the team.
    const answered = await assistant.answer(thread);
    assert.equal(answered.author, assistant.AUTHOR);
    assert.match(asked.prompt, /Haldi on 12 Dec 2026/);
    assert.match(asked.prompt, /Balance due: Rs 1,000/);
    assert.equal(await prisma.clientNotification.count({ where: { salesProjectId: F.project.id, type: "chat", body: { contains: "Haldi" } } }), 1);
    assert.ok(!(await chats.teamThreads({ unreadOnly: true })).some((row) => row.id === threadId));

    // Handed off: the client is told the team will reply, the chat stays unanswered and in the bells.
    process.env.CLIENT_CHAT_AI = "false";
    await chats.addMessage({ thread, fromClient: true, authorUserId: F.client.id, body: "Can we move it to 14 Dec?" });
    process.env.CLIENT_CHAT_AI = "true";
    next = { reply: "The studio team has your message and will reply here soon.", handOff: true };
    await assistant.answer(thread);
    assert.ok((await chats.teamThreads({ unreadOnly: true })).some((row) => row.id === threadId), "still unanswered for the team");
    assert.ok((await prisma.notification.count({ where: { type: "CLIENT_CHAT", entityId: String(threadId) } })) >= 1, "still in the bells");

    // The AI unreachable: nothing written, nothing thrown.
    next = new Error("connect ECONNREFUSED");
    assert.equal(await assistant.answer(thread), null);

    // A person answered within the half hour: Nebula stays out.
    await chats.addMessage({ thread, fromClient: false, authorUserId: F.admin.id, authorName: "Studio", body: "Let me check the 14th for you." });
    next = { reply: "should not be written", handOff: false };
    assert.equal(await assistant.answer(thread), null);
    assert.equal(await prisma.clientChatMessage.count({ where: { threadId, body: "should not be written" } }), 0);

    // Off: never asked.
    process.env.CLIENT_CHAT_AI = "false";
    asked = null;
    await prisma.clientChatMessage.deleteMany({ where: { threadId, fromClient: false, authorName: "Studio" } });
    assert.equal(await assistant.answer(thread), null);
    assert.equal(asked, null);
  } finally {
    provider.completeJson = realComplete;
    process.env.CLIENT_CHAT_AI = "false";
    await prisma.projectShoot.deleteMany({ where: { projectId: F.project.id } });
  }
});
