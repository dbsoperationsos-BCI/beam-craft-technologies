const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { requireClient, getClientProject } = require("../src/modules/client/portal/controller");

/*
 * The client portal's project: a client reads its own project - found through its account, never
 * an id it sends - and only the fields meant for it. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCP-${STAMP}-${name}`;
const F = {};

const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });
const projectData = (name) => ({
  enquiryId: tag(`enq-${name}`), eventId: tag(`ev-${name}`), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: "+919876543210",
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 125000, crmName: "Test",
  salesPreProductionRemarks: "internal note", projectStatus: "Work in Progress - Pre & Production",
  preProductionCoordinator: "Sneha Iyer", mainEventDateKnown: true, mainEventDate: new Date("2026-11-20T00:00:00.000Z"),
  welcomeGift: "Applicable", welcomeGiftStatus: "Sent", welcomeGiftSentAt: new Date("2026-10-02T06:30:00.000Z"), welcomeGiftAssignee: "Gift Handler",
  shootCompletedGift: "Applicable", shootCompletedGiftStatus: "Received by Client", shootCompletedGiftSentAt: new Date("2026-12-01T06:30:00.000Z"),
  shootCompletedGiftReceivedAt: new Date("2026-12-03T06:30:00.000Z"), shootCompletedGiftAssignee: "Other Handler",
});

before(async () => {
  await leadFor(tag("enq-mine"));
  await leadFor(tag("enq-theirs"));
  F.mine = await prisma.salesProject.create({ data: projectData("mine") });
  F.theirs = await prisma.salesProject.create({ data: projectData("theirs") });
  F.shoot = await prisma.projectShoot.create({ data: { projectId: F.mine.id, shootId: tag("sh-1"), shoot: "Reception", shootPlace: "Studio", district: "Erode", state: "Tamil Nadu", isMainEvent: true } });
  // The shoot's production plan, submitted - which is what moves Pre Production on.
  await prisma.projectProduction.create({ data: { shootId: F.shoot.id, salesProjectId: F.mine.id, planSubmittedAt: new Date("2026-10-01T06:30:00.000Z") } });
  await prisma.projectShoot.create({ data: { projectId: F.mine.id, shootId: tag("sh-2"), shoot: "Removed", shootPlace: "Studio", district: "Erode", state: "Tamil Nadu", deletedAt: new Date() } });
  F.admin = await prisma.user.create({ data: { name: "Admin", email: `${tag("admin")}@test.local`.toLowerCase(), username: tag("admin").toLowerCase(), password: "x", role: "SUPER_ADMIN" } });
  F.nobody = await prisma.user.create({ data: { name: "Nobody", email: `${tag("nobody")}@test.local`.toLowerCase(), username: tag("nobody").toLowerCase(), password: "x", role: "EMPLOYEE" } });
  F.client = await prisma.user.create({ data: { name: "Client", email: null, username: tag("client").toLowerCase(), password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.mine.id } });
});

after(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: `tcp-${STAMP}` } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCP-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCP-${STAMP}` } } });
  await prisma.$disconnect();
});

/** Calls a handler and says what it answered: `{ code, body, headers }`. */
async function answer(req, handler = getClientProject) {
  const out = { code: 200, body: null, headers: {} };
  const res = {
    set: (name, value) => { out.headers[name] = value; return res; },
    status: (code) => { out.code = code; return res; },
    json: (body) => { out.body = body; return res; },
  };
  await handler(req, res);
  return out;
}

test("only a client account passes the portal's guard", () => {
  const outcome = (user) => {
    let result = null;
    requireClient({ user }, { status: (code) => ({ json: () => { result = code; } }) }, () => { result = "next"; });
    return result;
  };
  assert.equal(outcome({ id: 1, role: "CLIENT" }), "next");
  assert.equal(outcome({ id: 1, role: "SUPER_ADMIN" }), 403, "staff read projects through the studio's screens");
  assert.equal(outcome({ id: 1, role: "EMPLOYEE" }), 403);
  assert.equal(outcome({ id: 1 }), 403, "no role is no client");
  assert.equal(outcome(undefined), 403);
});

