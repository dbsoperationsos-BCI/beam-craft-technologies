const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const service = require("../src/modules/hrm/whatsapp-groups/service");
const SCHEMA = read("prisma/schema.prisma");
const SQL = read("prisma/migrations/20261103160000_whatsapp_group_departments/migration.sql");
const ROUTES = read("src/modules/hrm/whatsapp-groups/routes.js");

/*
 * A WhatsApp group in Settings → Employee → WhatsApp Groups now says which departments it is for,
 * and may be for several: an "All Managers" group covers Sales and Production alike, and it is still
 * one group on WhatsApp. This is what onboarding will read to know which groups a new employee
 * belongs in.
 */

const fakeClient = (over = {}) => {
  const asked = {};
  return {
    asked,
    employeeWhatsAppGroup: {
      findMany: async (args) => { asked.list = args; return []; },
      findFirst: async () => null,
      findUnique: async () => ({ id: 1 }),
      create: async (args) => { asked.create = args; return { id: 1 }; },
      ...over.employeeWhatsAppGroup,
    },
    department: {
      findMany: async (args) => { asked.departments = args; return (args?.where?.id?.in || []).map((id) => ({ id })); },
      ...over.department,
    },
    employeeWhatsAppGroupDepartment: { deleteMany: async (a) => { asked.deleted = a; }, createMany: async (a) => { asked.created = a; } },
    $transaction: async (fn) => fn({
      employeeWhatsAppGroupDepartment: { deleteMany: async (a) => { asked.deleted = a; }, createMany: async (a) => { asked.created = a; } },
    }),
  };
};

