const { optionNames, namesWithFlag } = require("../../../services/optionLists");
const prisma = require("../../../config/db");
const dataScope = require("../../../services/dataScope.service");
const { lookups: referenceLookups } = require("../../../services/referenceMatchers");
const { notify, TYPES } = require("../../../services/notifications");
const attachments = require("./attachments");

/**
 * Tasks: one person asking another to do something, and what became of it.
 *
 * The module is deliberately small in what it lets anybody do. A task has one receiver and one
 * giver, and every verb below belongs to exactly one of them: the receiver starts, completes or
 * sends it back, the giver cancels it. That is ownership, not role - a Super Admin has no more
 * business marking somebody else's task done than anyone else does - so the checks are against the
 * signed-in user's id and never against `req.user.role`, which would sit below the route's
 * permission guard and quietly overrule it.
 *
 * Reading is the one thing a permission widens: `HRM / All Tasks` opens the whole studio's list,
 * and it is a separate permission on a separate endpoint precisely so the tab can be shown to the
 * people the API will actually answer.
 *
 * Every change writes an activity row and, where somebody else needs to know, a notification. Both
 * happen inside the same transaction as the change itself, so a task can never be completed with no
 * record of who completed it.
 */

const STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "REASSIGNED", "CANCELLED"];
/**
 * The states nothing further happens from: the task is over, one way or the other.
 *
 * `REASSIGNED` is deliberately not among them, where the `REVERTED` it replaced was. A rolled-back
 * task was finished — it had gone back to whoever set it and stopped. A reassigned one has landed on
 * somebody new and is waiting to be picked up, so it must still be startable, completable and
 * passable on again. Only finishing it and calling it off close a task now.
 */
