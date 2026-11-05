const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { vendorNoticesDue, digestsOf, snapshotOf, confirmedSeatsOf } = require("../src/modules/settings/shoot-crew-notice/vendorDue");
const projectSender = require("../src/modules/settings/shoot-crew-notice/projectSender");
const vendorSender = require("../src/modules/settings/shoot-crew-notice/vendorSender");

/*
 * Settings → Project Management → Shoot crew notice, **vendor arm**.
 *
 * A vendor is told thirty minutes after they are confirmed, reminded two days before, told what
 * changed, and told when they are off it. The rules that matter are the ones that go wrong quietly:
 * a vendor told twice, a vendor told the old date, and a vendor who travels to a shoot that moved.
 */

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const NOW = new Date("2026-11-03T06:00:00.000Z");
const QUIET = new Date("2026-11-03T05:00:00.000Z");
const JUST_TOUCHED = new Date("2026-11-03T05:50:00.000Z");

const vendor = (over = {}) => ({ id: 31, vendorName: "Sunrise Lights", whatsappNumber: "9876500011", mobileNumber: null, isDeleted: false, ...over });

const seat = (over = {}) => ({
  vendorId: 31, role: "LEAD", serviceDefinitionId: "svc-led", vendorStatus: "CONFIRMED",
  updatedAt: QUIET, serviceDefinition: { name: "Lighting" }, vendor: vendor(), ...over,
});

const shoot = (over = {}) => ({
  id: "shoot-1", shootId: "DBS-SID-DD-CBE-000256", shoot: "Reception",
  dateCreated: new Date("2026-11-20T00:00:00.000Z"), updatedAt: QUIET, deletedAt: null,
  eventStartTime: "18:30", eventEndTime: "23:00", sessionTiming: null,
  shootPlace: "Hotel Grand, Coimbatore", district: "Coimbatore",
  project: {
    id: "proj-1", eventId: "DBS-EID-0001", whatsappGroupName: "Sharma Wedding", deletedAt: null,
    preProductionCoordinatorEmployeeId: 9, productionManagerEmployeeId: 4,
    preProductionCoordinatorEmployee: { id: 9, employeeName: "Meera" },
    productionManagerEmployee: { id: 4, employeeName: "Ravi" },
  },
  ...over,
});

const production = (over = {}) => ({
  id: "prod-1", createdAt: QUIET, updatedAt: QUIET,
  planSubmittedAt: QUIET, planStatus: "SUBMITTED",
  shoot: shoot(), serviceCrew: [seat()], vendorNotices: [], ...over,
});

const clientWith = (productions) => ({ projectProduction: { findMany: async () => productions } });
const due = (productions, now = NOW) => vendorNoticesDue(now, { client: clientWith(productions) });

/** A row saying this vendor was told the shoot exactly as the fixture has it. */
function told(prod, over = {}) {
  const seats = confirmedSeatsOf(prod, 31);
  return {
    id: "notice-1", vendorId: 31, ...digestsOf(prod.shoot, seats), ...snapshotOf(prod.shoot, seats),
    confirmedSentAt: QUIET, reminderSentAt: null, needsNumber: false, serviceDefinitionId: "svc-led",
    sentAt: QUIET, vendor: vendor(), ...over,
  };
}

test("a vendor still Waiting is owed nothing, and a confirmed one is owed the confirm", async () => {
  assert.deepEqual(await due([production({ serviceCrew: [seat({ vendorStatus: "WAITING" })] })]), []);
  const owed = await due([production()]);
  assert.equal(owed.length, 1);
  assert.equal(owed[0].kind, "CONFIRMED");
  assert.equal(owed[0].vendor.vendorName, "Sunrise Lights");
  assert.equal(owed[0].services, "Lighting");
  // From the project's own Production Manager, which is what the message signs off with.
  assert.equal(owed[0].manager, "Ravi");
});

test("nothing goes until the plan has been still for thirty minutes, however it was touched", async () => {
  for (const touched of ["updatedAt", "shootTouched", "seatTouched"]) {
    const prod = production();
    if (touched === "updatedAt") prod.updatedAt = JUST_TOUCHED;
    if (touched === "shootTouched") prod.shoot.updatedAt = JUST_TOUCHED;
    if (touched === "seatTouched") prod.serviceCrew[0].updatedAt = JUST_TOUCHED;
    assert.deepEqual(await due([prod]), [], `a plan touched through ${touched} is still being worked on`);
  }
  // Ten minutes later it is quiet, and the vendor hears once.
  assert.equal((await due([production()], new Date("2026-11-03T06:21:00.000Z")))[0].kind, "CONFIRMED");
});

