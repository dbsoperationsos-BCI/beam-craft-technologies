const test = require("node:test"); const assert = require("node:assert/strict");
const { createGroupLinkService, nameKey, GROUP_TEMPLATE } = require("../src/modules/image-selection/whatsapp/group.service");
const { keyFor } = require("../src/modules/image-selection/whatsapp/service");

/*
 * The project's WhatsApp group and the invite sent into it, held against a stand-in repository
 * and a stand-in session manager: no database, no socket. What these pin is the shape of the
 * feature - a jid from the browser is linked only when the caller's WhatsApp is in that group,
 * one live project per group, and one message per gallery version however many people press Send.
 */

const GROUP_A = { jid: "120363000000000001@g.us", subject: "Arun & Priya Wedding", participantCount: 6 };
const GROUP_B = { jid: "120363000000000002@g.us", subject: "Studio Walk-in", participantCount: 3 };
const GROUP_C = { jid: "919876543210-1612345678@g.us", subject: "Corporate Shoot", participantCount: 9 };

function project(overrides = {}) {
  return { id: "p1", projectName: "Arun & Priya Wedding", salesProjectId: "s1", publishVersion: 1, archivedAt: null, totalPhotoSize: 0n, whatsappGroupJid: null, whatsappGroupSubject: null, whatsappGroupLinkedAt: null, ...overrides };
}

function setup({ projects = [project()], groups = [GROUP_A, GROUP_B, GROUP_C], notifications = [], prepared = null, sendError = null } = {}) {
  const state = { projects, notifications: [...notifications], sent: [], hideKeyOnce: false };
  const find = (id) => state.projects.find((item) => item.id === id) || null;
  const repo = {
    findProject: async (id) => find(id),
    findLiveProjectByGroupJid: async (jid, excludeId) => { const holder = state.projects.find((item) => item.whatsappGroupJid === jid && !item.archivedAt && item.id !== excludeId); return holder ? { id: holder.id, projectName: holder.projectName } : null; },
    listLiveProjectLinks: async () => state.projects.filter((item) => !item.archivedAt).map(({ id, projectName, whatsappGroupJid }) => ({ id, projectName, whatsappGroupJid })),
    linkGroup: async (id, { jid, subject }) => Object.assign(find(id), { whatsappGroupJid: jid, whatsappGroupSubject: subject, whatsappGroupLinkedAt: new Date("2026-09-19T10:00:00Z") }),
    unlinkGroup: async (id) => Object.assign(find(id), { whatsappGroupJid: null, whatsappGroupSubject: null, whatsappGroupLinkedAt: null }),
    findByKey: async (key) => { if (state.hideKeyOnce) { state.hideKeyOnce = false; return null; } return state.notifications.find((item) => item.idempotencyKey === key) || null; },
    create: async (data) => { if (state.notifications.some((item) => item.idempotencyKey === data.idempotencyKey)) { const error = new Error("Unique constraint failed"); error.code = "P2002"; throw error; } const item = { id: `n${state.notifications.length + 1}`, ...data }; state.notifications.push(item); return item; },
    update: async (id, data) => Object.assign(state.notifications.find((item) => item.id === id), data),
  };
  const sessions = {
    listGroups: async () => groups,
    sendMessageToGroup: async (input) => { if (sendError) throw sendError; state.sent.push(input); return { waMessageId: `wa-${state.sent.length}`, chatJid: input.jid }; },
  };
  const publishShare = { prepareForNotification: async () => prepared || { gallery: { publishVersion: 2, pin: "1234", clientUrl: "https://gallery.example/ABC" }, client: { clientName: "Arun", whatsappRecipientMasked: "+919•••••3210" }, deliverables: [], whatsappPreview: { message: "Client Name : Arun\nLink : https://gallery.example/ABC\nPIN : 1234" }, _recipient: "+919876543210" } };
  return { state, service: createGroupLinkService(repo, { sessions, publishShare, now: () => new Date("2026-09-19T10:05:00Z") }) };
}

test("two names are the same name whatever the case and spacing", () => {
  assert.equal(nameKey("  Arun &  Priya   Wedding "), nameKey("arun & priya wedding"));
  assert.notEqual(nameKey("Arun & Priya Wedding"), nameKey("Arun & Priya Wedding 2"));
});