const CLOSED_STATUSES = ["COMPLETED", "CANCELLED"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
/**
 * What kind of work it is. A fixed list rather than master data, for the same reason the payment
 * request expense categories are one: the studio has not settled its list yet, and a placeholder
 * that reads correctly is better than a settings screen nobody asked for. Moving it to master data
 * later is a migration of this array and nothing else.
 */
/**
 * The type that asks a question back. Everything else on the list names the work on its own; this
 * one only says the list did not cover it, so the form asks what it was and `taskTypeOther` holds
 * the answer. Named here rather than written as "Other" in three places, because the string is the
 * test the form, the validator and the label all make.
 */
const OTHER_TASK_TYPE = "Other";
const TASK_TYPES = ["Client", "Internal", "Administrative", "Follow Up", "Escalation", OTHER_TASK_TYPE];

/*
 * Both of the above are now what a failed read falls back to rather than the answer itself.
 *
 * Task types are a list the studio maintains (Settings → Fields → Tasks), and which of them asks
 * what the work actually was is `asks_for_details` on the row - the meaning "Other" carried in its
 * spelling, compared against here and again in the browser, so renaming it stopped the form asking.
 * More than one type may ask, which is why this answers with a list rather than a single name.
 */
const taskTypeNames = () => optionNames("taskType", TASK_TYPES);
const taskTypesAskingForDetails = () => namesWithFlag("taskType", "asksForDetails", [OTHER_TASK_TYPE]);

/** "Other" on its own is not worth a column; what somebody typed beside it is. */
/**
 * "Other" on its own is not worth a column; what somebody typed beside it is.
 *
 * Only for a type that actually asks for a description. A named type carrying a stray one - a form
 * that showed the box, then had its type changed - reads as the type alone, which is what it is.
 * `askingTypes` defaults to what the code used to compare against, so a caller with no list to hand
 * behaves exactly as before; `shapeTask` passes the live one.
 */
const taskTypeLabel = (task, askingTypes = [OTHER_TASK_TYPE]) =>
  (task.taskTypeOther && askingTypes.includes(task.taskType)
    ? `${task.taskType} — ${task.taskTypeOther}`
    : task.taskType);

const ACTIONS = {
  CREATED: "CREATED",
  ASSIGNED: "ASSIGNED",
  STATUS_CHANGED: "STATUS_CHANGED",
  COMPLETED: "COMPLETED",
  REASSIGNED: "REASSIGNED",
  CANCELLED: "CANCELLED",
  /*
   * Deleted, which is logged although the task is then invisible - and that is the point of logging
   * it. The row stays, so `deleted_at` cleared by hand brings the task back with the line saying who
   * removed it and when still in its history.
   */
  DELETED: "DELETED",
  /*
   * Edited, which is a change to what the task says rather than to what has happened to it - the
   * only entry here that is not a state change, and the reason the line names the fields that moved
   * rather than just recording that somebody saved the form.
   */
  UPDATED: "UPDATED",
  // A file arriving or leaving is something that happened to the task, so it is logged like
  // anything else - "the brief was replaced on the 4th" is exactly what somebody asks later.
  ATTACHED: "ATTACHED",
  ATTACHMENT_REMOVED: "ATTACHMENT_REMOVED",
};

/**
 * The verbs that belong to whoever holds the task. Cancelling is the giver's, alone.
 *
 * `reassign` replaced `revert`. The receiver used to be able to hand a task back to whoever set it,
 * which closed it and left the work where it started; now they name who should do it instead, and
 * the task carries on. Handing it back is still possible — it is a reassignment to the giver — but
 * it is now a destination somebody chose rather than the only way out.
 */
const RECEIVER_ACTIONS = ["start", "complete", "reassign"];

/**
 * The verbs that belong to whoever set the task.
 *
 * Cancelling calls off a task that was real: the holder is told, the row stays in both lists, and it
 * still counts. Deleting says the task should never have been raised at all - a duplicate, a test
 * row, one typed against the wrong person - and takes it out of every list instead. They are two
 * different statements, which is why deleting is not "cancel, but harder".
 */
const GIVER_ACTIONS = ["cancel", "delete", "edit"];

/** The roles that may act on a task they did not set. Compared case-insensitively and trimmed. */
const isSuperAdmin = (role) => String(role || "").trim().toUpperCase() === "SUPER_ADMIN";

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * `DBS-TK-00001`, from the counter every generated identifier in the application comes from.
 *
 * The `DBS-` prefix is what every other business id in the studio wears - `DBS-BK-DD-ERD-000001`,
 * `DBS-SID-DD-ERD-000001`, `DBS-EID-QQ-HYD-000007` - and a task was the one record answering to a
 * shape of its own, `TSK-000001`. Unlike those, it carries no vertical and no branch: a task names
 * its department and branch in its own columns, and the work is regularly handed across both, so
 * baking either into the id would date it the first time a task moved.
 *
 * Five digits rather than six, which is what was asked for. Nothing breaks at 100,000 - the number
 * simply grows a digit - because the code is read and matched as text, never parsed back.
 */
const TASK_CODE_PREFIX = "DBS-TK-";
async function nextTaskCode(client = prisma) {
  const row = await client.appSequence.upsert({
    where: { key: "HRM_TASK_ID" },
    create: { key: "HRM_TASK_ID", currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  return `${TASK_CODE_PREFIX}${String(row.currentValue).padStart(5, "0")}`;
}

/**
 * Whether `userId` may do `action` to `task`, and why not when they may not.
 *
 * Pure, and exported, because this is the whole access model of the module and the place a mistake
 * would be least visible: it decides five verbs against two people and five states, and every one
 * of those answers is a sentence somebody reads when they are refused. The controller asks it, and
 * the tests assert on it directly rather than through a request.
 *
 * `role` is read by one verb only, and only to widen it: deleting is the giver's, and a Super
 * Admin's as well. Everything else stays ownership rather than role - a Super Admin has no more
 * business marking somebody else's task done than anyone else does - and the argument is passed in
 * rather than read from a request, so this function stays pure and the tests can state the rule
 * directly. It cannot be used to *narrow* anything: leave it out and the four original verbs answer
 * exactly as they did.
 */
function refusalFor(task, action, userId, role = "") {
  const isReceiver = Boolean(task.assignedToUserId) && task.assignedToUserId === userId;
  const isGiver = Boolean(task.assignedByUserId) && task.assignedByUserId === userId;

  // Named verbs only. Falling through to the receiver's branch for anything unrecognised would
  // mean a verb added to a route and forgotten here was permitted by default, which is the wrong
  // way round for the function that decides who may change a task.
  if (!RECEIVER_ACTIONS.includes(action) && !GIVER_ACTIONS.includes(action)) return "That is not something a task can be asked to do.";

  /*
   * Deleting, which is the only verb a status does not gate.
   *
   * A task is deleted because it should not exist - a duplicate, a test row, one typed against the
   * wrong person - and that is as true of one somebody has already started as of one nobody has
   * touched. Cancelling is what says "this was real and is called off", and it stays the right
   * answer for work that was genuinely under way; the two are offered side by side and the giver
   * picks which statement they are making.
   */
  /*
   * Editing, which is correcting what the task *says* rather than changing what has happened to it.
   *
   * The giver's, and a Super Admin's, on the same reasoning delete follows: the person who wrote a
   * task down is the one who can say it was written down wrong. The receiver is deliberately not
   * included - they act on the task through the four verbs above, and letting them rewrite the
   * title, the due date or who it is for would let somebody quietly restate the job they were
   * given.
   *
   * A deleted task is not editable; a cancelled or completed one is, because correcting the record
   * of something that already happened is exactly when this is needed.
   */
  if (action === "edit") {
    if (task.deletedAt) return `${task.taskCode} has been deleted.`;
    if (!isGiver && !isSuperAdmin(role)) return "Only the person who gave this task, or a Super Admin, can edit it.";
    return null;
  }

  if (action === "delete") {
    if (task.deletedAt) return `${task.taskCode} has already been deleted.`;
    if (!isGiver && !isSuperAdmin(role)) return "Only the person who gave this task, or a Super Admin, can delete it.";
    return null;
  }

  if (action === "cancel") {
    if (!isGiver) return "Only the person who gave this task can cancel it.";
    if (CLOSED_STATUSES.includes(task.status)) return `${task.taskCode} is already ${statusLabel(task.status).toLowerCase()}.`;
    return null;
  }

  // Starting, completing and reassigning are the holder's, and only while the task is still open.
  if (!isReceiver) return "Only the person this task is assigned to can do that.";
  if (CLOSED_STATUSES.includes(task.status)) return `${task.taskCode} is already ${statusLabel(task.status).toLowerCase()} and cannot be changed.`;
  /*
   * A reassigned task is startable, which is why `REASSIGNED` is tested alongside `PENDING` rather
   * than the check being left as "must be PENDING". It has landed on somebody new and none of the
   * work is theirs yet — refusing them Start because a previous holder never pressed it would leave
   * the task unstartable by anybody.
   */
  if (action === "start" && !["PENDING", "REASSIGNED"].includes(task.status)) return "This task has already been started.";
  /*
   * Completing means starting first. A task that goes straight from Pending to Completed says
   * nobody ever picked it up, which leaves the person who set it with no moment where they could
   * see it was being worked on - the one thing Tasks Given exists to show. Only PENDING and
   * IN_PROGRESS reach this line, the closed states having been refused above.
   */
  if (action === "complete" && task.status !== "IN_PROGRESS") return "Start this task before marking it complete.";
  return null;
}

/**
 * Whether `userId` may read `task` at all: the two people it is between, or a reader of all tasks
 * whose scope covers it. `canSeeAll` is the permission; `scope` is what it is narrowed to, and is
 * absent only for a caller that has already decided.
 */
const canRead = (task, userId, canSeeAll = false, scope = null) => Boolean(
  task.assignedToUserId === userId
  || task.assignedByUserId === userId
  // Anybody who has held it. A task passed from B to C is readable by A, B and C — B is owed sight
  // of what became of the work they were asked to do, and of the reason it left them. Needs the
  // task to have been read with its `holders`; a caller that did not is answered by the two ids
  // above, which is the pre-reassignment behaviour.
  || (task.holders || []).some((holder) => holder.userId === userId)
  || (canSeeAll && (!scope || scope.allows(task))),
);

const STATUS_LABELS = {
  PENDING: "Pending",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  REASSIGNED: "Reassigned",
  CANCELLED: "Cancelled",
};
const statusLabel = (status) => STATUS_LABELS[status] || status;

const PRIORITY_LABELS = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

/** The name a task should record for a login: the person's name, falling back to what it has. */
const nameOf = (user) => user?.name || user?.username || user?.email || `User ${user?.id ?? "?"}`;

const include = {
  activities: { orderBy: { createdAt: "asc" } },
  // Oldest first, so the rows read as the chain in the order it actually happened.
  holders: { orderBy: { heldAt: "asc" } },
};

/**
 * Flattened for the table, which reads plain keys, with the history kept for the detail panel.
 *
 * `viewerRole` is carried only so `canDelete` can be answered for a Super Admin reading somebody
 * else's task; every other flag is decided by who the viewer is *on this task*.
 */
function toRow(task, viewerId, viewerRole = "") {
  return {
    id: task.id,
    taskCode: task.taskCode,
    title: task.title,
    description: task.description,
    taskType: task.taskType,
    taskTypeOther: task.taskTypeOther,
    taskTypeLabel: taskTypeLabel(task),
    priority: task.priority,
    priorityLabel: PRIORITY_LABELS[task.priority] || task.priority,
    department: task.department,
    branch: task.branch,
    status: task.status,
    statusLabel: statusLabel(task.status),
    assignedToUserId: task.assignedToUserId,
    assignedToName: task.assignedToName,
    assignedByUserId: task.assignedByUserId,
    assignedByName: task.assignedByName,
    dueOn: task.dueOn,
    completedAt: task.completedAt,
    completedByName: task.completedByName,
    reassignReason: task.reassignReason,
    reassignedAt: task.reassignedAt,
    reassignedFromName: task.reassignedFromName,
    /*
     * Everybody who has held this task, oldest first — the giver is not among them, being on the
     * task itself. It is what "the reassignment is shown to all three" means in practice: B reads
     * the chain that took the work from them to C, and C reads where it came from.
     */
    holders: (task.holders || []).map((holder) => ({ userId: holder.userId, name: holder.name, heldAt: holder.heldAt })),
    cancelledAt: task.cancelledAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    /*
     * What this reader may do to this row, answered by the server rather than guessed on the
     * screen. The buttons a task offers depend on which of its two people is looking, which is a
     * question about the record and not about the viewer's permissions - so it is decided here,
     * once, by the same function the write path refuses with. The two can then never disagree.
     */
    canComplete: refusalFor(task, "complete", viewerId) === null,
    canStart: refusalFor(task, "start", viewerId) === null,
    canReassign: refusalFor(task, "reassign", viewerId) === null,
    canCancel: refusalFor(task, "cancel", viewerId) === null,
    /*
     * Whether this reader may take the task out of the studio's lists altogether - the giver, or a
     * Super Admin. Answered here with the four verbs beside it, by the same function the write path
     * refuses with, so the menu cannot offer a Delete the server would then refuse.
     */
    canDelete: refusalFor(task, "delete", viewerId, viewerRole) === null,
    /*
     * Whether this reader may correct what the task says - the giver, or a Super Admin. Answered by
     * the same function the write path refuses with, so the menu cannot offer an Edit the server
     * would then turn down.
     */
    canEdit: refusalFor(task, "edit", viewerId, viewerRole) === null,
    /*
     * Whether this reader may hand a file over with the task, and whether they may take one back.
     *
     * Answered here for the same reason the four verbs above are: it is a question about the
     * record - which of its two people is looking - rather than about permissions, and the screen
     * must not have to guess it from the signed-in user. Somebody reading the studio's list through
     * All Tasks may open every file and add none, exactly as they may press none of the verbs.
     */
    canAttach: isOnTask(task, viewerId),
    activities: (task.activities || []).map((activity) => ({
      id: activity.id,
      action: activity.action,
      detail: activity.detail,
      userName: activity.userName,
      createdAt: activity.createdAt,
    })),
    /*
     * The files handed over with the task - what they are called and how big, never the bytes.
     *
     * No storage key either: it is the bucket's own address, of no use to the browser, and the
     * endpoint that streams a file takes the entry's id. Anybody who may read the task may read its
     * files, so this list needs no gate of its own beyond the one that answered with the task.
     */
    attachments: attachmentList(task).map((attachment) => toAttachment(attachment, task, viewerId)),
  };
}

/** The list as stored, defended against a column that is null or was written as something else. */
const attachmentList = (task) => (Array.isArray(task?.attachments) ? task.attachments : []);

/**
 * The id the next file on this task takes: the highest the list has reached, plus one.
 *
 * Never reused. A removed file's number is not handed to another one, so a link somebody kept to
 * `/tasks/12/attachments/3` cannot quietly start serving a different file - which is the trap of
 * numbering by position in the array instead.
 */
const nextAttachmentId = (list) => list.reduce((highest, file) => Math.max(highest, Number(file?.id) || 0), 0) + 1;

/** One file, as the screen reads it. `canRemove` is the same rule the delete path refuses by. */
function toAttachment(attachment, task = null, viewerId = null) {
  return {
    id: Number(attachment.id),
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    uploadedByName: attachment.uploadedByName,
    createdAt: attachment.createdAt,
    canRemove: Boolean(viewerId) && (attachment.uploadedByUserId === viewerId || task?.assignedByUserId === viewerId),
  };
}

/** One activity row. Called only from inside the transaction that made the change it describes. */
const logActivity = (client, taskId, action, detail, actor) => client.hrmTaskActivity.create({
  data: { taskId, action, detail, userId: actor.id || null, userName: nameOf(actor) },
});

/** Where the bell sends somebody: the Tasks page, with the task itself already open. */
const linkTo = (task) => `/hrm/tasks?task=${task.id}`;

/**
 * The logins a task may be given to.
 *
 * Its own endpoint rather than the Users screen's, and deliberately narrow: it answers "who is
 * there" with an id and a name and nothing else, so being able to assign a task never becomes a way
 * to read the user directory. Only active logins, since a task given to a disabled one would sit
 * unread for ever.
 */
async function assignableUsers() {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, username: true, email: true },
    orderBy: { name: "asc" },
  });
  return users.map((user) => ({ id: user.id, name: nameOf(user) }));
}

/**
 * The departments and branches a task may be filed under.
 *
 * Read from the studio's own master data - the same `department` and `location` rows the HRM
 * screens keep - so a department added there is offered here without this module being touched.
 * Only the active ones: a retired branch is not somewhere new work can be given, though the tasks
 * already filed under it keep reading its name.
 *
 * Names, not ids. The task stores the name (see `schema.prisma`), so offering ids here would mean
 * translating them back on the way in for no gain.
 */
async function taskDepartments() {
  const rows = await prisma.department.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } });
  return rows.map((row) => row.name);
}