test("a vendor confirmed three weeks out is told now, not in nineteen days", async () => {
  // The crew arm asks only about the next two days. A vendor is told when they are confirmed, which
  // is also what makes a change message reach somebody told a fortnight ago.
  const far = production({ shoot: shoot({ dateCreated: new Date("2026-11-24T00:00:00.000Z") }) });
  assert.equal((await due([far]))[0].kind, "CONFIRMED");
  const source = read("src/modules/settings/shoot-crew-notice/vendorDue.js");
  assert.match(source, /shoot: \{ dateCreated: \{ gte: shared\.dayStart\(now\) \} \}/, "every shoot from today on, with no upper bound");
});

test("the reminder goes two days before even to a vendor already told on confirming, and only once", async () => {
  const near = production({ shoot: shoot({ dateCreated: new Date("2026-11-04T00:00:00.000Z") }) });
  near.vendorNotices = [told(near)];
  const owed = await due([near]);
  assert.equal(owed.length, 1);
  assert.equal(owed[0].kind, "REMINDER");
  // Sent: not owed again.
  near.vendorNotices = [told(near, { reminderSentAt: NOW })];
  assert.deepEqual(await due([near]), []);
  // And a shoot still three weeks out is not reminded about yet.
  const far = production();
  far.vendorNotices = [told(far)];
  assert.deepEqual(await due([far]), []);
});

test("each kind of change picks its own wording, and two at once send one message", async () => {
  const cases = [
    ["DATE_CHANGED", (prod) => { prod.shoot.dateCreated = new Date("2026-11-21T00:00:00.000Z"); }],
    ["DATE_CHANGED", (prod) => { prod.shoot.eventStartTime = "17:00"; }],
    ["PLACE_CHANGED", (prod) => { prod.shoot.shootPlace = "Hotel Royal, Coimbatore"; }],
    ["PLACE_CHANGED", (prod) => { prod.shoot.district = "Tiruppur"; }],
    ["SERVICE_CHANGED", (prod) => { prod.serviceCrew[0].serviceDefinitionId = "svc-drone"; }],
  ];
  for (const [kind, change] of cases) {
    const prod = production();
    prod.vendorNotices = [told(prod)];
    change(prod);
    const owed = await due([prod]);
    assert.equal(owed.length, 1, `${kind} is one message`);
    assert.equal(owed[0].kind, kind);
  }
  // The day moved and the hall moved: the day is the news, and the hall rides in the same message.
  const both = production();
  both.vendorNotices = [told(both)];
  both.shoot.dateCreated = new Date("2026-11-21T00:00:00.000Z");
  both.shoot.shootPlace = "Hotel Royal, Coimbatore";
  const owed = await due([both]);
  assert.equal(owed.length, 1, "a vendor who gets three messages for one edit mutes the studio");
  assert.equal(owed[0].kind, "DATE_CHANGED");
});

test("a vendor who was told is chased whatever took the shoot away from them", async () => {
  const gone = [
    ["un-confirmed", (prod) => { prod.serviceCrew[0].vendorStatus = "WAITING"; }],
    ["the seat given to somebody else", (prod) => { prod.serviceCrew = []; }],
    ["the plan withdrawn", (prod) => { prod.planSubmittedAt = null; }],
    ["the plan put on hold", (prod) => { prod.planStatus = "HOLD"; }],
    ["the plan with the client", (prod) => { prod.planStatus = "WCR"; }],
    ["the shoot deleted", (prod) => { prod.shoot.deletedAt = QUIET; }],
    ["the project deleted", (prod) => { prod.shoot.project.deletedAt = QUIET; }],
  ];
  for (const [why, change] of gone) {
    const prod = production();
    prod.vendorNotices = [told(prod)];
    change(prod);
    const owed = await due([prod]);
    assert.equal(owed.length, 1, `${why}: the vendor is told once`);
    assert.equal(owed[0].kind, "REMOVED", why);
    // Composed from what was said, since the plan may no longer be readable.
    assert.equal(owed[0].services, "Lighting", why);
    assert.equal(owed[0].notice.lastPlace, "Hotel Grand, Coimbatore", why);
  }
});

