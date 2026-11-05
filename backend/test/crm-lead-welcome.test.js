const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const welcome = require("../src/modules/settings/automatic-whatsapp/newLeadWelcome");

/*
 * Automatic WhatsApp Message → New Lead Welcome: a sheet lead is greeted from its owner's WhatsApp.
 * The activity log and the WhatsApp sessions are stood in for: what is pinned is which leads are
 * queued, who each goes from, and that every refusal lands on the log through `track`.
 */

const today = new Date("2026-10-28T06:00:00.000Z");
/*
 * Only a vertical's own wording is sent, so the lead here is in vertical 1, which is worded for office
 * time and after hours, and the studio's attendance shift is what decides which.
 */
const VERTICAL_WORDING = "Hi {client name},\n\nI'm {sender name}, and I'll be taking care of your enquiry.";
const settingsClient = (enabled, extra = {}) => ({
  hrmSettings: { findUnique: async () => ({ leadWelcomeEnabled: enabled, leadWelcomeLastError: null }), upsert: async () => {} },
  messageTemplate: { findUnique: async ({ where }) => (/^CRM_LEAD_WELCOME_V1_/.test(where.key) ? { key: where.key, body: VERTICAL_WORDING } : null) },
  salesCrmLead: { findFirst: async () => ({ verticalId: 1, branchId: null }) },
  attendanceSettings: { upsert: async () => ({ shiftStart: "09:30", shiftEnd: "18:30", weeklyOffDays: "0" }) },
  attendanceHoliday: { findMany: async () => [] },
  ...extra,
});
const queueing = () => {
  const queued = [];
  return { queued, activity: { queue: async (context) => { queued.push(context); return { created: true }; } } };
};
const owner = async (crm) => (crm === "Priya" ? { userId: 70, name: "Priya Raman" } : { userId: null, name: null });
const lead = { id: "ENQ-1", name: "Arun", phone: "9876543210", crm: "Priya", createdDate: "2026-10-28" };

