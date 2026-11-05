const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const employeeReferences = require("../src/services/employeeReferences");
const { definitions } = require("../src/modules/hrm/master-data/definitions");
const { renameUsage } = require("../src/modules/hrm/master-data/usage");

/*
 * An employee's master-data answers carry a reference beside their text.
 *
 * The form offers twelve lists and the row stored only the words, so nothing could join, count or
 * index an employee by department, and a renamed entry had to be chased through every row by its
 * spelling. `services/employeeReferences.js` derives the reference on every write (single-valued
 * answers as `*_id` columns, department / skills / languages as junction rows) and the migration
 * backfilled what was already there. These tests hold the matching rule and the wiring.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TMR-${STAMP}-${name}`;
const F = {};

before(async () => {
  F.designation = await prisma.designation.create({ data: { code: tag("DES"), name: `Refs Designation ${STAMP}` } });
  // Two departments spelt the same: an answer naming them is ambiguous and must resolve to nothing.
  F.twinA = await prisma.department.create({ data: { code: tag("TWIN-A"), name: `Refs Twin ${STAMP}` } });
  F.twinB = await prisma.department.create({ data: { code: tag("TWIN-B"), name: `Refs Twin ${STAMP}` } });
  F.sales = await prisma.department.create({ data: { code: tag("SALES"), name: `Refs Sales ${STAMP}` } });
  F.accounts = await prisma.department.create({ data: { code: tag("ACC"), name: `Refs Accounts ${STAMP}` } });
  F.photo = await prisma.skill.create({ data: { code: tag("PHOTO"), name: `Refs Photo ${STAMP}` } });
  F.edit = await prisma.skill.create({ data: { code: tag("EDIT"), name: `Refs Edit ${STAMP}`, isActive: false } });
  F.tamil = await prisma.language.create({ data: { code: tag("TA"), name: `Refs Tamil ${STAMP}` } });
  F.remote = await prisma.workLocation.create({ data: { code: tag("REMOTE"), name: `Refs Remote ${STAMP}` } });
  employeeReferences.invalidate();
});

after(async () => {
  const startsWith = tag("");
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith } } });
  for (const model of ["designation", "department", "skill", "language", "workLocation"]) {
    await prisma[model].deleteMany({ where: { code: { startsWith } } });
  }
});

test("a text answer resolves to the one list row spelt that way, whatever its case or spacing", async () => {
  const columns = await employeeReferences.referenceColumns({
    designation: `  refs designation ${STAMP} `,
    workBaseLocation: F.remote.name.toUpperCase(),
    gender: "Nobody Has This Gender",
  });
  assert.equal(columns.designationId, F.designation.id);
  assert.equal(columns.workBaseLocationId, F.remote.id);
  assert.equal(columns.genderId, null, "text naming nothing on the list keeps a NULL reference");
  assert.ok(!("bloodGroupId" in columns), "a key the save does not carry is not resolved, so a patch cannot blank it");
});

test("the branch and the vertical are resolved here too, the way the controller always did", async () => {
  const branch = await prisma.branch.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  if (!branch) return;
  const columns = await employeeReferences.referenceColumns({ workBaseLocation: "Nowhere", currentWorkLocation: branch.name });
  assert.equal(columns.branchId, branch.id, "the branch falls back from the work base to the current location");
});

test("a list answer becomes one row per entry, dropping what matches nothing and never guessing between twins", async () => {
  const employee = await prisma.employee.create({ data: { employeeId: tag("emp"), employeeName: `Refs Employee ${STAMP}` } });
  const answers = {
    department: `${F.sales.name}, ${F.twinA.name}, Not A Department`,
    skills: `${F.photo.name},${F.edit.name}`,
    languagesKnown: F.tamil.name,
  };
  await prisma.$transaction((tx) => employeeReferences.syncLists(tx, employee.id, answers));
  const departments = await prisma.employeeDepartment.findMany({ where: { employeeId: employee.id } });
  assert.deepEqual(departments.map((row) => row.departmentId), [F.sales.id], "the twin and the unknown name are left out");
  const skills = await prisma.employeeSkill.findMany({ where: { employeeId: employee.id }, orderBy: { skillId: "asc" } });
  assert.deepEqual(skills.map((row) => row.skillId).sort(), [F.photo.id, F.edit.id].sort(), "an inactive entry still matches");
  assert.equal((await prisma.employeeLanguage.count({ where: { employeeId: employee.id } })), 1);

  // A later save that mentions only the skills replaces the skill rows and leaves the others alone.
  await prisma.$transaction((tx) => employeeReferences.syncLists(tx, employee.id, { skills: F.edit.name }));
  assert.deepEqual((await prisma.employeeSkill.findMany({ where: { employeeId: employee.id } })).map((row) => row.skillId), [F.edit.id]);
  assert.equal((await prisma.employeeDepartment.count({ where: { employeeId: employee.id } })), 1, "departments were not mentioned, so they stay");
  // And an emptied list clears its rows.
  await prisma.$transaction((tx) => employeeReferences.syncLists(tx, employee.id, { skills: "" }));
  assert.equal((await prisma.employeeSkill.count({ where: { employeeId: employee.id } })), 0);
});

test("renaming a list entry in Field Settings rewrites the employee's text by the reference", async () => {
  const employee = await prisma.employee.create({ data: {
    employeeId: tag("renamed"), employeeName: `Refs Renamed ${STAMP}`,
    designation: "Refs Designatoin (typo)", designationId: F.designation.id,
  } });
  const next = `Refs Designation Renamed ${STAMP}`;
  // The list row is renamed by the Field Settings controller in the same transaction; this is that half.
  const changed = await prisma.$transaction(async (tx) => {
    await tx.designation.update({ where: { id: F.designation.id }, data: { name: next } });
    return renameUsage(tx, definitions.designations, F.designation.name, next, { id: F.designation.id });
  });
  assert.ok(changed >= 1);
  assert.equal((await prisma.employee.findUnique({ where: { id: employee.id } })).designation, next, "a drifted spelling follows the reference");
  F.designation.name = next;
});

test("every list the form offers declares its reference, and the lists held several of are junctions", () => {
  const single = Object.fromEntries(employeeReferences.SINGLE_REFERENCES.map(([text, id]) => [text, id]));
  for (const [text, id] of Object.entries({ designation: "designationId", workType: "workTypeId", gender: "genderId", bloodGroup: "bloodGroupId", maritalStatus: "maritalStatusId", emergencyContactRelationship: "emergencyContactRelationshipId", workBaseLocation: "workBaseLocationId", currentWorkLocation: "currentWorkLocationId" })) {
    assert.equal(single[text], id);
  }
  assert.deepEqual(employeeReferences.LIST_REFERENCES.map(([text]) => text), ["department", "skills", "languagesKnown"]);
  // Field Settings rewrites by the same references.
  for (const [key, field] of [["designations", "designation"], ["work-types", "workType"], ["genders", "gender"], ["blood-groups", "bloodGroup"], ["marital-statuses", "maritalStatus"], ["emergency-contact-relationships", "emergencyContactRelationship"], ["work-locations", "workBaseLocation"]]) {
    const use = definitions[key].usedBy.find((candidate) => candidate.model === "employee" && candidate.field === field);
    assert.ok(use?.idField, `${key} does not rewrite the employee's ${field} by reference`);
  }
});

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

test("every place an employee's answers are written also writes the references and the rows", () => {
  const employees = read("modules", "hrm", "employees", "controller.js");
  assert.match(employees, /return employeeReferences\.referenceColumns\(data\);/);
  assert.equal((employees.match(/await employeeReferences\.syncLists\(transaction, /g) || []).length, 3, "create, import and update each sync the lists");
  const onboarding = read("modules", "hrm", "onboarding-invites", "controller.js");
  assert.match(onboarding, /const references = await employeeReferences\.referenceColumns\(submitted\);/);
  assert.equal((onboarding.match(/await employeeReferences\.syncLists\(tx, /g) || []).length, 2, "a first submission and a resubmission each sync the lists");
  assert.match(read("modules", "hrm", "master-data", "controller.js"), /employeeReferences\.invalidate\(\);/, "Field Settings forgets the matchers when a list changes");
});