test("the picker suggests the group named like the project and says which groups are already some other project's", async () => {
  const other = project({ id: "p2", projectName: "Corporate Shoot", whatsappGroupJid: GROUP_C.jid, whatsappGroupSubject: GROUP_C.subject });
  const { service } = setup({ projects: [project({ projectName: "arun & priya wedding" }), other] });
  const result = await service.listGroups("p1", 7);
  assert.equal(result.suggestedJid, GROUP_A.jid);
  assert.equal(result.groups.find((group) => group.jid === GROUP_A.jid).matchesProject, true);
  const taken = result.groups.find((group) => group.jid === GROUP_C.jid);
  assert.equal(taken.linkedProjectId, "p2");
  assert.equal(taken.linkedProjectName, "Corporate Shoot");
  // The full project row comes back beside the list, serialized the way the sidebar holds it.
  assert.equal(result.project.totalPhotoSize, "0");
});

test("a group another live project holds is never suggested, even when its name matches", async () => {
  const other = project({ id: "p2", projectName: "Something else", whatsappGroupJid: GROUP_A.jid, whatsappGroupSubject: GROUP_A.subject });
  const { service } = setup({ projects: [project(), other] });
  assert.equal((await service.listGroups("p1", 7)).suggestedJid, null);
});

test("linking refuses a group the caller's WhatsApp is not in", async () => {
  const { service } = setup();
  await assert.rejects(() => service.link("p1", 7, "120363999999999999@g.us"), (error) => error.status === 400 && error.code === "NOT_IN_GROUP");
});

test("linking refuses a group another live project holds, and allows it once that project is archived", async () => {
  const other = project({ id: "p2", projectName: "Corporate Shoot", whatsappGroupJid: GROUP_A.jid, whatsappGroupSubject: GROUP_A.subject });
  const { service, state } = setup({ projects: [project(), other] });
  await assert.rejects(() => service.link("p1", 7, GROUP_A.jid), (error) => error.status === 409 && error.code === "GROUP_TAKEN" && error.details.linkedProjectName === "Corporate Shoot");
  state.projects[1].archivedAt = new Date();
  const linked = await service.link("p1", 7, GROUP_A.jid);
  assert.equal(linked.whatsappGroupJid, GROUP_A.jid);
  assert.equal(linked.whatsappGroupSubject, "Arun & Priya Wedding");
  assert.ok(linked.whatsappGroupLinkedAt);
});

test("an archived project cannot be linked, and unlinking clears every field", async () => {
  const { service } = setup({ projects: [project({ archivedAt: new Date(), whatsappGroupJid: GROUP_A.jid, whatsappGroupSubject: GROUP_A.subject, whatsappGroupLinkedAt: new Date() })] });
  await assert.rejects(() => service.link("p1", 7, GROUP_B.jid), { status: 409 });
  const cleared = await service.unlink("p1");
  assert.equal(cleared.whatsappGroupJid, null);
  assert.equal(cleared.whatsappGroupSubject, null);
  assert.equal(cleared.whatsappGroupLinkedAt, null);
});

test("matching every project links exact names only, skips taken groups, and names what it could not match", async () => {
  const projects = [
    project({ id: "p1", projectName: "Arun & Priya Wedding" }),
    project({ id: "p2", projectName: "Studio Walk-in" }),
    project({ id: "p3", projectName: "Corporate Shoot", whatsappGroupJid: GROUP_C.jid, whatsappGroupSubject: GROUP_C.subject }),
    project({ id: "p4", projectName: "No Such Group" }),
    project({ id: "p5", projectName: "Twice Named" }),
    project({ id: "p6", projectName: "Archived Match", archivedAt: new Date() }),
  ];
  const groups = [GROUP_A, GROUP_B, GROUP_C, { jid: "120363000000000010@g.us", subject: "Twice Named" }, { jid: "120363000000000011@g.us", subject: "twice named" }, { jid: "120363000000000012@g.us", subject: "Archived Match" }];
  const { service, state } = setup({ projects, groups });
  const result = await service.linkAll(7);
  assert.deepEqual(result.linked, ["Arun & Priya Wedding", "Studio Walk-in"]);
  assert.equal(result.alreadyLinked, 1);
  assert.deepEqual(result.unmatched, ["No Such Group"]);
  assert.deepEqual(result.ambiguous, ["Twice Named"]);
  assert.equal(state.projects[0].whatsappGroupJid, GROUP_A.jid);
  assert.equal(state.projects[1].whatsappGroupJid, GROUP_B.jid);
  // An archived project is not in the pass at all.
  assert.equal(state.projects[5].whatsappGroupJid, null);
});

