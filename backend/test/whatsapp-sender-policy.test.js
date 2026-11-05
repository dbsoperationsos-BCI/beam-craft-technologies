const test = require("node:test");
const assert = require("node:assert/strict");

const policy = require("../src/modules/settings/automatic-whatsapp/senderPolicy");
const { senderPolicyTables } = require("./helpers/senderPolicyFakeDb");

/*
 * Who an automatic WhatsApp message goes from: one Sender (`SAME`), everybody else tried after them in
 * a dragged fallback order, or a Rotation (`ROTATE`) through every Allow-WhatsApp employee in its own
 * dragged order. Stand-ins only: no
 * database, no WhatsApp.
 */

// 7, 8 and 9 have Allow WhatsApp; 20 does not; 30 is not an active login.
const USERS = [
  { id: 7, name: "mukesh", employeeName: "Mukesh K", eligible: true },
  { id: 8, name: "arun", employeeName: "Arun Kumar", eligible: true },
  { id: 9, name: "divya", employeeName: "Divya S", eligible: true },
  { id: 20, name: "priya", employeeName: "Priya Raman", eligible: false },
  { id: 30, name: "gone", employeeName: "Gone Person", eligible: false },
];
const shape = (user) => ({ id: user.id, name: user.name, profilePhotoUrl: null, linkedEmployee: { employeeName: user.employeeName, employeeId: `DBS-${user.id}`, profilePhotoUrl: null } });
const userOf = (id) => { const user = USERS.find((entry) => entry.id === id); return user ? shape(user) : null; };
// Who the `where` asks for: an id, a list of ids, or nobody named - and Allow WhatsApp where asked.
const matches = (user, where) => (where.id?.in ? where.id.in.includes(user.id) : where.id === undefined || user.id === where.id) && (!where.whatsappRequired || user.eligible);

function fakeClient(policies = {}, options = {}) {
  return {
    ...senderPolicyTables(policies, userOf, options),
    user: {
      async findMany({ where }) { return USERS.filter((user) => matches(user, where)).map(shape); },
      async findFirst({ where }) { const user = USERS.find((entry) => matches(entry, where)); return user ? shape(user) : null; },
    },
  };
}
const sessions = (offline = []) => ({ sessionState: (userId) => ({ status: offline.includes(userId) ? "disconnected" : "connected" }) });
const ON = async () => true;
const KEY = policy.MESSAGE_KEYS.ATTENDANCE_REPORT;
const run = (client, attempt, extra = {}) => policy.trySenders(KEY, attempt, { client, sessions: sessions(), isChatEnabledForUser: ON, ...extra });
const ids = (list) => list.map((entry) => entry.id);

test("rotateOrder starts after the last sender, or from the top", () => {
  const list = [{ id: 7 }, { id: 8 }, { id: 9 }];
  assert.deepEqual(ids(policy.rotateOrder(list, 8)), [9, 7, 8]);
  assert.deepEqual(ids(policy.rotateOrder(list, 9)), [7, 8, 9]);
  assert.deepEqual(ids(policy.rotateOrder(list, null)), [7, 8, 9]);
  // The last sender has since left the rotation: from the top, nobody skipped.
  assert.deepEqual(ids(policy.rotateOrder(list, 99)), [7, 8, 9]);
  assert.deepEqual(policy.rotateOrder([], 7), []);
});

test("the rotation is every Allow-WhatsApp employee - the dragged order first, anybody since by name", async () => {
  // 9 was dragged first; 30 lost Allow WhatsApp and drops out; 7 and 8 were never placed, so follow by name.
  const read = await policy.readPolicy(KEY, { client: fakeClient({ [KEY]: { mode: "ROTATE", userIds: [9, 30] } }), sessions: sessions([8]) });
  assert.deepEqual(read.senders.map(({ priority, id, connected }) => [priority, id, connected]), [[1, 9, true], [2, 8, false], [3, 7, true]]);
  // Nothing saved yet: everybody, by name.
  assert.deepEqual(ids((await policy.readPolicy(KEY, { client: fakeClient(), sessions: sessions() })).senders), [8, 9, 7]);
});

test("the one Sender is named even after losing Allow WhatsApp, and marked so", async () => {
  const read = await policy.readPolicy(KEY, { client: fakeClient({ [KEY]: { sender: 30 } }), sessions: sessions() });
  assert.deepEqual({ id: read.sender.id, name: read.sender.name, eligible: read.sender.eligible }, { id: 30, name: "Gone Person", eligible: false });
});