test("a client reads its own project, and only the fields meant for it", async () => {
  // An id in the request is never what is read: the account decides.
  const { code, body, headers } = await answer({ user: { id: F.client.id, role: "CLIENT" }, params: { id: F.theirs.id }, query: { id: F.theirs.id } });
  assert.equal(code, 200);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.deepEqual(Object.keys(body.data).sort(), ["clientName", "crdDocument", "eventId", "flag", "projectStatus", "shootCompletedGift", "stages", "team", "welcomeGift", "whatsappGroupLink"]);
  // The welcome gift as Client Gifts tracks it - where it is and when it went, not who sends it.
  assert.deepEqual(body.data.welcomeGift, { status: "Sent", sentOn: "2026-10-02", receivedOn: null });
  assert.deepEqual(body.data.shootCompletedGift, { status: "Received by Client", sentOn: "2026-12-01", receivedOn: "2026-12-03" });
  assert.doesNotMatch(JSON.stringify(body), /Gift Handler|Other Handler/);
  assert.equal(body.data.eventId, F.mine.eventId);
  assert.equal(body.data.projectStatus, "Work in Progress - Pre & Production");
  // The stages as the studio's Status tab works them out: started, so Pre Production is current,
  // and its one shoot's plan is in.
  const stages = Object.fromEntries(body.data.stages.map((stage) => [stage.id, stage]));
  assert.deepEqual(body.data.stages.map((stage) => stage.state), ["done", "done", "current", "upcoming", "upcoming"], "every shoot planned: Pre Production is done");
  assert.deepEqual([stages.PRE_PRODUCTION.done, stages.PRE_PRODUCTION.total], [1, 1]);
  assert.deepEqual(stages.PRE_PRODUCTION.shoots, [{ id: F.shoot.id, name: "Reception", date: stages.PRE_PRODUCTION.shoots[0].date, planned: true, plannedOn: "2026-10-01", finished: false, progress: stages.PRE_PRODUCTION.shoots[0].progress,
    code: F.shoot.shootId, place: "Studio", session: null, duration: null, crewCount: null, coverUrl: stages.PRE_PRODUCTION.shoots[0].coverUrl }], "a removed shoot is not listed");
  assert.deepEqual(stages.STARTED.facts.find((fact) => fact.label === "Main event date"), { label: "Main event date", value: "2026-11-20" });
  assert.deepEqual(stages.PRE_PRODUCTION.facts.find((fact) => fact.label === "Pre-production coordinator"), { label: "Pre-production coordinator", value: "Sneha Iyer" });
  // Only the facts a client is told: not the converted value, who converted or recorded the sale.
  assert.deepEqual(stages.STARTED.facts.map((fact) => fact.label), ["Branch", "Vertical", "Main event date", "Project manager"]);
  const text = JSON.stringify(body);
  assert.doesNotMatch(text, /125000|internal note|\+919876543210/, "no money, remarks or phone number");
  assert.doesNotMatch(text, /Converted|Recorded by|updates|Step \d/, "no sale history, update remarks or the crew's step names");
});