async function taskBranches() {
  const rows = await prisma.branch.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } });
  return rows.map((row) => row.name);
}

/**
 * Checks a picked department and branch against the lists they were picked from.
 *
 * The form offers both as closed lists, so anything else arriving here did not come from the form -
 * and a task filed under a department that does not exist is a row that no reading of the list will
 * ever group correctly. Named separately in the refusal, because "invalid task" would leave the
 * sender to work out which of the two it meant.
 */
async function assertDepartmentAndBranch(values) {
  const [departments, branches] = await Promise.all([taskDepartments(), taskBranches()]);
  if (!departments.includes(values.department)) throw httpError(400, "That department could not be found.");
  if (!branches.includes(values.branch)) throw httpError(400, "That branch could not be found.");
}

async function createTask(values, actor) {
  const assignee = await prisma.user.findUnique({
    where: { id: values.assignedToUserId },
    // `linkedEmployeeId` is what a task's owner is: the employee behind the login it is given to.
    // A login with none carries no owner, which is visible under ALL and BRANCH and invisible under
    // TEAM and SELF - and assignment is never refused for it (DATA-SCOPE.md, the task decision).
    select: { id: true, name: true, username: true, email: true, status: true, linkedEmployeeId: true },
  });
  if (!assignee) throw httpError(400, "The person this task is for could not be found.");
  if (assignee.status !== "ACTIVE") throw httpError(400, "That login is not active, so it cannot be given a task.");
  await assertDepartmentAndBranch(values);

  return prisma.$transaction(async (client) => {
    const task = await client.hrmTask.create({
      data: {
        taskCode: await nextTaskCode(client),
        title: values.title,
        description: values.description,
        taskType: values.taskType,
        // Cleared unless the type is the one that asks for it, so a detail typed and then thought
        // better of cannot be stored against "Client" where nothing would ever show it.
        // Kept only for a type that asks for it. The controller has already refused the case where
        // one asks and nothing was said, so this is the other half: a type that does not ask never
        // carries a stray description from a form that showed the box before the type changed.
        taskTypeOther: (await taskTypesAskingForDetails()).includes(values.taskType) ? values.taskTypeOther || null : null,
        priority: values.priority,
        department: values.department,
        branch: values.branch,
        branchId: (await referenceLookups()).branchId(values.branch),
        status: "PENDING",
        assignedToUserId: assignee.id,
        ownerEmployeeId: assignee.linkedEmployeeId ?? null,
        assignedToName: nameOf(assignee),
        assignedByUserId: actor.id || null,
        // Usually the giver, but an administrator can raise one on somebody else's behalf.
        createdByUserId: actor.id || null,
        assignedByName: nameOf(actor),
        dueOn: values.dueOn ? new Date(values.dueOn) : null,
      },
    });

    await logActivity(client, task.id, ACTIONS.CREATED, `${task.taskCode} created with ${PRIORITY_LABELS[task.priority]} priority.`, actor);
    await logActivity(client, task.id, ACTIONS.ASSIGNED, `Assigned to ${task.assignedToName}.`, actor);
    // The first link in the chain. My Tasks reads the holder rows rather than `assignedToUserId`,
    // so a task created without one would not appear on the list of the person it was given to.
    await rememberHolder(client, task.id, assignee.id, nameOf(assignee));
    await notify(client, {
      userId: assignee.id,
      actorId: actor.id,
      type: TYPES.TASK_ASSIGNED,
      title: `New task: ${task.title}`,
      body: `${nameOf(actor)} assigned you ${task.taskCode} · ${PRIORITY_LABELS[task.priority]} priority${task.dueOn ? ` · due ${task.dueOn.toISOString().slice(0, 10)}` : ""}`,
      entityType: "HRM_TASK",
      entityId: task.id,
      link: linkTo(task),
    });

    return toRow({ ...task, activities: [], holders: [] }, actor.id);
  });
}

