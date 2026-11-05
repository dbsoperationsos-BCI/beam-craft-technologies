const prisma = require("../../../config/db");

/**
 * HRM -> employee WhatsApp groups: the studio's groups, and adding an employee to the ones chosen.
 *
 * Settings -> Employee -> WhatsApp Groups: the groups, **typed by name**, listed under the box.
 * Employee -> Edit -> Employee Preference -> WhatsApp Groups then ticks groups for one employee and
 * presses Add.
 *
 * WhatsApp only lets a group's admin add somebody, so each add is matched when it runs: the linked
 * WhatsApp of the person who pressed Add first, then anybody else whose WhatsApp is linked - the first
 * that is an admin of a group with that name adds them. Queued and done one group at a
 * time, a few seconds apart, in the background: adding one number to many groups in seconds is what
 * WhatsApp restricts a number for. Each add's answer is kept on its row - added, already a member, an
 * invite link sent instead (their privacy keeps strangers from adding them), or failed with the reason.
 */

/** Where a membership has got to, joining and leaving alike. */
const JOIN_STATUSES = ["PENDING", "ADDED", "ALREADY", "INVITED", "FAILED"];
const LEAVE_STATUSES = ["REMOVING", "REMOVED", "NOT_IN", "REMOVE_FAILED"];
const STATUSES = [...JOIN_STATUSES, ...LEAVE_STATUSES];

/** The statuses that mean they are in the group as far as the app knows, so there is one to leave. */
const IN_THE_GROUP = ["ADDED", "ALREADY", "INVITED"];

// Between two adds, on top of the session's own pacing: a person adding somebody to groups by hand.
const GROUP_GAP_MS = 5000;
/*
 * Between two **removals**, which is longer on purpose.
 *
 * Offboarding takes one person out of every group they are in, which is a burst of group
 * administration from one number against one person - the shape WhatsApp reads as automation, and
 * the studio's paired number is bannable. Nobody is waiting on it either: the queue runs behind a
 * relieving that has already happened.
 */
const REMOVE_GAP_MS = 30000;

let sessionsOverride = null;
const sessions = () => sessionsOverride || require("../../sales/whatsapp-chat/sessionManager");
const setSessionsForTest = (fake) => { sessionsOverride = fake; };

const httpError = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const cleanName = (value) => String(value || "").replace(/\s+/g, " ").trim();

/**
 * The departments a group may be given, read off the register rather than typed.
 *
 * Active ones only: a department the studio has retired is not one to put a new group under, though
 * a group already under it keeps the claim until somebody changes it.
 */
async function listDepartments({ client = prisma } = {}) {
  const rows = await client.department.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((row) => ({ value: String(row.id), label: row.name }));
}

/**
 * Which departments one group is for, ids and names both.
 *
 * The names are resolved through the link on every read, never copied onto the group - a renamed
 * department reads as its new name everywhere without anything being rewritten (Rule 5).
 */
const toGroup = (group) => ({
  id: group.id,
  subject: group.name,
  memberCount: group._count.members,
  departmentIds: (group.departments || []).map((link) => link.departmentId),
  departmentNames: (group.departments || []).map((link) => link.department?.name).filter(Boolean),
});

const GROUP_INCLUDE = {
  _count: { select: { members: { where: { status: { in: ["ADDED", "ALREADY"] } } } } },
  departments: { include: { department: { select: { name: true } } }, orderBy: { departmentId: "asc" } },
};

/**
 * The groups typed in Settings, with how many employees are in each and which departments each is for.
 *
 * `departmentId` narrows to one department's groups, which is what the screen's dropdown asks for. A
 * group belonging to **no** department is only ever listed unnarrowed: it is nobody's department's
 * group, and onboarding never adds anybody to one.
 */
async function listGroups({ client = prisma, departmentId = null } = {}) {
  const groups = await client.employeeWhatsAppGroup.findMany({
    where: departmentId ? { departments: { some: { departmentId: Number(departmentId) } } } : {},
    orderBy: { name: "asc" },
    include: GROUP_INCLUDE,
  });
  return groups.map(toGroup);
}

