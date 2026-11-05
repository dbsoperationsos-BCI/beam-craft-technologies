const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * **Switching a notification off clears how its last try went, everywhere.**
 *
 * Every automatic message keeps the reason its last send failed, and every panel shows it - in red,
 * because somebody is meant to do something about it. Switching the message off *is* doing something
 * about it: nothing is being sent any more, so a standing error reads as a notification still
 * failing when there is none. Worse, the reason sat in its column until the next successful send, so
 * switching the message back on months later put the old failure straight back on the screen - an
 * error about a send from a world the studio had already left.
 *
 * So the rule, for every switch: **off clears the reason, and on leaves it clear.** Turning a
 * notification on starts that module fresh, and only its own next try can put anything there again.
 *
 * Each case below is one switch and the column it must clear. A new notification with a switch of
 * its own joins this list - that is the whole point of the list being here rather than the rule
 * being remembered six modules apart.
 */

/** A client that records what a switch wrote, standing in for the one settings row each module keeps. */
function recordingClient(model) {
  const written = [];
  const row = { id: 1 };
  const table = {
    upsert: async ({ update }) => { written.push(update); Object.assign(row, update); return row; },
    update: async ({ data }) => { written.push(data); Object.assign(row, data); return row; },
    findUnique: async () => row,
    findFirst: async () => row,
  };
  return { client: { [model]: table }, written, row };
}

/*
 * The list of switches is the one in `services/notificationSwitches.js`; these are the functions
 * that press each one. A notification whose switch is not driven here is one the rule is not
 * actually checked on, so the test below refuses to let the two lists drift apart.
 */
const CASES = [
  {
    what: "the daily attendance WhatsApp report",
    model: "hrmSettings",
    errorField: "attendanceReportLastError",
    set: (enabled, client) => require("../src/modules/hrm/attendance/reportGroup").setReportEnabled(enabled, { client }),
  },
  {
    what: "Photo Selection Submitted",
    model: "hrmSettings",
    errorField: "photoSelectionLastError",
    set: (enabled, client) => require("../src/modules/settings/automatic-whatsapp/photoSelection").setEnabled(enabled, { client }),
  },
  {
    what: "New Lead Welcome",
    model: "hrmSettings",
    errorField: "leadWelcomeLastError",
    set: (enabled, client) => require("../src/modules/settings/automatic-whatsapp/newLeadWelcome").setEnabled(enabled, { client }),
  },
  {
    what: "Interview Welcome",
    model: "hrmSettings",
    errorField: "interviewWelcomeLastError",
    set: (enabled, client) => require("../src/modules/settings/automatic-whatsapp/interviewWelcome").setEnabled(enabled, { client }),
  },
];

for (const { what, model, errorField, set } of CASES) {
  test(`switching ${what} off clears its last error, and switching it on does not bring it back`, async () => {
    const off = recordingClient(model);
    off.row[errorField] = "WhatsApp not connected";
    // The write is what is being checked; a switch that goes on to read back a status this stub
    // cannot answer has already written by then.
    await set(false, off.client).catch(() => {});
    const wroteOff = off.written.find((data) => Object.hasOwn(data, errorField));
    assert.ok(wroteOff, `switching ${what} off writes nothing to ${errorField}`);
    assert.equal(wroteOff[errorField], null, `${errorField} is not cleared when ${what} is switched off`);

    // On, the column is left alone: nothing is resurrected, and nothing a live send wrote is wiped.
    const on = recordingClient(model);
    await set(true, on.client).catch(() => {});
    assert.ok(!on.written.some((data) => Object.hasOwn(data, errorField)), `switching ${what} on should not touch ${errorField}`);
  });
}

/*
 * The shoot crew notice is two switches on one row - the employee arm and the vendor arm - each with
 * its own reason for waiting, so one arm being switched off must not clear the other's.
 */
test("each arm of the shoot crew notice clears only its own last error", async () => {
  const service = require("../src/modules/settings/shoot-crew-notice/service");
  for (const [setter, mine, theirs] of [["setEnabled", "lastError", "vendorLastError"], ["setVendorEnabled", "vendorLastError", "lastError"]]) {
    const { client, written } = recordingClient("shootCrewNoticeSettings");
    await service[setter](false, { client }).catch(() => {});
    const wrote = written.find((data) => Object.hasOwn(data, mine));
    assert.ok(wrote, `${setter} writes nothing to ${mine}`);
    assert.equal(wrote[mine], null, `${setter} does not clear ${mine}`);
    assert.ok(!written.some((data) => Object.hasOwn(data, theirs)), `${setter} should leave ${theirs} to the other arm`);
  }
});