/**
 * One of the three views, as its own query.
 *
 * `mine` and `given` are the two sides of the same row and need no permission beyond the screen's
 * own, because they are already scoped to the person asking. `all` is the studio's whole list and
 * is reached through its own endpoint behind its own permission - which is why the scope is passed
 * in by the route rather than chosen from the query string, where a caller could ask for `all`.
 */
/**
 * Whose tasks a reader of All Tasks gets: the grant's scope on `HRM / All Tasks`, on the task's
 * branch reference and its owner - the employee behind whoever it was given to (DATA-SCOPE.md, the
 * task decision). My Tasks and Tasks Given are already one person's own and are narrowed by nobody:
 * a task given to you is yours to see however narrow your grant is.
 */
// A task names its two people by login as well as by employee, so a manager sees the tasks their
// team gave as well as the ones their team was given.
const TASK_SCOPE_COLUMNS = { branch: "branchId", employee: "ownerEmployeeId", user: ["assignedToUserId", "assignedByUserId", "createdByUserId"] };
const allTasksScope = (userId) => dataScope.resolve({ userId, module: "HRM", feature: "All Tasks", columns: TASK_SCOPE_COLUMNS });

async function listTasks({ scope, userId, role = "", status = "" }) {
  /*
   * Deleted tasks are gone from all three lists, whichever question is being asked - including All
   * Tasks, which is the studio's whole list and would otherwise be the one place a deleted task
   * carried on being read. Stated here rather than per scope, so a fourth view added below cannot
   * be the one that forgets.
   */
  const where = { deletedAt: null };
  /*
   * My Tasks is everything I hold *or have held*, not only what is on me now.
   *
   * A task I reassigned is no longer mine to do, and it stays on this list anyway: I was asked to do
   * it, I passed it on, and what became of it is my business. The row says who holds it now and
   * offers me none of the verbs — `refusalFor` answers those against `assignedToUserId`, which is
   * no longer me.
   */
  if (scope === "mine") {
    /*
     * Either half is enough, and that is deliberate rather than belt-and-braces.
     *
     * `assignedToUserId` is authoritative for the task I hold *now*: a task written by anything
     * other than `createTask` — an import, a fixture, a backfill — has no holder row, and it must
     * still reach the person it is assigned to. The holder rows only ever widen the list, with the
     * tasks I once held and passed on.
     */
    where.OR = [{ assignedToUserId: userId }, { holders: { some: { userId } } }];
  }
  else if (scope === "given") where.assignedByUserId = userId;
  else if (scope === "all") where.AND = [(await allTasksScope(userId)).where];
  if (status && STATUSES.includes(status)) where.status = status;

  const tasks = await prisma.hrmTask.findMany({ where, orderBy: { createdAt: "desc" }, include });
  return tasks.map((task) => toRow(task, userId, role));
}