test("each shoot shows the cover its signed quotation's brand has for it, as a quotation picks one", async () => {
  const code = `T${STAMP}`;
  const url = (name) => `https://covers.test/${STAMP}/${name}.webp`;
  await prisma.salesQuotationBrand.create({ data: { code, name: `Test ${STAMP}`, verticalName: "Test", pdfAssets: { coverSets: [
    { shoots: [], coverImageUrl: url("default") },
    { shoots: ["Reception"], coverImageUrl: url("reception") },
  ] } } });
  const quotation = await prisma.salesQuotation.create({ data: {
    quotationNumber: tag("q-cover"), quotationId: tag("q-cover-01"), publicToken: `cv${STAMP}`.slice(0, 8),
    payload: {}, sourceBranch: "Erode TN", followedBy: "Test", status: "Generated", quotationBrand: code,
  } });
  const haldi = await prisma.projectShoot.create({ data: { projectId: F.mine.id, shootId: tag("sh-3"), shoot: "Haldi", shootPlace: "Home", district: "Erode", state: "Tamil Nadu" } });
  const coverOf = async () => {
    const { body } = await answer({ user: { id: F.client.id, role: "CLIENT" } });
    const shoots = body.data.stages.find((stage) => stage.id === "PRODUCTION").shoots;
    return Object.fromEntries(shoots.map((shoot) => [shoot.name, shoot.coverUrl]));
  };
  try {
    await prisma.salesProject.update({ where: { id: F.mine.id }, data: { quotationId: quotation.quotationId } });
    assert.deepEqual(await coverOf(), { Reception: url("reception"), Haldi: url("default") }, "its own set, else the first set");
    // A cover the studio changes in Settings reaches the app at once - read live, not from a snapshot.
    await prisma.salesQuotationBrand.update({ where: { code }, data: { pdfAssets: { coverSets: [{ shoots: [], coverImageUrl: url("new") }] } } });
    assert.deepEqual(await coverOf(), { Reception: url("new"), Haldi: url("new") });
    // Nothing uploaded: no cover, and the app shows its own picture.
    await prisma.salesQuotationBrand.update({ where: { code }, data: { pdfAssets: null } });
    assert.deepEqual(await coverOf(), { Reception: null, Haldi: null });
  } finally {
    await prisma.salesProject.update({ where: { id: F.mine.id }, data: { quotationId: null } });
    await prisma.projectShoot.delete({ where: { id: haldi.id } });
    await prisma.salesQuotation.delete({ where: { id: quotation.id } });
    await prisma.salesQuotationBrand.delete({ where: { code } });
  }
});

test("a project that is gone answers 404, not somebody else's", async () => {
  await prisma.salesProject.update({ where: { id: F.mine.id }, data: { deletedAt: new Date() } });
  const { code } = await answer({ user: { id: F.client.id, role: "CLIENT" } });
  assert.equal(code, 404);
  await prisma.salesProject.update({ where: { id: F.mine.id }, data: { deletedAt: null } });
});

test("a project giving no welcome gift sends none, and the old spelling reads as Client Gifts reads it", async () => {
  await prisma.salesProject.update({ where: { id: F.mine.id }, data: { welcomeGiftStatus: "Yet To Receive" } });
  assert.equal((await answer({ user: { id: F.client.id, role: "CLIENT" } })).body.data.welcomeGift.status, "Yet To Sent");
  await prisma.salesProject.update({ where: { id: F.mine.id }, data: { welcomeGift: "Not Applicable", shootCompletedGift: "Not Applicable" } });
  const { body } = await answer({ user: { id: F.client.id, role: "CLIENT" } });
  assert.equal(body.data.welcomeGift, null);
  assert.equal(body.data.shootCompletedGift, null);
});

test("the CRD document: not started until it is sent, then the client's link until it is submitted", async () => {
  const crd = async () => (await answer({ user: { id: F.client.id, role: "CLIENT" } })).body.data.crdDocument;
  await prisma.salesProject.update({ where: { id: F.mine.id }, data: { crdDocumentStatus: "Not Applicable" } });
  assert.equal(await crd(), null, "a project needing no CRD document shows none");

  await prisma.salesProject.update({ where: { id: F.mine.id }, data: { crdDocumentStatus: "Applicable" } });
  assert.deepEqual(await crd(), { state: "notStarted" }, "applicable, but no document raised yet");

  const token = `${STAMP}crdlink01`.slice(0, 16);
  await prisma.salesProjectCrdDocument.create({ data: { projectId: F.mine.id, publicToken: token, status: "Not Sent", vertical: "WED" } });
  assert.deepEqual(await crd(), { state: "notStarted" }, "the studio has not sent it: no link is handed out");

  await prisma.salesProjectCrdDocument.update({ where: { projectId: F.mine.id }, data: { status: "Sent" } });
  assert.deepEqual(await crd(), { state: "awaiting", fillPath: `/crd/${token}` });

  await prisma.salesProjectCrdDocument.update({ where: { projectId: F.mine.id }, data: { status: "In Progress" } });
  assert.deepEqual(await crd(), { state: "inProgress", fillPath: `/crd/${token}` });

  await prisma.salesProjectCrdDocument.update({ where: { projectId: F.mine.id }, data: { status: "Submitted", submittedAt: new Date("2026-10-04T08:00:00.000Z") } });
  assert.deepEqual(await crd(), { state: "submitted", submittedOn: "2026-10-04" }, "submitted: the day, and no link to fill it again");
});

