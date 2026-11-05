const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { boardWhere, rangeOf, listBoard, PROJECT_ROLE_FIELDS } = require("../src/modules/project-management/shoot-board/read");

const noShowAll = { hasPermission: async () => false };
const scopeFor = ({ superAdmin = false, employeeIds = [] } = {}) => ({
  bypassesHierarchy: async () => superAdmin,
  identityFor: async () => ({ employeeIds }),
});

test("the board reaches every role a shoot can name the viewer or their reports in", async () => {
  const where = await boardWhere(21, { scope: scopeFor({ employeeIds: [9, 12] }), iam: noShowAll });
  const named = { in: [9, 12] };
  assert.deepEqual(where, {
    OR: [
      ...PROJECT_ROLE_FIELDS.map((field) => ({ project: { [field]: named } })),
      { production: { productionCoordinatorEmployeeId: named } },
      { production: { teamMembers: { some: { employeeId: named } } } },
      { production: { serviceCrew: { some: { employeeId: named } } } },
    ],
  });
  assert.deepEqual(PROJECT_ROLE_FIELDS, ["projectManagerEmployeeId", "preProductionCoordinatorEmployeeId", "creativeManagerEmployeeId", "productionManagerEmployeeId", "postProductionCoordinatorEmployeeId"]);
});

test("a Super Admin and Show All Projects see every shoot; a login with no employee sees none", async () => {
  assert.deepEqual(await boardWhere(1, { scope: scopeFor({ superAdmin: true }), iam: noShowAll }), {});
  const asked = [];
  const showAll = { hasPermission: async (...args) => { asked.push(args); return true; } };
  assert.deepEqual(await boardWhere(22, { scope: scopeFor(), iam: showAll }), {});
  assert.deepEqual(asked[0], [22, "PROJECT", "Show All Projects", "READ"]);
  assert.equal(await boardWhere(23, { scope: scopeFor({ employeeIds: [] }), iam: noShowAll }), null);
});

test("the range is whole days, refused when missing, reversed, not a date or longer than 92 days", () => {
  assert.deepEqual(rangeOf("2026-10-05", "2026-10-11"), { gte: new Date("2026-10-05T00:00:00.000Z"), lt: new Date("2026-10-12T00:00:00.000Z") });
  for (const [from, to] of [[undefined, "2026-10-11"], ["2026-10-11", "2026-10-05"], ["2026-02-30", "2026-03-02"], ["2026-01-01", "2026-04-03"]]) {
    assert.throws(() => rangeOf(from, to), (error) => error.status === 400);
  }
  assert.doesNotThrow(() => rangeOf("2026-01-01", "2026-04-02"));
});

