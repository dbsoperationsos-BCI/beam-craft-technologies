const test = require("node:test");
const assert = require("node:assert/strict");
const welcome = require("../src/modules/settings/automatic-whatsapp/newLeadWelcome");

/*
 * New Lead Welcome worded per vertical: a lead is sent its vertical's office-time wording inside the
 * attendance shift on a working day, its after-hours wording outside it (a weekly off and a holiday
 * included), and the New Lead Welcome template where its vertical has nothing written for the moment.
 * The database is stood in for; what is pinned is which template is chosen and kept on the queued row.
 */

// The studio's clock is India: 06:00 UTC is 11:30 am, 16:00 UTC is 9:30 pm. 28 Oct 2026 is a Wednesday.
const at = (iso) => new Date(iso);
const WEDNESDAY_MORNING = at("2026-10-28T06:00:00.000Z");
const WEDNESDAY_NIGHT = at("2026-10-28T16:00:00.000Z");
const SUNDAY_MORNING = at("2026-11-01T06:00:00.000Z");

const VERTICAL = 7;
const office = welcome.verticalTemplateKey(VERTICAL, welcome.SLOTS.OFFICE);
const afterHours = welcome.verticalTemplateKey(VERTICAL, welcome.SLOTS.AFTER_HOURS);

function clientWith({ templates = {}, holidays = [], verticalId = VERTICAL, branchId = null } = {}) {
  return {
    attendanceSettings: { upsert: async () => ({ shiftStart: "09:30", shiftEnd: "18:30", weeklyOffDays: "0" }) },
    attendanceHoliday: { findMany: async () => holidays },
    messageTemplate: { findUnique: async ({ where }) => (templates[where.key] ? { key: where.key, body: templates[where.key] } : null) },
    salesCrmLead: { findFirst: async () => ({ verticalId, branchId }) },
    hrmSettings: { findUnique: async () => ({ leadWelcomeEnabled: true }), upsert: async () => {} },
  };
}

test("the keys name the vertical by its id and the moment", () => {
  assert.equal(office, "CRM_LEAD_WELCOME_V7_OFFICE");
  assert.equal(afterHours, "CRM_LEAD_WELCOME_V7_AFTER_HOURS");
  assert.match(afterHours, /^[A-Z][A-Z0-9_]{1,59}$/, "a key the template editor will save");
});

test("office time is inside the attendance shift on a working day; outside it, a weekly off and a holiday are after hours", async () => {
  assert.equal(await welcome.officeSlot(WEDNESDAY_MORNING, clientWith()), "OFFICE");
  assert.equal(await welcome.officeSlot(WEDNESDAY_NIGHT, clientWith()), "AFTER_HOURS");
  assert.equal(await welcome.officeSlot(SUNDAY_MORNING, clientWith()), "AFTER_HOURS", "Sunday is the weekly off");
  const holiday = [{ id: 1, name: "Diwali", holidayDate: new Date("2026-10-28T00:00:00.000Z"), branchId: null, branchIds: null, isActive: true }];
  assert.equal(await welcome.officeSlot(WEDNESDAY_MORNING, clientWith({ holidays: holiday })), "AFTER_HOURS");
});

test("a lead is sent its vertical's wording for the moment it arrived", async () => {
  const client = clientWith({ templates: { [office]: "Hi {client name}, office", [afterHours]: "Hi {client name}, after hours" } });
  const lead = { id: "ENQ-1" };
  assert.equal(await welcome.templateKeyFor(lead, WEDNESDAY_MORNING, client), office);
  assert.equal(await welcome.templateKeyFor(lead, WEDNESDAY_NIGHT, client), afterHours);
});

test("a vertical with nothing written for the moment, and a lead with no vertical, have no wording to send", async () => {
  const onlyOffice = clientWith({ templates: { [office]: "Hi, office" } });
  assert.equal(await welcome.templateKeyFor({ id: "ENQ-1" }, WEDNESDAY_NIGHT, onlyOffice), null);
  assert.equal(await welcome.templateKeyFor({ id: "ENQ-2" }, WEDNESDAY_MORNING, clientWith({ verticalId: null, templates: { [office]: "x" } })), null);
});