test("a group may belong to several departments, through a join table", () => {
  // A column would have allowed one. The studio asked for the same group in multiple departments.
  assert.match(SCHEMA, /model EmployeeWhatsAppGroupDepartment \{/);
  assert.match(SCHEMA, /@@id\(\[groupId, departmentId\]\)/);
  assert.match(SCHEMA, /@@map\("employee_whatsapp_group_department"\)/);
  // The department is an id with a key, never its name: a renamed department keeps its groups.
  assert.match(SCHEMA, /department\s+Department\s+@relation\(fields: \[departmentId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(SCHEMA, /@@index\(\[departmentId\]\)/);
  assert.doesNotMatch(SCHEMA, /model EmployeeWhatsAppGroupDepartment \{[\s\S]*?departmentName/, "no name is copied onto the link");
});

test("the migration creates an empty table and backfills nothing", () => {
  /*
   * Every group that exists today ends up under no department, which is the honest answer: nobody
   * has said which department any of them is for. Guessing would have had onboarding adding people
   * to groups on the strength of a guess.
   */
  assert.match(SQL, /CREATE TABLE `employee_whatsapp_group_department`/);
  assert.match(SQL, /PRIMARY KEY \(`group_id`, `department_id`\)/);
  // Statement starts, with the comments stripped: `ON UPDATE CASCADE` contains the word, and the
  // prose above explains what is deliberately not done.
  const statements = SQL.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(statements, /^\s*(INSERT|UPDATE)\b/mi, "nothing is backfilled");
  // Both sides cascade, so no row is ever left pointing at nothing.
  assert.match(SQL, /REFERENCES `employee_whatsapp_group`\(`id`\) ON DELETE CASCADE/);
  assert.match(SQL, /REFERENCES `department`\(`id`\) ON DELETE CASCADE/);
});

test("the departments offered are the register's active ones, not a typed list", async () => {
  const client = { department: { findMany: async (args) => { client.asked = args; return [{ id: 3, name: "Production" }]; } } };
  const offered = await service.listDepartments({ client });
  assert.deepEqual(client.asked.where, { isActive: true });
  assert.deepEqual(client.asked.orderBy, { name: "asc" });
  assert.deepEqual(offered, [{ value: "3", label: "Production" }]);
});

test("the list narrows to one department when the dropdown asks", async () => {
  const client = fakeClient();
  await service.listGroups({ client, departmentId: 3 });
  assert.deepEqual(client.asked.list.where, { departments: { some: { departmentId: 3 } } });
  // Unnarrowed asks for everything, including the groups under no department.
  const all = fakeClient();
  await service.listGroups({ client: all });
  assert.deepEqual(all.asked.list.where, {});
});

test("a group's departments are written with it, in one statement", async () => {
  const client = fakeClient();
  await service.addGroup({ name: "All Managers", departmentIds: [3, 1], client, userId: 5 });
  assert.deepEqual(client.asked.create.data.departments, { create: [{ departmentId: 3 }, { departmentId: 1 }] });
  // So a group never exists for a moment belonging to none, which onboarding would have skipped.
  assert.equal(client.asked.create.data.name, "All Managers");
});

test("a department that does not exist is refused, not quietly dropped", async () => {
  /*
   * A group filed under fewer departments than asked for is a group onboarding will not add people
   * to — a silent partial save would be found out by somebody's employee never joining.
   */
  const client = fakeClient({ department: { findMany: async () => [{ id: 3 }] } });
  await assert.rejects(
    () => service.addGroup({ name: "Spans two", departmentIds: [3, 999], client }),
    (error) => error.status === 400 && /no longer exists/.test(error.message),
  );
});

test("saving replaces the list, inside one transaction", async () => {
  // What the multi-select means by saving: the rows it names are the rows the group should have.
  const client = fakeClient();
  await service.setGroupDepartments(1, [2], { client });
  assert.deepEqual(client.asked.deleted, { where: { groupId: 1 } });
  assert.deepEqual(client.asked.created, { data: [{ groupId: 1, departmentId: 2 }] });
});

test("clearing every department leaves the group under none, and writes no rows", async () => {
  const client = fakeClient();
  await service.setGroupDepartments(1, [], { client });
  assert.deepEqual(client.asked.deleted, { where: { groupId: 1 } });
  assert.equal(client.asked.created, undefined, "createMany is not called with an empty list");
});

test("the table reads one row per department, groups comma separated", async () => {
  /*
   * "Which groups does Production have" is the question somebody asks; one row per group with its
   * departments listed is the same fact from the less useful end.
   */
  const client = {
    department: {
      findMany: async (args) => {
        client.asked = args;
        return [
          { id: 3, name: "Production", whatsappGroupLinks: [{ group: { id: 11, name: "Production Team" } }, { group: { id: 12, name: "Production Leads" } }] },
          { id: 1, name: "Sales", whatsappGroupLinks: [] },
        ];
      },
    },
  };
  const rows = await service.listDepartmentGroups({ client });
  // Active departments only, every one of them - a department with no groups is what needs seeing.
  assert.deepEqual(client.asked.where, { isActive: true });
  // No count: the names are the answer, and a column counting what is already listed is noise.
  assert.deepEqual(rows[0], {
    id: 3,
    departmentName: "Production",
    groupNames: "Production Team, Production Leads",
    groups: [{ id: 11, name: "Production Team" }, { id: 12, name: "Production Leads" }],
  });
  assert.deepEqual(rows[1].groupNames, "", "a department claiming nothing is still a row");
});

test("adding a group to a department attaches an existing one rather than refusing it", async () => {
  /*
   * A group's name is unique because it is one group on WhatsApp, so typing "All Managers" under a
   * second department means "this department too". A plain create would have answered 409 and left
   * somebody wondering why a name they could see was taken.
   */
  const asked = {};
  const client = {
    department: { findUnique: async () => ({ id: 1 }), findMany: async () => [] },
    employeeWhatsAppGroup: {
      findFirst: async () => ({ id: 11 }),
      create: async () => { asked.created = true; return { id: 99 }; },
    },
    employeeWhatsAppGroupDepartment: {
      findUnique: async () => null,
      create: async (args) => { asked.link = args; },
    },
  };
  await service.addGroupToDepartment({ departmentId: 1, name: "All Managers", client });
  assert.equal(asked.created, undefined, "the existing group is reused, not duplicated");
  assert.deepEqual(asked.link.data, { groupId: 11, departmentId: 1 });
});

test("a name the studio has never used names a new group", async () => {
  const asked = {};
  const client = {
    department: { findUnique: async () => ({ id: 1 }), findMany: async () => [] },
    employeeWhatsAppGroup: { findFirst: async () => null, create: async (args) => { asked.created = args; return { id: 99 }; } },
    employeeWhatsAppGroupDepartment: { findUnique: async () => null, create: async (args) => { asked.link = args; } },
  };
  await service.addGroupToDepartment({ departmentId: 1, name: "Brand New", client, userId: 5 });
  assert.equal(asked.created.data.name, "Brand New");
  assert.deepEqual(asked.link.data, { groupId: 99, departmentId: 1 });
});

test("the same group twice under one department is refused, not silently repeated", async () => {
  const client = {
    department: { findUnique: async () => ({ id: 1 }) },
    employeeWhatsAppGroup: { findFirst: async () => ({ id: 11 }) },
    employeeWhatsAppGroupDepartment: { findUnique: async () => ({ groupId: 11 }) },
  };
  await assert.rejects(
    () => service.addGroupToDepartment({ departmentId: 1, name: "Production Team", client }),
    (error) => error.status === 409 && /already under this department/.test(error.message),
  );
});

test("taking a group out of a department keeps the group itself", async () => {
  /*
   * It may serve other departments, and even where it does not it is a group the studio named and
   * may be adding people to by hand. A group under no department is simply one onboarding skips.
   */
  const asked = {};
  const client = {
    department: { findMany: async () => [] },
    employeeWhatsAppGroupDepartment: { deleteMany: async (args) => { asked.deleted = args; return { count: 1 }; } },
  };
  await service.removeGroupFromDepartment({ departmentId: 1, groupId: 11, client });
  assert.deepEqual(asked.deleted.where, { groupId: 11, departmentId: 1 });
  // Only the link is deleted. Nothing touches the group row.
  const source = fs.readFileSync(path.join(__dirname, "..", "src/modules/hrm/whatsapp-groups/service.js"), "utf8");
  const fn = source.slice(source.indexOf("async function removeGroupFromDepartment"));
  assert.doesNotMatch(fn.slice(0, fn.indexOf("\n}")), /employeeWhatsAppGroup\.delete/);
});

test("a group not under that department answers 404 rather than pretending", async () => {
  const client = { employeeWhatsAppGroupDepartment: { deleteMany: async () => ({ count: 0 }) } };
  await assert.rejects(
    () => service.removeGroupFromDepartment({ departmentId: 1, groupId: 11, client }),
    (error) => error.status === 404,
  );
});

test("the routes sit on Employee Management, and /departments is not read as a group id", () => {
  assert.match(ROUTES, /router\.use\(requireModule\("HRM", "Employee Management"\)\);/);
  assert.match(ROUTES, /router\.get\("\/departments", controller\.listDepartments\);/);
  assert.match(ROUTES, /router\.put\("\/:id\/departments", controller\.setGroupDepartments\);/);
  // The department-first routes, all above any `/:id`.
  assert.match(ROUTES, /router\.get\("\/department-groups", controller\.listDepartmentGroups\);/);
  assert.match(ROUTES, /router\.post\("\/departments\/:departmentId\/groups", controller\.addGroupToDepartment\);/);
  assert.match(ROUTES, /router\.delete\("\/departments\/:departmentId\/groups\/:groupId", controller\.removeGroupFromDepartment\);/);
  assert.ok(ROUTES.indexOf('router.get("/department-groups"') < ROUTES.indexOf('router.delete("/:id"'));
  const departmentsAt = ROUTES.indexOf('router.get("/departments"');
  const listAt = ROUTES.indexOf('router.get("/", controller.listGroups);');
  assert.ok(departmentsAt > -1 && departmentsAt < listAt, "above the list and any /:id route");
});
