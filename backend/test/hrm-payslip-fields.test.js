const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../src/modules/hrm/payslip-fields/service");
const { payslipFor } = require("../src/modules/hrm/my-payslips/service");
const { payslipHtml } = require("../src/services/payslipPdfService");

/*
 * Settings → Payroll rules → Edit Payslip's Personal details and PF details: added fields, each
 * employee's answer, and the payslip printing them.
 */

function fakeClient(fields = []) {
  const writes = [];
  return {
    writes,
    payslipField: {
      findMany: async ({ where } = {}) => fields.filter((field) => (!where?.id || where.id.in.includes(field.id)) && (where?.archivedAt !== null || !field.archivedAt)),
      create: async ({ data }) => ({ id: 9, ...data }),
    },
    employeePayslipValue: {
      upsert: async (args) => { writes.push(["upsert", args.where.employeeId_fieldId.fieldId, args.create.value]); },
      deleteMany: async ({ where }) => { writes.push(["delete", where.fieldId]); },
    },
  };
}

test("an answer is checked against what its field takes", () => {
  assert.equal(service.valueProblem({ label: "Blood Group", inputType: "TEXT" }, "O+"), null);
  assert.equal(service.valueProblem({ label: "Dependants", inputType: "NUMBER" }, "two"), "Dependants takes a number.");
  assert.equal(service.valueProblem({ label: "PF Joined", inputType: "DATE" }, "2026-02-30x"), "PF Joined takes a date.");
  assert.equal(service.valueProblem({ label: "PF Joined", inputType: "DATE" }, "2025-06-01"), null);
  assert.equal(service.valueProblem({ label: "Anything", inputType: "NUMBER" }, ""), null, "empty clears it");
  // Text takes no digits; Text and number takes both.
  assert.match(service.valueProblem({ label: "Blood Group", inputType: "TEXT" }, "B2"), /takes text only/);
  assert.equal(service.valueProblem({ label: "Locker", inputType: "ALNUM" }, "Block 4B"), null);
  // Symbols are Any character's: Text and number refuses them, Any character takes everything.
  assert.match(service.valueProblem({ label: "Locker", inputType: "ALNUM" }, "B-4/2"), /choose "Any character"/);
  assert.equal(service.valueProblem({ label: "Locker", inputType: "ANY" }, "B-4/2 (A+) #9"), null);
  assert.deepEqual(service.INPUT_TYPES, ["TEXT", "NUMBER", "ALNUM", "ANY", "DATE", "DROPDOWN"]);
  // A Dropdown takes one of its own options, and nothing else.
  const bloodGroup = { label: "Blood Group", inputType: "DROPDOWN", options: ["A+", "B+", "O+"] };
  assert.equal(service.valueProblem(bloodGroup, "B+"), null);
  assert.equal(service.valueProblem(bloodGroup, "AB-"), "Blood Group: choose one of its options.");
});

test("a Dropdown is added with at least two options, each once; no other type takes options", async () => {
  const created = [];
  const client = { payslipField: { findMany: async () => [], create: async ({ data }) => { created.push(data); return { id: 1, ...data }; } } };
  const field = await service.createField({ section: "PERSONAL", label: "Blood Group", inputType: "DROPDOWN", options: [" A+ ", "B+", "A+", ""] }, 9, null, client);
  assert.deepEqual(field.options, ["A+", "B+"]);
  await assert.rejects(service.createField({ section: "PERSONAL", label: "Shift", inputType: "DROPDOWN", options: ["Day", " "] }, 9, null, client), /at least two options/);
  await service.createField({ section: "PF", label: "PF Joined", inputType: "DATE", options: ["ignored"] }, 9, null, client);
  assert.ok(!("options" in created.at(-1)), "a Date stores no options");
  const { createSchema } = require("../src/modules/hrm/payslip-fields/controller");
  assert.equal(createSchema.safeParse({ section: "PF", label: "PF Joined", inputType: "DATE", options: ["x"] }).success, false, "only a dropdown takes options");
  assert.equal(createSchema.safeParse({ section: "PERSONAL", label: "Blood Group", inputType: "DROPDOWN", options: ["A+", "B+"] }).success, true);
});