test("setPolicy refuses a mode it does not know and anybody without Allow WhatsApp", async () => {
  const client = fakeClient();
  await assert.rejects(policy.setPolicy(KEY, { mode: "X" }, { client, sessions: sessions() }), { status: 400, message: "Choose Sender or Rotation." });
  await assert.rejects(policy.setPolicy(KEY, { mode: "SAME", senderUserId: 20 }, { client, sessions: sessions() }), { status: 400, message: "Every sender has to be an active employee with Allow WhatsApp ticked on their login." });
  await assert.rejects(policy.setPolicy(KEY, { mode: "ROTATE", userIds: [7, 20] }, { client, sessions: sessions() }), /Allow WhatsApp ticked/);
  await assert.rejects(policy.setPolicy(KEY, { mode: "SAME", senderUserId: "abc" }, { client, sessions: sessions() }), { status: 400, message: "Choose the sender." });
  await assert.rejects(policy.setPolicy(KEY, { mode: "SAME", senderUserId: 7, fallbackUserIds: [20] }, { client, sessions: sessions() }), /Allow WhatsApp ticked/);
  await assert.rejects(policy.setPolicy("NOT_A_MESSAGE", { mode: "SAME" }, { client, sessions: sessions() }), /Unknown automatic WhatsApp message/);
});

test("each mode keeps its own setting: switching to Rotation and back loses neither the Sender nor the order", async () => {
  const client = fakeClient();
  let saved = await policy.setPolicy(KEY, { mode: "SAME", senderUserId: 8, fallbackUserIds: [9, 7], userIds: [9, 9, 7] }, { client, sessions: sessions() });
  assert.deepEqual(ids(saved.fallback), [9, 7], "the fallback order, kept apart from the rotation's");
  assert.equal(saved.sender.id, 8);
  assert.deepEqual(ids(saved.senders).slice(0, 2), [9, 7], "the order given, repeats dropped");
  saved = await policy.setPolicy(KEY, { mode: "ROTATE", senderUserId: 8, userIds: [9, 7, 8] }, { client, sessions: sessions() });
  assert.equal(saved.mode, "ROTATE");
  assert.equal(saved.sender.id, 8);
  saved = await policy.setPolicy(KEY, { mode: "SAME", senderUserId: 8, fallbackUserIds: [9, 7], userIds: [9, 7, 8] }, { client, sessions: sessions() });
  assert.deepEqual([saved.mode, saved.sender.id, ids(saved.fallback), ids(saved.senders)], ["SAME", 8, [9, 7], [9, 7, 8]]);
});

test("a Sender already saved stays saved through a mode switch after losing Allow WhatsApp", async () => {
  const client = fakeClient({ [KEY]: { sender: 30 } });
  const saved = await policy.setPolicy(KEY, { mode: "ROTATE", senderUserId: 30, userIds: [7, 8, 9] }, { client, sessions: sessions() });
  assert.equal(saved.sender.id, 30);
});

test("Sender: not connected, the fallback order is tried - as dragged, not the rotation's", async () => {
  // The rotation puts Arun next; the fallback order, dragged separately, puts Divya next.
  const client = fakeClient({ [KEY]: { sender: 7, fallback: [9, 8], userIds: [7, 8, 9] } });
  const tried = [];
  const result = await run(client, async (sender) => { tried.push(sender.id); return "ok"; }, { sessions: sessions([7]) });
  assert.equal(result.outcome, "sent");
  assert.equal(result.userId, 9);
  assert.equal(result.who, "Priority 2 (Divya S)");
  assert.deepEqual(tried, [9]);
  assert.deepEqual(result.reasons, ["Priority 1 (Mukesh K): WhatsApp is not connected"]);
});

test("the fallback order leaves the Sender out, and takes anybody it does not name yet by name", async () => {
  const read = await policy.readPolicy(KEY, { client: fakeClient({ [KEY]: { sender: 8, fallback: [8, 7] } }), sessions: sessions() });
  assert.deepEqual(read.fallback.map(({ priority, id }) => [priority, id]), [[2, 7], [3, 9]]);
});

