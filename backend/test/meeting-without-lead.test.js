const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Calendar → Add Meet books a meeting that belongs to no lead. It is seen by whoever booked it, by a
 * guest whose sign-in email is on it, and by a Super Admin - nobody else - and only whoever booked it
 * may cancel it. A lead's own meetings are untouched.
 */

const prisma = require("../src/config/db");
const meetings = require("../src/modules/sales/crm-meetings/service");
const meetingService = require("../src/modules/sales/crm-leads/meetingService");

const ROW = { id: "m1", enquiryId: null, title: "Vendor call", description: null, startAt: new Date("2026-10-15T05:00:00Z"), endAt: new Date("2026-10-15T05:30:00Z"), attendees: JSON.stringify(["Guest@Studio.in"]), status: "SCHEDULED", createdByUserId: 5 };

// Prisma's model methods are assigned over, as the other tests here do, and put back after each.
const originals = {
  findMany: prisma.salesCrmMeeting.findMany, findFirst: prisma.salesCrmMeeting.findFirst,
  leads: prisma.salesCrmLead.findMany, user: prisma.user.findUnique,
};
test.afterEach(() => {
  prisma.salesCrmMeeting.findMany = originals.findMany;
  prisma.salesCrmMeeting.findFirst = originals.findFirst;
  prisma.salesCrmLead.findMany = originals.leads;
  prisma.user.findUnique = originals.user;
});

function stubRows(user) {
  prisma.salesCrmMeeting.findMany = async () => [ROW];
  prisma.salesCrmLead.findMany = async () => [];
  prisma.user.findUnique = async () => user;
}

const seen = async (userId) => (await meetings.listAllMeetings({ reader: { userId, permissions: [] } })).map((row) => row.id);

test("a meeting with no lead is seen by whoever booked it, marked as theirs", async () => {
  stubRows({ email: "booker@studio.in", role: "USER" });
  const [row] = await meetings.listAllMeetings({ reader: { userId: 5, permissions: [] } });
  assert.equal(row.id, "m1");
  assert.equal(row.enquiryId, null);
  assert.equal(row.lead, null);
  assert.equal(row.mine, true);
});

test("by a guest whose email is on it, whatever its case - and not marked as theirs", async () => {
  stubRows({ email: "guest@studio.in", role: "USER" });
  const [row] = await meetings.listAllMeetings({ reader: { userId: 9, permissions: [] } });
  assert.equal(row.mine, false);
});

test("beside a lead's meeting, only the named lead is looked up - never null", async (t) => {
  const asked = [];
  // The lead's own scope is not what is under test: it reaches no lead.
  t.mock.method(require("../src/services/dataScope.service"), "resolve", async () => ({ unlimited: false, where: {} }));
  prisma.salesCrmMeeting.findMany = async () => [ROW, { ...ROW, id: "m2", enquiryId: "EID-1", attendees: null }];
  prisma.salesCrmLead.findMany = async ({ where }) => { if (where.enquiryId?.in) asked.push(where.enquiryId.in); return []; };
  prisma.user.findUnique = async () => ({ email: "booker@studio.in", role: "USER" });
  const rows = await meetings.listAllMeetings({ reader: { userId: 5, permissions: [] } });
  assert.deepEqual(rows.map((row) => row.id), ["m1", "m2"]);
  assert.ok(asked.length && asked.every((list) => !list.includes(null)));
});

test("an invalid body is refused before anything is booked; nobody signed in cancels nothing", async () => {
  const controller = require("../src/modules/sales/crm-meetings/controller");
  const replies = [];
  const res = { status(code) { replies.push(code); return this; }, json(body) { replies.push(body); return this; } };
  await controller.schedule({ user: { id: 5 }, body: { title: "", startAt: "" } }, res);
  assert.equal(replies[0], 400);
  prisma.salesCrmMeeting.findFirst = async () => { throw new Error("must not be asked"); };
  await assert.rejects(meetingService.cancelMeeting({ id: "m1", enquiryId: null, userId: null }), { status: 404 });
});

test("by a Super Admin, and by nobody else", async () => {
  stubRows({ email: "admin@studio.in", role: "SUPER_ADMIN" });
  assert.deepEqual(await seen(1), ["m1"]);
  stubRows({ email: "someone@studio.in", role: "USER" });
  assert.deepEqual(await seen(7), []);
});

test("only whoever booked it may cancel it; a lead's meeting is still found through its lead", async () => {
  const asked = [];
  prisma.salesCrmMeeting.findFirst = async ({ where }) => { asked.push(where); return null; };
  await assert.rejects(meetingService.cancelMeeting({ id: "m1", enquiryId: null, userId: 9 }), { status: 404 });
  await assert.rejects(meetingService.cancelMeeting({ id: "m2", enquiryId: "EID-1", userId: 9 }), { status: 404 });
  assert.deepEqual(asked, [{ id: "m1", enquiryId: null, createdByUserId: 9 }, { id: "m2", enquiryId: "EID-1" }]);
});

test("booked and cancelled at /api/sales/crm-meetings, under CRM Leads, checked by the lead meeting's own schema", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
  const routes = read("src", "modules", "sales", "crm-meetings", "routes.js");
  assert.match(routes, /router\.use\(requireModule\("SALES", "CRM Leads"\)\);[\s\S]*router\.post\("\/", schedule\);\s*router\.delete\("\/:id", cancel\);/);
  assert.doesNotMatch(routes, /\/leads/);
  const controller = read("src", "modules", "sales", "crm-meetings", "controller.js");
  assert.match(controller, /const \{ cancelMeeting, createMeeting, meetingSchema \} = require\("\.\.\/crm-leads\/meetingService"\);/);
  assert.match(controller, /createMeeting\(\{ \.\.\.parsed\.data, enquiryId: null, userId: req\.user\?\.id \}\)/);
  assert.match(read("prisma", "migrations", "20261015090000_meeting_without_lead", "migration.sql"), /MODIFY `enquiry_id` VARCHAR\(100\) NULL;/);
});