test("such a lead is not messaged, and is on the log as Failed with why, to message by hand", async () => {
  const queued = [];
  const failures = [];
  const result = await welcome.afterLeadCreated({
    lead: { id: "ENQ-1", name: "Arun", phone: "9876543210", crm: "Priya", createdDate: "2026-10-28" },
    now: WEDNESDAY_MORNING, client: clientWith({ verticalId: null }),
    activity: { queue: async (context) => { queued.push(context); return { created: true }; }, recordFailure: async (context, error) => { failures.push({ context, error }); } },
    kick: () => {}, resolveSender: async () => ({ userId: 70, name: "Priya Raman" }),
  });
  assert.equal(result, "no-wording");
  assert.equal(queued.length, 0);
  assert.equal(failures[0].context.trigger, "CRM_LEAD_WELCOME");
  assert.match(failures[0].error.message, /No welcome message is written for this lead's vertical/);
});

test("the chosen template is kept on the queued row, and its wording is what is queued", async () => {
  const queued = [];
  const client = clientWith({ templates: { [afterHours]: "Hi {client name}, we are closed now - {sender name} will call you first thing." } });
  const result = await welcome.afterLeadCreated({
    lead: { id: "ENQ-1", name: "Arun", phone: "9876543210", crm: "Priya", createdDate: "2026-10-28" },
    now: WEDNESDAY_NIGHT, client,
    activity: { queue: async (context) => { queued.push(context); return { created: true }; } },
    kick: () => {}, resolveSender: async () => ({ userId: 70, name: "Priya Raman" }),
  });
  assert.equal(result, "queued");
  assert.equal(queued[0].templateKey, afterHours);
  assert.equal(queued[0].body, "Hi Arun, we are closed now - Priya Raman will call you first thing.");
});

test("a holiday of the lead's own branch is after hours for that lead", async () => {
  const branchHoliday = [{ id: 2, name: "Local festival", holidayDate: new Date("2026-10-28T00:00:00.000Z"), branches: [{ branchId: 3 }], isActive: true }];
  const templates = { [office]: "office", [afterHours]: "after hours" };
  assert.equal(await welcome.templateKeyFor({ id: "ENQ-1" }, WEDNESDAY_MORNING, clientWith({ templates, holidays: branchHoliday, branchId: 3 })), afterHours);
  assert.equal(await welcome.templateKeyFor({ id: "ENQ-1" }, WEDNESDAY_MORNING, clientWith({ templates, holidays: branchHoliday, branchId: 4 })), office, "another branch's holiday is not this lead's");
});

test("a wording that cannot be worked out is not guessed at: the lead is on the log to message by hand", async () => {
  const queued = [];
  const failures = [];
  const client = { ...clientWith(), salesCrmLead: { findFirst: async () => { throw new Error("database down"); } } };
  const result = await welcome.afterLeadCreated({
    lead: { id: "ENQ-1", name: "Arun", phone: "9876543210", crm: "Priya", createdDate: "2026-10-28" },
    now: WEDNESDAY_MORNING, client,
    activity: { queue: async (context) => { queued.push(context); return { created: true }; }, recordFailure: async (context, error) => { failures.push(error); } },
    kick: () => {}, resolveSender: async () => ({ userId: 70, name: "Priya Raman" }),
  });
  assert.equal(result, "no-wording");
  assert.equal(queued.length, 0);
  assert.equal(failures.length, 1);
});

test("a vertical's wording taken away after the lead came in is not sent in its place", async () => {
  const tracked = [];
  const activity = {
    expirePending: async () => 0,
    listPending: async () => [{ logicalKey: "crm-lead-welcome:ENQ-1", crmLeadId: "ENQ-1", recipientAddress: "9876543210", templateKey: office, body: "queued" }],
    track: async (context, send) => { try { return await send(); } catch (error) { tracked.push(error); throw error; } },
  };
  const client = { ...clientWith({ templates: {} }), salesCrmLead: { findFirst: async () => ({ enquiryId: "ENQ-1", name: "Arun", phone: "9876543210", crm: "Priya" }) }, whatsAppActivity: { count: async () => 0 } };
  const result = await welcome.runOnce({
    now: WEDNESDAY_MORNING, client, activity,
    sessions: { sendMessageToLead: async () => { throw new Error("must not send"); } },
    switches: { isChatEnabled: async () => true, isChatEnabledForUser: async () => true },
    resolveSender: async () => ({ userId: 70, name: "Priya Raman" }),
  });
  assert.deepEqual(result, { sent: 0, failed: 1 });
  assert.match(tracked[0].message, /no longer written/);
});

test("the wording can say when the lead came in, its vertical, branch and enquiry, on the studio's clock", () => {
  const values = welcome.valuesFor({ id: "DBS-ENQ-9", name: "Arun", vertical: "Dum Dum", assignedBranch: "Erode TN" }, "Priya Raman", at("2026-10-28T13:15:00.000Z"));
  assert.deepEqual(values, {
    "client name": "Arun", "sender name": "Priya Raman",
    greeting: "Good evening", date: "28 Oct 2026", day: "Wednesday", time: "6:45 pm",
    vertical: "Dum Dum", branch: "Erode TN", "enquiry id": "DBS-ENQ-9",
  });
  assert.equal(welcome.valuesFor({ name: "Arun" }, "Priya", at("2026-10-28T03:00:00.000Z")).greeting, "Good morning", "8:30 am");
  assert.deepEqual(welcome.UNWORDED_VERTICAL_CODES, ["GENERAL", "TEAM_33"]);
});
