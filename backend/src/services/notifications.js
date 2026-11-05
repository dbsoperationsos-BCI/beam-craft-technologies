const prisma = require("../config/db");

/**
 * What the application has to tell somebody, waiting on the bell in the top bar.
 *
 * One store for every module rather than a panel per feature. The studio's meetings grew their own
 * bell, which is why the bar had a "Notifications" control that only ever knew about meetings and
 * went quiet for anybody without the Sales permission; a second such bell for tasks would have made
 * that two. A module that needs to tell somebody something writes a row here with a `type` and a
 * `link`, and the one bell shows it.
 *
 * Writing is never allowed to break the thing it is reporting on. A task is completed whether or
 * not the person who set it can be told about it, so `notify` swallows its own failure and says so
 * in the log - the alternative is a 500 on a request that already did what it was asked.
 */

/** The notice types written so far. Adding one is adding a string; the bell draws them all alike. */
const TYPES = {
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_COMPLETED: "TASK_COMPLETED",
  // Kept for the notices already sent about tasks rolled back, before reassigning replaced it.
  TASK_REVERTED: "TASK_REVERTED",
  TASK_REASSIGNED: "TASK_REASSIGNED",
  TASK_CANCELLED: "TASK_CANCELLED",
  /*
   * A lead has been put in somebody's name.
   *
   * Stored rather than derived, unlike the follow-up and WhatsApp notices beside it in the bell, and
   * the difference is not arbitrary. A derived notice is a *state* - a follow-up is due, a client is
   * waiting - and it stops being true when the work is done. Being handed a lead is an **event**: it
   * happened at a moment, to a person, and it stays true afterwards. Derived, it would have had to
   * be "leads assigned to you that you have not touched", which lights the bell for the whole of
   * somebody's caseload rather than for the one thing that just changed.
   */
  LEAD_ASSIGNED: "LEAD_ASSIGNED",
  /*
   * Somebody posted to HRM → Events. Stored for the same reason a lead assignment is: a post is
   * something that happened, and it stays true after it has been seen. Written to everybody who can
   * open Events, bar the person who posted it - see `hrm/events/eventNotifications.js`.
   */
  EVENT_POSTED: "EVENT_POSTED",
  /*
   * A leave, permission or comp-off request is waiting on this person's answer. Written only to the
   * approvers named on that request, and taken off again once they have answered it or it is settled
   * - see `hrm/attendance/requestNotifications.js`. This replaced the Request badge in the sidebar.
   */
  REQUEST_WAITING: "REQUEST_WAITING",
  /*
   * A client wrote in a chat from their app. Written to whoever answers that topic for the project
   * (see `client/chats/service.js`) - Payment to Accounts, the shoot topics to the project's team,
   * Quotation to its CRM - and taken off again once the chat is read or answered.
   */
  CLIENT_CHAT: "CLIENT_CHAT",
  /*
   * A client asked the studio to unlock an invitation (to share it, and edit past the free edits).
   * Written to everybody who may record invitations paid, and taken off again once it is recorded.
   */
  INVITATION_UNLOCK: "INVITATION_UNLOCK",
  /*
   * A client raised a request about their services or deliverables. Written to the project's team who
   * may answer client requests, and taken off once it is answered.
   */
  CLIENT_REQUEST: "CLIENT_REQUEST",
  /*
   * A request the studio raised on a project (Client Requests -> Raised Requests): to its approvers
   * when it is raised, to the person who raised it when it is decided or more is asked of them, and to
   * the reviewer when they answer. Approvers' notices are taken off once it is decided.
   */
  CHANGE_REQUEST: "CHANGE_REQUEST",
};

/*
 * ── Which permission each kind of notice answers for ──────────────────────────────────────────
 *
 * The bell is on the topbar of every screen, so its own router can only ask that the caller is
 * signed in; what they are actually told is decided one notice at a time, against the permission of
 * the module the notice is about. A row saying a lead has been assigned names that lead and links to
 * it, so it may only reach somebody who holds the CRM - otherwise the bell becomes a way of reading
 * a client's name past the guard on the screen that holds it.
 *
 * This was one constant in the controller, `HRM / Task Management`, and that was right exactly while
 * Tasks was the only module that wrote a row. The moment a second one did, a blanket gate would have
 * meant a salesperson with no Tasks permission being told nothing about their own leads, and a
 * task-only reader being told about leads they cannot open. A map is what lets a third module write
 * a row without either of those being true - and the bell picks it up without being edited.
 *
 * A type absent from this map is not shown to anybody, which is the safe direction: an unmapped type
 * is a module that has not said who its notices belong to, and guessing on its behalf is how a leak
 * gets written.
 */
