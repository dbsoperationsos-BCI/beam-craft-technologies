const prisma = require("../../../config/db");
const { redactSecrets } = require("../leadContext");

/**
 * Assistant conversations, kept apart by person and by module.
 *
 * Every read here filters on both `userId` and `module`, and neither is optional. That is the whole
 * isolation guarantee: a CRM thread and an HRM thread are different rows, and asking for one by id
 * from the wrong module returns nothing rather than the wrong thread. A conversation id is a cuid
 * and hard to guess, but "hard to guess" is not an access control, so the ownership check is in the
 * `where` clause rather than in a comparison afterwards.
 *
 * What is not stored is as deliberate as what is. Tool results never become rows: they are folded
 * into the assistant's answer and the trace keeps only which tools ran and how long they took. A
 * conversation reopened next month must not replay a lead's phone number that the reader has since
 * lost permission to see.
 */

// Enough for a real exchange without an unbounded prompt. The oldest turns matter least.
const HISTORY_TURNS = 10;
// A title is for the list, not for reading. Long enough to recognise a thread by.
const TITLE_LENGTH = 120;

/** The opening question, trimmed into something recognisable in a list. */
function titleFrom(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1)}…` : text;
}

/**
 * A conversation the caller owns, in the module they are working in.
 *
 * Returns null when it does not exist, belongs to someone else, or belongs to another module - all
 * three are the same answer on purpose. Telling the difference would say whether a given id exists.
 */
async function findConversation({ id, userId, module }) {
  const conversationId = String(id || "").trim();
  if (!conversationId) return null;
  return prisma.aiConversation.findFirst({
    // Ownership and module are part of the query, not checked after the row comes back.
    where: { id: conversationId, userId, module },
    select: { id: true, module: true, title: true, createdAt: true, updatedAt: true },
  });
}

/** This person's threads in this module, most recent first. */
async function listConversations({ userId, module, limit = 20 }) {
  return prisma.aiConversation.findMany({
    where: { userId, module },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 20, 1), 50),
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
}

/**
 * The conversation this turn belongs to, opening one if needed.
 *
 * An id that does not resolve - wrong owner, wrong module, deleted - starts a new thread rather
 * than raising. The alternative is a person whose assistant refuses to talk because of a stale id
 * in a browser tab.
 */
async function openConversation({ id, userId, module, firstMessage }) {
  const existing = await findConversation({ id, userId, module });
  if (existing) return existing;

  return prisma.aiConversation.create({
    data: { userId, module, title: titleFrom(firstMessage) },
    select: { id: true, module: true, title: true, createdAt: true, updatedAt: true },
  });
}

/**
 * The recent turns of a conversation, oldest first, for the prompt.
 *
 * Bounded rather than complete: a model has a small window, and a thread that has run all afternoon
 * would fill it with its own beginning.
 */
async function recentTurns({ conversationId, limit = HISTORY_TURNS }) {
  const rows = await prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || HISTORY_TURNS, 1), 40),
    select: { role: true, content: true },
  });
  // Newest first out of the database, oldest first into the prompt: a conversation reads forwards.
  return rows.reverse();
}

/**
 * Records one exchange.
 *
 * Both turns in one transaction with the conversation's timestamp, so a thread cannot end up with a
 * question and no answer, or drift to the bottom of the list because the write half-failed.
 */
async function recordTurn({ conversationId, question, answer, toolTrace = [] }) {
  const asked = String(question || "").trim();
  const replied = String(answer || "").trim();
  if (!asked && !replied) return;

  /*
   * Cleaned on the way in, not on the way out.
   *
   * People paste credentials into chat boxes the same way they paste them into remarks. Redacting
   * at write time means a secret is never in the table to be read back by a later turn, an export
   * or whoever inherits the database.
   */
  const rows = [];
  if (asked) rows.push({ conversationId, role: "user", content: redactSecrets(asked) });
  if (replied) {
    rows.push({
      conversationId,
      role: "assistant",
      content: redactSecrets(replied),
      // Names and durations only. A tool's results are not stored - see the note at the top.
      toolTrace: toolTrace.length ? JSON.stringify(toolTrace) : null,
    });
  }

  await prisma.$transaction([
    prisma.aiMessage.createMany({ data: rows }),
    prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }),
  ]);
}

/** Deletes a thread the caller owns. Returns whether anything was deleted. */
async function deleteConversation({ id, userId, module }) {
  const conversation = await findConversation({ id, userId, module });
  if (!conversation) return false;
  // Messages go with it: the cascade is declared on the foreign key.
  await prisma.aiConversation.delete({ where: { id: conversation.id } });
  return true;
}

module.exports = {
  findConversation,
  listConversations,
  openConversation,
  recentTurns,
  recordTurn,
  deleteConversation,
  titleFrom,
  HISTORY_TURNS,
};
