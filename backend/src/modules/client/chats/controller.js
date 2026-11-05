const prisma = require("../../../config/db");
const chats = require("./service");

/*
 * Client chats over HTTP: the client's routes (mounted on the client portal, their own project only)
 * and the team's (Sales -> Client Chats).
 */

const idOf = (req) => Number.parseInt(req.params.id, 10);
const fail = (res, error, fallback) => {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
};

// ── The client's ──
// `ownProject(req)` is the client portal's: the signed-in client's project (or the event they name).

function clientRoutes(ownProject) {
  return {
    async list(req, res) {
      try {
        res.set("Cache-Control", "no-store");
        const project = await ownProject(req);
        if (!project) return res.status(404).json({ message: "Your project could not be found." });
        return res.json({ data: { topics: Object.entries(chats.TOPICS).map(([key, label]) => ({ key, label })), chats: await chats.clientThreads(project.id) } });
      } catch (error) { return fail(res, error, "Unable to load your chats."); }
    },
    async start(req, res) {
      try {
        const project = await ownProject(req);
        if (!project) return res.status(404).json({ message: "Your project could not be found." });
        const id = await chats.startThread({ projectId: project.id, clientUserId: Number(req.user.id), topic: String(req.body?.topic || ""), body: req.body?.body });
        return res.status(201).json({ data: await chats.clientThread(project.id, id) });
      } catch (error) { return fail(res, error, "Your message could not be sent."); }
    },
    async read(req, res) {
      try {
        res.set("Cache-Control", "no-store");
        const project = await ownProject(req);
        const thread = project ? await chats.clientThread(project.id, idOf(req)) : null;
        if (!thread) return res.status(404).json({ message: "Chat not found." });
        return res.json({ data: thread });
      } catch (error) { return fail(res, error, "Unable to load the chat."); }
    },
    async reply(req, res) {
      try {
        const project = await ownProject(req);
        const thread = project ? await prisma.clientChatThread.findFirst({ where: { id: idOf(req), projectId: project.id } }) : null;
        if (!thread) return res.status(404).json({ message: "Chat not found." });
        return res.status(201).json({ data: await chats.addMessage({ thread, fromClient: true, authorUserId: Number(req.user.id), body: req.body?.body }) });
      } catch (error) { return fail(res, error, "Your message could not be sent."); }
    },
  };
}

// ── The team's ──

async function teamList(req, res) {
  try {
    return res.json({ data: await chats.teamThreads({ unreadOnly: req.query?.unread === "1" }) });
  } catch (error) { return fail(res, error, "Unable to load client chats."); }
}

async function teamRead(req, res) {
  try {
    const thread = await chats.teamThread(idOf(req));
    if (!thread) return res.status(404).json({ message: "Chat not found." });
    return res.json({ data: thread });
  } catch (error) { return fail(res, error, "Unable to load the chat."); }
}

async function teamReply(req, res) {
  try {
    const thread = await prisma.clientChatThread.findFirst({ where: { id: idOf(req), ...chats.LIVE_PROJECT } });
    if (!thread) return res.status(404).json({ message: "Chat not found." });
    const author = await prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: { name: true, username: true } });
    const message = await chats.addMessage({ thread, fromClient: false, authorUserId: Number(req.user.id), authorName: author?.name || author?.username || "Studio", body: req.body?.body });
    return res.status(201).json({ data: message });
  } catch (error) { return fail(res, error, "The reply could not be sent."); }
}

async function teamStatus(req, res) {
  try {
    const status = await chats.setStatus(idOf(req), String(req.body?.status || ""));
    if (!status) return res.status(404).json({ message: "Chat not found." });
    return res.json({ data: { status } });
  } catch (error) { return fail(res, error, "Unable to update the chat."); }
}

module.exports = { clientRoutes, teamList, teamRead, teamReply, teamStatus };
