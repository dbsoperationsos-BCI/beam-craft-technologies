const express = require("express");
const { mountBulkDelete } = require("../../services/bulkDelete");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/db");
const { protect } = require("../../middleware/authMiddleware");
const { checkPermission } = require("../../middleware/permissionMiddleware");
const iamService = require("../../services/iam.service");
// The application's own phone rule, so a number stored here is one the SMS gateway will take.
const { normalizePhoneNumber } = require("../../services/phoneNumber");
const { LINKABLE_EMPLOYEE_FIELDS, linkProblem, linkableEmployee, readLinkedEmployeeId } = require("./userEmployeeLink");

const router = express.Router();
router.use(protect);

// User ids are auto-increment ints; group, role and permission ids are cuids. Parsing a cuid as a
// number gives NaN, which Prisma rejects with a type error rather than a 404, so the two kinds of
// id are read differently and never interchangeably.
const userId = (value) => Number.parseInt(value, 10);
const branchIdOf = (value) => (value === null || value === undefined || value === "" ? null : Number.parseInt(value, 10));

// `mobile` is read as well as written: it is where a password-reset code goes for a login with no
// employee record behind it, and the screen that sets it has to show what is already there.
// `linkedEmployeeId` is read as well as written: the link is what Attendance, Payment Requests,
// Tasks and the org chart find the person behind a login, so the screen that sets it has to
// show which person is there now. It is a plain unique column rather than a relation, so the
// employee behind it is attached by `withLinkedEmployees` below rather than by a Prisma select.
const userFields = { id: true, name: true, email: true, mobile: true, branchId: true, role: true, status: true, linkedEmployeeId: true, branch: { select: { id: true, name: true } } };

/**
 * Attaches the employee behind each account, as `linkedEmployee` or null.
 *
 * One query for the whole page rather than one per row, and the same manual join the Employee
 * Repository does in the other direction — `User.linkedEmployeeId` is a plain unique column, not
 * a foreign key, so Prisma cannot follow it. An id pointing at an employee since archived reads
 * back as null, which is the honest answer and is what the picker then offers to correct.
 */
async function withLinkedEmployees(users) {
  const ids = [...new Set(users.map((user) => user.linkedEmployeeId).filter(Boolean))];
  if (!ids.length) return users.map((user) => ({ ...user, linkedEmployee: null }));
  const employees = await prisma.employee.findMany({
    where: { id: { in: ids }, archivedAt: null },
    select: { id: true, employeeId: true, employeeName: true, department: true, designation: true },
  });
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  return users.map((user) => ({ ...user, linkedEmployee: byId.get(user.linkedEmployeeId) || null }));
}

// Every handler is wrapped so a rejected Prisma call reaches the server's error handler instead of
// hanging the request as an unhandled rejection.
const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const ACCESS_LEVELS = ["DISABLED", "READ", "READ_WRITE"];

/**
 * The mobile a reset code would be sent to, checked before it is stored.
 *
 * Held to the application's own phone rule rather than accepted as typed: a number saved in a shape
 * no gateway will take is a login that looks recoverable and is not, and nothing would say so until
 * somebody actually needed it. Blank clears it, which is how a number is removed.
 *
 * Answers `{ ok, value }` or `{ ok: false, message }`.
 */
function readMobile(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, value: null };
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return { ok: false, message: "Enter the mobile number with its country code, as +91 9876543210." };
  return { ok: true, value: normalized };
}

/**
 * Prisma's unique-constraint error, turned into the sentence the check below would have given.
 *
 * `readLink` reads the holder and the write happens after it, so two administrators linking the
 * same employee at once can both pass the check and the second lose the index. Rare, and a 500
 * telling an administrator nothing is not the way to report it.
 */
function refuseLostLinkRace(error, res) {
  if (error?.code !== "P2002") return false;
  const target = String(error?.meta?.target ?? "");
  if (!target.includes("linked_employee_id") && !target.includes("linkedEmployeeId")) return false;
  res.status(409).json({ message: "That employee was linked to another login a moment ago. Reopen the list and choose again." });
  return true;
}

/**
 * The employee a save wants this login joined to, checked against the repository before it is
 * written. Replies with the reason and answers null when it cannot be, so a caller reads
 * `if (!link) return;` exactly as it does for the mobile number and the permission matrix.
 *
 * `targetUserId` is the account being saved, so re-saving a link already in place is not reported
 * as a clash with itself. Answers `{ value }` with null meaning "no employee", which is how a
 * wrong link is undone.
 */