async function getTask(id, userId, canSeeAll = false, role = "") {
  // `findFirst` rather than `findUnique`, because a deleted task must answer as a task that is not
  // there - including to the link in somebody's bell, which is the one way to reach a task by id
  // without having seen it in a list first.
  const task = await prisma.hrmTask.findFirst({ where: { id, deletedAt: null }, include });
  if (!task) throw httpError(404, "That task could not be found.");
  // The same answer for a task that is not yours as for one that does not exist: whether a
  // colleague was given a particular task is not something this endpoint should confirm.
  if (!canRead(task, userId, canSeeAll, canSeeAll ? await allTasksScope(userId) : null)) throw httpError(404, "That task could not be found.");
  return toRow(task, userId, role);
}

/** Whether this login is one of the two people on a task - which is who may act on it at all. */
const isOnTask = (task, userId) => Boolean(userId) && (task.assignedToUserId === userId || task.assignedByUserId === userId);

/**
 * Records that somebody now holds this task.
 *
 * Idempotent by the table's own `@@unique([taskId, userId])`: a task handed back to somebody who
 * held it before does not make two holders of them, and the row keeps the date they *first* had it.
 * A login that has since been removed leaves `userId` null, so the name is written beside the id
 * for the same reason the task itself stores `assignedToName`.
 */
async function rememberHolder(client, taskId, userId, name) {
  if (!userId) return;
  await client.hrmTaskHolder.upsert({
    where: { taskId_userId: { taskId, userId } },
    create: { taskId, userId, name },
    update: {},
  });
}

/** The shared shape of the three things the receiver can do, and the one the giver can. */
/**
 * Correcting what a task says.
 *
 * A task is written down in a hurry and is regularly written down slightly wrong - the wrong due
 * date, a title that does not say what the job is, the right work against the wrong person. Until
 * now the only answers were to delete it and raise it again, which loses its history and its
 * attachments, or to leave it wrong.
 *
 * ── What this is not ─────────────────────────────────────────────────────────────────────────
 *
 * It is not a fifth verb in `transition`. Those five change what has *happened* to a task - it was
 * started, it was handed on, it was called off - and each is a state machine answer with an
 * activity line of its own. This changes what the task *is*, touches no status, and belongs to the
 * person who wrote it rather than to whoever holds it. Mixing the two would mean a status machine
 * that also edits text.
 *
 * Reassignment stays `transition`'s. Giving a task to somebody else is a real event in its life -
 * the holder chain records it, and the new holder is told - so changing the assignee here would be
 * a second, quieter way of doing something the module already does properly. The assignee is
 * therefore deliberately **not** editable: correct the words and the dates here, hand it over
 * there.
 */
async function updateTask(id, values, actor, { canSeeAll = false } = {}) {
  const task = await prisma.hrmTask.findFirst({ where: { id, deletedAt: null }, include: { holders: true } });
  if (!task) throw httpError(404, "That task could not be found.");
  // The same "not found" a read would give: a task this reader cannot see must not be told apart
  // from one that does not exist by which refusal comes back.
  if (!canRead(task, actor.id, canSeeAll, canSeeAll ? await allTasksScope(actor.id) : null)) throw httpError(404, "That task could not be found.");

  // The role is passed, as delete's is, because this verb is the giver's *and* a Super Admin's.
  const refusal = refusalFor(task, "edit", actor.id, actor.role);
  if (refusal) throw httpError(403, refusal);

  // The same two closed lists a create is held to; both are master data the studio edits, so they
  // are read now rather than baked into a schema at require time.
  await assertDepartmentAndBranch(values);

  const asksForDetails = (await taskTypesAskingForDetails()).includes(values.taskType);

  return prisma.$transaction(async (client) => {
    const updated = await client.hrmTask.update({
      where: { id },
      data: {
        title: values.title,
        description: values.description,
        taskType: values.taskType,
        // Cleared unless the new type asks for it - the same rule the create follows, so a type
        // changed away from "Other" cannot leave its detail behind where nothing would show it.
        taskTypeOther: asksForDetails ? values.taskTypeOther || null : null,
        priority: values.priority,
        department: values.department,
        branch: values.branch,
        // The reference beside the text, kept in step the way every other branch write here is.
        branchId: (await referenceLookups()).branchId(values.branch),
        dueOn: values.dueOn ? new Date(values.dueOn) : null,
      },
    });

    /*
     * One line, naming what changed rather than that something did.
     *
     * A task's history is read to answer "why does this say what it says", and "TSK-1 was edited"
     * answers none of it. The fields are compared against the row as it was so the line names only
     * what actually moved - saving a form without touching it should not claim an edit.
     */
    const changes = [];
    if (task.title !== updated.title) changes.push("title");
    if (task.description !== updated.description) changes.push("description");
    if (task.taskType !== updated.taskType || task.taskTypeOther !== updated.taskTypeOther) changes.push("task type");
    if (task.priority !== updated.priority) changes.push(`priority to ${PRIORITY_LABELS[updated.priority]}`);
    if (task.department !== updated.department) changes.push(`department to ${updated.department}`);
    if (task.branch !== updated.branch) changes.push(`branch to ${updated.branch}`);
    if (String(task.dueOn ?? "") !== String(updated.dueOn ?? "")) {
      changes.push(updated.dueOn ? `due date to ${updated.dueOn.toISOString().slice(0, 10)}` : "due date removed");
    }
    if (changes.length) {
      await logActivity(client, id, ACTIONS.UPDATED, `${updated.taskCode}: changed ${changes.join(", ")}.`, actor);
    }

    /*
     * Re-read so the line just written is part of what comes back - the update above was taken
     * before it existed. The same thing `transition` does, and for the same reason: the panel draws
     * the history from this answer and would otherwise show the task without the edit that made it.
     */
    const withHistory = await client.hrmTask.findUnique({ where: { id }, include });
    return toRow(withHistory || updated, actor.id, actor.role);
  });
}

