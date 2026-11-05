const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { crewNoticesDue, digestOf, lastTouchedAt, settledFor, QUIET_MS, DAYS_BEFORE } = require("../src/modules/settings/shoot-crew-notice/due");
const { noticeText, timeWords, valuesFor, DEFAULT_ASSIGNED } = require("../src/modules/settings/shoot-crew-notice/sender");
const { senderPolicyTables } = require("./helpers/senderPolicyFakeDb");

/*
 * Settings → Project Management → Shoot crew notice, in the studio's own words:
 *
 *   - two days before a shoot, everybody given a service on it is told;
 *   - a plan changed afterwards tells only the people whose own part changed - a seat handed over
 *     tells those two and nobody else;
 *   - somebody taken off it is told that instead;
 *   - nothing goes until the plan has been still for thirty minutes, which is also what sends a
 *     plan settled late - inside the two days - half an hour after it is planned.
 */

const NOW = new Date("2026-11-01T09:00:00.000Z");
const QUIET = new Date(NOW.getTime() - QUIET_MS - 1000);
const SHOOT = {
  id: "shoot-1", shootId: "DBS-SID-1", shoot: "Reception", dateCreated: new Date("2026-11-02T00:00:00.000Z"), updatedAt: QUIET,
  eventStartTime: "18:30", eventEndTime: "23:00", sessionTiming: null,
  shootPlace: "Grand Palace Hall", district: "Coimbatore",
  project: { id: "p1", eventId: "DBS-EVT-1", whatsappGroupName: "Anu & Ravi" },
};
const employee = (id, name) => ({ id, employeeName: name, contactNumber: `98400100${id}`, companyGivenNumber: null });
const seat = (employeeId, name, service, role = "LEAD") => ({
  employeeId, role, serviceDefinitionId: service, updatedAt: QUIET,
  serviceDefinition: { name: service }, employee: employeeId ? employee(employeeId, name) : null,
});

/** One planned shoot, its seats and what its crew have been told so far. */
function production({ serviceCrew = [], crewNotices = [], planStatus = null, updatedAt = QUIET, shoot = SHOOT } = {}) {
  return { id: "prod-1", planSubmittedAt: new Date("2026-10-20T00:00:00.000Z"), planStatus, updatedAt, shoot, productionCoordinatorEmployee: { employeeName: "Meena" }, serviceCrew, crewNotices };
}

/** A client whose `findMany` answers with these productions, keeping the `where` it was asked. */
function fakeClient(productions) {
  const asked = [];
  return { asked, projectProduction: { findMany: async (args) => { asked.push(args.where); return productions; } } };
}

const told = (employeeId, digest, name = "Told") => ({ id: `n-${employeeId}`, employeeId, digest, employee: employee(employeeId, name) });
const digestFor = (seats) => digestOf(SHOOT, seats);

test("two days before, everybody given a service is told - once each, with the service they are on", async () => {
  const seats = [seat(1, "Asha", "Candid Photo"), seat(2, "Ravi", "Traditional Video")];
  const due = await crewNoticesDue(NOW, { client: fakeClient([production({ serviceCrew: seats })]) });
  assert.deepEqual(due.map((item) => [item.kind, item.employee.id, item.services]), [["ASSIGNED", 1, "Candid Photo"], ["ASSIGNED", 2, "Traditional Video"]]);
});

test("somebody already told the same thing is not told again", async () => {
  const seats = [seat(1, "Asha", "Candid Photo"), seat(2, "Ravi", "Traditional Video")];
  const notices = seats.map((one) => told(one.employeeId, digestFor([one])));
  assert.deepEqual(await crewNoticesDue(NOW, { client: fakeClient([production({ serviceCrew: seats, crewNotices: notices })]) }), []);
});

test("a seat handed over tells those two and nobody else", async () => {
  const before = [seat(1, "Asha", "Candid Photo"), seat(2, "Ravi", "Traditional Video")];
  const after = [seat(1, "Asha", "Candid Photo"), seat(3, "Divya", "Traditional Video")];
  const notices = before.map((one) => told(one.employeeId, digestFor([one]), one.employee.employeeName));
  const due = await crewNoticesDue(NOW, { client: fakeClient([production({ serviceCrew: after, crewNotices: notices })]) });
  assert.deepEqual(due.map((item) => [item.kind, item.employee.id]), [["ASSIGNED", 3], ["REMOVED", 2]], "the new one and the one taken off; Asha is left alone");
  assert.equal(due.find((item) => item.kind === "REMOVED").notice.id, "n-2", "the row to drop once it has gone");
});