test("a removal reads the shoot the vendor was told about, not the one it has become", () => {
  const prod = production();
  const notice = told(prod);
  const values = vendorSender.valuesFor({
    kind: "REMOVED", notice, vendor: vendor(), project: prod.shoot.project, shoot: null,
    services: notice.lastService, manager: "Ravi",
  });
  assert.equal(values.date, "20 Nov 2026");
  assert.equal(values.place, "Hotel Grand, Coimbatore");
  assert.equal(values.shoot, "Reception");
  assert.equal(values["vendor name"], "Sunrise Lights");
  assert.equal(values["manager name"], "Ravi");
});

test("a row for a vendor nobody ever told is dropped quietly, with no message", async () => {
  const prod = production({ serviceCrew: [] });
  prod.vendorNotices = [told(prod, { confirmedSentAt: null })];
  const owed = await due([prod]);
  assert.equal(owed.length, 1);
  assert.equal(owed[0].kind, "STALE", "there is nothing to take back");
});

test("a vendor with no number is marked rather than retried, and the mark clears when a number is saved", async () => {
  const prod = production({ serviceCrew: [seat({ vendor: vendor({ whatsappNumber: null, mobileNumber: null }) })] });
  prod.vendorNotices = [told(prod, { needsNumber: true, confirmedSentAt: null })];
  assert.deepEqual(await due([prod]), [], "not listed again every minute");
  // Somebody saves a mobile number: the mark no longer holds it back.
  const fixed = production({ serviceCrew: [seat({ vendor: vendor({ whatsappNumber: null, mobileNumber: "9876500022" }) })] });
  fixed.vendorNotices = [told(fixed, { needsNumber: true, confirmedSentAt: null, shootDigest: "stale" })];
  const owed = await due([fixed]);
  assert.equal(owed.length, 1);
  assert.equal(owed[0].phone, "9876500022", "their mobile where no WhatsApp number is saved");
});

test("a vendor binned since being planned is neither told nor chased", async () => {
  const prod = production({ serviceCrew: [seat({ vendor: vendor({ isDeleted: true }) })] });
  assert.deepEqual(await due([prod]), []);
  prod.vendorNotices = [told(prod)];
  assert.deepEqual(await due([prod]), [], "the row stays, so re-instating them does not re-tell them");
});

test("the sender is the project's own Production Manager, and five things can stop them", async () => {
  const project = shoot().project;
  const connected = { sessionState: () => ({ status: "connected" }) };
  const eligibleUser = { id: 77 };
  const client = (login, eligible) => ({ user: { findFirst: async ({ where }) => (where.id ? (eligible ? eligibleUser : null) : login) } });

  const ok = await projectSender.resolve(project, projectSender.ROLES.PRODUCTION_MANAGER, { client: client({ id: 77 }, true), sessions: connected, isChatEnabledForUser: async () => true });
  assert.equal(ok.ok, true);
  assert.equal(ok.userId, 77);

  const refusals = [
    [projectSender.WHY.NOBODY_NAMED, { ...project, productionManagerEmployeeId: null }, client({ id: 77 }, true), connected, true],
    [projectSender.WHY.NO_LOGIN, project, client(null, false), connected, true],
    [projectSender.WHY.NOT_ELIGIBLE, project, client({ id: 77 }, false), connected, true],
    [projectSender.WHY.CHAT_OFF, project, client({ id: 77 }, true), connected, false],
    [projectSender.WHY.NOT_CONNECTED, project, client({ id: 77 }, true), { sessionState: () => ({ status: "disconnected" }) }, true],
  ];
  for (const [why, proj, db, sessions, chat] of refusals) {
    const answer = await projectSender.resolve(proj, projectSender.ROLES.PRODUCTION_MANAGER, { client: db, sessions, isChatEnabledForUser: async () => chat });
    assert.equal(answer.ok, false, why);
    assert.equal(answer.why, why);
    // Each is fixed by a different person, so each says which - the panel shows this line.
    assert.match(answer.reason, /Production Manager/, why);
  }
});

