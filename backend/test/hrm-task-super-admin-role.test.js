const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { taskRole, refusalFor } = require("../src/modules/hrm/tasks/service");

/*
 * Tasks treat both kinds of Super Admin alike: the account whose own `role` column says SUPER_ADMIN,
 * and the account given the SUPER_ADMIN role in Role Management. Reading the column alone left the
 * second an ordinary user for Reassign, Edit and Delete.
 */

// Reserved fixture prefix, swept by scripts/clear-test-fixtures.js if a run dies before `t.after`.
const STAMP = `TSA-${Date.now().toString(36)}`;

async function account(t, name, role = "USER") {
  const row = await prisma.user.create({ data: { name: `${STAMP} ${name}`, email: `${STAMP}-${name}@test.local`.toLowerCase(), username: `${STAMP}-${name}`.toLowerCase(), password: "x", role } });
  t.after(async () => {
    await prisma.userRole.deleteMany({ where: { userId: row.id } });
    await prisma.user.delete({ where: { id: row.id } });
  });
  return row;
}

test("the account's own SUPER_ADMIN column is recognised without asking the database", async () => {
  assert.equal(await taskRole(123456789, "SUPER_ADMIN"), "SUPER_ADMIN");
});

test("an account holding the SUPER_ADMIN role is a Super Admin to Tasks, and may reassign", async (t) => {
  const superRole = await prisma.role.findFirst({ where: { name: "SUPER_ADMIN", isActive: true }, select: { id: true } });
  if (!superRole) return t.skip("no active SUPER_ADMIN role in this database");
  const holder = await account(t, "holder");
  await prisma.userRole.create({ data: { userId: holder.id, roleId: superRole.id } });

  const role = await taskRole(holder.id, "USER");
  assert.equal(role, "SUPER_ADMIN");
  const task = { taskCode: "T-1", status: "PENDING", assignedToUserId: -1, assignedByUserId: -2 };
  assert.equal(refusalFor(task, "reassign", holder.id, role), null);
  assert.equal(refusalFor(task, "edit", holder.id, role), null);
  assert.equal(refusalFor(task, "delete", holder.id, role), null);
});

test("an ordinary account stays ordinary", async (t) => {
  const plain = await account(t, "plain");
  assert.equal(await taskRole(plain.id, "USER"), "USER");
});