/**
 * Every department with the WhatsApp groups it claims — one row per department, which is how the
 * screen reads them.
 *
 * Active departments only, and **every** one of them, including the ones claiming no group yet: a
 * department missing from the table is one nobody would think to add groups to, and a department
 * with no groups is exactly the state somebody needs to see to fix.
 *
 * The group names are resolved through the link on every read, never copied, so a group renamed in
 * Settings reads as its new name here without anything being rewritten (Rule 5).
 */
async function listDepartmentGroups({ client = prisma } = {}) {
  const departments = await client.department.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      whatsappGroupLinks: {
        orderBy: { groupId: "asc" },
        select: { group: { select: { id: true, name: true } } },
      },
    },
  });
  return departments.map((department) => {
    const groups = department.whatsappGroupLinks.map((link) => link.group).filter(Boolean);
    return {
      id: department.id,
      departmentName: department.name,
      // The cell the table prints, and what its search and CSV read. No count beside it: the names
      // are the answer, and the screen counts nothing it has already listed.
      groupNames: groups.map((group) => group.name).join(", "),
      groups,
    };
  });
}

/**
 * Puts a group under one department, creating the group if the studio has not named it yet.
 *
 * Add is **attach-or-create** on purpose. A group's name is unique because it is one group on
 * WhatsApp, so typing "All Managers" under a second department must mean "this department too" and
 * not "a second group of the same name" - which a plain create would have refused with a 409 and
 * left somebody wondering why a name they could see was taken.
 */
async function addGroupToDepartment({ departmentId, name, userId, client = prisma }) {
  const groupName = cleanName(name);
  if (!groupName) throw httpError(400, "Type the WhatsApp group's name.");
  if (groupName.length > 200) throw httpError(400, "That group name is too long.");
  const department = await client.department.findUnique({ where: { id: Number(departmentId) }, select: { id: true } });
  if (!department) throw httpError(404, "That department could not be found.");

  const existing = await client.employeeWhatsAppGroup.findFirst({ where: { name: groupName }, select: { id: true } });
  const groupId = existing
    ? existing.id
    : (await client.employeeWhatsAppGroup.create({ data: { name: groupName, createdByUserId: userId || null }, select: { id: true } })).id;
  // Already under this department: say so rather than answering as though something changed.
  const claimed = await client.employeeWhatsAppGroupDepartment.findUnique({ where: { groupId_departmentId: { groupId, departmentId: department.id } }, select: { groupId: true } });
  if (claimed) throw httpError(409, `"${groupName}" is already under this department.`);
  await client.employeeWhatsAppGroupDepartment.create({ data: { groupId, departmentId: department.id } });
  return listDepartmentGroups({ client });
}

/**
 * Takes a group out from under one department.
 *
 * The **group is kept**. It may serve other departments, and even where it does not it is still a
 * group the studio named and may be adding people to by hand - deleting it here would throw that
 * away to answer a smaller question. A group left under no department is simply one onboarding no
 * longer adds anybody to, and Settings still lists it.
 */
async function removeGroupFromDepartment({ departmentId, groupId, client = prisma }) {
  const { count } = await client.employeeWhatsAppGroupDepartment.deleteMany({
    where: { groupId: Number(groupId), departmentId: Number(departmentId) },
  });
  if (!count) throw httpError(404, "That group is not under this department.");
  return listDepartmentGroups({ client });
}

/** The department ids a payload named, as ids: anything that is not one is not a department. */
const wantedDepartments = (ids) => [...new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];

/**
 * Checks that every department named is one that exists, so a group cannot claim a department that
 * does not. Refused rather than dropped: a group silently filed under fewer departments than asked
 * for is a group onboarding will not add people to.
 */
async function checkedDepartments(ids, client) {
  const wanted = wantedDepartments(ids);
  if (!wanted.length) return [];
  const found = await client.department.findMany({ where: { id: { in: wanted } }, select: { id: true } });
  if (found.length !== wanted.length) throw httpError(400, "One of those departments no longer exists. Reopen the list and choose again.");
  return wanted;
}

