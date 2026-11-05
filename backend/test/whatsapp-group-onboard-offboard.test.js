const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const service = require("../src/modules/hrm/whatsapp-groups/service");
const SESSIONS = read("src/modules/sales/whatsapp-chat/sessionManager.js");
const RELIEVE = read("src/modules/hrm/separations/relieve.js");
const EMPLOYEES = read("src/modules/hrm/employees/controller.js");

/*
 * Onboarding puts a new employee into the groups their departments claim; being relieved takes them
 * out of every group the app has them in. Both ride the queue that already existed for adding
 * somebody by hand, because joining and leaving a group are the same fact at different times.
 */

const employeeClient = ({ employee = { id: 7, contactNumber: "9876543210" }, departments = [{ departmentId: 3 }], groups = [{ id: 11 }, { id: 12 }] } = {}) => {
  const asked = {};
  return {
    asked,
    employee: { findFirst: async () => employee },
    employeeDepartment: { findMany: async (args) => { asked.departments = args; return departments; } },
    employeeWhatsAppGroup: { findMany: async (args) => { asked.groups = args; return groups; } },
    employeeWhatsAppGroupMember: {
      createMany: async (args) => { (asked.created = asked.created || []).push(args); },
      updateMany: async (args) => { asked.updated = args; return { count: 2 }; },
      findMany: async () => [],
      findFirst: async () => null,
    },
  };
};

test("onboarding adds them to the groups their departments claim", async () => {
  const client = employeeClient();
  const result = await service.addEmployeeToDepartmentGroups(7, { client, userId: 5 });
  assert.equal(result.queued, 2);
  // Their departments are rows, so somebody in two departments gets the groups of both.
  assert.deepEqual(client.asked.groups.where, { departments: { some: { departmentId: { in: [3] } } } });
  // One row per group, queued PENDING, which is the status the existing drain already picks up.
  assert.equal(client.asked.created.length, 2);
  assert.deepEqual(client.asked.created[0].data, [{ employeeId: 7, groupId: 11, status: "PENDING", requestedByUserId: 5 }]);
});

test("onboarding never re-queues a row somebody has already acted on", async () => {
  /*
   * `skipDuplicates`, not an upsert. Somebody already ADDED, or deliberately REMOVED, is left alone -
   * onboarding runs once, and re-queueing a row would quietly undo a decision somebody had made.
   */
  const client = employeeClient();
  await service.addEmployeeToDepartmentGroups(7, { client });
  assert.equal(client.asked.created[0].skipDuplicates, true);
});

test("a group under no department is never one onboarding adds to", async () => {
  // The whole point of letting a group sit under none: it is not one the app acts on by itself.
  const client = employeeClient({ groups: [] });
  const result = await service.addEmployeeToDepartmentGroups(7, { client });
  assert.equal(result.queued, 0);
  assert.match(result.reason, /no groups under their departments/);
});

test("no departments, or no mobile number, is a reason and not a crash", async () => {
  assert.equal((await service.addEmployeeToDepartmentGroups(7, { client: employeeClient({ departments: [] }) })).queued, 0);
  const noPhone = employeeClient({ employee: { id: 7, contactNumber: "  " } });
  const result = await service.addEmployeeToDepartmentGroups(7, { client: noPhone });
  assert.equal(result.queued, 0);
  assert.match(result.reason, /no mobile number/);
});

test("onboarding and offboarding never throw, whatever the database says", async () => {
  /*
   * They are called from creating an employee and from the relieving that closes a login. An employee
   * who exists with their groups unqueued beats one who could not be created because WhatsApp was
   * unreachable, and a login must close on the right day regardless.
   */
  const broken = { employee: { findFirst: async () => { throw new Error("db down"); } } };
  assert.deepEqual(await service.addEmployeeToDepartmentGroups(7, { client: broken }), { queued: 0, reason: "the queue could not be written" });
  const brokenToo = { employeeWhatsAppGroupMember: { updateMany: async () => { throw new Error("db down"); } } };
  assert.deepEqual(await service.removeEmployeeFromAllGroups(7, { client: brokenToo }), { queued: 0 });
});

test("the employee's picker offers their departments' groups, and marks them as such", async () => {
  /*
   * The studio decided in Settings which groups a department has. A picker listing every group in
   * the studio asked whoever is on the employee's screen to decide it again, differently, and
   * without the context to - so the screen offers the same list onboarding uses.
   */
  const client = {
    employeeDepartment: { findMany: async () => [{ departmentId: 3 }] },
    employeeWhatsAppGroup: {
      findMany: async (args) => (args.where?.departments
        ? [{ id: 11 }]
        : [{ id: 11, name: "Production Team" }, { id: 99, name: "An old group" }]),
    },
    employeeWhatsAppGroupMember: { findMany: async () => [{ groupId: 99, status: "ADDED", group: { name: "An old group" }, detail: null, addedAt: null, updatedAt: null }] },
  };
  const picker = await service.employeeGroupPicker(7, { client });
  assert.deepEqual(picker.groups.map((group) => [group.subject, group.fromDepartment]), [
    ["Production Team", true],
    // Already in it, though their department no longer claims it: a membership that exists has to
    // stay visible, or it is one nobody could see or act on.
    ["An old group", false],
  ]);
  assert.equal(picker.memberships.length, 1);
});

