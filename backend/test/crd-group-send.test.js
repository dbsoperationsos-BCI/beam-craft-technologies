const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveProjectGroup, sendToProjectGroup } = require("../src/modules/sales/crd-documents/groupSend");
const { sendLinkToGroup, linkGroup } = require("../src/modules/sales/crd-documents/controller");

/*
 * CRD Link Ready → Send WhatsApp: into the project's own WhatsApp group, from the sender's WhatsApp -
 * the group Image Selection keeps, or the one group named like the project. Every collaborator is a
 * stand-in: nothing reaches WhatsApp, and the group lookups never reach the database.
 */

after(async () => { await require("../src/config/db").$disconnect(); });

const project = { id: "sale-1", whatsappGroupName: "WED Priya & Arjun" };
const ON = { isChatEnabled: async () => true, isChatEnabledForUser: async () => true };

function harness({ groups = [], selection = null, held = [], switches = ON } = {}) {
  const sent = [];
  const dependencies = {
    // The activity log is its own test; here the send is all that matters.
    activity: { track: (_context, send) => send() },
    chatSwitches: switches,
    findLinked: async () => (selection?.whatsappGroupJid ? { jid: selection.whatsappGroupJid, subject: selection.whatsappGroupSubject } : null),
    heldElsewhere: async (jid) => held.includes(jid),
    sessions: {
      listGroups: async () => groups,
      sendMessageToGroup: async (message) => { sent.push(message); return { waMessageId: "wa-1" }; },
    },
  };
  return { dependencies, sent };
}

const status = (promise) => promise.then(() => "ok", (error) => error.status);

test("a group Image Selection already linked is where the message goes, and the dialog is told its name first", async () => {
  const h = harness({ selection: { id: "is-1", whatsappGroupJid: "111@g.us", whatsappGroupSubject: "WED Priya & Arjun" }, groups: [{ jid: "111@g.us", subject: "WED Priya & Arjun" }] });
  assert.deepEqual(await resolveProjectGroup(project, 7, h.dependencies), { groupSubject: "WED Priya & Arjun", linked: true });
  assert.equal(h.sent.length, 0, "naming the group sends nothing");
  const result = await sendToProjectGroup(project, 7, "Hi - your CRD form", h.dependencies);
  assert.deepEqual(h.sent, [{ userId: 7, jid: "111@g.us", body: "Hi - your CRD form" }]);
  assert.equal(result.groupSubject, "WED Priya & Arjun");
});

test("a linked group the sender is not in is refused, never sent to", async () => {
  const h = harness({ selection: { id: "is-1", whatsappGroupJid: "111@g.us" }, groups: [] });
  assert.equal(await status(sendToProjectGroup(project, 7, "Hi", h.dependencies)), 409);
  assert.equal(h.sent.length, 0);
});

test("unlinked: the one group named like the project is used - and nothing is written to Image Selection", async () => {
  const h = harness({ selection: { id: "is-1", whatsappGroupJid: null }, groups: [{ jid: "222@g.us", subject: "  wed priya &  arjun " }, { jid: "333@g.us", subject: "Another couple" }] });
  assert.deepEqual(await resolveProjectGroup(project, 7, h.dependencies), { groupSubject: "  wed priya &  arjun ", linked: false });
  await sendToProjectGroup(project, 7, "Hi", h.dependencies);
  assert.equal(h.sent[0].jid, "222@g.us", "the name matches however it is spaced or cased");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crd-documents", "groupSend.js"), "utf8");
  assert.doesNotMatch(source, /linkGroup|updateProject|\.update\(/, "linking is Image Selection's, under its own permission");
});

test("no group by that name, two of them, or one another project holds (archived ones too): nothing is sent", async () => {
  assert.equal(await status(sendToProjectGroup(project, 7, "Hi", harness({ groups: [{ jid: "333@g.us", subject: "Another couple" }] }).dependencies)), 422);
  const twin = [{ jid: "222@g.us", subject: "WED Priya & Arjun" }, { jid: "444@g.us", subject: "WED Priya & Arjun" }];
  assert.equal(await status(sendToProjectGroup(project, 7, "Hi", harness({ groups: twin }).dependencies)), 409);
  const held = harness({ groups: [{ jid: "222@g.us", subject: "WED Priya & Arjun" }], held: ["222@g.us"] });
  assert.equal(await status(sendToProjectGroup(project, 7, "Hi", held.dependencies)), 422, "another client's chat is never this project's group");
  assert.equal(held.sent.length, 0);
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crd-documents", "groupSend.js"), "utf8");
  assert.match(source, /where: \{ whatsappGroupJid: jid, deletedAt: null, NOT: \{ salesProjectId \} \}/, "no archivedAt filter: a past client's group is still held");
});

test("the studio's and the sender's WhatsApp switches are honoured before anything else", async () => {
  const groups = [{ jid: "222@g.us", subject: "WED Priya & Arjun" }];
  const off = harness({ groups, switches: { isChatEnabled: async () => false, isChatEnabledForUser: async () => true } });
  assert.equal(await status(sendToProjectGroup(project, 7, "Hi", off.dependencies)), 403);
  assert.equal(await status(resolveProjectGroup(project, 7, off.dependencies)), 403);
  const userOff = harness({ groups, switches: { isChatEnabled: async () => true, isChatEnabledForUser: async () => false } });
  assert.equal(await status(sendToProjectGroup(project, 7, "Hi", userOff.dependencies)), 403);
  assert.equal(off.sent.length + userOff.sent.length, 0);
});

/** Calls a handler and says what it answered: `{ code, body }`. */
async function answer(handler, req) {
  const out = { code: 200, body: null };
  const res = { status: (code) => { out.code = code; return res; }, json: (body) => { out.body = body; return res; } };
  await handler(req, res);
  return out;
}

test("the routes refuse an empty or oversized message, and a project the caller cannot reach", async () => {
  // A real account, so the 404 is the project's - not an unknown caller's refusal.
  const admin = await require("../src/config/db").user.findFirst({ where: { role: "SUPER_ADMIN", status: "ACTIVE" }, select: { id: true } });
  assert.ok(admin, "the test database has no Super Admin to read projects as");
  const user = { id: admin.id, role: "SUPER_ADMIN" };
  assert.equal((await answer(sendLinkToGroup, { user, params: { projectId: "x" }, body: { message: "   " } })).code, 400);
  assert.equal((await answer(sendLinkToGroup, { user, params: { projectId: "x" }, body: { message: "a".repeat(5000) } })).code, 400);
  assert.equal((await answer(sendLinkToGroup, { user, params: { projectId: "no-such-project" }, body: { message: "Hi" } })).code, 404);
  assert.equal((await answer(linkGroup, { user, params: { projectId: "no-such-project" } })).code, 404);
});

test("the routes sit behind the CRD Documents guard and the WhatsApp limits; CRD users can read their template", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crd-documents", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(requireModule\("PROJECT", "CRD Documents"\)\);/);
  assert.match(routes, /router\.get\("\/:projectId\/whatsapp-group", whatsappLimits\.read, linkGroup\);/);
  assert.match(routes, /router\.post\("\/:projectId\/whatsapp-group", requireTemplateOn\("CRD_DOCUMENT_LINK"\), whatsappLimits\.send, sendLinkToGroup\);/);
  const templates = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "message-templates", "routes.js"), "utf8");
  assert.match(templates, /\{ module: "PROJECT", feature: "CRD Documents", level: "READ" \}/);
  assert.equal(require("../src/services/messageTemplate").TEMPLATE_KEYS.CRD_DOCUMENT_LINK, "CRD_DOCUMENT_LINK");
});