test("cards carry the project, and open the production panel only where production is raised", async () => {
  const shoots = [
    { id: "s1", shootId: "DBS-SID-1", shoot: "Wedding", dateCreated: new Date("2026-10-06"), shootPlace: "Chennai", project: { id: "p1", eventId: "EV1", whatsappGroupName: "Anu & Ravi", whatsappGroupNameId: null }, production: { planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO", shootStatus: null, productionCoordinatorEmployee: { employeeName: "Arun" },
      teamMembers: [{ employee: { employeeName: "Divya" } }, { vendor: { vendorName: "Lens Co" } }, { employee: null, employeeName: "Old Hand" }],
      serviceCrew: [
        { serviceDefinitionId: "d1", role: "LEAD", serviceDefinition: { name: "Candid Photo" }, employee: { employeeName: "Bala" } },
        { serviceDefinitionId: "d1", role: "ASSISTANT_1", serviceDefinition: { name: "Candid Photo" }, employee: { employeeName: "Esha" } },
      ] } },
    { id: "s2", shootId: "DBS-SID-2", shoot: "Reception", dateCreated: new Date("2026-10-07"), shootPlace: "Madurai", project: { id: "p1", eventId: "EV1", whatsappGroupName: "Anu & Ravi", whatsappGroupNameId: null }, production: null },
  ];
  const asked = [];
  const client = {
    projectShoot: { findMany: async (args) => { asked.push(args); return shoots; } },
    // Two shooters and someone who is not; Arun (9) coordinates the 6th, so is busy that day only.
    // A shooter is somebody in the Technical department - "Non Technical" is a department of its
    // own and is not one.
    employee: { findMany: async () => [
      { id: 9, employeeName: "Arun", departments: [{ department: { name: "Technical" } }] },
      { id: 10, employeeName: "Bala", departments: [{ department: { name: "Operations" } }, { department: { name: "Technical" } }] },
      { id: 11, employeeName: "Chitra", departments: [{ department: { name: "Non Technical" } }] },
    ] },
    projectProduction: { findMany: async () => [
      { productionCoordinatorEmployeeId: 9, shoot: { dateCreated: new Date("2026-10-06") }, teamMembers: [], serviceCrew: [] },
    ] },
  };
  const result = await listBoard(21, { from: "2026-10-05", to: "2026-10-11" }, { client, scope: scopeFor({ employeeIds: [9] }), iam: noShowAll, statuses: async () => ["active"] });
  // Free shooters for every day on the board: only people in the Technical department, and nobody
  // with a shoot that date.
  assert.equal(Object.keys(result.freeShooters).length, 7);
  assert.deepEqual(result.freeShooters["2026-10-06"], [{ id: 10, name: "Bala" }]);
  assert.deepEqual(result.freeShooters["2026-10-07"], [{ id: 9, name: "Arun" }, { id: 10, name: "Bala" }]);
  assert.deepEqual(result.freeShooters["2026-10-11"], [{ id: 9, name: "Arun" }, { id: 10, name: "Bala" }]);
  assert.equal("unscheduled" in result, false);
  assert.equal(result.shoots[0].productionShootId, "s1");
  assert.equal(result.shoots[0].pending, "Plan pending");
  assert.equal(result.shoots[0].coordinator, "Arun");
  // Who is on the shoot: the team, and each service with its person and assistants.
  assert.deepEqual(result.shoots[0].team, ["Divya", "EXT-Lens Co", "Old Hand"]);
  assert.deepEqual(result.shoots[0].crew, [{ service: "Candid Photo", person: "Bala", assistants: ["Esha"] }]);
  assert.deepEqual(result.shoots[1].team, []);
  assert.equal(result.shoots[0].clientName, "Anu & Ravi");
  assert.equal(result.shoots[1].productionShootId, null);
  assert.equal(result.shoots[1].pending, null);
  // Only live shoots of started projects.
  assert.deepEqual(asked[0].where.project, { deletedAt: null, projectStatus: { not: "Yet to Start" } });
  assert.equal(asked[0].where.deletedAt, null);
});

test("a login with no employee gets an empty board, said as such", async () => {
  const result = await listBoard(23, { from: "2026-10-05", to: "2026-10-11" }, { client: {}, scope: scopeFor(), iam: noShowAll });
  assert.deepEqual(result, { shoots: [], unlinked: true });
});

test("the board is guarded by PROJECT / Shoot Board and mounted on the server", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../src/modules/project-management/shoot-board/routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\);/);
  assert.match(routes, /router\.use\(requireModule\("PROJECT", "Shoot Board"\)\);/);
  assert.match(fs.readFileSync(path.join(__dirname, "../src/server.js"), "utf8"), /app\.use\("\/api\/project-management\/shoot-board", projectShootBoardRoutes\);/);
});

test("the permission ships in the catalogue and a migration, granted to SUPER_ADMIN only", () => {
  const { PERMISSIONS } = require("../prisma/seeds/permission-catalogue");
  assert.ok((PERMISSIONS || []).some((row) => row.module === "PROJECT" && row.feature === "Shoot Board"));
  const sql = fs.readFileSync(path.join(__dirname, "../prisma/migrations/20261005130000_shoot_board_permission/migration.sql"), "utf8");
  assert.match(sql, /WHERE `role`\.`name` = 'SUPER_ADMIN'\n/);
  assert.doesNotMatch(sql, /is_admin/);
});
