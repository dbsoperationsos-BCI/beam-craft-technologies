const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const switches = require("../src/services/messageTemplateSwitches");

/*
 * Settings → Templates' ON / OFF for each message sent over WhatsApp (`message_template_switch`): a
 * message nobody switched is ON; OFF refuses its Send WhatsApp on the server and stops every
 * automatic send of it.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

function fakeClient(rows = []) {
  const state = new Map(rows.map((row) => [row.key, { ...row }]));
  return {
    state,
    messageTemplateSwitch: {
      findMany: async () => [...state.values()],
      findUnique: async ({ where }) => state.get(where.key) || null,
      upsert: async ({ where, update, create }) => { state.set(where.key, { ...(state.get(where.key) || create), ...(state.has(where.key) ? update : {}) }); },
    },
  };
}

test("a message nobody has switched is ON; a row says OFF", async () => {
  const client = fakeClient([{ key: "CASH_RECEIVED", enabled: false }]);
  const all = await switches.listSwitches(client);
  assert.equal(all.CASH_RECEIVED, false);
  assert.equal(all.LOGIN_CREDENTIALS, true);
  assert.equal(Object.keys(all).length, Object.keys(switches.SWITCHES).length);
  assert.equal(await switches.isEnabled("LOGIN_CREDENTIALS", client), true);
  // Anything that is not a switch is never held back.
  assert.equal(await switches.isEnabled("ATTENDANCE_DAILY_REPORT", client), true);
});

test("switching writes the row; only a known switch, and only a yes or no", async () => {
  const client = fakeClient();
  const after = await switches.setEnabled("PAYMENT_DUE_REMINDER", false, 7, client);
  assert.equal(after.PAYMENT_DUE_REMINDER, false);
  assert.deepEqual(client.state.get("PAYMENT_DUE_REMINDER"), { key: "PAYMENT_DUE_REMINDER", enabled: false, updatedByUserId: 7 });
  await assert.rejects(switches.setEnabled("NOT_A_SWITCH", false, 7, client), (error) => error.status === 404);
  await assert.rejects(switches.setEnabled("CASH_RECEIVED", "no", 7, client), (error) => error.status === 400);
});

test("an OFF message is refused with 409 TEMPLATE_SWITCHED_OFF, saying where it is switched", async () => {
  const client = fakeClient([{ key: "CRD_DOCUMENT_LINK", enabled: false }]);
  await assert.rejects(switches.assertEnabled("CRD_DOCUMENT_LINK", client), (error) => error.status === 409 && error.code === "TEMPLATE_SWITCHED_OFF" && /CRD Document Link is switched off under Settings → Templates/.test(error.message));
});

test("every manual Send WhatsApp is refused on the server while its message is OFF", () => {
  assert.match(read("src", "modules", "accounts", "cash-entries", "routes.js"), /router\.post\("\/:id\/whatsapp-group", requireTemplateOn\("CASH_RECEIVED"\)/);
  assert.match(read("src", "modules", "sales", "crd-documents", "routes.js"), /router\.post\("\/:projectId\/whatsapp-group", requireTemplateOn\("CRD_DOCUMENT_LINK"\)/);
  const hrm = read("src", "modules", "hrm", "master-data", "routes.js");
  assert.match(hrm, /send-credentials-whatsapp", requireTemplateOn\("LOGIN_CREDENTIALS"\)/);
  assert.match(hrm, /onboarding-invites\/:id\/send-whatsapp", requireTemplateOn\("EMPLOYEE_ONBOARDING_INVITE"\)/);
  assert.match(read("src", "modules", "hrm", "interview", "inviteRoutes.js"), /"\/:id\/send-whatsapp", requireTemplateOn\("INTERVIEW_APPLICATION_INVITE"\)/);
  assert.match(read("src", "modules", "sales", "projects", "routes.js"), /client-login\/whatsapp", salesManager, requireTemplateOn\("CLIENT_LOGIN_CREDENTIALS"\)/);
});

test("the switches are read by the screens that send, and switched by whoever rewords the message", () => {
  const routes = read("src", "modules", "settings", "message-templates", "routes.js");
  assert.match(routes, /router\.get\("\/switches", maySeeSwitches, listSwitches\);/);
  assert.match(routes, /router\.put\("\/switches\/:key", maySwitch, setSwitch\);/);
  assert.ok(routes.indexOf('router.get("/switches"') < routes.indexOf('router.get("/:key"'), "above /:key");
  assert.match(routes, /WISH_SWITCHES\.has\(String\(req\.params\.key \|\| ""\)\)\s*\? checkPermission\("SETTINGS", "Wishes", "READ_WRITE"\)\s*: maySettings/);
  for (const feature of ['"HRM", feature: "Interview"', '"SALES", feature: "Sales Manager"', '"SETTINGS", feature: "Wishes"']) assert.ok(routes.includes(feature), feature);
});

test("an automatic send stops while its message is OFF", async () => {
  const off = async () => false;
  // Cash Received to the project's group, and the payment reminders: nothing read, claimed or sent.
  assert.equal(await require("../src/modules/settings/payment-reminder/receivedMessage").sendReceivedMessage("entry", "Paid", { isMessageOn: off, client: {} }), "switched-off");
  assert.equal(await require("../src/modules/settings/payment-reminder/sender").runRemindersOnce({ isMessageOn: off, client: {} }), "switched-off");
  // A production step claims no message, so none is sent or offered for retry.
  let written = false;
  const tx = { projectProductionMessage: { upsert: async () => { written = true; } } };
  assert.equal(await require("../src/modules/project-management/production/messages").claimSending(tx, "p1", "SHOOT_COMPLETED", { isMessageOn: off }), false);
  assert.equal(written, false);
  assert.equal(await require("../src/modules/project-management/production/messages").claimSending(tx, "p1", "SHOOT_COMPLETED", { isMessageOn: async () => true }), true);
  /*
   * The crew sender reads **this branch's** switch - the `enabled` column each wording carries on
   * Settings → Templates (`isMessageEnabled`) - rather than the switch table, and a message skipped
   * while it was off stays **owed**: the row is left untouched, so switching it back on still sends
   * it. Develop settled such a change instead (`dropNotice` / `remember`) so nothing was owed later;
   * that reading was superseded when the two branches were merged, and this is the kept one.
   */
  const crew = read("src", "modules", "settings", "shoot-crew-notice", "sender.js");
  assert.match(crew, /isMessageEnabled\(TEMPLATE_KEYS\.SHOOT_CREW_ASSIGNED, client\)/);
  assert.match(crew, /isMessageEnabled\(TEMPLATE_KEYS\.SHOOT_CREW_REMOVED, client\)/);
  assert.match(crew, /const sending = \{ ASSIGNED: sendsAssigned, REMOVED: sendsRemoved \};/);
  assert.match(crew, /if \(!sending\[item\.kind\]\) continue;/);
  assert.match(read("src", "modules", "settings", "wishes", "sender.js"), /\.filter\(\(person\) => !kindsOff\.has\(person\.kind\)\)/);
  // A production step's retry is refused in this branch's own words, naming the message.
  assert.match(read("src", "modules", "project-management", "production", "messages.js"), /is switched off on Settings → Templates, so it cannot be sent\./);
  assert.deepEqual(switches.WISH_SWITCH_OF, { BIRTHDAY: "BIRTHDAY_WISH", WEDDING_ANNIVERSARY: "WEDDING_ANNIVERSARY_WISH", WORK_ANNIVERSARY: "WORK_ANNIVERSARY_WISH" });
});