test("the shoot moved or re-venued is everybody's change, so everybody on it is told again", async () => {
  const seats = [seat(1, "Asha", "Candid Photo"), seat(2, "Ravi", "Traditional Video")];
  const notices = seats.map((one) => told(one.employeeId, digestFor([one])));
  const moved = { ...SHOOT, shootPlace: "Sea View Lawn" };
  const due = await crewNoticesDue(NOW, { client: fakeClient([production({ serviceCrew: seats, crewNotices: notices, shoot: moved })]) });
  assert.deepEqual(due.map((item) => item.employee.id), [1, 2]);
});

test("a change of their service, and a second service, each read as a change; the plan's other edits do not", () => {
  const one = seat(1, "Asha", "Candid Photo");
  const base = digestFor([one]);
  assert.notEqual(base, digestFor([seat(1, "Asha", "Drone")]), "a different service");
  assert.notEqual(base, digestFor([one, seat(1, "Asha", "Drone", "ASSISTANT")]), "a second service of their own");
  assert.equal(base, digestFor([{ ...one, updatedAt: new Date() }]), "the seat merely saved again is not a change");
  assert.notEqual(base, digestOf({ ...SHOOT, eventStartTime: "17:00" }, [one]), "the shoot's time");
  assert.notEqual(base, digestOf({ ...SHOOT, dateCreated: new Date("2026-11-03T00:00:00.000Z") }, [one]), "the shoot's day");
});

test("nothing goes until the plan has been still for thirty minutes - the plan's, its seats' or the shoot's own edit restarts it", async () => {
  const justNow = new Date(NOW.getTime() - 60 * 1000);
  const seats = [seat(1, "Asha", "Candid Photo")];
  const quiet = production({ serviceCrew: seats });
  assert.equal((await crewNoticesDue(NOW, { client: fakeClient([quiet]) })).length, 1);
  for (const busy of [
    production({ serviceCrew: seats, updatedAt: justNow }),
    production({ serviceCrew: [{ ...seats[0], updatedAt: justNow }] }),
    production({ serviceCrew: seats, shoot: { ...SHOOT, updatedAt: justNow } }),
  ]) {
    assert.deepEqual(await crewNoticesDue(NOW, { client: fakeClient([busy]) }), [], "edited a minute ago: it waits");
  }
  assert.equal(lastTouchedAt(production({ serviceCrew: [{ ...seats[0], updatedAt: justNow }] })).getTime(), justNow.getTime());
  assert.equal(settledFor(quiet, NOW, QUIET_MS), true);
});

test("a plan still being settled - Hold, Rejected or waiting on the client - tells nobody", async () => {
  for (const planStatus of ["HOLD", "REJECTED", "WCR"]) {
    const client = fakeClient([production({ serviceCrew: [seat(1, "Asha", "Candid Photo")], planStatus })]);
    assert.deepEqual(await crewNoticesDue(NOW, { client }), [], `${planStatus} waits`);
  }
});

test("only a planned shoot of a live project, from today to two days out, is even looked at", async () => {
  const client = fakeClient([]);
  await crewNoticesDue(NOW, { client });
  const where = client.asked[0];
  assert.deepEqual(where.planSubmittedAt, { not: null }, "a plan that has been submitted");
  assert.equal(where.shoot.deletedAt, null);
  assert.equal(where.shoot.project.deletedAt, null);
  assert.equal(where.shoot.dateCreated.gte.toISOString(), "2026-11-01T00:00:00.000Z", "from the start of today - a shoot already past is left alone");
  assert.equal(where.shoot.dateCreated.lt.toISOString(), "2026-11-04T00:00:00.000Z", `through the end of the day ${DAYS_BEFORE} days out`);
});

test("a vendor's seat, and a service nobody is on, carry nobody to tell", async () => {
  const seats = [seat(null, null, "Drone"), { ...seat(null, null, "Album"), vendorId: 5 }, seat(1, "Asha", "Candid Photo")];
  const due = await crewNoticesDue(NOW, { client: fakeClient([production({ serviceCrew: seats })]) });
  assert.deepEqual(due.map((item) => item.employee.id), [1]);
});

test("somebody on two services of one shoot gets one message naming both", async () => {
  const seats = [seat(1, "Asha", "Candid Photo"), seat(1, "Asha", "Drone", "ASSISTANT")];
  const due = await crewNoticesDue(NOW, { client: fakeClient([production({ serviceCrew: seats })]) });
  assert.equal(due.length, 1);
  assert.equal(due[0].services, "Candid Photo, Drone");
  assert.equal(due[0].serviceDefinitionId, null, "two services, so the row names neither");
});