async function transition(id, action, actor, { reason = null, assignToUserId = null, canSeeAll = false } = {}) {
  // With `holders`, so `canRead` can answer for somebody who has held this task and passed it on.
  // A deleted task is not there to be started, completed, reassigned or cancelled.
  const task = await prisma.hrmTask.findFirst({ where: { id, deletedAt: null }, include: { holders: true } });
  if (!task) throw httpError(404, "That task could not be found.");
  if (!canRead(task, actor.id, canSeeAll, canSeeAll ? await allTasksScope(actor.id) : null)) throw httpError(404, "That task could not be found.");

  const refusal = refusalFor(task, action, actor.id);
  if (refusal) throw httpError(403, refusal);

  const now = new Date();
  const actorName = nameOf(actor);

  return prisma.$transaction(async (client) => {
    let data;
    let activity;
    let notice;

    if (action === "start") {
      data = { status: "IN_PROGRESS" };
      activity = [ACTIONS.STATUS_CHANGED, `Status changed from ${statusLabel(task.status)} to In Progress.`];
      // No notice: starting is the receiver getting on with it, and the giver does not need a bell
      // for every task somebody opens. Completion and reverting are the answers they are waiting on.
      notice = null;
    } else if (action === "complete") {
      data = { status: "COMPLETED", completedAt: now, completedByUserId: actor.id || null, completedByName: actorName };
      activity = [ACTIONS.COMPLETED, `Completed by ${actorName}.`];
      notice = {
        userId: task.assignedByUserId,
        type: TYPES.TASK_COMPLETED,
        title: `Task completed: ${task.title}`,
        body: `${actorName} completed ${task.taskCode}.`,
      };
    } else if (action === "reassign") {
      /*
       * Handing the work on, with a reason and a named destination.
       *
       * Guarded here as well as in the controller's schema, because this is the last place before
       * it is written and both halves are the point: a reassignment with nobody to go to is not a
       * reassignment, and one with no reason leaves the next person the task and none of the
       * context that would let them pick it up.
       */
      if (!reason || !String(reason).trim()) throw httpError(400, "Say why this task is being reassigned.");
      if (!assignToUserId) throw httpError(400, "Choose who this task is being reassigned to.");
      if (assignToUserId === task.assignedToUserId) throw httpError(400, "This task is already assigned to them.");
      // `linkedEmployeeId` comes back because the task's *owner* is the employee behind whoever
      // holds it, and the owner is what the data-scope team and self limbs read (DATA-SCOPE.md).
      const next = await client.user.findUnique({ where: { id: assignToUserId }, select: { id: true, name: true, username: true, email: true, status: true, linkedEmployeeId: true } });
      if (!next || next.status !== "ACTIVE") throw httpError(400, "That person cannot be given tasks.");
      const nextName = nameOf(next);

      data = {
        status: "REASSIGNED",
        assignedToUserId: next.id,
        assignedToName: nextName,
        /*
         * The owner follows the holder, and forgetting this is invisible until it matters.
         *
         * `ownerEmployeeId` is the employee behind whoever holds the task, and it is what a
         * manager's TEAM scope and a person's SELF scope read on All Tasks. Left pointing at the
         * previous holder, a reassigned task would keep showing up for that person's manager and
         * disappear from the new holder's — with nothing on screen to suggest why.
         */
        ownerEmployeeId: next.linkedEmployeeId ?? null,
        reassignedAt: now,
        reassignReason: String(reason).trim(),
        reassignedFromUserId: actor.id || null,
        reassignedFromName: actorName,
        /*
         * The clock starts again for the person picking it up. A task half-done by somebody else is
         * not half-done for them, and leaving `IN_PROGRESS` on it would let them mark work complete
         * they never started.
         */
      };
      activity = [ACTIONS.REASSIGNED, `Reassigned from ${actorName} to ${nextName}. Reason: ${String(reason).trim()}`];
      /*
       * The new holder is told, and so is whoever set the task: the person waiting on the work has
       * to know it changed hands, or the first they hear of it is a name they did not choose
       * appearing against their task.
       */
      notice = [
        {
          userId: next.id,
          type: TYPES.TASK_REASSIGNED,
          title: `Task reassigned to you: ${task.title}`,
          body: `${actorName} reassigned ${task.taskCode} to you. Reason: ${String(reason).trim()}`,
        },
        ...(task.assignedByUserId && task.assignedByUserId !== next.id ? [{
          userId: task.assignedByUserId,
          type: TYPES.TASK_REASSIGNED,
          title: `Task reassigned: ${task.title}`,
          body: `${actorName} reassigned ${task.taskCode} to ${nextName}. Reason: ${String(reason).trim()}`,
        }] : []),
      ];
      /*
       * Both ends of the hop, not just the new one.
       *
       * The person handing it on is recorded here as well, because a task written by anything other
       * than `createTask` — an import, a fixture, a backfill — has no holder row of its own, and
       * reassigning it would otherwise start the chain at its second link. Recording is idempotent,
       * so a holder already known keeps the date they first had it.
       */
      await rememberHolder(client, task.id, task.assignedToUserId, task.assignedToName);
      await rememberHolder(client, task.id, next.id, nextName);
    } else if (action === "cancel") {
      data = { status: "CANCELLED", cancelledAt: now };
      activity = [ACTIONS.CANCELLED, reason ? `Cancelled by ${actorName}. Reason: ${String(reason).trim()}` : `Cancelled by ${actorName}.`];
      notice = {
        userId: task.assignedToUserId,
        type: TYPES.TASK_CANCELLED,
        title: `Task cancelled: ${task.title}`,
        body: `${actorName} cancelled ${task.taskCode}.${reason ? ` Reason: ${String(reason).trim()}` : ""}`,
      };
    } else {
      throw httpError(400, "That is not something a task can be asked to do.");
    }

    const updated = await client.hrmTask.update({ where: { id }, data, include });
    await logActivity(client, id, activity[0], activity[1], actor);
    // One notice or several — reassigning tells two people, everything else tells one.
    for (const entry of [notice].flat().filter(Boolean)) {
      await notify(client, {
        ...entry,
        actorId: actor.id,
        entityType: "HRM_TASK",
        entityId: task.id,
        link: linkTo(task),
      });
    }
    // Re-read so the activity just written is part of what comes back; the update above was taken
    // before it existed.
    const withHistory = await client.hrmTask.findUnique({ where: { id }, include });
    return toRow(withHistory || updated, actor.id, actor.role);
  });
}