async function readLink(raw, res, targetUserId = null) {
  const parsed = readLinkedEmployeeId(raw);
  if (!parsed.ok) { res.status(400).json({ message: parsed.message }); return null; }
  if (parsed.value === null) return { value: null };

  const [employee, holder] = await Promise.all([
    prisma.employee.findUnique({ where: { id: parsed.value }, select: { id: true, employeeName: true, archivedAt: true } }),
    prisma.user.findFirst({ where: { linkedEmployeeId: parsed.value }, select: { id: true, name: true } }),
  ]);
  const problem = linkProblem({ employee, linkedTo: holder?.id || null, userId: targetUserId, linkedUserName: holder?.name || "" });
  if (problem) { res.status(400).json({ message: problem }); return null; }
  return { value: parsed.value };
}

// Validates a permission matrix coming from an editor and answers null after replying with the
// reason, so a caller can `if (!grants) return;`. Every id is checked to exist: a grant naming a
// permission that does not would otherwise fail as a foreign key error, which reads as a server
// fault rather than as the bad request it is. Rows set to DISABLED are dropped rather than stored —
// under most-permissive-wins a DISABLED row grants nothing and is indistinguishable from absence,
// so keeping it would only be a row that looks meaningful and is not.
async function readGrants(input, res) {
  if (!Array.isArray(input)) { res.status(400).json({ message: "Send permissions as a list." }); return null; }

  const wanted = [];
  for (const entry of input) {
    const permissionId = entry?.permissionId;
    const accessLevel = entry?.accessLevel;
    if (!permissionId || !ACCESS_LEVELS.includes(accessLevel)) {
      res.status(400).json({ message: `Each permission needs a permissionId and an accessLevel of ${ACCESS_LEVELS.join(", ")}.` });
      return null;
    }
    if (accessLevel === "DISABLED") continue;
    const scopeIds = Array.isArray(entry.scopeIds) ? [...new Set(entry.scopeIds.filter(Boolean))] : [];
    wanted.push({ permissionId, accessLevel, scopeIds });
  }

  // Deduplicate on the way in: the unique index would reject a repeated permission with a raw
  // database error, and the caller only ever means one level per permission.
  const byPermission = new Map(wanted.map((grant) => [grant.permissionId, grant]));
  const grants = [...byPermission.values()];
  if (!grants.length) return grants;

  const found = await prisma.permission.count({ where: { id: { in: grants.map((grant) => grant.permissionId) } } });
  if (found !== grants.length) { res.status(400).json({ message: "One of those permissions no longer exists." }); return null; }

  return grants;
}