test("offboarding queues them out of every group the app has them in", async () => {
  const client = employeeClient();
  const result = await service.removeEmployeeFromAllGroups(7, { client, userId: 5 });
  assert.equal(result.queued, 2);
  // Every group, not only their departments' - a group they were put in by hand is one they can
  // still read tomorrow. And only rows that actually got them in: there is nothing else to remove.
  assert.deepEqual(client.asked.updated.where, { employeeId: 7, status: { in: service.IN_THE_GROUP } });
  assert.deepEqual(service.IN_THE_GROUP, ["ADDED", "ALREADY", "INVITED"]);
  assert.equal(client.asked.updated.data.status, "REMOVING");
});

test("WhatsApp's answers to a removal are read as the four different things they are", async () => {
  const row = { group: { name: "Production Team" }, employee: { id: 7, contactNumber: "9876543210" }, requestedByUserId: null };
  const client = { user: { findMany: async () => [{ id: 1 }] } };
  const outcomes = {
    REMOVED: "REMOVED",
    NOT_IN: "NOT_IN",
    NOT_ADMIN: "REMOVE_FAILED",
    FAILED: "REMOVE_FAILED",
  };
  for (const [outcome, expected] of Object.entries(outcomes)) {
    service.setSessionsForTest({
      sessionState: () => ({ status: "connected" }),
      listAdminGroups: async () => [{ jid: "g@g.us", subject: "Production Team", isAdmin: true }],
      removeFromGroup: async () => ({ outcome, status: "200" }),
    });
    const answer = await service.removeOne(row, { client });
    assert.equal(answer.status, expected, `${outcome} reads as ${expected}`);
  }
  // Not in the group is the state that was wanted, so it is stamped done rather than left to retry.
  service.setSessionsForTest({
    sessionState: () => ({ status: "connected" }),
    listAdminGroups: async () => [{ jid: "g@g.us", subject: "Production Team", isAdmin: true }],
    removeFromGroup: async () => ({ outcome: "NOT_IN", status: "404" }),
  });
  assert.ok((await service.removeOne(row, { client })).removedAt instanceof Date);
  service.setSessionsForTest(null);
});

test("a group nobody's linked WhatsApp administers is a failure that says so", async () => {
  // `findAdder` is reused unchanged: admin of the group is the same requirement either way.
  service.setSessionsForTest({ sessionState: () => ({ status: "disconnected" }), listAdminGroups: async () => [] });
  const answer = await service.removeOne(
    { group: { name: "Production Team" }, employee: { id: 7, contactNumber: "98765" }, requestedByUserId: null },
    { client: { user: { findMany: async () => [{ id: 1 }] } } },
  );
  assert.equal(answer.status, "REMOVE_FAILED");
  assert.match(answer.detail, /No WhatsApp is linked/);
  service.setSessionsForTest(null);
});

test("removals wait far longer between them than adds do", () => {
  /*
   * Taking one leaver out of a dozen groups is a burst of group administration from one number
   * against one person, which is the shape WhatsApp reads as automation - and the studio's paired
   * number is bannable. Nobody waits on it either: it runs behind a relieving already done.
   */
  assert.equal(service.REMOVE_GAP_MS, 30000);
  const source = read("src/modules/hrm/whatsapp-groups/service.js");
  assert.match(source, /removing \? removeWaitMs : waitMs/);
  // Adds are served first: somebody is waiting on those.
  assert.match(source, /where: \{ status: "PENDING" \}[\s\S]{0,200}\|\| await client\.employeeWhatsAppGroupMember\.findFirst\(\{\s*\n\s*where: \{ status: "REMOVING" \}/);
});

test("removeFromGroup is Baileys' own remove, and does not check they are on WhatsApp first", () => {
  /*
   * Adding needs that check - a number not on WhatsApp cannot be added. Removal is the opposite:
   * somebody whose number has since left WhatsApp may still be a participant, and refusing to remove
   * them because the check failed would leave them in the group for good.
   */
  assert.match(SESSIONS, /groupParticipantsUpdate\(groupJid, \[jid\], "remove"\)/);
  const fn = SESSIONS.slice(SESSIONS.indexOf("async function removeFromGroup"), SESSIONS.indexOf("async function removeFromGroup") + 1800);
  assert.doesNotMatch(fn.slice(0, fn.indexOf("\n}\n")), /confirmOnWhatsApp/);
  // Paced like every other write to WhatsApp.
  assert.match(fn, /await pace\(session\);/);
});

test("both hooks sit outside the transaction they follow", () => {
  // Holding an employee's creation, or a relieving, open while WhatsApp is talked to would risk the
  // half that matters for the sake of a group invitation.
  assert.match(EMPLOYEES, /\}\);\n\s*\/\*[\s\S]*?\*\/\n\s*await whatsappGroups\.addEmployeeToDepartmentGroups\(data\.id, \{ userId: actorId \}\);/);
  assert.match(RELIEVE, /\}\);\n\s*\/\*[\s\S]*?\*\/\n\s*const left = await whatsappGroups\.removeEmployeeFromAllGroups\(separation\.employeeId\);/);
});