test("matching every project does not hand one group to two projects", async () => {
  const projects = [project({ id: "p1", projectName: "Arun & Priya Wedding" }), project({ id: "p2", projectName: "arun & priya wedding" })];
  const { service, state } = setup({ projects, groups: [GROUP_A] });
  const result = await service.linkAll(7);
  assert.deepEqual(result.linked, ["Arun & Priya Wedding"]);
  assert.deepEqual(result.unmatched, ["arun & priya wedding"]);
  assert.equal(state.projects[1].whatsappGroupJid, null);
});

test("sending asks for a group first", async () => {
  const { service, state } = setup();
  await assert.rejects(() => service.sendInvite("p1", 7), (error) => error.status === 422 && error.details.action === "link_whatsapp_group");
  assert.equal(state.sent.length, 0);
});

test("sending goes into the linked group from the person who pressed Send, once per gallery version", async () => {
  const linked = project({ whatsappGroupJid: GROUP_A.jid, whatsappGroupSubject: GROUP_A.subject });
  const { service, state } = setup({ projects: [linked] });
  const first = await service.sendInvite("p1", 7);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].userId, 7);
  assert.equal(state.sent[0].jid, GROUP_A.jid);
  assert.equal(state.sent[0].body, "Client Name : Arun\nLink : https://gallery.example/ABC\nPIN : 1234");
  assert.equal(first.notification.status, "SENT");
  assert.equal(first.notification.providerMessageId, "wa-1");
  assert.equal(first.notification.provider, "baileys-group");
  assert.equal(first.notification.recipientMasked, "Arun & Priya Wedding");
  assert.equal(first.notification.idempotencyKey, keyFor({ imageSelectionProjectId: "p1", recipient: GROUP_A.jid, publishVersion: 2, templateName: GROUP_TEMPLATE }));
  // The client's own number never leaves the server on this path.
  assert.equal(first.preview._recipient, undefined);
  // The post-production coordinator pressing Send on the same gallery sends nothing more.
  const second = await service.sendInvite("p1", 9);
  assert.equal(second.notification.status, "ALREADY_SENT");
  assert.equal(state.sent.length, 1);
  assert.equal(JSON.parse(state.notifications[0].messageSnapshot).userId, 7);
});

test("a send that fails is recorded as failed, and the retry reuses the row", async () => {
  const linked = project({ whatsappGroupJid: GROUP_A.jid, whatsappGroupSubject: GROUP_A.subject });
  const notConnected = Object.assign(new Error("WhatsApp is not connected."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" });
  const failing = setup({ projects: [linked], sendError: notConnected });
  await assert.rejects(() => failing.service.sendInvite("p1", 7), { code: "WHATSAPP_NOT_CONNECTED" });
  assert.equal(failing.state.notifications[0].status, "FAILED");
  assert.equal(failing.state.notifications[0].errorCode, "WHATSAPP_NOT_CONNECTED");
  const retry = setup({ projects: [linked], notifications: failing.state.notifications });
  const result = await retry.service.sendInvite("p1", 7);
  assert.equal(result.notification.status, "SENT");
  assert.equal(retry.state.notifications.length, 1);
  assert.equal(retry.state.sent.length, 1);
});

test("two people pressing Send in the same second produce one message", async () => {
  const linked = project({ whatsappGroupJid: GROUP_A.jid, whatsappGroupSubject: GROUP_A.subject });
  const { service, state } = setup({ projects: [linked] });
  await service.sendInvite("p1", 7);
  // The second press read no row (it had not been committed yet) and then lost the create.
  state.hideKeyOnce = true;
  const second = await service.sendInvite("p1", 9);
  assert.equal(second.notification.status, "ALREADY_SENT");
  assert.equal(state.sent.length, 1);
});
