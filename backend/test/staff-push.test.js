const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const clientPush = require("../src/services/clientPush");
const notifications = require("../src/services/notifications");

/*
 * A team member's bell, pushed to their phone: whatever DBS writes to a staff login's bell goes to
 * the phones that login registered in the app - never to a client's, and never to another login's.
 * Nothing reaches Expo (the sender is replaced). Real rows, removed at the end.
 */
const STAMP = String(Date.now()).slice(-6);
const F = {};
const sent = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

before(async () => {
  clientPush.setSender(async (messages) => { sent.push(...messages); return messages.map(() => ({ status: "ok" })); });
  F.staff = await prisma.user.create({ data: { name: "Staff", email: `tsp-${STAMP}@test.local`, username: `tsp-${STAMP}`, password: "x", role: "EMPLOYEE", status: "ACTIVE" } });
  F.other = await prisma.user.create({ data: { name: "Other", email: `tso-${STAMP}@test.local`, username: `tso-${STAMP}`, password: "x", role: "EMPLOYEE", status: "ACTIVE" } });
  await prisma.clientPushToken.create({ data: { token: `ExponentPushToken[staff-${STAMP}]`, platform: "android", userId: F.staff.id } });
});

after(async () => {
  clientPush.setSender(null);
  await prisma.notification.deleteMany({ where: { userId: { in: [F.staff?.id, F.other?.id].filter(Boolean) } } });
  await prisma.clientPushToken.deleteMany({ where: { userId: { in: [F.staff?.id, F.other?.id].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.staff?.id, F.other?.id].filter(Boolean) } } });
  await prisma.$disconnect();
});

test("a notice on a team member's bell is pushed to their phone, with its link", async () => {
  await notifications.notify(null, { userId: F.staff.id, type: notifications.TYPES.TASK_ASSIGNED, title: "New task: Edit the Haldi album", body: "Due Friday", link: "/hrm/tasks" });
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, `ExponentPushToken[staff-${STAMP}]`);
  assert.equal(sent[0].title, "New task: Edit the Haldi album");
  assert.deepEqual(sent[0].data, { type: "staff", link: "/hrm/tasks" });
});

test("only that login's phones: another team member's notice does not reach them", async () => {
  sent.length = 0;
  await notifications.notify(null, { userId: F.other.id, type: notifications.TYPES.TASK_ASSIGNED, title: "Not yours" });
  await settle();
  assert.equal(sent.length, 0);
});