test("Sender: nobody at all can send - failed, naming each of them", async () => {
  const result = await run(fakeClient({ [KEY]: { sender: 7 } }), async () => "ok", { sessions: sessions([7, 8, 9]) });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reasons.length, 3);
});

test("Sender: the one sender sends every time, however many messages go", async () => {
  const client = fakeClient({ [KEY]: { sender: 8 } });
  const senders = [];
  for (let i = 0; i < 3; i += 1) senders.push((await run(client, async () => "ok")).userId);
  assert.deepEqual(senders, [8, 8, 8]);
});

test("Sender: refused by WhatsApp, the next in the fallback order sends it", async () => {
  const client = fakeClient({ [KEY]: { sender: 7 } });
  const tried = [];
  const result = await run(client, async (sender) => { tried.push(sender.id); if (sender.id === 7) throw Object.assign(new Error("not a participant"), { status: 403 }); return "ok"; });
  assert.equal(result.outcome, "sent");
  assert.deepEqual(tried, [7, 8]);
});

test("Rotation: each message goes from the next in the order", async () => {
  const client = fakeClient({ [KEY]: { mode: "ROTATE", userIds: [9, 7, 8] } });
  const senders = [];
  for (let i = 0; i < 4; i += 1) senders.push((await run(client, async () => "ok")).userId);
  assert.deepEqual(senders, [9, 7, 8, 9]);
});

test("Rotation: the next cannot send, so the one after does - and the turn after starts past them", async () => {
  const client = fakeClient({ [KEY]: { mode: "ROTATE", userIds: [7, 8, 9], lastSenderUserId: 7 } });
  const result = await run(client, async (sender) => { if (sender.id === 8) throw policy.skip("no group of that name among their own"); return "ok"; });
  assert.equal(result.userId, 9);
  assert.equal(client.senderPolicyState.policies.get(KEY).lastSenderUserId, 9);
  assert.match(result.reasons[0], /Priority 2 \(Arun Kumar\): no group of that name among their own/);
  assert.equal((await run(client, async () => "ok")).userId, 7);
});

test("Rotation: nobody can send - failed, naming every one of them", async () => {
  const client = fakeClient({ [KEY]: { mode: "ROTATE", userIds: [7, 8, 9] } });
  const result = await run(client, async () => "ok", { sessions: sessions([7, 8, 9]) });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reasons.length, 3);
  assert.equal(client.senderPolicyState.policies.get(KEY).lastSenderUserId, null);
});

test("a send that may have gone stops there", async () => {
  const client = fakeClient({ [KEY]: { mode: "ROTATE", userIds: [7, 8] } });
  const tried = [];
  const result = await run(client, async (sender) => { tried.push(sender.id); throw new Error("Timed Out"); });
  assert.equal(result.outcome, "maybe-sent");
  assert.deepEqual(tried, [7]);
});

test("no sender chosen: failed, saying so", async () => {
  const result = await run(fakeClient(), async () => assert.fail("nobody should be asked"));
  assert.equal(result.outcome, "failed");
  assert.equal(result.attempted, false);
  assert.deepEqual(result.reasons, ["No sender is chosen for this message."]);
  assert.equal(policy.hasSender(await policy.readPolicy(KEY, { client: fakeClient(), sessions: sessions() })), false);
});

test("the Sender having lost Allow WhatsApp is passed over with the reason, for the fallback order", async () => {
  const result = await run(fakeClient({ [KEY]: { sender: 30 } }), async () => "ok");
  assert.equal(result.userId, 8);
  assert.match(result.reasons[0], /^Priority 1 \(Gone Person\): no longer an active employee with Allow WhatsApp ticked/);
});

test("their own WhatsApp chat switched off: passed over in a Rotation", async () => {
  const client = fakeClient({ [KEY]: { mode: "ROTATE", userIds: [7, 8] } });
  const result = await run(client, async () => "ok", { isChatEnabledForUser: async (userId) => userId !== 7 });
  assert.equal(result.userId, 8);
  assert.match(result.reasons[0], /switched off for them/);
});

test("the last sender failing to save does not undo a message that went", async () => {
  const client = fakeClient({ [KEY]: { mode: "ROTATE", userIds: [7] } }, { failMarkSent: true });
  const result = await run(client, async () => "ok");
  assert.equal(result.outcome, "sent");
  assert.equal(result.userId, 7);
});