/** Adds a group by its WhatsApp name, under the departments it serves. */
async function addGroup({ name, departmentIds, userId, client = prisma }) {
  const groupName = cleanName(name);
  if (!groupName) throw httpError(400, "Type the WhatsApp group's name.");
  if (groupName.length > 200) throw httpError(400, "That group name is too long.");
  const existing = await client.employeeWhatsAppGroup.findFirst({ where: { name: groupName }, select: { id: true } });
  if (existing) throw httpError(409, `"${groupName}" is already added.`);
  const departments = await checkedDepartments(departmentIds, client);
  await client.employeeWhatsAppGroup.create({
    data: {
      name: groupName,
      createdByUserId: userId || null,
      // Written with the group, in one statement, so a group never exists for a moment with none.
      departments: { create: departments.map((departmentId) => ({ departmentId })) },
    },
  });
  return listGroups({ client });
}

/**
 * Changes which departments an existing group is for.
 *
 * The list is **replaced**, which is what the screen's multi-select means by saving: the rows it
 * names are the rows it should have. Deleted and re-created inside one transaction rather than
 * diffed, because the table is two columns and a handful of rows, and a half-applied change would
 * leave a group under departments nobody chose.
 */
async function setGroupDepartments(id, departmentIds, { client = prisma } = {}) {
  const group = await client.employeeWhatsAppGroup.findUnique({ where: { id: Number(id) }, select: { id: true } });
  if (!group) throw httpError(404, "That WhatsApp group could not be found.");
  const departments = await checkedDepartments(departmentIds, client);
  await client.$transaction(async (tx) => {
    await tx.employeeWhatsAppGroupDepartment.deleteMany({ where: { groupId: group.id } });
    if (departments.length) {
      await tx.employeeWhatsAppGroupDepartment.createMany({ data: departments.map((departmentId) => ({ groupId: group.id, departmentId })) });
    }
  });
  return listGroups({ client });
}

async function removeGroup(id, { client = prisma } = {}) {
  const group = await client.employeeWhatsAppGroup.findUnique({ where: { id }, select: { id: true } });
  if (!group) throw httpError(404, "That WhatsApp group could not be found.");
  // Its rows go with it (cascade); nobody is removed from the group on WhatsApp itself.
  await client.employeeWhatsAppGroup.delete({ where: { id } });
}

const toMembership = (row) => ({
  groupId: row.groupId,
  subject: row.group?.name || "",
  status: row.status,
  detail: row.detail || "",
  addedAt: row.addedAt,
  updatedAt: row.updatedAt,
});

/**
 * One employee's WhatsApp groups, as their own screen reads them: where each add stands, and the
 * groups they are **offered**.
 *
 * Offered means their departments' groups and nothing else. The studio decided in Settings which
 * groups each department has, and a picker listing every group in the studio asked the person at the
 * employee's screen to decide it again - differently, and without the context to. So the list here
 * is the same list onboarding uses, and the screen is where somebody takes one off it.
 *
 * A group they are **already in** is still returned, even if their department no longer claims it:
 * it is a row about them that exists, and hiding it would leave a membership nobody could see or
 * act on.
 */
async function employeeGroupPicker(employeeId, { client = prisma } = {}) {
  const [rows, fromDepartments] = await Promise.all([
    memberships(employeeId, { client }),
    departmentGroupsFor(employeeId, { client }),
  ]);
  const offeredIds = fromDepartments.groupIds;
  const ids = [...new Set([...offeredIds, ...rows.map((row) => row.groupId)])];
  const groups = ids.length
    ? await client.employeeWhatsAppGroup.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  return {
    memberships: rows,
    // `fromDepartment` is what the screen ticks by default: the studio's own answer for this person.
    groups: groups.map((group) => ({ id: group.id, subject: group.name, fromDepartment: offeredIds.includes(group.id) })),
    // The departments this looked at, so an empty list can say which - "no departments saved yet"
    // and "their departments have no groups" need opposite actions.
    departmentNames: fromDepartments.departmentNames,
  };
}

