const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/db");
const clientPush = require("../src/services/clientPush");
const userRouter = require("../src/modules/user/routes");
const { existingClientLoginFor } = require("../src/modules/sales/projects/controller");

/*
 * A client sets their own password in the Beam Craft app, in place of the one the studio sent: the
 * route every login uses (`POST /api/user/change-password`), which knows the current password,
 * keeps the studio's password rules, clears `mustChangePassword` - which Client Credentials then
 * shows as "Set by the client" - and tells the client's phones. Real rows, removed at the end;
 * nothing reaches Expo, the sender is replaced.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCPW-${STAMP}-${name}`;
const NUMBER = `90001${STAMP.slice(-5)}`;
const STUDIO_PASSWORD = "abcd-efgh-jkmn";
const F = {};
const sent = [];

const changePassword = userRouter.stack.find((layer) => layer.route?.path === "/change-password" && layer.route.methods.post).route.stack[0].handle;
const answer = async (body) => {
  const out = { code: 200 };
  const res = { status: (c) => { out.code = c; return res; }, json: (b) => { out.body = b; return res; } };
  await changePassword({ user: { id: F.client.id, role: "CLIENT" }, body }, res);
  return out;
};

before(async () => {
  clientPush.setSender(async (messages) => { sent.push(...messages); return messages.map(() => ({ status: "ok" })); });
  await prisma.salesCrmLead.upsert({ where: { enquiryId: tag("enq") }, create: { enquiryId: tag("enq"), name: tag("enq") }, update: {} });
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq"), eventId: tag("ev"), whatsappGroupName: `WED ${STAMP}`, clientMainNumber: `+91 ${NUMBER}`,
    sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Yet to Start",
  } });
  F.client = await prisma.user.create({ data: {
    name: "C", email: null, username: NUMBER, password: await bcrypt.hash(STUDIO_PASSWORD, 4), role: "CLIENT", status: "ACTIVE",
    clientProjectId: F.project.id, mustChangePassword: true,
  } });
  await prisma.clientPushToken.create({ data: { userId: F.client.id, token: `ExponentPushToken[${STAMP}-pw]`, platform: "android" } });
});

after(async () => {
  clientPush.setSender(null);
  await prisma.user.deleteMany({ where: { id: { in: [F.client?.id].filter(Boolean) } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCPW-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCPW-${STAMP}` } } });
  await prisma.$disconnect();
});

test("a client replaces the studio's password with their own, and Client Credentials says so", async () => {
  assert.equal((await existingClientLoginFor(`+91 ${NUMBER}`)).passwordChanged, false, "the studio's password until then");

  assert.equal((await answer({ currentPassword: "wrong-one", newPassword: "Nandhini@2026" })).code, 400, "the current password is asked");
  assert.match((await answer({ currentPassword: STUDIO_PASSWORD, newPassword: "short" })).body.message, /^Password needs /, "the studio's rules hold");
  assert.equal(sent.length, 0, "nothing is said of a change that did not happen");

  const done = await answer({ currentPassword: STUDIO_PASSWORD, newPassword: "Nandhini@2026" });
  assert.equal(done.code, 200);
  const account = await prisma.user.findUnique({ where: { id: F.client.id }, select: { password: true, mustChangePassword: true } });
  assert.equal(account.mustChangePassword, false);
  assert.ok(await bcrypt.compare("Nandhini@2026", account.password), "the next sign-in uses the new one");
  assert.equal((await existingClientLoginFor(`+91 ${NUMBER}`)).passwordChanged, true);

  // The push goes after the answer; give it its moment.
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(sent.map((m) => [m.to, m.title, m.data.type]), [[`ExponentPushToken[${STAMP}-pw]`, "Your password was changed", "password"]]);

  assert.equal((await answer({ currentPassword: "Nandhini@2026", newPassword: "Deepa#2027x" })).code, 200, "and can change it again");
});