test("answers are written, cleared, and refused for a field no longer offered", async () => {
  const fields = [{ id: 1, label: "Blood Group", inputType: "TEXT" }, { id: 2, label: "Dependants", inputType: "NUMBER" }, { id: 3, label: "Old", inputType: "TEXT", archivedAt: new Date() }];
  const client = fakeClient(fields);
  await service.saveValues(366, { 1: " O+ ", 2: "" }, client);
  assert.deepEqual(client.writes, [["upsert", 1, "O+"], ["delete", 2]]);
  await assert.rejects(service.saveValues(366, { 3: "x" }, client), /no longer offered/);
  await assert.rejects(service.saveValues(366, { 2: "two" }, client), /takes a number/);
});

test("only somebody who reaches every branch changes them, and never under a built-in name", async () => {
  await assert.rejects(service.createField({ section: "PF", label: "Branch PF", inputType: "TEXT" }, 7, [1], fakeClient()), /every branch/);
  await assert.rejects(service.createField({ section: "PERSONAL", label: "PAN", inputType: "TEXT" }, 7, null, fakeClient()), /already one of the payslip's own details/);
  const created = await service.createField({ section: "PF", label: "PF Joining Date", inputType: "DATE" }, 7, null, fakeClient());
  assert.deepEqual([created.section, created.label, created.inputType], ["PF", "PF Joining Date", "DATE"]);
});

test("the payslip prints them - a PF one only when it carries the PF details", () => {
  const employee = {
    employeeId: "DBS-6", employeeName: "Karthik Selvam", payslipValues: [
      { value: "O+", field: { id: 1, label: "Blood Group", section: "PERSONAL", inputType: "TEXT", sortOrder: 1 } },
      { value: "2025-06-01", field: { id: 2, label: "PF Joining Date", section: "PF", inputType: "DATE", sortOrder: 2 } },
    ],
  };
  const payslip = payslipFor({ year: 2026, month: 10, baseSalary: 1000, rules: {}, componentAmounts: {} }, employee, []);
  assert.deepEqual(payslip.employee.slice(-2), [["Blood Group", "O+"], ["PF Joining Date", "01 Jun 2025", "PF"]]);
  assert.ok(payslipHtml({ heading: { details: "PERSONAL_AND_PF" }, payslip }).includes("<th>PF Joining Date</th>"));
  const personal = payslipHtml({ heading: { details: "PERSONAL" }, payslip });
  assert.ok(personal.includes("<th>Blood Group</th>") && !personal.includes("<th>PF Joining Date</th>"));
});

test("read on the payroll rules or the employee record; changed on Payroll Register Read / Write", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payslip-fields", "routes.js"), "utf8");
  assert.match(routes, /router\.get\("\/", reads, controller\.listFields\);/);
  assert.match(routes, /const writes = checkPermission\("HRM", "Payroll Register", "READ_WRITE"\);/);
  for (const line of ['router.post("/", writes,', 'router.put("/:id", writes,', 'router.delete("/:id", writes,']) assert.ok(routes.includes(line), line);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8"), /app\.use\("\/api\/hrm\/payslip-fields", hrmPayslipFieldRoutes\);/);
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012290000_payslip_fields", "migration.sql"), "utf8");
  assert.match(sql, /UNIQUE INDEX `employee_payslip_value_employee_id_field_id_key`\(`employee_id`, `field_id`\)/);
});

test("answers are sent only on an edit, keyed by a field's plain id", () => {
  const { employeeSchema } = require("../src/modules/hrm/employees/controller");
  const update = employeeSchema.partial();
  assert.equal(update.safeParse({ payslipValues: { 1: "O+" } }).success, true);
  for (const key of ["1e0", "0x1", " 1", "abc"]) assert.equal(update.safeParse({ payslipValues: { [key]: "O+" } }).success, false, key);
  // Adding or importing an employee takes none - Payslip Details is an edit of a record that exists.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");
  assert.match(source, /const createEmployeeSchema = employeeSchema\.omit\(\{ employeeId: true, payslipValues: true, payslipPersonalDetails: true \}\);/);
});