/** One employee's groups and where each add stands. A queue left over from a restart is picked up here. */
async function memberships(employeeId, { client = prisma } = {}) {
  const rows = await client.employeeWhatsAppGroupMember.findMany({
    where: { employeeId },
    include: { group: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (rows.some((row) => row.status === "PENDING")) kick();
  return rows.map(toMembership);
}

/**
 * The groups an employee's departments claim, which is what onboarding adds them to.
 *
 * Their departments are rows (`EmployeeDepartment`), so somebody in two departments gets the groups
 * of both; a group claimed by two of their departments is still one group, hence the `some`.
 *
 * A group under **no** department is never returned, which is the whole point of letting a group sit
 * under none: it is not one the app puts people into on its own.
 */
async function departmentGroupIdsFor(employeeId, { client = prisma } = {}) {
  return (await departmentGroupsFor(employeeId, { client })).groupIds;
}

/**
 * The same, with the **departments it looked at** named.
 *
 * "No groups" on an employee's screen is a dead end without them: the reader cannot tell whether the
 * person has no departments saved yet, or has them and none of those departments has been given a
 * group. Those need opposite actions - save the employee, or go to Settings - and the names are what
 * tell them apart.
 */
async function departmentGroupsFor(employeeId, { client = prisma } = {}) {
  const rows = await client.employeeDepartment.findMany({
    where: { employeeId: Number(employeeId) },
    select: { departmentId: true, department: { select: { name: true } } },
  });
  const departmentNames = rows.map((row) => row.department?.name).filter(Boolean);
  if (!rows.length) return { groupIds: [], departmentNames };
  const groups = await client.employeeWhatsAppGroup.findMany({
    where: { departments: { some: { departmentId: { in: rows.map((row) => row.departmentId) } } } },
    select: { id: true },
  });
  return { groupIds: groups.map((group) => group.id), departmentNames };
}

/**
 * Onboarding: queues the new employee into the groups their departments claim.
 *
 * `revive` makes it the **coming back** path as well, for an employee marked active again: a leaver's
 * rows all read REMOVED, and the create-only rule below would skip exactly the groups they are
 * returning to. Only their **departments'** groups come back - a group somebody was added to by hand
 * is a decision somebody made, and putting that back is theirs to make again.
 *
 * Never throws. It is called from the end of creating an employee, and an employee who exists with
 * their groups unqueued is a far better outcome than an employee who could not be created because
 * WhatsApp was unreachable - the rows are a queue, and a queue can be retried from their own screen.
 * The reasons it declines are each ordinary: no departments, no groups under them, or no mobile
 * number to add (which the manual path refuses outright, because there a person is waiting on an
 * answer).
 */
async function addEmployeeToDepartmentGroups(employeeId, { client = prisma, userId = null, revive = false } = {}) {
  try {
    const employee = await client.employee.findFirst({ where: { id: Number(employeeId), archivedAt: null }, select: { id: true, contactNumber: true } });
    if (!employee || !String(employee.contactNumber || "").trim()) return { queued: 0, reason: "no mobile number" };
    const groupIds = await departmentGroupIdsFor(employeeId, { client });
    if (!groupIds.length) return { queued: 0, reason: "no groups under their departments" };
    for (const groupId of groupIds) {
      /*
       * `create` only, never an update: somebody already ADDED, or deliberately REMOVED, is left
       * alone. Onboarding runs once, and re-queueing a row somebody has since acted on would undo
       * their decision.
       *
       * `revive` is the one case that must: somebody **coming back**, whose rows all read REMOVED
       * because leaving took them out. Without it the re-add would skip every group they had, which
       * is precisely the set they are returning to - so it moves a REMOVED row back into the queue
       * and leaves every other state alone. A row that is ADDED needs nothing, and one that FAILED
       * is retried from their own screen where somebody can read why.
       */
      await client.employeeWhatsAppGroupMember.createMany({
        data: [{ employeeId: Number(employeeId), groupId, status: "PENDING", requestedByUserId: userId }],
        skipDuplicates: true,
      });
      if (revive) {
        await client.employeeWhatsAppGroupMember.updateMany({
          where: { employeeId: Number(employeeId), groupId, status: "REMOVED" },
          data: { status: "PENDING", detail: null, requestedByUserId: userId },
        });
      }
    }
    kick();
    return { queued: groupIds.length, reason: null };
  } catch (error) {
    console.error("[whatsapp-groups] could not queue an onboarded employee's groups:", error?.message || error);
    return { queued: 0, reason: "the queue could not be written" };
  }
}

/**
 * Offboarding: queues the employee out of every group the app has them in.
 *
 * **Every** group, not only their departments' - the studio asked for that, and it is the safer
 * reading of leaving: a group they were put in by hand is still one they can read tomorrow. A row
 * that never succeeded in adding them is left alone, since there is nothing to remove.
 *
 * Never throws, for the same reason as the add: this is called from the relieving that closes their
 * login, and the login must close on the right day whatever WhatsApp is doing.
 */
async function removeEmployeeFromAllGroups(employeeId, { client = prisma, userId = null } = {}) {
  try {
    const { count } = await client.employeeWhatsAppGroupMember.updateMany({
      where: { employeeId: Number(employeeId), status: { in: IN_THE_GROUP } },
      data: { status: "REMOVING", detail: null, requestedByUserId: userId },
    });
    if (count) kick();
    return { queued: count };
  } catch (error) {
    console.error("[whatsapp-groups] could not queue an offboarded employee's removals:", error?.message || error);
    return { queued: 0 };
  }
}

/** Queues an employee's add to each group chosen, and starts working through the queue. */
async function addEmployee({ employeeId, groupIds, userId, client = prisma }) {
  const wanted = [...new Set((groupIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!wanted.length) throw httpError(400, "Choose at least one WhatsApp group.");
  const employee = await client.employee.findFirst({ where: { id: employeeId, archivedAt: null }, select: { id: true, contactNumber: true } });
  if (!employee) throw httpError(404, "Employee not found");
  if (!String(employee.contactNumber || "").trim()) throw httpError(400, "Add this employee's mobile number first - it is the number added to the groups.");
  const groups = await client.employeeWhatsAppGroup.findMany({ where: { id: { in: wanted } }, select: { id: true } });
  if (groups.length !== wanted.length) throw httpError(400, "One of those WhatsApp groups is no longer in Settings.");
  for (const groupId of wanted) {
    await client.employeeWhatsAppGroupMember.upsert({
      where: { employeeId_groupId: { employeeId, groupId } },
      create: { employeeId, groupId, status: "PENDING", requestedByUserId: userId || null },
      update: { status: "PENDING", detail: null, requestedByUserId: userId || null },
    });
  }
  kick();
  // The picker's whole shape, so the screen that asked gets its groups back with the rows and does
  // not have to make a second call to learn nothing changed about them.
  return employeeGroupPicker(employeeId, { client });
}

/**
 * Why WhatsApp would not add them, in its own two answers - which are different things and were
 * both being reported as the first:
 *
 *   - **403** - their privacy keeps somebody who is not a contact from adding them to a group.
 *     Saving their number on the adding phone is usually enough to turn this into a plain add.
 *   - **408** - WhatsApp would not take the add just now, which is what it answers for somebody who
 *     **left this group recently**: it holds them out of it for a while however their privacy is set.
 *
 * Somebody who has "anyone can add me" switched on and is still only getting a link is almost always
 * the second, and being told it was their privacy sent them looking at a setting that was already right.
 */
const INVITE_REASON = {
  403: "Their WhatsApp privacy does not allow somebody who is not a contact to add them",
  408: "WhatsApp would not add them just now - this is what it answers for somebody who left this group recently",
};
const inviteReason = (status) => INVITE_REASON[Number(status)] || `WhatsApp would not add them (code ${status || "unknown"})`;

/** The answer WhatsApp gave, as the row keeps it. */
function outcomeRow(result, inviteSent) {
  if (result.outcome === "ADDED") return { status: "ADDED", detail: null, addedAt: new Date() };
  if (result.outcome === "ALREADY") return { status: "ALREADY", detail: "Already in this group.", addedAt: new Date() };
  if (result.outcome === "INVITE") {
    const why = inviteReason(result.status);
    return inviteSent
      ? { status: "INVITED", detail: `${why}, so the group's invite link was sent to them.` }
      : { status: "FAILED", detail: `${why}, and the invite link could not be sent.` };
  }
  return { status: "FAILED", detail: `WhatsApp did not add them${result.status ? ` (code ${result.status})` : ""}.` };
}

/** Every staff login whose WhatsApp is linked right now, in the order to be tried. */
async function linkedUsersInOrder(first, { client = prisma } = {}) {
  const users = await client.user.findMany({ where: { status: "ACTIVE", role: { not: "CLIENT" } }, select: { id: true } });
  const ids = [...new Set([...first.filter(Boolean), ...users.map((user) => user.id)])];
  return ids.filter((id) => sessions().sessionState(id)?.status === "connected");
}

/**
 * Which WhatsApp group this is, and whose linked WhatsApp can add to it: the first linked WhatsApp -
 * the requester's, then anybody's - that is an admin of a group with this name.
 * `cache` keeps each WhatsApp's groups for the queue's run.
 */
async function findAdder(row, cache, { client = prisma } = {}) {
  const users = await linkedUsersInOrder([row.requestedByUserId], { client });
  if (!users.length) return { problem: "No WhatsApp is linked to the app right now. Link a WhatsApp that is an admin of this group, then press Retry." };
  for (const userId of users) {
    if (!cache.has(userId)) {
      try { cache.set(userId, await sessions().listAdminGroups(userId)); } catch { cache.set(userId, []); }
    }
    const match = cache.get(userId).find((group) => group.isAdmin && sameName(group.subject, row.group.name));
    if (match) return { userId, jid: match.jid };
  }
  return { problem: "No linked WhatsApp is an admin of a group with this name. Check the name in Settings matches the group exactly, and that a linked WhatsApp is its admin, then press Retry." };
}

async function processOne(row, { client = prisma, cache = new Map() } = {}) {
  const { group, employee } = row;
  if (!group?.name) return { status: "FAILED", detail: "This WhatsApp group is no longer in Settings." };
  const adder = await findAdder(row, cache, { client });
  if (adder.problem) return { status: "FAILED", detail: adder.problem };
  try {
    const result = await sessions().addToGroup({ userId: adder.userId, groupJid: adder.jid, phone: employee.contactNumber });
    let inviteSent = false;
    if (result.outcome === "INVITE" && result.inviteLink) {
      try {
        await sessions().sendMessageToPerson({
          userId: adder.userId,
          phone: employee.contactNumber,
          body: `Hi${employee.employeeName ? ` ${employee.employeeName}` : ""}, please join our WhatsApp group "${group.name}": ${result.inviteLink}`,
        });
        inviteSent = true;
      } catch { inviteSent = false; }
    }
    return outcomeRow(result, inviteSent);
  } catch (error) {
    if (error?.code === "WHATSAPP_NOT_CONNECTED") return { status: "FAILED", detail: "The WhatsApp that adds to this group was disconnected. Link it again, then press Retry." };
    return { status: "FAILED", detail: String(error?.message || "WhatsApp did not answer.").slice(0, 500) };
  }
}

let running = false;
let waitMs = GROUP_GAP_MS;
let removeWaitMs = REMOVE_GAP_MS;
const setGapForTest = (ms) => { waitMs = ms; removeWaitMs = ms; };

/**
 * Takes one person out of one group, and reads WhatsApp's answer the way the add's is read.
 *
 * `findAdder` is reused unchanged: being an admin of the group is the same requirement for taking
 * somebody out as for putting them in, and the group is still found by its name.
 */
async function removeOne(row, { client = prisma, cache = new Map() } = {}) {
  const { group, employee } = row;
  if (!group?.name) return { status: "REMOVE_FAILED", detail: "This WhatsApp group is no longer in Settings." };
  if (!String(employee?.contactNumber || "").trim()) return { status: "REMOVE_FAILED", detail: "This employee has no mobile number, so there is no number to take out of the group." };
  const adder = await findAdder(row, cache, { client });
  if (adder.problem) return { status: "REMOVE_FAILED", detail: adder.problem };
  try {
    const result = await sessions().removeFromGroup({ userId: adder.userId, groupJid: adder.jid, phone: employee.contactNumber });
    if (result.outcome === "REMOVED") return { status: "REMOVED", detail: null, removedAt: new Date() };
    // Not in it is the state that was wanted, so it is an outcome and not a failure.
    if (result.outcome === "NOT_IN") return { status: "NOT_IN", detail: "They were not in this group.", removedAt: new Date() };
    if (result.outcome === "NOT_ADMIN") return { status: "REMOVE_FAILED", detail: "The linked WhatsApp is not an admin of this group any more, so it cannot take anybody out of it." };
    return { status: "REMOVE_FAILED", detail: `WhatsApp did not remove them${result.status ? ` (code ${result.status})` : ""}.` };
  } catch (error) {
    if (error?.code === "WHATSAPP_NOT_CONNECTED") return { status: "REMOVE_FAILED", detail: "The WhatsApp that administers this group was disconnected. Link it again, then press Retry." };
    return { status: "REMOVE_FAILED", detail: String(error?.message || "WhatsApp did not answer.").slice(0, 500) };
  }
}

/**
 * Works through every queued add **and removal**, one at a time, until none is left. Never runs twice
 * at once.
 *
 * Adds go first on purpose. Somebody waits on an add - they were told the employee would be in the
 * group - while a removal runs behind a relieving that has already happened, and it waits thirty
 * seconds between each so that taking one leaver out of a dozen groups does not read as automation
 * from the studio's number.
 */
async function drain({ client = prisma } = {}) {
  if (running) return;
  running = true;
  const cache = new Map();
  try {
    for (;;) {
      const include = { group: true, employee: { select: { id: true, employeeName: true, contactNumber: true } } };
      const row = await client.employeeWhatsAppGroupMember.findFirst({
        where: { status: "PENDING" },
        orderBy: { updatedAt: "asc" },
        include,
      }) || await client.employeeWhatsAppGroupMember.findFirst({
        where: { status: "REMOVING" },
        orderBy: { updatedAt: "asc" },
        include,
      });
      if (!row) break;
      const removing = row.status === "REMOVING";
      const answer = removing ? await removeOne(row, { client, cache }) : await processOne(row, { client, cache });
      await client.employeeWhatsAppGroupMember.update({ where: { id: row.id }, data: answer });
      await new Promise((resolve) => setTimeout(resolve, removing ? removeWaitMs : waitMs));
    }
  } catch (error) {
    console.error("Employee WhatsApp group queue stopped:", error?.message || error);
  } finally {
    running = false;
  }
}

const kick = () => { setImmediate(() => { void drain(); }); };

module.exports = {
  employeeGroupPicker,
  listDepartments,
  listDepartmentGroups,
  addGroupToDepartment,
  removeGroupFromDepartment,
  setGroupDepartments,
  departmentGroupIdsFor,
  departmentGroupsFor,
  addEmployeeToDepartmentGroups,
  removeEmployeeFromAllGroups,
  removeOne,
  IN_THE_GROUP,
  REMOVE_GAP_MS,
  STATUSES,
  listGroups,
  addGroup,
  removeGroup,
  memberships,
  addEmployee,
  outcomeRow,
  inviteReason,
  findAdder,
  processOne,
  drain,
  setSessionsForTest,
  setGapForTest,
};
