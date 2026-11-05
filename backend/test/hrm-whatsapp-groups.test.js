const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const service = require("../src/modules/hrm/whatsapp-groups/service");

/*
 * Employee WhatsApp groups: the group is typed by name in Settings, and when somebody is added the
 * first linked WhatsApp - the requester's, then anybody's - that is an admin of a group with that name
 * adds them. What each answer becomes on the row, and who
 * may reach the routes.
 */

const GROUP = { jid: "120363000000000001@g.us", subject: "WED Vikram & Harini", isAdmin: true };
const row = (group = {}) => ({
  requestedByUserId: 7,
  group: { name: "WED Vikram & Harini", ...group },
  employee: { id: 3, employeeName: "Priya", contactNumber: "+91 8576827914" },
});
// Two staff logins; `linked` says whose WhatsApp is connected, `groups` what each one administers.
const client = { user: { findMany: async () => [{ id: 7 }, { id: 9 }] } };

function fakeSessions({ linked = [7], groups = { 7: [GROUP] }, answer = { outcome: "ADDED", status: "200" }, inviteFails = false } = {}) {
  const calls = { added: [], sent: [] };
  return {
    calls,
    sessionState: (id) => ({ status: linked.includes(id) ? "connected" : "disconnected" }),
    listAdminGroups: async (id) => groups[id] || [],
    addToGroup: async (args) => { calls.added.push(args); if (answer instanceof Error) throw answer; return answer; },
    sendMessageToPerson: async (message) => { if (inviteFails) throw new Error("no"); calls.sent.push(message); return {}; },
  };
}

test.after(() => service.setSessionsForTest(null));

test("the requester's linked WhatsApp adds them to the group of that name", async () => {
  const fake = fakeSessions();
  service.setSessionsForTest(fake);
  assert.equal((await service.processOne(row(), { client })).status, "ADDED");
  assert.deepEqual(fake.calls.added[0], { userId: 7, groupJid: GROUP.jid, phone: "+91 8576827914" });
});

test("another linked WhatsApp is used when the requester is not an admin of that group", async () => {
  const fake = fakeSessions({ linked: [7, 9], groups: { 7: [], 9: [{ ...GROUP, subject: " wed vikram & harini " }] } });
  service.setSessionsForTest(fake);
  assert.equal((await service.processOne(row(), { client })).status, "ADDED");
  assert.equal(fake.calls.added[0].userId, 9, "matched by name, ignoring case and spaces");
});

test("a WhatsApp that is only a member, not an admin, is not used", async () => {
  service.setSessionsForTest(fakeSessions({ groups: { 7: [{ ...GROUP, isAdmin: false }] } }));
  assert.match((await service.processOne(row(), { client })).detail, /admin of a group with this name/);
});

test("with no WhatsApp linked at all, it says so", async () => {
  service.setSessionsForTest(fakeSessions({ linked: [] }));
  assert.match((await service.processOne(row(), { client })).detail, /No WhatsApp is linked/);
});

test("privacy blocking a direct add sends them the invite link instead", async () => {
  const fake = fakeSessions({ answer: { outcome: "INVITE", status: "403", inviteLink: "https://chat.whatsapp.com/abc" } });
  service.setSessionsForTest(fake);
  assert.equal((await service.processOne(row(), { client })).status, "INVITED");
  assert.match(fake.calls.sent[0].body, /chat\.whatsapp\.com\/abc/);
  service.setSessionsForTest(fakeSessions({ answer: { outcome: "INVITE", status: "403", inviteLink: "x" }, inviteFails: true }));
  assert.equal((await service.processOne(row(), { client })).status, "FAILED");
});

test("already a member is kept as such", async () => {
  service.setSessionsForTest(fakeSessions({ answer: { outcome: "ALREADY", status: "409" } }));
  assert.equal((await service.processOne(row(), { client })).status, "ALREADY");
});

test("every route sits behind protect and HRM / Employee Management", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "whatsapp-groups", "routes.js"), "utf8");
  assert.match(source, /router\.use\(protect\);\s*router\.use\(requireModule\("HRM", "Employee Management"\)\);/);
  assert.ok(source.indexOf("requireModule") < source.indexOf("router.get("), "the guard comes before every route");
});

test("the two refusals are told apart: privacy, and somebody who left the group recently", () => {
  const { outcomeRow, inviteReason } = require("../src/modules/hrm/whatsapp-groups/service");
  assert.match(inviteReason(403), /privacy/);
  assert.match(inviteReason(408), /left this group recently/);
  assert.match(inviteReason("408"), /left this group recently/, "the code arrives as a string");
  assert.match(inviteReason(500), /code 500/, "anything else says what WhatsApp answered");

  const left = outcomeRow({ outcome: "INVITE", status: "408" }, true);
  assert.equal(left.status, "INVITED");
  assert.match(left.detail, /left this group recently, so the group's invite link was sent/);
  assert.doesNotMatch(left.detail, /privacy/, "somebody with 'anyone can add me' is not told their privacy is wrong");
  assert.match(outcomeRow({ outcome: "INVITE", status: "403" }, true).detail, /privacy/);
  assert.match(outcomeRow({ outcome: "INVITE", status: "408" }, false).detail, /invite link could not be sent/);
});