test("the migration adds one empty table and changes no existing row", () => {
  const sql = read("prisma", "migrations", "20261103160000_message_template_switches", "migration.sql");
  assert.match(sql, /CREATE TABLE `message_template_switch`/);
  assert.match(sql, /`enabled` BOOLEAN NOT NULL DEFAULT true/);
  // No statement writes or removes data (the key's own ON DELETE / ON UPDATE aside).
  assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE|DROP|INSERT)\b/m);
});

test("the offboarding messages are sent on WhatsApp only in the form's own state, and only while ON", () => {
  const controller = read("src", "modules", "hrm", "offboarding-invites", "controller.js");
  const { WHATSAPP_MESSAGES } = require("../src/modules/hrm/offboarding-invites/controller");
  assert.deepEqual(Object.fromEntries(Object.entries(WHATSAPP_MESSAGES).map(([kind, entry]) => [kind, entry.key])), {
    FORM: "EMPLOYEE_OFFBOARDING_FORM", REMINDER: "EMPLOYEE_OFFBOARDING_REMINDER", APPROVED: "EMPLOYEE_OFFBOARDING_APPROVED", NOT_ACCEPTED: "EMPLOYEE_OFFBOARDING_NOT_ACCEPTED",
  });
  assert.deepEqual(WHATSAPP_MESSAGES.APPROVED.statuses, ["Approved"]);
  assert.deepEqual(WHATSAPP_MESSAGES.NOT_ACCEPTED.statuses, ["Rejected"]);
  const handler = controller.slice(controller.indexOf("async function sendInviteWhatsApp("), controller.indexOf("async function cancelInvite("));
  // A form in reach, its message ON, in the right state and in date - the number read off the record.
  assert.match(handler, /const invite = await scopedInvite\(req, res\);/);
  assert.match(handler, /await messageSwitches\.assertEnabled\(kind\.key\);/);
  assert.match(handler, /if \(!kind\.statuses\.includes\(invite\.status\)\)/);
  assert.match(handler, /if \(kind\.open && invite\.expiresAt <= new Date\(\)\)/);
  assert.match(handler, /phone: invite\.employee\?\.contactNumber,/);
  assert.match(read("src", "modules", "hrm", "master-data", "routes.js"), /router\.post\("\/offboarding-invites\/:id\/send-whatsapp", whatsappLimits\.send, offboarding\.sendInviteWhatsApp\);/);
});

test("the feedback reply goes to the project's client, for a feedback in reach, while its message is ON", () => {
  const service = read("src", "modules", "project-management", "feedback", "service.js");
  const sender = service.slice(service.indexOf("async function sendFeedbackWhatsApp("), service.indexOf("const feedbackAssignees"));
  assert.match(sender, /AND: \[await feedbackScope\(userId\)\]/);
  assert.match(sender, /const key = found\.status === "Completed" \? "FEEDBACK_THANK_YOU" : "FEEDBACK_ISSUES";/);
  assert.match(sender, /await messageSwitches\.assertEnabled\(key\);/);
  assert.match(sender, /phone: found\.project\?\.clientMainNumber,/);
  assert.match(read("src", "modules", "project-management", "feedback", "routes.js"), /router\.post\("\/:id\/send-whatsapp", whatsappLimits\.send, sendWhatsApp\);/);
  // Both sends are named in the WhatsApp Activity Log.
  for (const trigger of ["OFFBOARDING_FORM", "OFFBOARDING_REMINDER", "OFFBOARDING_APPROVED", "OFFBOARDING_NOT_ACCEPTED", "FEEDBACK_THANK_YOU", "FEEDBACK_ISSUES"]) assert.ok(read("src", "services", "whatsappActivity.js").includes(`${trigger}: {`), trigger);
});
