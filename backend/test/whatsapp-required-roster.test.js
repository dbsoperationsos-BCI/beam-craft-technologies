const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * Settings → User Settings → WhatsApp lists two different reasons to be on it, and a row can be
 * either or both: being on the **Sales** team (a CRM someone can chat as), and having **Allow
 * WhatsApp** ticked on Login Credentials (`whatsappRequired`, which holds somebody to the
 * application-wide gate regardless of department). An administrator is never listed as required -
 * `linkRequired` never holds one - even if the tick happens to be on for them.
 *
 * Every collaborator this handler reaches is stubbed, so this is about what `users()` assembles
 * from the rows it is handed, not about a real database.
 */

const dbPath = require.resolve("../src/config/db");
const employeeOptionListsPath = require.resolve("../src/services/employeeOptionLists");
const repositoryPath = require.resolve("../src/modules/sales/whatsapp-chat/repository");
const sessionManagerPath = require.resolve("../src/modules/sales/whatsapp-chat/sessionManager");

const realEmployeeOptionLists = require(employeeOptionListsPath);
const realRepository = require(repositoryPath);
const realSessionManager = require(sessionManagerPath);

// One Sales employee (Priya), one Design employee Allow WhatsApp was ticked for (Arun), one Sales
// login with no employee record (a raw account), and one Super Admin Allow WhatsApp is also
// (mistakenly, or leftover) ticked for - who must never appear as required.
const salesEmployeeRow = { id: 1, employeeName: "Priya", department: "Sales", designation: "CRM", contactNumber: "9000000001" };
const requiredEmployeeRow = { id: 2, employeeName: "Arun", department: "Design", designation: "Retoucher", contactNumber: "9000000002" };

const accounts = [
  { id: 101, name: "Priya", username: "priya", linkedEmployeeId: 1, accessDepartment: "Sales", role: "USER", whatsappRequired: false, roles: [] },
  { id: 102, name: "Arun", username: "arun", linkedEmployeeId: 2, accessDepartment: "Design", role: "USER", whatsappRequired: true, roles: [] },
  { id: 103, name: "Sales Desk", username: "salesdesk", linkedEmployeeId: null, accessDepartment: "Sales", role: "USER", whatsappRequired: false, roles: [] },
  { id: 104, name: "Root", username: "root", linkedEmployeeId: null, accessDepartment: "Admin", role: "SUPER_ADMIN", whatsappRequired: true, roles: [] },
];

require.cache[dbPath].exports = {
  user: { findMany: async () => accounts },
  employee: { findMany: async ({ where }) => [requiredEmployeeRow].filter((row) => where.id.in.includes(row.id)) },
};
require.cache[employeeOptionListsPath].exports = { ...realEmployeeOptionLists, salesEmployees: async () => [salesEmployeeRow] };
require.cache[repositoryPath].exports = {
  ...realRepository,
  usageForUsers: async () => new Map(),
  blockedChatUserIds: async () => new Set(),
  chatLimits: async () => ({}),
};
require.cache[sessionManagerPath].exports = { ...realSessionManager, sessionStatesFor: async () => new Map() };

const { users } = require("../src/modules/sales/whatsapp-chat/controller");

/** The handler, called the way the router calls it, answering with whatever it passed to `json`. */
async function readUsers() {
  let payload;
  let code = 200;
  const res = {
    json: (body) => { payload = body; return res; },
    status: (value) => { code = value; return res; },
  };
  await users({ user: { id: 999 } }, res);
  assert.equal(code, 200, `the users read failed: ${JSON.stringify(payload)}`);
  return payload?.data;
}

test("a Sales employee is listed as sales team, not required", async () => {
  const data = await readUsers();
  const priya = data.find((row) => row.name === "Priya");
  assert.ok(priya, "Priya is missing from the roster");
  assert.equal(priya.salesTeam, true);
  assert.equal(priya.required, false);
});

test("an employee outside Sales with Allow WhatsApp ticked is listed as required, not sales team", async () => {
  const data = await readUsers();
  const arun = data.find((row) => row.name === "Arun");
  assert.ok(arun, "Arun is missing from the roster - Allow WhatsApp must reach outside Sales");
  assert.equal(arun.salesTeam, false);
  assert.equal(arun.required, true);
  assert.equal(arun.role, "Retoucher", "their own designation, not their login's department");
});

test("a Sales login with no employee record is still listed", async () => {
  const data = await readUsers();
  const desk = data.find((row) => row.name === "Sales Desk");
  assert.ok(desk, "a Sales-only login must still be listed");
  assert.equal(desk.salesTeam, true);
  assert.equal(desk.required, false);
});

test("an administrator is never listed as required, even with the tick on", async () => {
  const data = await readUsers();
  assert.equal(data.some((row) => row.name === "Root"), false, "an administrator must not appear for being required");
});
