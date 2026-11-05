const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const clientPush = require("../src/services/clientPush");
const { getClientNotifications, registerPushToken, removePushToken } = require("../src/modules/client/portal/controller");

/*
 * Push notifications to clients: the app registers a phone's Expo token against the login, and a
 * push for a project reaches every phone of every client login that reaches it - its own login, or a
 * login made for another project with the same number. Nothing is sent to Expo: the sender is
 * replaced. Real rows, removed at the end.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCPU-${STAMP}-${name}`;
const F = {};
const token = (n) => `ExponentPushToken[${STAMP}-${n}]`;

const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });
const projectData = (name, number) => ({
  enquiryId: tag(`enq-${name}`), eventId: tag(`ev-${name}`), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: number,
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Yet to Start",
});
const answer = async (handler, user, body) => {
  const out = { code: 200 };
  const res = { status: (c) => { out.code = c; return res; }, json: (b) => { out.body = b; return res; }, end: () => res, set: () => res };
  await handler({ user: { id: user.id, role: "CLIENT" }, body }, res);
  return out;
};

// The client logins are named by phone number, which carries no prefix the fixture sweep could find,
// so a run killed before `after` left them behind and every later run failed on the username.
const CLIENT_NUMBERS = ["9000054321", "9000011122"];

before(async () => {
  await prisma.user.deleteMany({ where: { username: { in: CLIENT_NUMBERS }, role: "CLIENT" } });
  for (const n of ["first", "second", "other"]) await leadFor(tag(`enq-${n}`));
  F.first = await prisma.salesProject.create({ data: projectData("first", "+91 9000054321") });
  F.second = await prisma.salesProject.create({ data: projectData("second", "+91 90000 54321") });
  F.other = await prisma.salesProject.create({ data: projectData("other", "+91 9000011122") });
  F.client = await prisma.user.create({ data: { name: "C", email: null, username: "9000054321", password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.first.id } });
  F.otherClient = await prisma.user.create({ data: { name: "O", email: null, username: "9000011122", password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.other.id } });
});

after(async () => {
  clientPush.setSender(null);
  await prisma.clientNotification.deleteMany({ where: { salesProjectId: { in: [F.first?.id, F.second?.id, F.other?.id].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.client?.id, F.otherClient?.id].filter(Boolean) } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCPU-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCPU-${STAMP}` } } });
  await prisma.$disconnect();
});

test("the app registers a phone's push token, refuses anything else, and removes it on sign-out", async () => {
  assert.equal((await answer(registerPushToken, F.client, { token: "not a token" })).code, 400);
  assert.equal((await answer(registerPushToken, F.client, { token: token(1), platform: "android" })).code, 204);
  assert.equal((await answer(registerPushToken, F.client, { token: token(2), platform: "ios" })).code, 204);
  assert.equal(await prisma.clientPushToken.count({ where: { userId: F.client.id } }), 2);
  await answer(removePushToken, F.otherClient, { token: token(2) });
  assert.equal(await prisma.clientPushToken.count({ where: { userId: F.client.id } }), 2, "another login cannot remove it");
  await answer(removePushToken, F.client, { token: token(2) });
  assert.equal(await prisma.clientPushToken.count({ where: { userId: F.client.id } }), 1);
  await answer(registerPushToken, F.otherClient, { token: token(9) });
});

test("a push for any of the client's events reaches their phones, and no one else's", async () => {
  const sent = [];
  clientPush.setSender(async (messages) => { sent.push(...messages); return messages.map(() => ({ status: "ok" })); });
  assert.equal(await clientPush.notifyProject(F.second.id, { title: "Hello" }), 1, "the second event, through the number");
  assert.deepEqual(sent.map((m) => m.to), [token(1)]);
  assert.equal(sent[0].data.eventId, F.second.eventId, "the event rides along for the app to open");
  sent.length = 0;
  await clientPush.notifyPaymentReceived({ entryType: "Spent", projectId: F.first.id, amount: 10 });
  assert.equal(sent.length, 0, "money spent is never sent");
  await clientPush.notifyPaymentReceived({ entryType: "Received", projectId: F.first.id, amount: 6500, category: "Advance", entryId: "X" });
  assert.equal(sent[0].title, "Payment of ₹6,500 received");
});

test("photos sent from a gallery (or its album) reach the booking's client once, not twice in a row", async () => {
  const gallery = await prisma.imageSelectionProject.create({ data: { projectName: tag("gallery"), salesProjectId: F.first.id }, select: { id: true } });
  try {
    const sent = [];
    clientPush.setSender(async (messages) => { sent.push(...messages); return messages.map(() => ({ status: "ok" })); });
    const message = { title: "New photos are ready for you", data: { type: "gallery" } };
    assert.equal(await clientPush.notifyGallery(gallery.id, message), 1, "Send to Client");
    assert.equal(await clientPush.notifyGallery(gallery.id, message), 0, "Send to Group straight after: not a second push");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].data.eventId, F.first.eventId);
    assert.equal(await clientPush.notifyGallery("no-such-gallery", message), 0);
    // Kept for the app's bell - once, like the push - and only for that booking's client.
    const mine = (await answer(getClientNotifications, F.client)).body.data.notifications;
    assert.deepEqual(mine.map((n) => [n.title, n.type, n.eventId]), [["New photos are ready for you", "gallery", F.first.eventId]]);
    assert.equal((await answer(getClientNotifications, F.otherClient)).body.data.notifications.length, 0, "never another client's");
  } finally {
    await prisma.imageSelectionProject.delete({ where: { id: gallery.id } });
  }
});

test("a phone the app is gone from is forgotten; a failing push service never throws", async () => {
  clientPush.setSender(async (messages) => messages.map(() => ({ status: "error", details: { error: "DeviceNotRegistered" } })));
  assert.equal(await clientPush.notifyProject(F.first.id, { title: "Hi" }), 0);
  assert.equal(await prisma.clientPushToken.count({ where: { token: token(1) } }), 0);
  clientPush.setSender(async () => { throw new Error("down"); });
  assert.equal(await clientPush.notifyProject(F.other.id, { title: "Hi" }), 0);
});