test("there is no fallback sender: a project that cannot send waits, and another project still sends", () => {
  const source = read("src/modules/settings/shoot-crew-notice/vendorSender.js");
  assert.match(source, /projectSender\.resolve\(project, projectSender\.ROLES\.PRODUCTION_MANAGER/);
  assert.match(source, /if \(!sender\.ok\) \{ trouble\.push\(`\$\{label\}: \$\{sender\.reason\}`\); continue; \}/, "waits, and says why, without touching the row");
  assert.doesNotMatch(source, /senderPolicy|trySenders|Rotation/);
  // One manager's own phone, not the studio's: their own share of a sweep.
  assert.match(source, /MAX_PER_SENDER_TRY/);
});

test("a message is written before it is sent, claimed on all three digests, and put back only when it certainly did not go", async () => {
  const writes = [];
  const client = {
    projectShootVendorNotice: {
      create: async (args) => { writes.push(["create", args]); return {}; },
      updateMany: async (args) => { writes.push(["updateMany", args]); return { count: 1 }; },
      update: async (args) => { writes.push(["update", args]); return {}; },
      deleteMany: async (args) => { writes.push(["deleteMany", args]); return { count: 1 }; },
    },
  };
  const prod = production();
  const seats = confirmedSeatsOf(prod, 31);
  const item = {
    kind: "DATE_CHANGED", production: prod, vendor: vendor(), shoot: prod.shoot,
    digests: digestsOf(prod.shoot, seats), snapshot: snapshotOf(prod.shoot, seats),
    serviceDefinitionId: "svc-led", coversReminder: false,
  };
  const before = told(prod);
  assert.equal(await vendorSender.remember(item, before, NOW, { client }), true);
  const [, claim] = writes[0];
  for (const field of ["shootDigest", "placeDigest", "serviceDigest", "reminderSentAt"]) {
    assert.ok(field in claim.where, `${field} is part of the claim, so a second sweep finds nothing to take`);
  }
  // Two sweeps at once: the second changes nothing and sends nothing.
  const quiet = { projectShootVendorNotice: { ...client.projectShootVendorNotice, updateMany: async () => ({ count: 0 }) } };
  assert.equal(await vendorSender.remember(item, before, NOW, { client: quiet }), false);

  // Put back: every field, not only the digest, or the next sweep sends a message built from one
  // plan and a row remembering another.
  writes.length = 0;
  await vendorSender.forget(item, before, { client });
  const [, back] = writes[0];
  for (const field of ["shootDigest", "placeDigest", "serviceDigest", "confirmedSentAt", "reminderSentAt", "lastPlace", "lastService"]) {
    assert.ok(field in back.data, `${field} is put back`);
  }
});

test("a change inside the two days answers for the reminder, and the confirm never does", () => {
  const written = (kind, coversReminder) => vendorSender.writtenFor({ kind, coversReminder, digests: { shootDigest: "a", placeDigest: "b", serviceDigest: "c" }, snapshot: {}, serviceDefinitionId: null }, NOW);
  assert.equal(written("CONFIRMED", true).reminderSentAt, undefined, "a vendor confirmed inside the two days still gets the reminder");
  assert.equal(written("CONFIRMED", true).confirmedSentAt, NOW);
  assert.equal(written("DATE_CHANGED", true).reminderSentAt, NOW, "the change already said the day");
  assert.equal(written("DATE_CHANGED", false).reminderSentAt, undefined, "a change a fortnight out answers for no reminder");
  assert.equal(written("REMINDER", false).reminderSentAt, NOW);
  // And a send of any kind clears "no number", since one evidently went.
  assert.equal(written("REMINDER", false).needsNumber, false);
});

test("switching the vendor arm on tells nobody: every vendor already confirmed is recorded as told", async () => {
  const service = require("../src/modules/settings/shoot-crew-notice/service");
  const prod = production();
  const created = [];
  const client = {
    shootCrewNoticeSettings: { findUnique: async () => ({ enabled: false, vendorEnabled: true }), upsert: async () => ({}) },
    whatsAppActivity: { findFirst: async () => null },
    projectProduction: { findMany: async () => [prod] },
    projectShootVendorNotice: { create: async (args) => { created.push(args.data); return {}; }, findMany: async () => [] },
    user: { findFirst: async () => null },
  };
  const adopted = await service.adoptConfirmedVendors({ client, now: NOW });
  assert.equal(adopted, 1);
  const [row] = created;
  assert.equal(row.vendorId, 31);
  /*
   * Recorded as **told**, not as never-messaged: somebody told these vendors by hand before the
   * switch and they will travel, so a row saying nothing was ever sent would have a later removal
   * dropped in silence as "never told".
   */
  assert.equal(row.confirmedSentAt, NOW);
  // The shoot is three weeks out, so its reminder is still owed two days before, as it should be.
  assert.equal(row.reminderSentAt, null);
  // The digests are the shoot as it stands, so the first sweep finds nothing changed.
  assert.deepEqual(
    { shootDigest: row.shootDigest, placeDigest: row.placeDigest, serviceDigest: row.serviceDigest },
    digestsOf(prod.shoot, confirmedSeatsOf(prod, 31)),
  );
  assert.match(read("src/modules/settings/shoot-crew-notice/service.js"), /if \(enabled\) await adoptConfirmedVendors/);
});

test("switching on does not fire a reminder at every vendor whose shoot is already near", async () => {
  /*
   * The confirm was never the only burst. A shoot inside the reminder window owes its reminder the
   * moment a row exists, so adopting without saying the reminder has gone would send one to every
   * confirmed vendor on every shoot in the next three days, at once, from the managers' own numbers.
   */
  const service = require("../src/modules/settings/shoot-crew-notice/service");
  const near = production({ shoot: shoot({ dateCreated: new Date("2026-11-04T00:00:00.000Z") }) });
  const created = [];
  const client = {
    projectProduction: { findMany: async () => [near] },
    projectShootVendorNotice: { create: async (args) => { created.push(args.data); return {}; }, findMany: async () => [] },
  };
  await service.adoptConfirmedVendors({ client, now: NOW });
  assert.equal(created[0].reminderSentAt, NOW, "the near shoot's reminder is marked as covered");
  // Which is what the owed-list then reads: nothing waiting for this vendor.
  near.vendorNotices = [told(near, { reminderSentAt: NOW })];
  assert.deepEqual(await due([near]), []);
});

test("a vendor held for want of a number still gets the confirm once one is saved", async () => {
  /*
   * The bug this pins lost the message for ever: the holding row's digests already matched the shoot,
   * so once a number arrived there was no change to report and no confirm owed - the vendor heard
   * nothing, with a row saying they had been dealt with.
   */
  const prod = production();
  prod.vendorNotices = [told(prod, { needsNumber: true, confirmedSentAt: null })];
  const owed = await due([prod]);
  assert.equal(owed.length, 1);
  assert.equal(owed[0].kind, "CONFIRMED", "the first message is still the first message");
  assert.equal(owed[0].phone, "9876500011");
});

test("any message at all records the vendor as told, so a later removal is not dropped as never-told", () => {
  const written = (kind, notice) => vendorSender.writtenFor({ kind, notice, coversReminder: false, digests: { shootDigest: "a", placeDigest: "b", serviceDigest: "c" }, snapshot: {}, serviceDefinitionId: null }, NOW);
  assert.equal(written("DATE_CHANGED", { confirmedSentAt: null }).confirmedSentAt, NOW, "a change sent on a held row is still being told");
  assert.equal(written("REMINDER", { confirmedSentAt: null }).confirmedSentAt, NOW);
  // One already told keeps the moment they were first told.
  assert.equal(written("DATE_CHANGED", { confirmedSentAt: QUIET }).confirmedSentAt, undefined);
});

test("a number WhatsApp has no account for is marked, not retried from the manager's phone every minute", () => {
  const source = read("src/modules/settings/shoot-crew-notice/vendorSender.js");
  assert.match(source, /const NO_WHATSAPP = new Set\(\["NOT_ON_WHATSAPP", "INVALID_RECIPIENT"\]\)/);
  assert.match(source, /if \(NO_WHATSAPP\.has\(delivery\.code\) && item\.kind !== "REMOVED"\) \{[\s\S]{0,40}await markNeedsNumber/);
  // Because it fails the same way for ever, and five of them use the whole sweep every minute.
  assert.match(source, /starving every vendor behind them/);
});

test("a removal is claimed too, so two overlapping sweeps cannot both say do not travel", async () => {
  const writes = [];
  const client = { projectShootVendorNotice: { updateMany: async (args) => { writes.push(args); return { count: args.where.sentAt ? 1 : 0 }; } } };
  const item = { kind: "REMOVED", production: { id: "prod-1" }, vendor: vendor(), digests: { shootDigest: "a", placeDigest: "b", serviceDigest: "c" } };
  const before = { id: "notice-1", sentAt: QUIET };
  assert.equal(await vendorSender.remember(item, before, NOW, { client }), true);
  assert.deepEqual(writes[0].where, { id: "notice-1", sentAt: QUIET }, "claimed on the one field a removal moves");
  // The loser of the race changes nothing and sends nothing.
  const lost = { projectShootVendorNotice: { updateMany: async () => ({ count: 0 }) } };
  assert.equal(await vendorSender.remember(item, before, NOW, { client: lost }), false);
  // And with no row there is nothing owed at all.
  assert.equal(await vendorSender.remember(item, null, NOW, { client }), false);
});

test("the sweep's claim is not pushed forward by writing down its trouble", () => {
  /*
   * `keepError` used to stamp the claim column again at the end of the sweep. The claim is 50 seconds
   * and the tick is 60, so any sweep lasting more than about ten seconds - two sends - left the claim
   * live when the next tick came, and that tick did nothing. Every second sweep was silently lost.
   */
  const source = read("src/modules/settings/shoot-crew-notice/service.js");
  assert.doesNotMatch(source, /lastError: message[^\n]*lastAttemptAt/);
  assert.doesNotMatch(source, /vendorLastError: message[^\n]*vendorLastAttemptAt/);
  assert.match(source, /every second sweep was lost/);
});

test("one number's hour is bounded across both arms, not just its minute", async () => {
  const senderRate = require("../src/modules/settings/shoot-crew-notice/senderRate");
  // Both arms' triggers are counted, because the same person is often both roles.
  for (const trigger of ["SHOOT_CREW_ASSIGNED", "VENDOR_SHOOT_CONFIRMED", "VENDOR_SHOOT_REMOVED"]) {
    assert.ok(senderRate.SHOOT_NOTICE_TRIGGERS.includes(trigger), trigger);
  }
  const client = (count) => ({ whatsAppActivity: { count: async () => count } });
  assert.equal((await senderRate.mayStillSend(7, { client: client(29) })).ok, true);
  const full = await senderRate.mayStillSend(7, { client: client(senderRate.MAX_PER_SENDER_HOUR) });
  assert.equal(full.ok, false);
  assert.match(full.reason, /in the last hour/);
  assert.equal((await senderRate.mayStillSend(null, { client: client(0) })).ok, false, "nobody to send from");
  // Only what actually went is counted: a refusal sent nothing and the sweep already paced it.
  const source = read("src/modules/settings/shoot-crew-notice/senderRate.js");
  assert.match(source, /status: \{ in: \["SENT", "DELIVERED", "READ"\] \}/);
  for (const arm of ["sender.js", "vendorSender.js"]) {
    assert.match(read(`src/modules/settings/shoot-crew-notice/${arm}`), /senderRate\.mayStillSend\(sender\.userId/, `${arm} asks`);
  }
});

test("the waiting list says only what is actually owed, and asks each person once", async () => {
  /*
   * It used to list any project whose sender could not send and which had crew or a confirmed vendor
   * on it - so a project whose vendors had all been told months ago read as stuck. What is waiting is
   * what the sweep would try, so it asks the same owed-lists the sweep asks.
   */
  const source = read("src/modules/settings/shoot-crew-notice/service.js");
  assert.match(source, /crewNoticesDue\(now, \{ client \}\)/);
  assert.match(source, /vendorNoticesDue\(now, \{ client \}\)/);
  assert.match(source, /item\.kind !== "STALE"/, "a row the sweep drops without sending is nobody's to chase");
  // Resolved per person per role, so somebody on thirty projects is looked up once, not thirty times.
  assert.match(source, /const key = `\$\{project\?\.\[role\.employeeIdField\] \|\| "none"\}:\$\{role\.key\}`/);
  assert.match(source, /const MAX_WAITING = 50/);

  const service = require("../src/modules/settings/shoot-crew-notice/service");
  // Nothing owed: nothing waiting, even though this project's manager has no login at all.
  const prod = production();
  prod.vendorNotices = [told(prod, { reminderSentAt: NOW })];
  const quiet = await service.waiting({
    client: { projectProduction: { findMany: async () => [prod] }, user: { findFirst: async () => null } },
    now: NOW, vendorEnabled: true,
  });
  assert.deepEqual(quiet, []);
  // Something owed, and nobody to send it: one row, naming the reason.
  const stuck = await service.waiting({
    client: { projectProduction: { findMany: async () => [production()] }, user: { findFirst: async () => null } },
    now: NOW, vendorEnabled: true,
  });
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].why, "NO_LOGIN");
  assert.equal(stuck[0].arm, "vendor");
  assert.equal(stuck[0].project, "Sharma Wedding");
});

test("a failure shown on a Settings screen has no phone number left in it", () => {
  // What the WhatsApp library says carries a jid, which is a number, and this panel is read by
  // anybody with Shoot Crew Notice Read.
  const { plainly } = projectSender;
  assert.equal(plainly({ message: "send to 919876500011@s.whatsapp.net failed." }), "send to a number failed");
  assert.equal(plainly({ message: "919876500011 is not on WhatsApp" }), "a number is not on WhatsApp");
  assert.equal(plainly({}), "could not send");
});

test("rows for shoots now past are dropped, since the owed-list can never reach them again", async () => {
  const { dropPastNotices } = require("../src/modules/settings/shoot-crew-notice/vendorDue");
  let asked = null;
  const count = await dropPastNotices(NOW, { client: { projectShootVendorNotice: { deleteMany: async (args) => { asked = args; return { count: 3 }; } } } });
  assert.equal(count, 3);
  assert.ok(asked.where.production.shoot.dateCreated.lt instanceof Date);
  assert.match(read("src/modules/settings/shoot-crew-notice/vendorSender.js"), /await dropPastNotices\(now, \{ client \}\)/);
});

test("the six wordings exist, take the same placeholders, and are the studio's to rewrite", () => {
  const { TEMPLATE_KEYS } = require("../src/services/messageTemplate");
  const service = require("../src/modules/settings/shoot-crew-notice/service");
  const keys = ["VENDOR_SHOOT_CONFIRMED", "VENDOR_SHOOT_REMINDER", "VENDOR_SHOOT_DATE_CHANGED", "VENDOR_SHOOT_PLACE_CHANGED", "VENDOR_SHOOT_SERVICE_CHANGED", "VENDOR_SHOOT_REMOVED"];
  for (const key of keys) {
    assert.equal(TEMPLATE_KEYS[key], key);
    assert.ok(service.VENDOR_TEMPLATE_KEYS.includes(key), `${key} is offered on the Templates page`);
    const kind = key.replace("VENDOR_SHOOT_", "");
    assert.ok(vendorSender.DEFAULTS[kind], `${kind} says something until the studio writes it`);
    assert.equal(vendorSender.KINDS[kind], key);
  }
  // Every placeholder a default uses is one the panel documents, so nothing renders as `{...}`.
  const { placeholdersIn } = require("../src/services/messageTemplate");
  for (const [kind, body] of Object.entries(vendorSender.DEFAULTS)) {
    for (const name of placeholdersIn(body)) {
      assert.ok(service.VENDOR_PLACEHOLDERS.includes(name), `${kind} uses {${name}}, which the panel must document`);
    }
  }
});

test("the table, the switch and the activity link ship in the migration, and no seed is needed", () => {
  const migration = read("prisma/migrations/20261103150000_vendor_shoot_notice/migration.sql");
  assert.match(migration, /CREATE TABLE `project_shoot_vendor_notice`/);
  assert.match(migration, /`vendor_enabled` BOOLEAN NOT NULL DEFAULT false/, "off until the studio switches it on");
  assert.match(migration, /ALTER TABLE `whatsapp_activity` ADD COLUMN `vendor_id` INTEGER NULL/);
  assert.match(migration, /DELETE FROM `whatsapp_sender_policy` WHERE `message_key` = 'SHOOT_CREW_NOTICE'/, "a setting that decides nothing is worse than none");
  // The arm answers to the permission the crew arm already has: nothing new to grant.
  const routes = read("src/modules/settings/shoot-crew-notice/routes.js");
  assert.match(routes, /router\.use\(requireModule\("SETTINGS", "Shoot Crew Notice"\)\);/);
  assert.match(routes, /router\.put\("\/vendor\/enabled", controller\.setVendorEnabled\);/);
  assert.doesNotMatch(migration, /INSERT INTO `permission`/, "no new permission, so none to grant");
});
