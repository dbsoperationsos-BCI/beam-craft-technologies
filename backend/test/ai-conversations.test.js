const test = require("node:test");
const assert = require("node:assert");
const prisma = require("../src/config/db");
const memory = require("../src/services/ai/memory/conversations");

/**
 * Conversation isolation, against the real database.
 *
 * The guarantee is that a thread belongs to one person in one module, and that asking for it from
 * anywhere else returns nothing. These run against real rows because the guarantee lives in a
 * `where` clause - a stubbed Prisma would test the stub.
 *
 * Everything created here is deleted afterwards, and only rows created here are touched.
 */

let userId;
const created = [];

test.before(async () => {
  const user = await prisma.user.findFirst({ select: { id: true } });
  assert.ok(user, "a user is needed to own a conversation");
  userId = user.id;
});

test.after(async () => {
  for (const id of created) {
    await prisma.aiConversation.deleteMany({ where: { id } });
  }
});

async function open(module, message) {
  const conversation = await memory.openConversation({ userId, module, firstMessage: message });
  created.push(conversation.id);
  return conversation;
}

test("a conversation is opened in the module it was asked for", async () => {
  const conversation = await open("SALES", "What should I do with this lead?");
  assert.strictEqual(conversation.module, "SALES");
  // The title comes from the question, never from the model.
  assert.strictEqual(conversation.title, "What should I do with this lead?");
});

test("a CRM thread cannot be reached from an HRM session", async () => {
  /*
   * The isolation guarantee, stated as the test that would have caught its absence. The id is
   * correct and the owner is correct; only the module is wrong, and that is enough.
   */
  const sales = await open("SALES", "Lead question");

  assert.ok(await memory.findConversation({ id: sales.id, userId, module: "SALES" }));
  assert.strictEqual(await memory.findConversation({ id: sales.id, userId, module: "HRM" }), null);
  assert.strictEqual(await memory.findConversation({ id: sales.id, userId, module: "GLOBAL" }), null);
});

test("another person's thread is invisible even with the right id", async () => {
  const mine = await open("SALES", "Mine");
  // A different user id, same everything else.
  assert.strictEqual(await memory.findConversation({ id: mine.id, userId: userId + 99999, module: "SALES" }), null);
});

test("listing a module never shows another module's threads", async () => {
  const sales = await open("SALES", "Sales thread");
  const hrm = await open("HRM", "HRM thread");

  const salesIds = (await memory.listConversations({ userId, module: "SALES" })).map((c) => c.id);
  const hrmIds = (await memory.listConversations({ userId, module: "HRM" })).map((c) => c.id);

  assert.ok(salesIds.includes(sales.id));
  assert.ok(!salesIds.includes(hrm.id), "an HRM thread appeared in the SALES list");
  assert.ok(hrmIds.includes(hrm.id));
  assert.ok(!hrmIds.includes(sales.id), "a SALES thread appeared in the HRM list");
});

test("an id from the wrong module opens a new thread rather than failing", async () => {
  /*
   * A stale id in a browser tab must not leave someone with an assistant that refuses to talk.
   * Starting a fresh thread is the recoverable answer; returning the other module's thread would
   * be the isolation breach this whole file is about.
   */
  const sales = await open("SALES", "Original");
  const reopened = await memory.openConversation({ id: sales.id, userId, module: "HRM", firstMessage: "New" });
  created.push(reopened.id);

  assert.notStrictEqual(reopened.id, sales.id);
  assert.strictEqual(reopened.module, "HRM");
});

test("a turn is stored and read back oldest first", async () => {
  const conversation = await open("SALES", "First");
  await memory.recordTurn({ conversationId: conversation.id, question: "First question", answer: "First answer" });
  await memory.recordTurn({ conversationId: conversation.id, question: "Second question", answer: "Second answer" });

  const turns = await memory.recentTurns({ conversationId: conversation.id });
  assert.deepStrictEqual(turns.map((t) => t.role), ["user", "assistant", "user", "assistant"]);
  // A conversation reads forwards.
  assert.strictEqual(turns[0].content, "First question");
  assert.strictEqual(turns[3].content, "Second answer");
});

test("history is bounded", async () => {
  const conversation = await open("SALES", "Long");
  for (let i = 0; i < 8; i += 1) {
    await memory.recordTurn({ conversationId: conversation.id, question: `Q${i}`, answer: `A${i}` });
  }
  // Sixteen rows exist; the prompt gets a window, not the lot.
  const turns = await memory.recentTurns({ conversationId: conversation.id, limit: 6 });
  assert.strictEqual(turns.length, 6);
  // And the window is the recent end.
  assert.strictEqual(turns[turns.length - 1].content, "A7");
});

test("a pasted secret is redacted before it is stored", async () => {
  /*
   * People paste credentials into chat boxes the way they paste them into remarks. Cleaning on the
   * way in means it is never in the table for a later turn, an export, or whoever inherits the
   * database to read back.
   */
  const conversation = await open("SALES", "Secrets");
  await memory.recordTurn({
    conversationId: conversation.id,
    question: "the server says DB_PASSWORD=hunter2 and JWT_SECRET=abc123",
    answer: "Noted.",
  });

  const [stored] = await memory.recentTurns({ conversationId: conversation.id });
  assert.ok(!stored.content.includes("hunter2"), "a password was stored");
  assert.ok(!stored.content.includes("abc123"), "a secret was stored");
  assert.match(stored.content, /redacted/);
});

test("tool results are never stored, only which tools ran", async () => {
  const conversation = await open("SALES", "Tools");
  await memory.recordTurn({
    conversationId: conversation.id,
    question: "How many leads?",
    answer: "You have 31,071 leads.",
    toolTrace: [{ name: "sales.getPipeline", ms: 240 }],
  });

  const row = await prisma.aiMessage.findFirst({
    where: { conversationId: conversation.id, role: "assistant" },
    select: { toolTrace: true },
  });
  const trace = JSON.parse(row.toolTrace);
  assert.strictEqual(trace[0].name, "sales.getPipeline");
  // Names and durations - never the rows the tool returned.
  assert.strictEqual(trace[0].items, undefined);
  assert.strictEqual(trace[0].result, undefined);
});

test("deleting a thread takes its messages with it", async () => {
  const conversation = await open("SALES", "Doomed");
  await memory.recordTurn({ conversationId: conversation.id, question: "Q", answer: "A" });

  assert.strictEqual(await memory.deleteConversation({ id: conversation.id, userId, module: "HRM" }), false, "deleted from the wrong module");
  assert.strictEqual(await memory.deleteConversation({ id: conversation.id, userId, module: "SALES" }), true);

  const orphans = await prisma.aiMessage.count({ where: { conversationId: conversation.id } });
  assert.strictEqual(orphans, 0, "messages outlived their conversation");
});