test("a new sheet lead is queued once, to its number, with the owner's name in the message", async () => {
  const { queued, activity } = queueing();
  let kicked = 0;
  const outcome = await welcome.afterLeadCreated({ lead, now: today, client: settingsClient(true), activity, kick: () => { kicked += 1; }, resolveSender: owner });
  assert.equal(outcome, "queued");
  assert.equal(kicked, 1);
  assert.equal(queued[0].trigger, "CRM_LEAD_WELCOME");
  assert.equal(queued[0].mode, "AUTOMATIC");
  assert.equal(queued[0].logicalKey, "crm-lead-welcome:ENQ-1", "keyed by the lead, so a lead is only ever welcomed once");
  assert.deepEqual(queued[0].links, { crmLeadId: "ENQ-1" });
  assert.deepEqual(queued[0].recipient, { kind: "LEAD", address: "9876543210", name: "Arun" });
  assert.match(queued[0].body, /^Hi Arun,/);
  assert.match(queued[0].body, /I'm Priya Raman/);
});

test("nothing is queued with the switch off, without a number, or for an old enquiry", async () => {
  const cases = [
    [{ client: settingsClient(false) }, "off"],
    [{ client: settingsClient(true), lead: { ...lead, phone: "", whatsappNumber: "" } }, "no-phone"],
    [{ client: settingsClient(true), lead: { ...lead, createdDate: "2026-10-20" } }, "old-enquiry"],
  ];
  for (const [options, expected] of cases) {
    const { queued, activity } = queueing();
    const outcome = await welcome.afterLeadCreated({ lead, now: today, activity, kick: () => {}, resolveSender: owner, ...options });
    assert.equal(outcome, expected);
    assert.equal(queued.length, 0, expected);
  }
  // Yesterday's enquiry still counts as new - a lead in last night's sheet is welcomed this morning.
  assert.equal(welcome.isOldEnquiry("2026-10-27", today), false);
  assert.equal(welcome.isOldEnquiry("2026-10-26", today), true);
  assert.equal(welcome.isOldEnquiry("27/10/2026", today), false, "a date this cannot read is not held against the lead");
});

/** The loop's collaborators: one queued lead, a `track` that records what it was asked and runs the send. */
function loopHarness({ storedLead = { enquiryId: "ENQ-1", name: "Arun", phone: "9876543210", whatsappNumber: "", crm: "Priya" }, connected = true, chatOn = true, sentLastHour = 0 } = {}) {
  const tracked = [];
  const sends = [];
  const activity = {
    expirePending: async () => 0,
    listPending: async () => [{ logicalKey: "crm-lead-welcome:ENQ-1", eventRef: "crm-lead:ENQ-1", crmLeadId: "ENQ-1", recipientAddress: "9876543210", recipientName: "Arun", templateKey: "CRM_LEAD_WELCOME_V1_OFFICE", body: "queued text" }],
    track: async (context, sendFn) => {
      const entry = { context };
      tracked.push(entry);
      try {
        entry.result = await sendFn();
        return entry.result;
      } catch (error) {
        entry.error = error;
        throw error;
      }
    },
  };
  const sessions = {
    sendMessageToLead: async (args) => {
      if (!connected) throw Object.assign(new Error("WhatsApp is not connected."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" });
      sends.push(args);
      return { waMessageId: "wa-1" };
    },
  };
  const switches = { isChatEnabled: async () => chatOn, isChatEnabledForUser: async () => true };
  const client = settingsClient(true, { salesCrmLead: { findFirst: async () => storedLead }, whatsAppActivity: { count: async () => sentLastHour } });
  return { tracked, sends, run: () => welcome.runOnce({ now: today, client, activity, sessions, switches, resolveSender: owner }) };
}

test("the loop sends from the owner's own WhatsApp to the lead, as a lead message", async () => {
  const { tracked, sends, run } = loopHarness();
  assert.deepEqual(await run(), { sent: 1, failed: 0 });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].userId, 70, "from whoever the lead is assigned to");
  assert.equal(sends[0].enquiryId, "ENQ-1", "into the lead's own thread, where the reply will land");
  assert.equal(sends[0].phone, "9876543210");
  assert.equal(tracked[0].context.senderUserId, 70);
  assert.equal(tracked[0].context.requireClaim, true, "never sent without the row's claim");
  assert.equal(tracked[0].context.resendable, true, "a failure can be resent from the log");
});

test("an owner whose WhatsApp is not linked, a lead with no owner, chat switched off: each is a failure on the log", async () => {
  for (const [options, pattern] of [
    [{ connected: false }, /not connected/],
    [{ storedLead: { enquiryId: "ENQ-1", name: "Arun", phone: "9876543210", crm: "Nobody" } }, /Nobody with an active login is assigned/],
    [{ chatOn: false }, /switched off for the studio/],
    [{ sentLastHour: welcome.MAX_PER_SENDER_HOUR }, /already sent 30 welcome messages in the last hour/],
    [{ storedLead: { enquiryId: "ENQ-1", name: "Arun", phone: "12345", crm: "Priya" } }, /not a phone number/],
    [{ storedLead: null }, /deleted/],
  ]) {
    const { tracked, sends, run } = loopHarness(options);
    assert.deepEqual(await run(), { sent: 0, failed: 1 });
    assert.equal(sends.length, 0);
    assert.match(tracked[0].error.message, pattern);
    // A status the log reads as "certainly not sent", so the loop retries it rather than leaving it.
    assert.ok([400, 403, 404, 409, 429].includes(tracked[0].error.status));
  }
});

test("with the switch off the loop sends nothing, but still retires what waited too long", async () => {
  let expired = 0;
  const activity = { expirePending: async () => { expired += 1; return 0; }, listPending: async () => { throw new Error("must not be asked"); } };
  assert.deepEqual(await welcome.runOnce({ now: today, client: settingsClient(false), activity }), { sent: 0, failed: 0, skipped: "off" });
  assert.equal(expired, 1);
});

test("only the Google Sheet sync welcomes a lead, after the lead is written and recorded", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
  const sheets = read("modules", "sales", "crm-leads", "googleSheetsService.js");
  const sync = sheets.slice(sheets.indexOf("async function runGoogleSheetLinkSync("), sheets.indexOf("async function syncGoogleSheetLinkToCrm("));
  assert.match(sync, /recordImportedRow\([\s\S]*?action: "CREATED"[\s\S]*?\.afterLeadCreated\(\{ lead: record\.lead, queuedThisSync: welcomesQueued \}\)\s*\n\s*\.catch\(/);
  // A link's first sync is welcomed like any later one - nothing tells it apart.
  assert.doesNotMatch(sync, /firstSync/);
  assert.equal((sheets.match(/afterLeadCreated/g) || []).length, 1, "the refill rebuild does not welcome anybody");
  for (const file of [["modules", "sales", "crm-leads", "controller.js"], ["modules", "sales", "crm-leads", "csvImportService.js"]]) {
    assert.doesNotMatch(read(...file), /afterLeadCreated|newLeadWelcome/, file.join("/"));
  }
  // Guarded with the rest of Automatic WhatsApp Message: Read to look, Read / Write to switch.
  const routes = read("modules", "settings", "automatic-whatsapp", "routes.js");
  assert.match(routes, /router\.use\(requireModule\("SETTINGS", "Automatic WhatsApp Message"\)\);[\s\S]*router\.put\("\/lead-welcome\/enabled"/);
});

test("a sync that brings in more than the limit welcomes the first ones and logs the rest as Failed", async () => {
  const failures = [];
  const { queued, activity } = queueing();
  activity.recordFailure = async (context, error) => { failures.push({ context, error }); };
  const outcome = await welcome.afterLeadCreated({ lead, now: today, client: settingsClient(true), activity, kick: () => {}, resolveSender: owner, queuedThisSync: welcome.MAX_PER_SYNC });
  assert.equal(outcome, "volume-limit");
  assert.equal(queued.length, 0, "not queued - a burst from one number is how it gets banned");
  assert.equal(failures.length, 1, "but on the log, so somebody can message them by hand");
  assert.equal(failures[0].context.trigger, "CRM_LEAD_WELCOME");
  assert.equal(failures[0].error.status, 429);
  assert.match(failures[0].error.message, /More than 20 new leads arrived in one sync/);
  // Just under the limit is still welcomed.
  assert.equal(await welcome.afterLeadCreated({ lead, now: today, client: settingsClient(true), activity, kick: () => {}, resolveSender: owner, queuedThisSync: welcome.MAX_PER_SYNC - 1 }), "queued");
});

test("the lead's name from the sheet goes out as a name only - one line, no links or formatting, short", () => {
  assert.equal(welcome.safeName("Arun Kumar"), "Arun Kumar");
  assert.equal(welcome.safeName("Arun\nclaim your prize"), "Arun claim your prize");
  assert.equal(welcome.safeName("Arun http://evil.example/x"), "Arun");
  assert.equal(welcome.safeName("Arun www.evil.example"), "Arun");
  assert.equal(welcome.safeName("Arun evil.com/win"), "Arun");
  assert.equal(welcome.safeName("*Arun* _bold_ ~x~ `y`"), "Arun bold x y");
  assert.equal(welcome.safeName("A".repeat(80)).length, 40);
  assert.equal(welcome.safeName("   "), "");
});

test("a number that is not 10 to 15 digits is not queued", async () => {
  for (const phone of ["12345", "abc", "1234567890123456"]) {
    const { queued, activity } = queueing();
    assert.equal(await welcome.afterLeadCreated({ lead: { ...lead, phone }, now: today, client: settingsClient(true), activity, kick: () => {}, resolveSender: owner }), "no-phone", phone);
    assert.equal(queued.length, 0);
  }
  const { activity } = queueing();
  assert.equal(await welcome.afterLeadCreated({ lead: { ...lead, phone: "+91 98765-43210" }, now: today, client: settingsClient(true), activity, kick: () => {}, resolveSender: owner }), "queued");
});