// "Branch Manager" → "Branch Manager (copy)" → "Branch Manager (copy 2)". Duplicating twice should
// not fail on the unique name, and should not make the person think of a name before they can look
// at what they copied.
async function nextCopyName(model, sourceName) {
  const base = `${sourceName} (copy`;
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const candidate = attempt === 1 ? `${base})` : `${base} ${attempt})`;
    const taken = await model.findUnique({ where: { name: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${sourceName} (copy ${Date.now()})`;
}

const READ_USERS = checkPermission("ADMIN", "User Management", "READ");
const WRITE_USERS = checkPermission("ADMIN", "User Management", "READ_WRITE");
const READ_ROLES = checkPermission("ADMIN", "Role Management", "READ");
const WRITE_ROLES = checkPermission("ADMIN", "Role Management", "READ_WRITE");

// Branches are not served from here: they are the `locations` master data, already listed by
// GET /api/hrm/locations, and the admin screens read them from there.

// ============= USERS =============
router.get("/users", READ_USERS, route(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));

  // A branch manager administers their own branch, so the list is scoped the same way every other
  // module's is. A SUPER_ADMIN gets an empty filter back and so sees every branch.
  const branchFilter = await iamService.buildBranchFilter(req.user.id, { module: "ADMIN", feature: "User Management" });

  // Narrowed here rather than by the screen, so `total` counts what is actually listed: filtering a
  // page of 50 after it arrives would leave the footer promising rows that were thrown away.
  const where = {
    ...branchFilter,
    ...(req.query.status ? { status: String(req.query.status) } : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { name: "asc" }, select: userFields }),
    prisma.user.count({ where }),
  ]);

  res.json({ data: await withLinkedEmployees(users), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

/**
 * The employees an account can be linked to.
 *
 * Served from the admin router under `ADMIN / User Management` rather than read from
 * `GET /api/hrm/employees`, which answers to `HRM / Employee Management`. Pointing the Users screen
 * at that endpoint would have meant an administrator needed the Employee Repository's permission to
 * finish a job on their own screen — the trap CLAUDE.md names, where a screen ends up asking for a
 * permission the endpoint behind it decides. What is disclosed here is the minimum a picker needs:
 * a code, a name, a department and a designation.
 *
 * Not narrowed by branch, deliberately. `Employee.branchId` exists but is NULL for everyone recorded
 * before it did and stays so until the match report backfills it (IAM.md), so a branch filter here
 * would hand a branch manager an all-but-empty list and hide the very people they are trying to
 * link. The Users list beside it *is* branch-scoped, so they can still only act on their own
 * accounts; this endpoint widens who they can *name*, not what they can change.
 */
router.get("/linkable-employees", READ_USERS, route(async (req, res) => {
  const [employees, linked] = await Promise.all([
    prisma.employee.findMany({ where: { archivedAt: null }, orderBy: { employeeName: "asc" }, select: LINKABLE_EMPLOYEE_FIELDS }),
    prisma.user.findMany({ where: { linkedEmployeeId: { not: null } }, select: { id: true, linkedEmployeeId: true } }),
  ]);
  const takenBy = new Map(linked.map((user) => [user.linkedEmployeeId, user.id]));
  res.json({ data: employees.map((employee) => linkableEmployee(employee, takenBy.get(employee.id) || null)) });
}));

router.get("/users/:userId", READ_USERS, route(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: userId(req.params.userId) }, select: userFields });
  if (!user) return res.status(404).json({ message: "User not found." });
  const [withEmployee] = await withLinkedEmployees([user]);
  res.json({ data: withEmployee });
}));

router.post("/users", WRITE_USERS, route(async (req, res) => {
  const { name, email, password, branchId, role, mobile, linkedEmployeeId } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are all required." });

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return res.status(409).json({ message: "A user with that email already exists." });
  if (await refuseUnreachableBranch(req, res, branchIdOf(branchId))) return;
  const number = readMobile(mobile);
  if (!number.ok) return res.status(400).json({ message: number.message });
  // Optional here, and normally left alone: an account raised from the Employee Repository arrives
  // linked already. It is accepted so an account created on this screen need not be edited twice.
  const link = linkedEmployeeId === undefined ? { value: null } : await readLink(linkedEmployeeId, res);
  if (!link) return;

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name,
        email,
        // Hashed here and never stored as typed - the login route compares against a bcrypt hash, so
        // a plain string in this column would also be a password that can never sign in.
        password: await bcrypt.hash(password, 12),
        branchId: branchIdOf(branchId),
        role: role || "STAFF",
        // Where a reset code goes for an account with no employee record. See `readMobile`.
        mobile: number.value,
        linkedEmployeeId: link.value,
        mustChangePassword: true,
      },
      select: userFields,
    });
  } catch (error) {
    if (refuseLostLinkRace(error, res)) return;
    throw error;
  }

  const [created] = await withLinkedEmployees([user]);
  res.status(201).json({ data: created });
}));

router.patch("/users/:userId", WRITE_USERS, route(async (req, res) => {
  const id = userId(req.params.userId);
  const { name, email, branchId, role, status, mobile, linkedEmployeeId } = req.body || {};

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return res.status(404).json({ message: "User not found." });
  if (branchId !== undefined && await refuseUnreachableBranch(req, res, branchIdOf(branchId))) return;
  const number = mobile === undefined ? null : readMobile(mobile);
  if (number && !number.ok) return res.status(400).json({ message: number.message });
  // Left out of the body entirely means "do not touch it", which is what every other field here
  // means; sent as null or "none" means unlink, which somebody linked to the wrong person needs.
  const link = linkedEmployeeId === undefined ? null : await readLink(linkedEmployeeId, res, id);
  if (linkedEmployeeId !== undefined && !link) return;

  let user;
  try {
    user = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(branchId !== undefined && { branchId: branchIdOf(branchId) }),
        ...(role !== undefined && { role }),
        ...(status !== undefined && { status }),
        ...(number && { mobile: number.value }),
        ...(link && { linkedEmployeeId: link.value }),
      },
      select: userFields,
    });
  } catch (error) {
    if (refuseLostLinkRace(error, res)) return;
    throw error;
  }

  /*
   * ── One person, one name ──────────────────────────────────────────────────────────────────────
   *
   * The other half of the rule the Employee Repository applies when somebody is renamed there: the
   * same person's name lives on two records, and a rename in either screen has to reach the other
   * or every reader of the one that was not edited goes on showing who they used to be. Every
   * employee dropdown reads the employee record, so a rename here used to change nothing anybody
   * could see.
   *
   * **On update only.** Creating an account must not rename the person it is for - an account
   * raised against an existing employee would otherwise overwrite the HR register with whatever was
   * typed into the accounts form. This sat in the create handler on the first attempt, where it did
   * exactly that and where `id` does not exist at all, so its own catch threw.
   *
   * Written after the login rather than in a transaction with it: this screen owns the login and
   * only mirrors the employee, and a failure to mirror must not refuse a rename that has already
   * been made. Logged instead - saving either screen again brings the two back into step, which a
   * refusal could not.
   */
  if (name !== undefined && user.linkedEmployeeId) {
    try {
      await prisma.employee.update({ where: { id: user.linkedEmployeeId }, data: { employeeName: name } });
    } catch (error) {
      console.warn(`Renamed user ${id} but could not rename employee ${user.linkedEmployeeId}:`, error?.message || error);
    }
  }

  const [updated] = await withLinkedEmployees([user]);
  res.json({ data: updated });
}));

/**
 * Deleting one account, as the route and the bulk delete both do it.
 *
 * Both refusals matter more over a selection than over a single row, which is why this is one
 * function rather than two copies: ticking every account on the screen and pressing Delete must
 * still not end the session doing the deleting, and must still not take the last Super Admin with
 * it. Answers `{ error }` rather than writing a response, so the route can turn it into a status
 * code and the bulk runner can count it as an id it could not take.
 */
async function removeUser(req, id) {
  // Deleting your own account ends the session that is doing the deleting, and it is the one
  // account whose loss cannot be undone by the person holding the screen.
  if (id === req.user.id) return { status: 400, error: "You cannot delete your own account." };

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } });
  if (!target) return { status: 404, error: "User not found." };
  // The last SUPER_ADMIN is the only account that can restore anyone else's access, so it is not
  // deletable while it is the last one - otherwise the studio locks itself out of its own IAM.
  if (target.role === "SUPER_ADMIN") {
    const superAdmins = await prisma.user.count({ where: { role: "SUPER_ADMIN" } });
    if (superAdmins <= 1) return { status: 400, error: "The last super admin cannot be deleted." };
  }

  await prisma.user.delete({ where: { id } });
  return { status: 200 };
}

const deleteUserRecord = async (req, id) => {
  const answer = await removeUser(req, userId(id));
  if (answer.error) throw new Error(answer.error);
  return { id };
};

/*
 * The ticked accounts, deleted together. Above `DELETE /users/:userId` because `/bulk` is a fixed
 * segment. `WRITE_USERS` is mounted here exactly as it is below, and `mountBulkDelete` pairs it
 * with `ADMIN / Table Select All` - so this is for somebody who could already have deleted each of
 * these accounts by hand. `removeUser` still refuses their own account and the last Super Admin,
 * per id, and those two land in `missedIds` with their rows left ticked.
 */
mountBulkDelete(router, { path: "/users/bulk", guard: WRITE_USERS, deleteOne: (id, req) => deleteUserRecord(req, id), noun: "user" });

router.delete("/users/:userId", WRITE_USERS, route(async (req, res) => {
  const answer = await removeUser(req, userId(req.params.userId));
  if (answer.error) return res.status(answer.status).json({ message: answer.error });
  res.json({ message: "User deleted." });
}));

// ============= USER ROLES =============
// A user carries roles directly. The role decides what may be done and which branches it reaches,
// so this pair of endpoints is the whole of who-can-do-what for one person.
router.get("/users/:userId/roles", READ_USERS, route(async (req, res) => {
  const held = await iamService.getUserRoles(userId(req.params.userId));
  res.json({ data: held.map((entry) => entry.role) });
}));

router.post("/users/:userId/roles", WRITE_USERS, route(async (req, res) => {
  const { roleId } = req.body || {};
  if (!roleId) return res.status(400).json({ message: "A role is required." });

  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true } });
  if (!role) return res.status(404).json({ message: "Role not found." });

  await iamService.assignRoleToUser(userId(req.params.userId), roleId);
  res.status(201).json({ message: "Role assigned." });
}));

router.delete("/users/:userId/roles/:roleId", WRITE_USERS, route(async (req, res) => {
  await iamService.removeRoleFromUser(userId(req.params.userId), req.params.roleId);
  res.json({ message: "Role removed." });
}));

// ============= ROLES =============
// A role holds its permissions directly - there is no layer between a role and what it grants - and
// a group is given as many roles as it needs.
const roleShape = {
  // How many people who can actually sign in carry it. Two roles whose names differ only by
  // "(copy)" are otherwise indistinguishable in the list, so the one you may not delete looks
  // exactly like the one you may - and you find out only when the delete is refused.
  //
  // Closed accounts are left out on purpose, and the delete guard below agrees: an account that
  // cannot sign in is not using what a role grants, and the Users screen does not list it, so
  // counting it would block a delete against somebody nobody can reach to unassign.
  _count: { select: { users: { where: { user: { status: "ACTIVE" } } } } },
  branches: { include: { branch: { select: { id: true, name: true } } } },
  permissions: {
    include: {
      permission: { include: { scopes: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } } },
      scopes: true,
    },
  },
};


/**
 * Whether the person making the request may put somebody, or something, in that branch.
 *
 * An administrator hands out reach; they cannot hand out more than they have. A branch manager
 * given the Users screen was otherwise one request away from posting themselves into another branch
 * — or granting a role that reaches it — which is the whole branch model undone from inside. A super
 * admin reaches everywhere and is stopped by none of this.
 */
async function refuseUnreachableBranch(req, res, branchId) {
  if (branchId === null || branchId === undefined) return false;
  if (await iamService.canUseBranchId(req.user.id, branchId, { module: "ADMIN", feature: "User Management", level: "READ_WRITE" })) return false;
  res.status(403).json({ message: "You cannot assign a branch you do not have access to." });
  return true;
}

/*
 * The branches a role reaches, validated against real ones.
 *
 * **At least one, always.** The dialog has marked Branches required since it was written, but the
 * mark was the only thing saying so: the field is a custom one, which the schema form deliberately
 * does not judge, and this read accepted `[]` as "parked". So the form asked for a branch, refused
 * nothing when it was not given, and saved a role that reaches nowhere and grants nothing anywhere
 * - which reads as the permissions not working rather than as a role that was never finished. A
 * role is parked by deactivating it, which is a decision with a switch of its own.
 *
 * A list naming a branch that does not exist is a bad request, not a foreign key error.
 */
async function readBranchIds(input, res, req) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) { res.status(400).json({ message: "Send branchIds as a list." }); return null; }

  const branchIds = [...new Set(input.map((value) => Number.parseInt(value, 10)))];
  if (branchIds.some((value) => Number.isNaN(value))) { res.status(400).json({ message: "Every branch must be an id." }); return null; }
  if (!branchIds.length) { res.status(400).json({ message: "A role must reach at least one branch. Select the branches this role applies in." }); return null; }

  const found = await prisma.branch.count({ where: { id: { in: branchIds } } });
  if (found !== branchIds.length) { res.status(400).json({ message: "One of those branches no longer exists." }); return null; }

  /*
    * And every one of them within the reach of whoever is granting it - measured by **Role
    * Management**, which is the permission they are exercising by being on this screen at all.
    * Not by the role being edited: somebody must not be able to widen their own reach by writing a
    * role that names a branch they cannot themselves touch.
    */
  const reachable = await iamService.reachableBranchIds(req.user.id, { module: "ADMIN", feature: "Role Management", level: "READ_WRITE" });
  if (reachable !== null && branchIds.some((id) => !reachable.includes(id))) {
    res.status(403).json({ message: "You cannot grant a role access to a branch you do not have access to." });
    return null;
  }

  return branchIds;
}

async function writeRoleBranches(roleId, branchIds) {
  await prisma.$transaction([
    prisma.roleBranch.deleteMany({ where: { roleId } }),
    ...(branchIds.length ? [prisma.roleBranch.createMany({ data: branchIds.map((branchId) => ({ roleId, branchId })) })] : []),
  ]);
}

// Refuses the one edit that cannot be undone from the screen doing it: Super Admin is the account
// that restores everyone else's access, so it is not editable, renameable or deletable.
const guardSystemRole = async (roleId, res) => {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true, isSystem: true } });
  if (!role) { res.status(404).json({ message: "Role not found." }); return null; }
  if (role.isSystem) { res.status(400).json({ message: `${role.name} is a system role and cannot be changed. Duplicate it to make an editable copy.` }); return null; }
  return role;
};

// Writes a role's whole permission matrix in one go, scopes included. The editor sends every row it
// knows about, so a permission left out is one being withdrawn - and withdrawing it takes its
// ticked scopes with it, because they hang off the grant.
/** The permissions the role editor is not offered, and therefore cannot send back. */
async function unofferedPermissionIds() {
  const rows = await prisma.permission.findMany({
    where: { module: iamService.TICK_CARRIES.module, feature: iamService.TICK_CARRIES.feature },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

async function writeRoleMatrix(roleId, grants) {
  /*
   * This replaces a role's matrix whole, which is right for everything the editor draws and fatal
   * for anything it does not: a permission the editor never received is a permission it cannot send
   * back, so opening a role and saving it would quietly revoke one. Roles granted
   * `ADMIN / Branch Administration` before the tick carried it still hold it, and keep it.
   *
   * The same ids are dropped from what arrives, so the API cannot be used to set by hand what the
   * screen deliberately does not offer.
   */
  const unoffered = await unofferedPermissionIds();
  const carried = unoffered.size
    ? await prisma.rolePermission.findMany({ where: { roleId, permissionId: { in: [...unoffered] } }, select: { permissionId: true, accessLevel: true } })
    : [];
  const offered = grants.filter((grant) => !unoffered.has(grant.permissionId));

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    for (const grant of [...offered, ...carried]) {
      const created = await tx.rolePermission.create({
        data: { roleId, permissionId: grant.permissionId, accessLevel: grant.accessLevel },
      });
      if (grant.scopeIds?.length) {
        await tx.rolePermissionScope.createMany({
          data: grant.scopeIds.map((scopeId) => ({ rolePermissionId: created.id, scopeId })),
        });
      }
    }
  });
}

router.get("/roles", READ_ROLES, route(async (req, res) => {
  const roles = await prisma.role.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, include: roleShape });
  res.json({ data: roles });
}));

router.get("/roles/:roleId", READ_ROLES, route(async (req, res) => {
  const role = await prisma.role.findUnique({ where: { id: req.params.roleId }, include: roleShape });
  if (!role) return res.status(404).json({ message: "Role not found." });
  res.json({ data: role });
}));

router.post("/roles", WRITE_ROLES, route(async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ message: "A role needs a name." });

  const existing = await prisma.role.findUnique({ where: { name }, select: { id: true } });
  if (existing) return res.status(409).json({ message: "A role with that name already exists." });

  // The whole role arrives from one dialog - identification, characteristics and the permission
  // matrix together - so it is created complete rather than created empty and then filled in.
  const grants = await readGrants(req.body?.permissions ?? [], res);
  if (!grants) return;
  const branchIds = await readBranchIds(req.body?.branchIds ?? [], res, req);
  if (branchIds === null) return;

  const created = await prisma.role.create({
    data: {
      name,
      description: description || null,
      isAdmin: Boolean(req.body?.isAdmin),
      isBranchManager: Boolean(req.body?.isBranchManager),
      isDepartmentLead: Boolean(req.body?.isDepartmentLead),
    },
  });
  if (grants.length) await writeRoleMatrix(created.id, grants);
  await writeRoleBranches(created.id, branchIds);

  const role = await prisma.role.findUnique({ where: { id: created.id }, include: roleShape });
  res.status(201).json({ data: role });
}));

router.patch("/roles/:roleId", WRITE_ROLES, route(async (req, res) => {
  if (!(await guardSystemRole(req.params.roleId, res))) return;
  const { name, description, isActive, isAdmin, isBranchManager, isDepartmentLead } = req.body || {};

  if (name) {
    const clash = await prisma.role.findFirst({ where: { name, NOT: { id: req.params.roleId } }, select: { id: true } });
    if (clash) return res.status(409).json({ message: "A role with that name already exists." });
  }

  // Permissions and branches are optional on an edit: the dialog sends both, a rename from
  // elsewhere need send neither. Sending branches and sending none of them is not the same thing -
  // an empty list is refused rather than stored, see `readBranchIds`.
  if (req.body?.permissions !== undefined) {
    const grants = await readGrants(req.body.permissions, res);
    if (!grants) return;
    await writeRoleMatrix(req.params.roleId, grants);
  }
  if (req.body?.branchIds !== undefined) {
    const branchIds = await readBranchIds(req.body.branchIds, res, req);
    if (branchIds === null) return;
    await writeRoleBranches(req.params.roleId, branchIds);
  }

  await prisma.role.update({
    where: { id: req.params.roleId },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(isActive !== undefined && { isActive }),
      ...(isAdmin !== undefined && { isAdmin: Boolean(isAdmin) }),
      ...(isBranchManager !== undefined && { isBranchManager: Boolean(isBranchManager) }),
      ...(isDepartmentLead !== undefined && { isDepartmentLead: Boolean(isDepartmentLead) }),
    },
  });

  const role = await prisma.role.findUnique({ where: { id: req.params.roleId }, include: roleShape });
  res.json({ data: role });
}));

/**
 * Deleting one role, as the route and the bulk delete both do it.
 *
 * The two refusals are the point of sharing it: a system role is never deletable, and a role
 * somebody still carries takes their access with it. A selection that ticks every row must run
 * both per role, or one press strips the studio's own IAM. Answers `{ error }` rather than writing
 * a response.
 */
async function removeRole(roleId) {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { id: true, name: true, isSystem: true } });
  if (!role) return { status: 404, error: "Role not found." };
  if (role.isSystem) return { status: 400, error: `${role.name} is a system role and cannot be changed. Duplicate it to make an editable copy.` };

  // A role somebody still carries is the only thing granting them anything, so removing it
  // silently would take their access away without anyone asking for that.
  /*
   * Only accounts that can sign in block a delete.
   *
   * A closed account cannot use what a role grants, and the Users screen lists active accounts
   * only - so counting one meant a role could be held hostage by somebody nobody could reach to
   * unassign, with the refusal naming a count and no way to act on it. Its UserRole rows go with
   * the role when it is deleted, which is the right outcome: the role is gone for everybody.
   *
   * Named, not counted. "1 user still carries this role" beside a copy of a role somebody else
   * holds reads as the wrong role being checked; saying who it is settles that at a glance.
   */
  const holders = await prisma.userRole.findMany({
    where: { roleId, user: { status: "ACTIVE" } },
    select: { user: { select: { name: true, email: true } } },
    take: 11,
  });
  if (holders.length > 0) {
    const names = holders.slice(0, 10).map((entry) => entry.user?.name || entry.user?.email).filter(Boolean);
    const more = holders.length > 10 ? ", and others" : "";
    return { status: 409, error: `This role is still carried by ${names.join(", ")}${more}. Remove it from them first.` };
  }

  await prisma.role.delete({ where: { id: roleId } });
  return { status: 200 };
}

const deleteRoleRecord = async (req, roleId) => {
  const answer = await removeRole(String(roleId));
  if (answer.error) throw new Error(answer.error);
  return { id: roleId };
};

// The ticked roles, deleted together - above `DELETE /roles/:roleId`, since `/bulk` is fixed.
// `WRITE_ROLES` as below, plus `ADMIN / Table Select All`. `removeRole` still refuses a system role
// and a role somebody active still carries, per role, and names who carries it.
mountBulkDelete(router, { path: "/roles/bulk", guard: WRITE_ROLES, deleteOne: (id, req) => deleteRoleRecord(req, id), noun: "role" });

router.delete("/roles/:roleId", WRITE_ROLES, route(async (req, res) => {
  const answer = await removeRole(req.params.roleId);
  if (answer.error) return res.status(answer.status).json({ message: answer.error });
  res.json({ message: "Role deleted." });
}));

// Copies a role with everything it grants, scopes included. This is how a locked system role
// becomes a starting point you can edit.
router.post("/roles/:roleId/duplicate", WRITE_ROLES, route(async (req, res) => {
  const source = await prisma.role.findUnique({
    where: { id: req.params.roleId },
    include: { permissions: { include: { scopes: true } }, branches: true },
  });
  if (!source) return res.status(404).json({ message: "Role not found." });

  const name = (req.body?.name || "").trim() || await nextCopyName(prisma.role, source.name);
  const clash = await prisma.role.findUnique({ where: { name }, select: { id: true } });
  if (clash) return res.status(409).json({ message: "A role with that name already exists." });

  // The copy is never a system role, whatever it was copied from - that is the point of
  // duplicating a locked role.
  const created = await prisma.role.create({
    data: {
      name,
      description: source.description,
      isSystem: false,
      isAdmin: source.isAdmin,
      isBranchManager: source.isBranchManager,
      isDepartmentLead: source.isDepartmentLead,
    },
  });

  await writeRoleMatrix(created.id, source.permissions.map((grant) => ({
    permissionId: grant.permissionId,
    accessLevel: grant.accessLevel,
    scopeIds: grant.scopes.map((scope) => scope.scopeId),
  })));
  await writeRoleBranches(created.id, source.branches.map((entry) => entry.branchId));

  const role = await prisma.role.findUnique({ where: { id: created.id }, include: roleShape });
  res.status(201).json({ data: role });
}));

// Replaces a role's permission matrix on its own, for callers that only want to change grants.
router.put("/roles/:roleId/permissions", WRITE_ROLES, route(async (req, res) => {
  if (!(await guardSystemRole(req.params.roleId, res))) return;
  const grants = await readGrants(req.body?.permissions, res);
  if (!grants) return;

  await writeRoleMatrix(req.params.roleId, grants);

  const role = await prisma.role.findUnique({ where: { id: req.params.roleId }, include: roleShape });
  res.json({ data: role });
}));

// ============= ADMIN PERMISSION SET =============
/*
 * The one matrix every branch administrator carries, on top of whatever their own role grants.
 *
 * Guarded by `ADMIN / Role Management` rather than a permission of its own, and deliberately: this
 * *is* role management. Saving it changes what every role marked as a branch administrator may do,
 * which is a strictly larger act than editing one role - so it cannot sit behind a weaker guard,
 * and giving it a weaker one of its own would have been a way around the stronger.
 *
 * `readGrants` is the role editor's own validator, reused unchanged. One level per permission, a
 * DISABLED row means "grant nothing here" and is dropped rather than stored, and a permission that
 * no longer exists is refused - the same three answers the role matrix gives, because it is the
 * same question.
 */
router.get("/branch-admin-permissions", READ_ROLES, route(async (req, res) => {
  res.json({ data: await iamService.branchAdminPermissions() });
}));

router.put("/branch-admin-permissions", WRITE_ROLES, route(async (req, res) => {
  const grants = await readGrants(req.body?.permissions, res);
  if (!grants) return;
  res.json({ data: await iamService.saveBranchAdminPermissions(grants) });
}));

// ============= PERMISSIONS =============
router.get("/permissions", READ_ROLES, route(async (req, res) => {
  // Scopes travel with the permission they belong to, so the role editor can draw a permission and
  // its checkboxes from one response instead of stitching two together.
  const permissions = await prisma.permission.findMany({
    /*
     * Everything but the one the Branch Admin tick carries.
     *
     * `ADMIN / Branch Administration` is what *makes* a branch administrator, so it is granted by
     * the tick and by nothing else - see `TICK_CARRIES` in `iam.service.js`. Drawn in the matrix it
     * was a second, independent switch for the same fact, under a name that reads like the right to
     * edit the branch register (that is `SETTINGS / Organization`), and a role could be marked
     * Branch Admin while not holding it. This response feeds the role editor *and* the Admin
     * Permission dialog, so leaving it out closes both.
     */
    where: { isActive: true, NOT: { AND: [{ module: iamService.TICK_CARRIES.module }, { feature: iamService.TICK_CARRIES.feature }] } },
    orderBy: [{ module: "asc" }, { feature: "asc" }],
    include: { scopes: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
  });
  res.json({ data: permissions });
}));

module.exports = router;