/**
 * Taking a task out of the studio's lists: the giver's, and a Super Admin's.
 *
 * **A soft delete.** `deleted_at` is stamped and the row stays exactly where it was, with its chain
 * of holders, its activity log and the files handed over with it. A task is the record of somebody
 * having been asked to do something, and a row removed outright would leave "what happened to
 * DBS-TK-00042?" unanswerable for good - where this is a column somebody can clear. Every read in
 * this module narrows by it, so the task is gone from My Tasks, Tasks Given and All Tasks alike, and
 * its id answers 404 to every verb and to its own files.
 *
 * Not a status, and deliberately not one. CANCELLED says a real task was called off and is still
 * read by both people; deleted says it should never have been raised. Folding the second into the
 * first would have lost the distinction and put deleted rows back in front of everybody under a
 * status tab.
 *
 * Its own function rather than a fifth branch of `transition`, because it is not a state change:
 * nothing about the task moves, no notice is sent, and what comes back is the id that went rather
 * than a row to put on screen.
 */
async function deleteTask(id, actor, { canSeeAll = false } = {}) {
  const task = await prisma.hrmTask.findFirst({ where: { id, deletedAt: null }, include: { holders: true } });
  if (!task) throw httpError(404, "That task could not be found.");
  // The same 404 for a task that is not yours as for one that does not exist, exactly as reading it
  // answers - whether a colleague holds a particular task is not something this confirms.
  if (!canRead(task, actor.id, canSeeAll, canSeeAll ? await allTasksScope(actor.id) : null)) throw httpError(404, "That task could not be found.");

  const refusal = refusalFor(task, "delete", actor.id, actor.role);
  if (refusal) throw httpError(403, refusal);

  const actorName = nameOf(actor);
  return prisma.$transaction(async (client) => {
    await client.hrmTask.update({ where: { id }, data: { deletedAt: new Date() } });
    /*
     * Logged although the task is now invisible, and that is the point: cleared by hand, the task
     * comes back with the line saying who removed it and when still in its own history. Written
     * inside the same transaction as the delete, so there can be no deleted task with no record of
     * who deleted it.
     */
    await logActivity(client, id, ACTIONS.DELETED, `Deleted by ${actorName}.`, actor);
    /*
     * The bell is cleared of everything about this task, rather than left pointing at it.
     *
     * A notice carries a link to the task, and the task now answers 404 - so a row left in the bell
     * would be an entry that opens onto nothing, for as long as the feed shows it. Nothing new is
     * sent either: a "this was deleted" notice would be an entry with nowhere to go for the same
     * reason. The holder finds it gone from My Tasks, which is where they were reading it.
     */
    // `String(...)`: the column is text, since a notice can be about a record whose id is not a
    // number - it is written that way by `notify`, and it has to be matched that way here.
    await client.notification.deleteMany({ where: { entityType: "HRM_TASK", entityId: String(task.id) } });
    return { id: task.id, taskCode: task.taskCode, deleted: true };
  });
}

/*
 * ── Attachments ───────────────────────────────────────────────────────────────────────────────
 *
 * A task's files live in one JSON column on the task itself (`attachments`), not in a table beside
 * it: they are read with the task, always, and nothing else in the application points at one. What
 * is stored is a list of small records — never the bytes, which are private objects in R2.
 *
 * Who may read one is decided by `canRead`, exactly as the task itself is: whoever may open the
 * task may open what was handed over with it, and a task this reader may not see answers 404 for
 * its files too rather than confirming they exist.
 *
 * Who may *add or remove* one is narrower, and follows the rule the four verbs already keep: the
 * two people on the task, and nobody else. Somebody reading the studio's list through
 * `HRM / All Tasks` may look at every task and act on none of them — attaching a file to a task
 * that is not theirs is acting on it.
 *
 * The two things a column costs against a table are paid here rather than left to chance:
 *
 * - **An id has to be minted.** `nextAttachmentId` takes the highest in the list and adds one, so a
 *   file keeps a stable address (`/tasks/12/attachments/3`) for as long as it exists, and a
 *   removed file's number is never handed to another one.
 * - **The list is rewritten whole.** So every write takes the task's row lock first — see
 *   `withLockedTask`. Without it, two people removing two different files at the same moment each
 *   write back the list they read, and the second quietly puts the first one's file back.
 */