test("each shoot's production as the client follows it: planned, on the way, reached, started, completed", async () => {
  const shootsNow = async () => (await answer({ user: { id: F.client.id, role: "CLIENT" } })).body.data.stages.find((stage) => stage.id === "PRODUCTION").shoots;
  const progress = async (id = F.shoot.id) => (await shootsNow()).find((shoot) => shoot.id === id).progress;
  const steps = (value) => value.steps.map(({ key, done, at }) => [key, done, at]);
  const PLANNED = "2026-10-01T06:30:00.000Z";

  // Planned, the team not left yet.
  assert.deepEqual(await progress(), { steps: [["PLAN", true, PLANNED], ["ON_THE_WAY", false, null], ["REACHED", false, null], ["STARTED", false, null], ["COMPLETED", false, null]].map(([key, done, at]) => ({ key, done, at })) });

  // Out of the studio, at the place, past the Pineapple meeting and started - still shooting.
  await prisma.projectProduction.update({ where: { shootId: F.shoot.id }, data: {
    startedFromStudioAt: new Date("2026-11-20T03:40:00.000Z"), reachedShootPlaceAt: new Date("2026-11-20T04:30:00.000Z"),
    pineappleMeetingAt: new Date("2026-11-20T04:45:00.000Z"), shootStartedAt: new Date("2026-11-20T05:00:00.000Z"),
    currentStep: "HAPPENING_NOW", startedFromStudioRemarks: "crew note",
  } });
  let value = await progress();
  assert.deepEqual(steps(value), [["PLAN", true, PLANNED], ["ON_THE_WAY", true, "2026-11-20T03:40:00.000Z"], ["REACHED", true, "2026-11-20T04:30:00.000Z"], ["STARTED", true, "2026-11-20T05:00:00.000Z"], ["COMPLETED", false, null]]);

  // Happy clients is the shoot over, with the moment it happened; File in, the footage, is the
  // studio's own and the client is not shown it.
  await prisma.projectProduction.update({ where: { shootId: F.shoot.id }, data: { shootStatus: "COMPLETED", happyClientsAt: new Date("2026-11-20T10:00:00.000Z"), currentStep: "PHOTO_COPY" } });
  value = await progress();
  assert.deepEqual(value.steps.at(-1), { key: "COMPLETED", done: true, at: "2026-11-20T10:00:00.000Z" });
  const text = JSON.stringify((await answer({ user: { id: F.client.id, role: "CLIENT" } })).body);
  await prisma.projectProduction.update({ where: { shootId: F.shoot.id }, data: { currentStep: "DONE", photoCopyAt: new Date("2026-11-21T06:00:00.000Z") } });
  value = await progress();
  assert.ok(value.steps.every((step) => step.done), "a shoot the crew has finished is done on every step");

  // A shoot left standing on a step nobody works any more is as far as File in: the shoot is over.
  await prisma.projectProduction.update({ where: { shootId: F.shoot.id }, data: { currentStep: "REACHED_STUDIO" } });
  assert.equal((await progress()).steps.at(-1).done, true);

  // A shoot whose production has not been raised yet is still to be planned.
  const unraised = await prisma.projectShoot.create({ data: { projectId: F.mine.id, shootId: tag("sh-3"), shoot: "Engagement", shootPlace: "Studio", district: "Erode", state: "Tamil Nadu" } });
  assert.deepEqual(await progress(unraised.id), { steps: ["PLAN", "ON_THE_WAY", "REACHED", "STARTED", "COMPLETED"].map((key) => ({ key, done: false, at: null })) });

  assert.doesNotMatch(text, /2026-11-20T04:45|crew note|PINEAPPLE|REACHED_STUDIO|PHOTO_COPY|Pineapple|Photo copy|File in/, "the crew's own steps, times and remarks stay the studio's");
});