/*
 * The per-message switches on Settings → Templates are the same rule for a message whose failures
 * live on the shoot rather than in a settings column: a production step message that never reached
 * the group is **closed** when the message is switched off, so the step stops showing it and
 * switching the message on again cannot bring it back (`production/messages.closeOpenMessages`).
 */
test("switching a production message off closes the sends of it still waiting", async () => {
  const { closeOpenMessages, STEP_FOR_TEMPLATE } = require("../src/modules/project-management/production/messages");
  let asked = null;
  const client = { projectProductionMessage: { updateMany: async (args) => { asked = args; return { count: 2 }; } } };
  assert.equal(await closeOpenMessages("PRODUCTION_STARTED_FROM_STUDIO", { client }), 2);
  assert.deepEqual(asked.where, { step: "STARTED_FROM_STUDIO", status: { in: ["FAILED", "SENDING"] } });
  assert.deepEqual(asked.data, { status: "OFF", reason: null });
  // All three step messages are switchable, and nothing else is touched by a switch.
  assert.deepEqual(Object.keys(STEP_FOR_TEMPLATE).sort(), ["PRODUCTION_REACHED_SHOOT_PLACE", "PRODUCTION_SHOOT_COMPLETED", "PRODUCTION_STARTED_FROM_STUDIO"]);
  assert.equal(await closeOpenMessages("CASH_RECEIVED", { client }), 0);
});

/*
 * The rule lives in one place, and every switch goes through it.
 *
 * Each of these used to carry its own copy of "off clears the error", and the attendance report's
 * copy was simply missing - which is how a studio ended up looking at a red line about a report it
 * had switched off weeks before. One registry, and a switch joins the rule by joining the list.
 */
test("every switch in the registry is driven by a test above, and writes what the rule says", () => {
  const { SWITCHES, switchOffData } = require("../src/services/notificationSwitches");
  const crewArms = ["enabled", "vendorEnabled"];
  const driven = new Set([...CASES.map((row) => row.errorField), "lastError", "vendorLastError"]);

  for (const entry of SWITCHES) {
    assert.ok(driven.has(entry.lastError), `${entry.what} is in the registry but no test presses its switch`);
    // Off writes the clear, and the moment for a message whose failures outlive it in the activity log.
    const off = switchOffData(entry.enabled, false);
    assert.equal(off[entry.lastError], null, `${entry.what} does not clear ${entry.lastError} when switched off`);
    assert.equal(Object.hasOwn(off, entry.offAt || "__none"), Boolean(entry.offAt), `${entry.what} and its ${entry.offAt || "offAt"} disagree`);
    // On writes nothing: a live send's own report is never undone by somebody switching the message on.
    assert.deepEqual(switchOffData(entry.enabled, true), {}, `${entry.what} writes something when switched on`);
    // A message that can reach the group-failure notice must be able to answer its failures by date.
    if (entry.triggers.length) assert.ok(entry.offAt, `${entry.what} is in the notice but records no moment, so switching it on would bring its old failures back`);
  }
  assert.deepEqual(SWITCHES.filter((entry) => crewArms.includes(entry.enabled)).map((entry) => entry.model), ["shootCrewNoticeSettings", "shootCrewNoticeSettings"]);
  assert.equal(switchOffData("notASwitch", false).lastError, undefined, "an unknown switch writes nothing of its own");
});

test("the notice answers a failure by its message's switch, and only its own", async () => {
  const { switchStates, answeredBySwitch } = require("../src/services/notificationSwitches");
  const row = { attendanceReportEnabled: true, attendanceReportOffAt: new Date("2026-11-04T10:00:00.000Z"), photoSelectionNotifyEnabled: false, photoSelectionOffAt: null };
  const client = { hrmSettings: { findFirst: async () => row } };
  const at = (iso) => ({ trigger: "ATTENDANCE_REPORT", createdAt: new Date(iso) });

  const map = await switchStates(client);
  assert.equal(answeredBySwitch(at("2026-11-03T00:00:00.000Z"), map), true, "before the switch-off: answered");
  assert.equal(answeredBySwitch(at("2026-11-05T00:00:00.000Z"), map), false, "after it: still to fix");
  // Off outright, whatever the dates say.
  assert.equal(answeredBySwitch({ trigger: "PHOTO_SELECTION_SUBMITTED", createdAt: new Date() }, map), true);
  // A message with no switch of its own - the wishes, the payment reminder - is never answered this way.
  assert.equal(answeredBySwitch({ trigger: "WISH_BIRTHDAY", createdAt: new Date("2000-01-01") }, map), false);
});
