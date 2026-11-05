const prisma = require("../../../config/db");
const { publishedSaleExtrasTotal } = require("../../sales/sale-extras/totals");
const provider = require("../../../services/ai/provider");

/*
 * Nebula in the client's chat: the first answer to a client's message, so nobody waits for a person
 * to be free. It answers only from this client's own booking - what the app already shows them: the
 * shoots and their dates, what is paid and still due, who is on their team - and hands everything
 * else to the team: changes, prices and discounts, refunds, complaints, and anything it does not know.
 * The team is told of every client message either way (`service.tellTeam`) and can always answer.
 *
 * Off with CLIENT_CHAT_AI="false", or when the studio's AI is off (`AI_ENABLED`). A person who
 * answered the chat in the last half hour has it: Nebula stays out of their way.
 */

const AUTHOR = "Nebula (AI assistant)";
const HUMAN_ACTIVE_MS = 30 * 60 * 1000;

function enabled() {
  return String(process.env.CLIENT_CHAT_AI ?? "true").trim().toLowerCase() !== "false" && provider.enabled();
}

const inr = (amount) => `Rs ${Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const day = (value) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "date not fixed yet");

/** What this client may be told about their own booking, as plain lines for the model. */
async function bookingFacts(projectId) {
  const project = await prisma.salesProject.findUnique({
    where: { id: projectId },
    select: {
      eventId: true, projectStatus: true, mainEventDate: true, initialConvertedValue: true, sourceBranch: true,
      projectManager: true, crmName: true,
      shoots: { where: { deletedAt: null }, select: { shoot: true, dateCreated: true, eventStartTime: true }, orderBy: { dateCreated: "asc" } },
    },
  });
  if (!project) return null;
  const [received, extras] = await Promise.all([
    prisma.cashEntry.aggregate({ where: { projectId, deletedAt: null, entryType: "Received" }, _sum: { amount: true } }),
    prisma.projectExtraQuotation.aggregate({ where: { projectId, deletedAt: null, status: "APPROVED" }, _sum: { amount: true } }),
  ]);
  const signed = Number(project.initialConvertedValue || 0) + Number(extras._sum.amount || 0) + await publishedSaleExtrasTotal(projectId);
  const paid = Number(received._sum.amount || 0);
  return [
    `Booking ID: ${project.eventId}`,
    `Booking status: ${project.projectStatus || "unknown"}`,
    `Main event date: ${day(project.mainEventDate)}`,
    `Studio branch: ${project.sourceBranch || "unknown"}`,
    `Shoots: ${project.shoots.length ? project.shoots.map((s) => `${s.shoot} on ${day(s.dateCreated)}${s.eventStartTime ? ` from ${s.eventStartTime}` : ""}`).join("; ") : "none listed yet"}`,
    `Total signed (quotation + approved extras): ${inr(signed)}`,
    `Paid so far: ${inr(paid)}`,
    `Balance due: ${inr(Math.max(0, signed - paid))}`,
    project.projectManager ? `Project manager: ${project.projectManager}` : null,
    project.crmName ? `Sales contact: ${project.crmName}` : null,
  ].filter(Boolean).join("\n");
}

const SYSTEM = [
  "You are Nebula, the assistant of Don't Blink Studioz, a wedding and family photography studio.",
  "You are replying to a client in the chat of their studio app.",
  "Answer ONLY from the BOOKING FACTS given. Never invent dates, amounts, names, prices, policies or promises.",
  "Hand the question to the team (handOff true) when it asks to change, cancel or reschedule anything, about prices, discounts, offers, refunds or new services, a complaint or an unhappy client, or anything the facts do not answer.",
  "When you hand off, still reply kindly: say the studio team has the message and will reply here soon. Do not guess the answer.",
  "Write warmly and briefly - two to four short sentences, plain text, no markdown, no lists. Match the client's language (English or Tanglish) if you can.",
  'Reply with JSON only: {"reply": "<message to the client>", "handOff": true|false}',
].join("\n");

/**
 * Nebula's answer to the client's newest message in `thread`, written into the chat - or nothing, when
 * it is off, a person is answering, or the AI cannot be reached. Never throws.
 */
async function answer(thread) {
  try {
    if (!enabled()) return null;
    const messages = await prisma.clientChatMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" }, take: 40 });
    const lastHuman = [...messages].reverse().find((m) => !m.fromClient && m.authorName !== AUTHOR);
    if (lastHuman && Date.now() - lastHuman.createdAt.getTime() < HUMAN_ACTIVE_MS) return null;
    const facts = await bookingFacts(thread.projectId);
    if (!facts) return null;
    const history = messages.slice(-12).map((m) => `${m.fromClient ? "Client" : m.authorName === AUTHOR ? "Nebula" : `Studio (${m.authorName || "team"})`}: ${m.body}`).join("\n");
    const result = await provider.completeJson({
      system: SYSTEM,
      prompt: `CHAT TOPIC: ${thread.topic}\n\nBOOKING FACTS:\n${facts}\n\nCONVERSATION SO FAR:\n${history}\n\nReply to the client's last message.`,
      temperature: 0.3,
      maxTokens: 400,
    });
    const reply = String(result?.reply || "").trim().slice(0, 1200);
    if (!reply) return null;
    // Written as the studio's side, by Nebula; the client is told as for any reply.
    const { addMessage } = require("./service");
    return await addMessage({ thread, fromClient: false, authorName: AUTHOR, body: reply, byAssistant: true, handOff: Boolean(result?.handOff) });
  } catch (error) {
    console.warn("Nebula could not answer the client chat:", error?.message || error);
    return null;
  }
}

module.exports = { answer, enabled, bookingFacts, AUTHOR };