test("a client is named by their own names, never the studio's WhatsApp group name", async () => {
  await prisma.salesCrmLead.update({ where: { enquiryId: tag("enq-mine") }, data: { groomName: "Vikram", brideName: "Harini" } });
  const { body } = await answer({ user: { id: F.client.id, role: "CLIENT" }, params: {}, query: {} });
  assert.equal(body.data.clientName, "Vikram and Harini");
  // The group name is the studio's working code - its vertical, branch, package and dates.
  assert.ok(!JSON.stringify(body).includes(`WED mine ${STAMP}`), "the WhatsApp group name must not reach the client");
});

test("the team a client may call: the company phone, else the person's own; a typed name has none", async () => {
  const work = await prisma.employee.create({ data: { employeeId: tag("emp-work"), employeeName: `Work Phone ${STAMP}`, companyGivenNumber: "+91 9000011111", contactNumber: "+91 9000022222" } });
  const own = await prisma.employee.create({ data: { employeeId: tag("emp-own"), employeeName: `Own Phone ${STAMP}`, contactNumber: "+91 9000033333" } });
  try {
    await prisma.salesProject.update({ where: { id: F.mine.id }, data: { projectManagerEmployeeId: work.id, creativeManagerEmployeeId: own.id } });
    const { body } = await answer({ user: { id: F.client.id, role: "CLIENT" } });
    const byRole = Object.fromEntries(body.data.team.map((member) => [member.role, member]));
    assert.deepEqual(byRole["Project manager"], { role: "Project manager", name: `Work Phone ${STAMP}`, phone: "+91 9000011111" }, "the company phone, never the personal one beside it");
    assert.deepEqual(byRole["Creative manager"], { role: "Creative manager", name: `Own Phone ${STAMP}`, phone: "+91 9000033333" });
    assert.deepEqual(byRole["Pre-production coordinator"], { role: "Pre-production coordinator", name: "Sneha Iyer", phone: null }, "a name typed by hand has no number");
    assert.doesNotMatch(JSON.stringify(body), /9000022222/, "the personal number stays private when a company phone exists");
  } finally {
    await prisma.salesProject.update({ where: { id: F.mine.id }, data: { projectManagerEmployeeId: null, creativeManagerEmployeeId: null } });
    await prisma.employee.deleteMany({ where: { id: { in: [work.id, own.id] } } });
  }
});

test("the client's WhatsApp group: only an invite link pasted into the group name is sent, never the name", async () => {
  try {
    await prisma.salesProject.update({ where: { id: F.mine.id }, data: { whatsappGroupName: "https://chat.whatsapp.com/AbC123xyz_-9" } });
    assert.equal((await answer({ user: { id: F.client.id, role: "CLIENT" } })).body.data.whatsappGroupLink, "https://chat.whatsapp.com/AbC123xyz_-9");
    await prisma.salesProject.update({ where: { id: F.mine.id }, data: { whatsappGroupName: `WED secret code ${STAMP}` } });
    const { body } = await answer({ user: { id: F.client.id, role: "CLIENT" } });
    assert.equal(body.data.whatsappGroupLink, null, "a plain name is no link");
    assert.doesNotMatch(JSON.stringify(body), /secret code/, "the group name never leaves");
  } finally {
    await prisma.salesProject.update({ where: { id: F.mine.id }, data: { whatsappGroupName: `WED mine ${STAMP}` } });
  }
});
