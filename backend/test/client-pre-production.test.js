const { test, before, after } = require("node:test");
// CI has no .env: the token this suite signs and checks needs a key of its own, as every other suite sets.
process.env.JWT_SECRET = process.env.JWT_SECRET || "client-pre-production-test-secret";
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const clientPush = require("../src/services/clientPush");
const { getClientPreProduction, saveClientPreProduction } = require("../src/modules/client/portal/controller");
const { sendToClient, clientForm, downloadClientFile } = require("../src/modules/project-management/pre-production/controller");
const { protect } = require("../src/middleware/authMiddleware");

/*
 * A shoot's pre production details, filled in by the client in the app: the team sends a shoot, the
 * client sees only it and only their own questions, saves some answers now and some later, and each
 * one locks once saved; their answers are the shoot's own fields. Nothing reaches Expo (the sender is
 * replaced). Real rows, removed at the end.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCPP-${STAMP}-${name}`;
const NUMBER = `90${STAMP}12`.slice(0, 10);
const F = {};

const answer = async (handler, req) => {
  const out = { code: 200 };
  const res = { status: (c) => { out.code = c; return res; }, json: (b) => { out.body = b; return res; }, set: () => res, end: () => res };
  await handler(req, res);
  return out;
};
const asClient = (extra = {}) => ({ user: { id: F.client.id, role: "CLIENT" }, query: {}, params: {}, body: {}, ...extra });
const asTeam = (shootId) => ({ user: { id: F.admin.id }, params: { shootId }, body: {} });
const PDF = `data:application/pdf;base64,${Buffer.from("%PDF-1.4 test").toString("base64")}`;
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

before(async () => {
  clientPush.setSender(async (messages) => messages.map(() => ({ status: "ok" })));
  await prisma.salesCrmLead.upsert({ where: { enquiryId: tag("enq") }, create: { enquiryId: tag("enq"), name: tag("enq") }, update: {} });
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq"), eventId: tag("ev"), whatsappGroupName: `WED ${STAMP}`, clientMainNumber: `+91 ${NUMBER}`,
    sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Work in Progress",
  } });
  F.sent = await prisma.projectShoot.create({ data: { projectId: F.project.id, shootId: tag("s1"), shoot: "Reception", shootType: "Outdoor / On-Location" } });
  F.unsent = await prisma.projectShoot.create({ data: { projectId: F.project.id, shootId: tag("s2"), shoot: "Haldi", shootType: "Outdoor / On-Location" } });
  F.client = await prisma.user.create({ data: { name: "C", email: null, username: NUMBER, password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: F.project.id } });
  F.admin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } }) || await prisma.user.findFirst({ select: { id: true } });
});

after(async () => {
  clientPush.setSender(null);
  await prisma.clientNotification.deleteMany({ where: { salesProjectId: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.projectActivity?.deleteMany?.({ where: { projectId: { in: [F.project?.id].filter(Boolean) } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [F.client?.id].filter(Boolean) } } });
  await prisma.projectPreProduction.deleteMany({ where: { projectId: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.projectShoot.deleteMany({ where: { projectId: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.salesProject.deleteMany({ where: { id: { in: [F.project?.id].filter(Boolean) } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: tag("enq") } });
  await prisma.$disconnect();
});

test("only shoots the team sent are asked, with a push and a bell item", async () => {
  assert.deepEqual((await answer(getClientPreProduction, asClient())).body.data.shoots, [], "nothing until sent");
  assert.equal((await answer(sendToClient, asTeam(F.sent.id))).code, 200);
  const shoots = (await answer(getClientPreProduction, asClient())).body.data.shoots;
  assert.deepEqual(shoots.map((s) => s.shoot), ["Reception"], "Haldi was not sent");
  const fields = shoots[0].sections.flatMap((s) => s.fields).map((f) => f.name);
  assert.ok(fields.includes("files.decor"), "a wedding asks the photos");
  assert.ok(!fields.some((name) => ["conceptsNeeded", "concepts", "groomAddress", "brideAddress"].includes(name)), "the concepts and the addresses are the team's, never asked");
  assert.ok(fields.includes("introCallGroom") && fields.includes("reportingTime") && fields.includes("siteVisit"), "every empty field of the team's form is asked");
  assert.equal(shoots[0].done, false);
  assert.equal(await prisma.clientNotification.count({ where: { salesProjectId: F.project.id, type: "preproduction" } }), 1);
});

test("answers save a few at a time, land in the shoot's fields, and lock once saved", async () => {
  const save = (body) => answer(saveClientPreProduction, asClient({ params: { shootId: F.sent.id }, body }));
  assert.equal((await save({ answers: { locationLink: "not a link" } })).code, 400);
  const first = await save({ answers: { eventStartTime: "18:00", locationAddress: "Sri Krishna Mahal" } });
  assert.equal(first.code, 200);
  assert.equal((await prisma.projectShoot.findUnique({ where: { id: F.sent.id } })).eventStartTime, "18:00");
  assert.equal((await prisma.projectPreProduction.findUnique({ where: { shootId: F.sent.id } })).locationAddress, "Sri Krishna Mahal");
  // Saved once: not again.
  assert.equal((await save({ answers: { locationAddress: "Elsewhere" } })).code, 400);
  // Photos, and a set the client does not have.
  const photos = await save({ files: { invitation: [{ name: "card.png", data: PIXEL }, { name: "invite.pdf", data: PDF }], dresses: "none" } });
  assert.equal(photos.code, 200);
  const row = await prisma.projectPreProduction.findUnique({ where: { shootId: F.sent.id }, include: { clientImages: true } });
  assert.equal(row.clientImages.filter((i) => i.kind === "invitation").length, 2);
  assert.equal(row.invitationSoftCopy, true, "the team's checklist says the invitation is in");
  // The team sees it on the shoot.
  const team = (await answer(clientForm, asTeam(F.sent.id))).body.data;
  const invitation = team.files.find((group) => group.kind === "invitation");
  assert.deepEqual(invitation.files.map((file) => file.name), ["card.png", "invite.pdf"]);
  assert.equal(team.files.find((group) => group.kind === "dresses").notAvailable, true);
  // The team downloads a file under its own name.
  const pdf = invitation.files.find((file) => file.name === "invite.pdf");
  const download = { headers: {} };
  await downloadClientFile({ params: { shootId: F.sent.id, fileId: pdf.id } }, { set: (k, v) => { download.headers[k] = v; }, send: (body) => { download.body = body; }, status: () => ({ json: () => {} }) });
  assert.match(download.headers["Content-Disposition"], /invite\.pdf/);
  assert.equal(download.body.toString(), "%PDF-1.4 test");
  assert.ok(team.pending.includes("Event End Time"));
});

test("another client's shoot cannot be read or written, and only that one save route is open", async () => {
  const other = await prisma.user.create({ data: { name: "O", email: null, username: `91${STAMP}34`.slice(0, 10), password: "x", role: "CLIENT", status: "ACTIVE", clientProjectId: null } });
  try {
    const res = await answer(saveClientPreProduction, { user: { id: other.id, role: "CLIENT" }, params: { shootId: F.sent.id }, body: { answers: { eventEndTime: "23:00" } } });
    assert.equal(res.code, 404);
  } finally {
    await prisma.user.delete({ where: { id: other.id } });
  }
  const route = async (method, url) => {
    let outcome = null;
    const res = { status: (c) => { outcome = c; return res; }, json: () => res };
    const token = require("jsonwebtoken").sign({ id: F.client.id, role: "CLIENT" }, process.env.JWT_SECRET, { expiresIn: "5m" });
    await protect({ method, originalUrl: url, headers: { authorization: `Bearer ${token}` } }, res, () => { outcome = "next"; });
    return outcome;
  };
  assert.equal(await route("PATCH", `/api/client/pre-production/${F.sent.id}`), "next");
  assert.equal(await route("PATCH", "/api/client/pre-production/../../user/profile"), 403);
  assert.equal(await route("DELETE", `/api/client/pre-production/${F.sent.id}`), 403);
});

test("the three file sets are the client's even when the team ticked them; answers go in a few at a time until done", async () => {
  // The team ticks Invitation on their form: the client is still asked for the invitation files.
  const shoot = await prisma.projectShoot.create({ data: { projectId: F.project.id, shootId: tag("s3"), shoot: "Sangeeth", shootType: "Outdoor / On-Location" } });
  await prisma.projectPreProduction.create({ data: { projectId: F.project.id, shootId: shoot.id, invitationSoftCopy: true, gettingDressesImages: true, gettingDecorImages: true } });
  assert.equal((await answer(sendToClient, asTeam(shoot.id))).code, 200);
  const read = async () => (await answer(getClientPreProduction, asClient())).body.data.shoots.find((s) => s.shootId === shoot.id);
  const field = (form, name) => form.sections.flatMap((s) => s.fields).find((f) => f.name === name);
  let form = await read();
  for (const kind of ["invitation", "dresses", "decor"]) assert.equal(field(form, `files.${kind}`).locked, false, `${kind} is still the client's to upload`);
  const owed = form.pending.length;
  assert.ok(owed > 3);
  const save = (body) => answer(saveClientPreProduction, asClient({ params: { shootId: shoot.id }, body }));

  // Three answers now: each lands in the shoot's fields at once; the rest stay open.
  assert.equal((await save({ answers: { locationAddress: "Sri Krishna Mahal", eventStartTime: "18:30" }, files: { invitation: [{ name: "card.png", data: PIXEL }] } })).code, 200);
  const pre = await prisma.projectPreProduction.findUnique({ where: { shootId: shoot.id }, include: { clientImages: true } });
  assert.equal(pre.locationAddress, "Sri Krishna Mahal");
  assert.equal((await prisma.projectShoot.findUnique({ where: { id: shoot.id } })).eventStartTime, "18:30");
  assert.equal(pre.clientImages.filter((i) => i.kind === "invitation").length, 1);
  form = await read();
  assert.equal(form.pending.length, owed - 3);
  assert.equal(form.done, false);
  assert.equal((await answer(clientForm, asTeam(shoot.id))).body.data.files.find((g) => g.kind === "invitation").files.length, 1, "the team sees the upload");

  // The rest later: every remaining question answered -> done.
  const answers = {};
  const filesLater = {};
  for (const f of form.sections.flatMap((s) => s.fields)) {
    if (f.locked || f.notAvailable || !form.pending.includes(f.label)) continue;
    if (f.type === "files") filesLater[f.kind] = "none";
    else if (f.type === "yesno") answers[f.name] = false;
    else if (f.type === "time") answers[f.name] = "10:00";
    else if (f.type === "date") answers[f.name] = "2026-12-01";
    else answers[f.name] = "Filled by the client";
  }
  assert.equal((await save({ answers, files: filesLater })).code, 200);
  form = await read();
  assert.deepEqual(form.pending, []);
  assert.equal(form.done, true);
  const after = await prisma.projectPreProduction.findUnique({ where: { shootId: shoot.id } });
  assert.equal(after.reportingTime, "10:00", "the second submit reached DBS too");
});