/** The task this file belongs to, read for this viewer, or a 404 that says nothing either way. */
async function taskForAttachment(taskId, userId, canSeeAll, client = prisma) {
  // Deleted with the task: its files are not readable, addable or removable afterwards, and the
  // same 404 answers for all three.
  const task = await client.hrmTask.findFirst({ where: { id: taskId, deletedAt: null } });
  if (!task) throw httpError(404, "That task could not be found.");
  if (!canRead(task, userId, canSeeAll, canSeeAll ? await allTasksScope(userId) : null)) {
    throw httpError(404, "That task could not be found.");
  }
  return task;
}

/**
 * Reads the task with its row locked, runs `change`, and writes the list back.
 *
 * `SELECT … FOR UPDATE` is what makes a JSON list safe to edit: it holds the row until the
 * transaction ends, so a second writer waits and then reads the list the first one left rather than
 * the one it started from. Raw because Prisma has no locking read — the row it returns is
 * discarded, and the `findUnique` after it is what reads the locked row.
 */
async function withLockedTask(taskId, userId, canSeeAll, change) {
  return prisma.$transaction(async (client) => {
    await client.$queryRaw`SELECT id FROM hrm_task WHERE id = ${taskId} FOR UPDATE`;
    const task = await taskForAttachment(taskId, userId, canSeeAll, client);
    return change(client, task, attachmentList(task));
  });
}

/**
 * Files one picked file against a task.
 *
 * The bucket is written before the row, and outside the lock: an upload takes as long as the file
 * is big, and holding a task's row for it would block everything else the two people on it are
 * doing. An object stored whose list entry then fails to save is an orphan somebody can sweep; a
 * list entry pointing at an object that was never stored is a download that fails for whoever
 * presses it, which is the worse of the two.
 */
async function addAttachment(taskId, file, actor, { canSeeAll = false } = {}) {
  const task = await taskForAttachment(taskId, actor.id, canSeeAll);
  if (!isOnTask(task, actor.id)) throw httpError(403, "Only the two people on a task can attach a file to it.");
  if (!file?.buffer?.length) throw httpError(400, "Choose a file to attach.");
  // Named rather than a bare refusal: somebody who picked the wrong thing should be told what
  // would have been right, in the same sentence.
  if (!attachments.isAllowedFile(file)) throw httpError(415, `That file type cannot be attached. ${attachments.ALLOWED_LABEL} are accepted.`);
  if (!attachments.storageReady()) throw httpError(503, "File storage is not configured, so attachments cannot be saved yet.");

  const stored = await attachments.storeAttachment({ taskCode: task.taskCode, taskId: task.id, file });
  if (!stored) throw httpError(500, "That file could not be stored.");

  return withLockedTask(taskId, actor.id, canSeeAll, async (client, locked, list) => {
    const entry = {
      id: nextAttachmentId(list),
      name: stored.name,
      storageKey: stored.key,
      mimeType: stored.type,
      size: stored.size,
      uploadedByUserId: actor.id || null,
      uploadedByName: nameOf(actor),
      createdAt: new Date().toISOString(),
    };
    await client.hrmTask.update({ where: { id: locked.id }, data: { attachments: [...list, entry] } });
    await logActivity(client, locked.id, ACTIONS.ATTACHED, entry.name, actor);
    return toAttachment(entry, locked, actor.id);
  });
}

/** The bytes behind one file, for the endpoint that streams it. */
async function readTaskAttachment(taskId, attachmentId, userId, { canSeeAll = false } = {}) {
  const task = await taskForAttachment(taskId, userId, canSeeAll);
  const entry = attachmentList(task).find((file) => Number(file?.id) === attachmentId);
  if (!entry) throw httpError(404, "That attachment could not be found.");
  const object = await attachments.readAttachment(entry.storageKey);
  // The entry outliving the object is possible - a bucket can be swept - and reads better as "no
  // longer stored" than as a stream that ends immediately.
  if (!object) throw httpError(404, "That attachment is no longer stored.");
  return { ...object, name: entry.name, size: entry.size, mimeType: entry.mimeType };
}

/**
 * Removes one file: the list first, then the object.
 *
 * That order on purpose. A list without the entry, with the object left behind, is a file nothing
 * points at; the other way round is an entry whose download fails for everybody, which is worse and
 * is what a failed delete would leave.
 */
async function removeTaskAttachment(taskId, attachmentId, actor, { canSeeAll = false } = {}) {
  const removed = await withLockedTask(taskId, actor.id, canSeeAll, async (client, task, list) => {
    const entry = list.find((file) => Number(file?.id) === attachmentId);
    if (!entry) throw httpError(404, "That attachment could not be found.");
    // Whoever put it there, or whoever set the task. The receiver cannot quietly drop the brief
    // they were given, and the giver cannot be left unable to withdraw one they attached by mistake.
    const mayRemove = entry.uploadedByUserId === actor.id || task.assignedByUserId === actor.id;
    if (!mayRemove) throw httpError(403, "Only the person who attached a file, or whoever set the task, can remove it.");

    await client.hrmTask.update({
      where: { id: task.id },
      data: { attachments: list.filter((file) => Number(file?.id) !== attachmentId) },
    });
    await logActivity(client, task.id, ACTIONS.ATTACHMENT_REMOVED, entry.name, actor);
    return entry;
  });

  await attachments.removeAttachment(removed.storageKey);
  return { id: removed.id };
}

module.exports = {
  addAttachment,
  updateTask,
  attachmentList,
  nextAttachmentId,
  readTaskAttachment,
  removeTaskAttachment,
  STATUSES,
  CLOSED_STATUSES,
  PRIORITIES,
  TASK_TYPES,
  OTHER_TASK_TYPE,
  taskTypeNames,
  taskTypesAskingForDetails,
  taskTypeLabel,
  ACTIONS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  statusLabel,
  nameOf,
  refusalFor,
  canRead,
  assignableUsers,
  createTask,
  taskDepartments,
  taskBranches,
  listTasks,
  getTask,
  transition,
  deleteTask,
};