test("the message says what the shoot is, when, where and their service", () => {
  const item = { kind: "ASSIGNED", shoot: SHOOT, project: SHOOT.project, employee: employee(1, "Asha"), services: "Candid Photo", coordinator: "Meena" };
  const values = valuesFor(item);
  assert.equal(values.date, "02 Nov 2026");
  assert.equal(values.day, "Monday");
  assert.equal(values.time, "6:30 pm to 11:00 pm");
  assert.equal(values.place, "Grand Palace Hall");
  assert.equal(values.district, "Coimbatore");
  assert.equal(values.service, "Candid Photo");
  assert.match(noticeText(item, {}), /^Hi Asha, you are on Reception for Anu & Ravi on 02 Nov 2026 \(Monday\) at 6:30 pm to 11:00 pm, Grand Palace Hall\. Your service: Candid Photo\.$/);
  assert.equal(timeWords({ sessionTiming: "8-10 Hours (Full)" }), "8-10 Hours (Full)", "a shoot with no clock says its session instead");
  assert.match(DEFAULT_ASSIGNED, /\{employee name\}/);
});

test("each message goes from the project's own Pre-Production Coordinator and nobody else, the person's claim put back when it did not go", () => {
  // Who that is, and the five ways they can be unable to send, is `projectSender`'s own test.
  const source = read("src/modules/settings/shoot-crew-notice/sender.js");
  assert.match(source, /projectSender\.resolve\(project, projectSender\.ROLES\.PRE_PRODUCTION_COORDINATOR/, "the project decides, not a setting");
  assert.match(source, /const sender = await senderFor\(item\.project\);\n\s*if \(!sender\.ok\) \{ trouble\.push/, "a project that cannot send waits, and says why");
  assert.match(source, /const delivery = await projectSender\.sendFrom\(sender, /);
  assert.match(source, /if \(delivery\.outcome !== "sent"\) \{\n\s*\/\/ [^\n]*\n\s*\/\/ [^\n]*\n\s*await forget\(item, before, \{ client \}\);/);
  // One answer per project, so four people waiting on one project ask once.
  assert.match(source, /if \(!senders\.has\(key\)\)/);
  // And no fallback: a crew member never hears about a shoot from somebody else's number.
  assert.doesNotMatch(source, /senderPolicy|trySenders|Fallback|Rotation|pickSender/);
});

test("it is off until it is switched on, the wordings ship with it, and the permission is Super Admin's alone", () => {
  const migration = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261031160000_shoot_crew_notice/migration.sql"), "utf8");
  assert.match(migration, /`enabled` BOOLEAN NOT NULL DEFAULT false/);
  for (const key of ["SHOOT_CREW_ASSIGNED", "SHOOT_CREW_REMOVED"]) {
    assert.match(migration, new RegExp(`WHERE NOT EXISTS \\(SELECT 1 FROM \`message_template\` WHERE \`key\` = '${key}'\\)`), `${key} is inserted only where the studio has none`);
  }
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.doesNotMatch(migration, /`role`\.`name` IN|'BRANCH_ADMIN'/, "no other role is granted it");
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/settings/shoot-crew-notice/routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\);/);
  assert.match(routes, /router\.use\(requireModule\("SETTINGS", "Shoot Crew Notice"\)\);/);
  const catalogue = require("../prisma/seeds/permission-catalogue");
  assert.ok((catalogue.PERMISSIONS || catalogue).some((row) => row.module === "SETTINGS" && row.feature === "Shoot Crew Notice"));
});

/*
 * The paths that only go wrong when something else does: two sweeps at once, a message that did not
 * go, and a plan changed back to what it was.
 */

const { remember, forget, dropNotice } = require("../src/modules/settings/shoot-crew-notice/sender");
const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/** A client that records the writes made to `project_shoot_crew_notice`, answering as told. */
function noticeClient({ updated = 1, created = null } = {}) {
  const writes = [];
  return {
    writes,
    projectShootCrewNotice: {
      updateMany: async (args) => { writes.push(["updateMany", args]); return { count: updated }; },
      update: async (args) => { writes.push(["update", args]); return {}; },
      create: async (args) => { writes.push(["create", args]); if (created) throw created; return {}; },
      deleteMany: async (args) => { writes.push(["deleteMany", args]); return { count: 1 }; },
      delete: async (args) => { writes.push(["delete", args]); return {}; },
    },
  };
}

const item = (kind, extra = {}) => ({ kind, production: { id: "prod-1" }, employee: { id: 7 }, shoot: { id: "shoot-1" }, digest: "new-digest", serviceDefinitionId: "svc-1", ...extra });
const row = { id: "n-7", digest: "old-digest", serviceDefinitionId: "svc-old", sentAt: new Date("2026-10-30T10:00:00.000Z") };

test("a person is claimed before they are told, so two sweeps at once tell them once", async () => {
  const mine = noticeClient({ updated: 1 });
  assert.equal(await remember(item("ASSIGNED"), row, { client: mine }), true);
  const [[, args]] = mine.writes;
  assert.deepEqual(args.where, { id: "n-7", digest: "old-digest" }, "changed only while it still holds what this sweep read");
  assert.equal(args.data.digest, "new-digest");

  const theirs = noticeClient({ updated: 0 });
  assert.equal(await remember(item("ASSIGNED"), row, { client: theirs }), false, "another sweep got there first: this one sends nothing");
});

test("somebody never told before is claimed by the row's own uniqueness", async () => {
  const fresh = noticeClient();
  assert.equal(await remember(item("ASSIGNED"), null, { client: fresh }), true);
  assert.equal(fresh.writes[0][0], "create");
  const clash = noticeClient({ created: Object.assign(new Error("unique"), { code: "P2002" }) });
  assert.equal(await remember(item("ASSIGNED"), null, { client: clash }), false, "created by another sweep between the read and the write");
  await assert.rejects(remember(item("ASSIGNED"), null, { client: noticeClient({ created: new Error("database down") }) }), /database down/, "anything else is a real failure");
});

test("a removal is dropped after it has gone, never before - the row is what makes it owed", async () => {
  const client = noticeClient();
  assert.equal(await remember(item("REMOVED"), row, { client }), true);
  assert.deepEqual(client.writes, [], "nothing is written before the send");
  await dropNotice({ ...item("REMOVED"), notice: row }, { client });
  assert.deepEqual(client.writes, [["delete", { where: { id: "n-7" } }]]);
  assert.equal(await remember(item("REMOVED"), null, { client }), false, "no row, nothing to tell them about");
});

test("a message that certainly did not go puts the row back exactly as it was", async () => {
  const client = noticeClient();
  await forget(item("ASSIGNED"), row, { client });
  assert.deepEqual(client.writes, [["update", { where: { id: "n-7" }, data: { digest: "old-digest", serviceDefinitionId: "svc-old", sentAt: row.sentAt } }]], "every field remember wrote, not only the digest");

  const fresh = noticeClient();
  await forget(item("ASSIGNED"), null, { client: fresh });
  assert.deepEqual(fresh.writes[0], ["deleteMany", { where: { productionId: "prod-1", employeeId: 7 } }], "told for the first time: the row goes again");

  const removed = noticeClient();
  await forget(item("REMOVED"), row, { client: removed });
  assert.deepEqual(removed.writes, [], "nothing was written for a removal, so there is nothing to put back");
});

test("told A, then B, then A again is a third message - the log key is the move, not where it lands", () => {
  const source = read("src/modules/settings/shoot-crew-notice/sender.js");
  assert.match(source, /logicalKey: `shoot-crew:\$\{item\.production\.id\}:\$\{item\.employee\.id\}:\$\{item\.kind\}:\$\{before\?\.digest \|\| "new"\}>/);
  // A duplicate the log refuses is not counted as one sent, and every attempt is paced and counted.
  assert.match(source, /if \(!delivery\.result\?\.duplicate\) sent \+= 1;/);
  assert.match(source, /if \(tried >= MAX_PER_TRY\)/);
  assert.match(source, /if \(tried\) await pause\(\);\n\s*tried \+= 1;/);
  // One sweep at a time across processes, claimed the way the payment reminder claims its try.
  assert.match(source, /shootCrewNoticeSettings\.updateMany\(\{\n\s*where: \{ id: settings\.SETTINGS_ID, OR: \[\{ lastAttemptAt: null \}/);
  assert.match(source, /if \(!mine\) return "nothing-to-do";/);
});

test("each switch refuses what is not an answer, and there is no sender to choose any more", async () => {
  const service = require("../src/modules/settings/shoot-crew-notice/service");
  const client = {
    shootCrewNoticeSettings: { findUnique: async () => ({ enabled: false, vendorEnabled: false }), upsert: async () => ({}) },
    user: { findMany: async () => [], findFirst: async () => null },
    whatsAppActivity: { findFirst: async () => null },
    projectProduction: { findMany: async () => [] },
    projectShootVendorNotice: { findMany: async () => [], create: async () => ({}) },
  };
  await assert.rejects(service.setEnabled("false", { client }), (error) => error.status === 400, "a string is not on or off");
  await assert.rejects(service.setVendorEnabled("true", { client }), (error) => error.status === 400, "nor on the vendor arm");
  /*
   * Switching it on is no longer refused for want of a sender: who sends it is each project's own
   * Pre-Production Coordinator, so there is nothing to choose first. A project whose coordinator
   * cannot send has its messages wait, and says so in `waiting`.
   */
  assert.ok(await service.setEnabled(true, { client }));
  assert.equal(typeof service.setSenders, "undefined", "the sender picker is gone, not left deciding nothing");
});
