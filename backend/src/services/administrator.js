const prisma = require("../config/db");

/**
 * Whether a login is an administrator, read from the database rather than the token.
 *
 * Three ways to be one, each already in use in this codebase: the legacy `user.role` column saying
 * SUPER_ADMIN; an active role carrying the Administrator tick (`role.isAdmin`), the reading the
 * WhatsApp chat module makes; and the active SUPER_ADMIN system role, which is what an administrator
 * added through Login Credentials carries while their column still says EMPLOYEE.
 *
 * For the few things that belong to administrators whatever permission levels a role has been
 * given - the attendance rules, removing somebody else's event - where "Read / Write on the
 * feature" is too wide, because every employee can be granted that.
 */
async function isAdministrator(userId) {
  const id = Number(userId) || null;
  if (!id) return false;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { role: true, roles: { select: { role: { select: { name: true, isAdmin: true, isActive: true } } } } },
  });
  if (!user) return false;
  return user.role === "SUPER_ADMIN"
    || user.roles.some((entry) => entry.role?.isActive && (entry.role.isAdmin || entry.role.name === "SUPER_ADMIN"));
}

/**
 * Whether a login is a **Super Admin** - narrower than `isAdministrator`, which also counts any role
 * with the Administrator tick. Two ways to be one: the legacy `user.role` column saying SUPER_ADMIN,
 * or an active role named SUPER_ADMIN. For the handful of things the studio keeps for its Super
 * Admins alone - reassigning anybody's task, deleting attendance requests outright.
 */
async function isSuperAdmin(userId) {
  const id = Number(userId) || null;
  if (!id) return false;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { role: true, roles: { select: { role: { select: { name: true, isActive: true } } } } },
  });
  if (!user) return false;
  // Read leniently, as Tasks always has: a column saying "super_admin " is still a Super Admin.
  const named = (value) => String(value || "").trim().toUpperCase() === "SUPER_ADMIN";
  return named(user.role) || user.roles.some((entry) => entry.role?.isActive && named(entry.role.name));
}

module.exports = { isAdministrator, isSuperAdmin };