test("Edit Payslip starts with the brought-in figures alone; every other item is added, and has an on/off", async () => {
  let state = {};
  const client = {
    hrmSettings: {
      findUnique: async () => ({ payslipBuiltInItems: state }),
      upsert: async ({ update }) => { state = update.payslipBuiltInItems; },
    },
    payslipField: { findMany: async () => [{ label: "Blood Group" }] },
    payrollComponent: { findMany: async () => [{ name: "Canteen" }] },
  };
  /*
   * Nothing done yet: only the figures the payroll row brings in are listed and printed - Salary,
   * Referral Bonus, LOP Deduction, Salary Advance, Recovery and Policy Breach. Each can be turned
   * off, none deleted: they are what the month was worked out from.
   */
  const listed = async () => (await service.builtInItems({ client })).filter((item) => !item.deleted).map((item) => item.label);
  assert.deepEqual(await listed(), ["Salary", "Referral Bonus", "LOP Deduction", "Salary Advance", "Recovery", "Policy Breach"]);
  assert.ok((await service.hiddenPayslipItems({ client })).includes("Emp Code"), "an item not added is not printed");
  // Added, one is listed and printed; turned off, it is listed and not printed; deleted, it goes again.
  await service.setBuiltInItem("PAN", { deleted: false }, null, client);
  await service.setBuiltInItem("Incentive", { deleted: false }, null, client);
  assert.deepEqual(await listed(), ["PAN", "Salary", "Incentive", "Referral Bonus", "LOP Deduction", "Salary Advance", "Recovery", "Policy Breach"]);
  await service.setBuiltInItem("PAN", { shown: false }, null, client);
  await service.setBuiltInItem("Incentive", { deleted: true }, null, client);
  assert.deepEqual(state, { PAN: { deleted: false, shown: false }, Incentive: { deleted: true } });
  const hidden = await service.hiddenPayslipItems({ client });
  assert.ok(["PAN", "Incentive", "Blood Group", "Canteen"].every((name) => hidden.includes(name)) && !hidden.includes("Salary"));
  // Restoring a deleted one brings it back, on.
  assert.deepEqual(await service.setBuiltInItem("Incentive", { deleted: false }, null, client), { group: "EARNING", label: "Incentive", name: "Incentive", deletable: true, shown: true, deleted: false });
  // Edit renames one: the payslip prints the new name in its place; its own label again puts it back.
  await service.setBuiltInItem("PAN", { name: "PAN Card" }, null, client);
  assert.deepEqual(await service.renamedPayslipItems({ client }), { PAN: "PAN Card" });
  await assert.rejects(service.setBuiltInItem("PAN", { name: "Salary" }, null, client), (error) => error.status === 409);
  await assert.rejects(service.setBuiltInItem("PAN", { name: "canteen" }, null, client), /already has "canteen"/);
  await assert.rejects(service.setBuiltInItem("PAN", { name: "  " }, null, client), /Name the item/);
  await service.setBuiltInItem("PAN", { name: "PAN" }, null, client);
  assert.deepEqual(await service.renamedPayslipItems({ client }), {});
  await assert.rejects(service.setBuiltInItem("Something Else", { shown: false }, null, client), /not one of the payslip's own/);
  // What the payroll is worked out from is renamed or turned off, never deleted.
  // Referral Bonus with them: a figure the payroll row brings in, not one anybody types here.
  assert.deepEqual(service.UNDELETABLE_ITEMS, ["Salary", "LOP Deduction", "Salary Advance", "Recovery", "Policy Breach", "Referral Bonus"]);
  for (const label of service.UNDELETABLE_ITEMS) await assert.rejects(service.setBuiltInItem(label, { deleted: true }, null, client), /cannot be deleted/);
  assert.deepEqual((await service.builtInItems({ client })).filter((item) => !item.deletable).map((item) => item.label), ["Salary", "Referral Bonus", "LOP Deduction", "Salary Advance", "Recovery", "Policy Breach"]);
  await assert.rejects(service.setBuiltInItem("PAN", { shown: false }, [1], client), /every branch/);

  const html = payslipHtml({ heading: { hiddenItems: ["PAN", "Incentive"] } });
  assert.ok(!html.includes("<th>PAN</th>") && !html.includes("<td>Incentive</td>") && html.includes("<td>Salary</td>"));
});
