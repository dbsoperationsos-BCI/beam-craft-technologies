const test = require("node:test");
const assert = require("node:assert/strict");
const { projectGroupChoices, linkProjectGroup, autoLinkProjectGroup } = require("../src/modules/project-management/pre-production/whatsappGroup");
const { createProductionFake } = require("./production-fake-client");

const groups = [
  { jid: "111111111111111111@g.us", subject: "Asha Weds  Arun", participantCount: 12 },
  { jid: "222222222222222222@g.us", subject: "Studio crew", participantCount: 8 },
];
const sessions = () => ({ resumeSession: async () => ({ status: "connected" }), listGroups: async () => groups });

test("the caller's groups are listed, with the one named like the project chosen by default", async () => {
  const client = createProductionFake({ projects: [{ id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "asha weds arun", whatsappGroupJid: null }] });
  const result = await projectGroupChoices("p-1", 21, { client, sessions });
  assert.equal(result.suggestedJid, "111111111111111111@g.us");
  assert.equal(result.groups[0].matchesProject, true);
});

test("a group jid not in the caller's own groups is rejected", async () => {
  const client = createProductionFake({ projects: [{ id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha" }] });
  await assert.rejects(linkProjectGroup("p-1", 21, "999999999999999999@g.us", { client, sessions }), (error) => error.status === 400 && error.code === "NOT_IN_GROUP");
});

test("linking stores the jid, the subject, who linked it and when", async () => {
  const project = { id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha" };
  const client = createProductionFake({ projects: [project] });
  await linkProjectGroup("p-1", 21, "111111111111111111@g.us", { client, sessions, now: () => new Date("2026-09-30T06:00:00Z") });
  assert.equal(project.whatsappGroupJid, "111111111111111111@g.us");
  assert.equal(project.whatsappGroupSubject, "Asha Weds  Arun");
  assert.equal(project.whatsappGroupLinkedByUserId, 21);
  assert.deepEqual(project.whatsappGroupLinkedAt, new Date("2026-09-30T06:00:00Z"));
});

test("a group already linked to another live project is refused", async () => {
  const client = createProductionFake({ projects: [
    { id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha" },
    { id: "p-2", eventId: "DBS-EV-2", whatsappGroupName: "Other", whatsappGroupJid: "111111111111111111@g.us" },
  ] });
  await assert.rejects(linkProjectGroup("p-1", 21, "111111111111111111@g.us", { client, sessions }), (error) => error.status === 409 && error.code === "GROUP_TAKEN");
});

test("a disconnected WhatsApp says so rather than listing nothing", async () => {
  const client = createProductionFake({ projects: [{ id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha" }] });
  const offline = () => ({ listGroups: async () => { throw Object.assign(new Error("WhatsApp is not connected."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" }); } });
  await assert.rejects(projectGroupChoices("p-1", 21, { client, sessions: offline }), (error) => error.status === 409);
});

test("a project that does not exist is not found", async () => {
  await assert.rejects(projectGroupChoices("nope", 21, { client: createProductionFake(), sessions }), (error) => error.status === 404);
});

test("auto-link: the one group named like the project is linked from the caller's WhatsApp", async () => {
  const project = { id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "asha weds arun", whatsappGroupJid: null };
  const client = createProductionFake({ projects: [project] });
  const result = await autoLinkProjectGroup("p-1", 21, { client, sessions });
  assert.equal(result.linked, true);
  assert.equal(project.whatsappGroupJid, "111111111111111111@g.us");
  assert.equal(project.whatsappGroupLinkedByUserId, 21);
});

test("auto-link links nothing when it would be a guess, and says why", async () => {
  const fresh = (name) => createProductionFake({ projects: [{ id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: name, whatsappGroupJid: null }] });
  const none = await autoLinkProjectGroup("p-1", 21, { client: fresh("Someone else"), sessions });
  assert.equal(none.linked, false);
  assert.match(none.reason, /None of your WhatsApp groups/);
  const twice = () => ({ resumeSession: async () => ({ status: "connected" }), listGroups: async () => [...groups, { jid: "333333333333333333@g.us", subject: "Asha weds Arun" }] });
  const two = await autoLinkProjectGroup("p-1", 21, { client: fresh("Asha Weds Arun"), sessions: twice });
  assert.match(two.reason, /More than one/);
  const offline = () => ({ resumeSession: async () => ({ status: "connecting" }), listGroups: async () => { throw new Error("WhatsApp is not connected."); } });
  const down = await autoLinkProjectGroup("p-1", 21, { client: fresh("Asha Weds Arun"), sessions: offline });
  assert.match(down.reason, /Connect your WhatsApp/);
});

test("auto-link leaves an already linked project alone", async () => {
  const project = { id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha Weds Arun", whatsappGroupJid: "222222222222222222@g.us" };
  const result = await autoLinkProjectGroup("p-1", 21, { client: createProductionFake({ projects: [project] }), sessions });
  assert.deepEqual(result, { linked: true, alreadyLinked: true });
  assert.equal(project.whatsappGroupJid, "222222222222222222@g.us");
});

test("auto-link checks the connection first: an unpaired WhatsApp is never paired here, only told to link", async () => {
  let listed = false;
  const unpaired = () => ({ resumeSession: async () => ({ status: "disconnected", paired: false }), listGroups: async () => { listed = true; return groups; } });
  const client = createProductionFake({ projects: [{ id: "p-1", eventId: "DBS-EV-1", whatsappGroupName: "Asha Weds Arun", whatsappGroupJid: null }] });
  const result = await autoLinkProjectGroup("p-1", 21, { client, sessions: unpaired });
  assert.equal(result.linked, false);
  assert.match(result.reason, /Link your WhatsApp first/);
  assert.equal(listed, false);
});
