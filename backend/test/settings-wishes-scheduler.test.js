const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scheduler = require("../src/modules/settings/wishes/scheduler");
const { senderPolicyTables } = require("./helpers/senderPolicyFakeDb");

/*
 * Settings → Wishes → Wishes Scheduler: the wishes' own WhatsApp group, send time and senders -
 * set the way Attendance WhatsApp Report sets the daily report's.
 */

function fakeClient({ eligible = [] } = {}) {
  const writes = [];
  return {
    writes,
    ...senderPolicyTables({}, (id) => ({ id, name: `user ${id}`, linkedEmployee: null })),
    hrmSettings: { upsert: async ({ update }) => { writes.push(update); return update; } },
    user: {
      findFirst: async ({ where }) => (eligible.includes(where.id) ? { id: where.id } : null),
      // An id list, or nobody named - everyone with Allow WhatsApp, as the picker asks.
      findMany: async ({ where }) => eligible.filter((id) => !where.id || where.id.in.includes(id)).map((id) => ({ id, name: `user ${id}`, linkedEmployee: null })),
    },
  };
}

test("the group is a name - trimmed, and cleared to none", async () => {
  const client = fakeClient();
  await scheduler.setGroupName("  Studio Family  ", { client });
  await scheduler.setGroupName("", { client });
  assert.deepEqual(client.writes, [{ wishesGroupName: "Studio Family", wishesLastError: null }, { wishesGroupName: null, wishesLastError: null }]);
});

test("the time is HH:MM, or none for 10:00 am", async () => {
  const client = fakeClient();
  await scheduler.setSendAt("9:05", { client });
  await scheduler.setSendAt("", { client });
  assert.deepEqual(client.writes, [{ wishesSendAt: "09:05" }, { wishesSendAt: null }]);
  await assert.rejects(scheduler.setSendAt("25:00", { client }), /Choose a time as HH:MM/);
  assert.deepEqual(scheduler.wishesSendAt({ wishesSendAt: null }), { hour: 10, minute: 0 });
});

test("the Sender and the Rotation have to be active employees with Allow WhatsApp ticked, the order kept as given", async () => {
  const client = fakeClient({ eligible: [7, 8] });
  await scheduler.setSender({ mode: "ROTATE", senderUserId: 7, userIds: [8, 7] }, { client });
  assert.deepEqual(client.senderPolicyState.members.map((member) => [member.userId, member.position]), [[8, 1], [7, 2]]);
  assert.deepEqual([client.senderPolicyState.policies.get("WISHES").mode, client.senderPolicyState.policies.get("WISHES").senderUserId], ["ROTATE", 7]);
  await scheduler.setSender({ mode: "SAME", senderUserId: null, userIds: [8, 7] }, { client });
  assert.equal(client.senderPolicyState.policies.get("WISHES").senderUserId, null);
  await assert.rejects(scheduler.setSender({ mode: "SAME", senderUserId: 9 }, { client }), /Allow WhatsApp ticked/);
  // Not an id: refused, never read as "nobody".
  for (const bad of ["abc", 0, -1]) await assert.rejects(scheduler.setSender({ mode: "SAME", senderUserId: bad }, { client }), /Choose the sender/);
  await assert.rejects(scheduler.setSender({ mode: "ROTATE", userIds: "7" }, { client }), /Choose the rotation order/);
});

test("the wishes go to the scheduler's group and its own sender list, not the attendance report's", () => {
  assert.deepEqual(scheduler.wishesTarget({ wishesGroupName: "Studio Family" }), { messageKey: "WISHES", groupName: "Studio Family" });
  const sender = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "wishes", "sender.js"), "utf8");
  assert.match(sender, /reportGroup\.deliverToGroup\(scheduler\.wishesTarget\(row\), wish\.body,/);
  assert.doesNotMatch(sender, /attendanceReportGroupName|ATTENDANCE_REPORT/);
});

test("behind SETTINGS / Wishes, above the wish key route, and its columns migrated", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "wishes", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(requireModule\("SETTINGS", "Wishes"\)\);[\s\S]*router\.get\("\/scheduler", controller\.getScheduler\);\s+[^\n]*\n\s*router\.get\("\/scheduler\/senders\/candidates", checkPermission\("SETTINGS", "Wishes", "READ_WRITE"\), controller\.listSchedulerCandidates\);[\s\S]*router\.put\("\/scheduler\/senders", controller\.setSchedulerSender\);\s+router\.put\("\/:key"/);
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012280000_wishes_scheduler", "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `wishes_group_name` VARCHAR\(500\) NULL/);
  assert.match(sql, /FOREIGN KEY \(`wishes_sender_user_id`\) REFERENCES `user`\(`id`\) ON DELETE SET NULL/);
});