const TYPE_PERMISSIONS = {
  [TYPES.TASK_ASSIGNED]: { module: "HRM", feature: "Task Management" },
  [TYPES.TASK_COMPLETED]: { module: "HRM", feature: "Task Management" },
  [TYPES.TASK_REVERTED]: { module: "HRM", feature: "Task Management" },
  [TYPES.TASK_CANCELLED]: { module: "HRM", feature: "Task Management" },
  [TYPES.TASK_REASSIGNED]: { module: "HRM", feature: "Task Management" },
  [TYPES.LEAD_ASSIGNED]: { module: "SALES", feature: "CRM Leads" },
  [TYPES.EVENT_POSTED]: { module: "HRM", feature: "Events" },
  /*
   * A list means *any of them*: the requests are read through either permission (the attendance
   * routes accept both), so an approver holding only one of the two is still told.
   */
  [TYPES.REQUEST_WAITING]: [{ module: "HRM", feature: "Requests" }, { module: "HRM", feature: "Employee Attendance" }],
  [TYPES.CLIENT_CHAT]: { module: "CLIENT", feature: "Client Chats" },
  [TYPES.INVITATION_UNLOCK]: { module: "CLIENT", feature: "Invitation Cards" },
  [TYPES.CLIENT_REQUEST]: { module: "CLIENT", feature: "Client Requests" },
  [TYPES.CHANGE_REQUEST]: [{ module: "CLIENT", feature: "Client Requests" }, { module: "CLIENT", feature: "Request Approval" }],
};

/** A type's permissions as a list, whether it names one or several. */
const permissionsOf = (type) => [TYPE_PERMISSIONS[type]].flat().filter(Boolean);

/** Every distinct `{ module, feature }` a stored notice can answer for, asked once per request. */
function permissionsForTypes() {
  const seen = new Map();
  for (const permission of Object.keys(TYPE_PERMISSIONS).flatMap(permissionsOf)) {
    seen.set(`${permission.module}:${permission.feature}`, permission);
  }
  return [...seen.values()];
}

/** The types a reader holding these `{ module, feature }` pairs may be told about - any one suffices. */
function typesFor(held = []) {
  const keys = new Set(held.map((permission) => `${permission.module}:${permission.feature}`));
  return Object.keys(TYPE_PERMISSIONS)
    .filter((type) => permissionsOf(type).some((permission) => keys.has(`${permission.module}:${permission.feature}`)));
}

/** How many notices the bell will carry. Older ones stay in the table and simply stop being fetched. */
const FEED_LIMIT = 30;

/**
 * Tell one person one thing.
 *
 * Never tells somebody about their own action: completing a task you set yourself, or assigning one
 * to yourself, would otherwise light your own bell for something you just did. That check is here
 * rather than at each call site so no caller can forget it.
 *
 * `client` takes a transaction where the notice belongs with the write that caused it.
 */
async function notify(client, { userId, actorId = null, type, title, body = null, entityType = null, entityId = null, link = null }) {
  if (!userId || (actorId && userId === actorId)) return null;
  try {
    const row = await (client || prisma).notification.create({
      data: {
        userId,
        type,
        title: String(title).slice(0, 200),
        body: body ? String(body) : null,
        entityType,
        entityId: entityId === null || entityId === undefined ? null : String(entityId),
        link,
      },
    });
    // The same notice on their phone, if they use the Beam Craft app (never held up, never fails this).
    require("./clientPush").pushToStaff([userId], { title, body, link });
    return row;
  } catch (error) {
    // See the note above: the work this reports on has already happened.
    console.error("Unable to write notification:", error);
    return null;
  }
}

/**
 * This reader's bell: the newest *unread* notices, and how many there are for the badge.
 *
 * Unread only, because reading one is how it leaves the bell: opening it, or pressing its
 * "Mark as read", marks it read and it is gone from the panel. The row stays in the table.
 *
 * `types` is the list this reader's permissions reach - see `typesFor`. Applied in the query rather
 * than filtered afterwards, so the badge counts what the panel lists: a count taken over every row
 * and a list narrowed to some of them is a bell that says three and opens showing one.
 *
 * An empty list means no permission reaches any kind of stored notice, and the honest answer is
 * nothing rather than everything - so it is passed to Prisma as `in: []` and matches no row.
 */
async function listForUser(userId, { limit = FEED_LIMIT, types = null } = {}) {
  const where = { userId, ...(types ? { type: { in: types } } : {}) };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { ...where, readAt: null }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { notifications: notifications.map(serialize), unreadCount };
}

function serialize(notification) {
  return {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    entityType: notification.entityType,
    entityId: notification.entityId,
    link: notification.link,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}

/**
 * Mark one notice read.
 *
 * Scoped to the reader in the `where` rather than fetched and then checked, so there is no window
 * in which somebody else's notice is loaded at all: an id belonging to another person matches
 * nothing and the count comes back zero, which is the 404 the controller reports.
 */
async function markRead(userId, id) {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  // Already read is not an error - the bell marks on open, so a second press is ordinary.
  if (count === 0) return prisma.notification.count({ where: { id, userId } }).then((exists) => exists > 0);
  return true;
}

async function markAllRead(userId) {
  const { count } = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return count;
}

module.exports = { TYPES, TYPE_PERMISSIONS, FEED_LIMIT, notify, listForUser, markRead, markAllRead, permissionsForTypes, typesFor };
