/*
 * A stand-in Prisma client holding the two activity-log tables in memory, for the WhatsApp activity
 * tests. It answers the subset of Prisma that `services/whatsappActivity.js` uses - `findUnique`,
 * `findFirst`, `findMany`, `create`, `update`, `updateMany`, `count`, `groupBy` with the where
 * shapes the service writes - and nothing more, so a query the service does not make fails loudly
 * here rather than passing by accident.
 */
let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

function matches(row, where = {}, relations = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((branch) => matches(row, branch, relations));
    if (key === "AND") return condition.every((branch) => matches(row, branch, relations));
    // A relation named in a where (`crmLead: { is: {...} }`) is resolved the way a select resolves it.
    const value = relations[key] && !(key in row) ? relations[key](row, { select: null }) : row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date || typeof condition !== "object") return value === condition;
    return Object.entries(condition).every(([op, operand]) => {
      if (op === "in") return operand.includes(value);
      if (op === "not") return value !== operand;
      if (op === "lt") return value !== null && value !== undefined && new Date(value) < new Date(operand);
      if (op === "gt") return value !== null && value !== undefined && new Date(value) > new Date(operand);
      if (op === "gte") return value !== null && value !== undefined && new Date(value) >= new Date(operand);
      if (op === "lte") return value !== null && value !== undefined && new Date(value) <= new Date(operand);
      if (op === "contains") return String(value || "").toLowerCase().includes(String(operand).toLowerCase());
      if (op === "is") return matches(value || {}, operand);
      if (op === "isNot") return !matches(value || {}, operand);
      throw new Error(`fake client: unsupported operator ${op}`);
    });
  });
}

function pick(row, select, relations) {
  if (!select) return { ...row };
  const out = {};
  for (const [key, wanted] of Object.entries(select)) {
    if (!wanted) continue;
    if (relations && typeof wanted === "object" && relations[key]) out[key] = relations[key](row, wanted);
    else if (typeof wanted === "object" && key in row && typeof row[key] === "object") out[key] = row[key];
    else out[key] = row[key] ?? null;
  }
  return out;
}

function sortRows(rows, orderBy) {
  const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const [[key, dir]] = Object.entries(order);
      const left = a[key] instanceof Date ? a[key].getTime() : a[key];
      const right = b[key] instanceof Date ? b[key].getTime() : b[key];
      if (left === right) continue;
      return (left > right ? 1 : -1) * (dir === "desc" ? -1 : 1);
    }
    return 0;
  });
}

function table(name, rows, { defaults = () => ({}), unique = [], relations = {}, onUpdate = () => ({}) } = {}) {
  const uniqueViolated = (row, exceptId) => unique.some((keys) => rows.some((other) => other.id !== exceptId && keys.every((key) => other[key] === row[key])));
  return {
    rows,
    findUnique: async ({ where, select, include }) => {
      const row = rows.find((candidate) => matches(candidate, where, relations));
      if (!row) return null;
      const base = pick(row, select, relations);
      if (include) for (const [key, options] of Object.entries(include)) base[key] = relations[key](row, options === true ? {} : options);
      return base;
    },
    findFirst: async ({ where, select, orderBy }) => {
      const row = sortRows(rows.filter((candidate) => matches(candidate, where, relations)), orderBy)[0];
      return row ? pick(row, select, relations) : null;
    },
    findMany: async ({ where, select, orderBy, skip = 0, take, distinct } = {}) => {
      let hits = sortRows(rows.filter((candidate) => matches(candidate, where || {}, relations)), orderBy);
      if (Array.isArray(distinct)) {
        const seen = new Set();
        hits = hits.filter((row) => { const key = distinct.map((field) => String(row[field])).join("|"); if (seen.has(key)) return false; seen.add(key); return true; });
      }
      return hits.slice(skip, take ? skip + take : undefined).map((row) => pick(row, select, relations));
    },
    count: async ({ where } = {}) => rows.filter((candidate) => matches(candidate, where || {}, relations)).length,
    groupBy: async ({ by, where }) => {
      const groups = new Map();
      for (const row of rows.filter((candidate) => matches(candidate, where || {}, relations))) {
        const key = by.map((field) => row[field]).join("|");
        if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(by.map((field) => [field, row[field]])), _count: { _all: 0 } });
        groups.get(key)._count._all += 1;
      }
      return [...groups.values()];
    },
    create: async ({ data, select }) => {
      const row = { id: nextId(name), ...defaults(), ...data };
      if (uniqueViolated(row)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      rows.push(row);
      return pick(row, select, relations);
    },
    update: async ({ where, data, select }) => {
      const row = rows.find((candidate) => matches(candidate, where, relations));
      if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
      Object.assign(row, data, onUpdate());
      return pick(row, select, relations);
    },
    updateMany: async ({ where, data }) => {
      const hits = rows.filter((candidate) => matches(candidate, where, relations));
      for (const row of hits) Object.assign(row, data, onUpdate());
      return { count: hits.length };
    },
  };
}

/**
 * The client. `initial` seeds `{ activities, attempts, users, salesProjects, imageSelectionProjects,
 * productionMessages, notifications }`; everything is reachable afterwards on `client.state`.
 */
function createActivityFakeClient(initial = {}) {
  const state = {
    activities: initial.activities || [],
    attempts: initial.attempts || [],
    users: initial.users || [{ id: 7, name: "Priya", status: "ACTIVE" }],
    salesProjects: initial.salesProjects || [],
    imageSelectionProjects: initial.imageSelectionProjects || [],
    productionMessages: initial.productionMessages || [],
    notifications: initial.notifications || [],
  };
  const userOf = (id) => (id ? state.users.find((user) => user.id === id) || null : null);
  const nameOf = (row, select) => (row ? pick(row, select) : null);
  const activityRelations = {
    initiatedByUser: (row, { select }) => nameOf(userOf(row.initiatedByUserId), select),
    senderUser: (row, { select }) => nameOf(userOf(row.senderUserId), select),
    salesProject: (row, { select }) => nameOf(state.salesProjects.find((project) => project.id === row.salesProjectId), select),
    crmLead: () => null,
    employee: () => null,
    imageSelectionProject: (row, { select }) => nameOf(state.imageSelectionProjects.find((project) => project.id === row.imageSelectionProjectId), select),
    attempts: (row, { select, orderBy }) => sortRows(state.attempts.filter((attempt) => attempt.activityId === row.id), orderBy).map((attempt) => pick(attempt, select, attemptRelations)),
  };
  const attemptRelations = {
    requestedByUser: (row, { select }) => nameOf(userOf(row.requestedByUserId), select),
    senderUser: (row, { select }) => nameOf(userOf(row.senderUserId), select),
  };
  const stamp = () => ({ updatedAt: new Date() });
  const activityDefaults = () => ({
    eventRef: null, initiatedByUserId: null, senderUserId: null, salesProjectId: null, crmLeadId: null, employeeId: null, imageSelectionProjectId: null, productionId: null, imageSelectionNotificationId: null,
    recipientName: null, templateKey: null, bodyPreview: null, body: null, resendable: false, status: "QUEUED", failureCode: null, failureReason: null,
    attemptCount: 0, providerMessageId: null, createdAt: new Date(), attemptedAt: null, sentAt: null, deliveredAt: null, readAt: null, updatedAt: new Date(),
  });
  const attemptDefaults = () => ({ requestedByUserId: null, senderUserId: null, status: "PROCESSING", providerMessageId: null, errorCode: null, errorMessage: null, errorSafe: false, ambiguous: false, startedAt: new Date(), finishedAt: null });

  return {
    state,
    whatsAppActivity: table("activity", state.activities, { defaults: activityDefaults, unique: [["logicalKey"]], relations: activityRelations, onUpdate: stamp }),
    whatsAppActivityAttempt: table("attempt", state.attempts, { defaults: attemptDefaults, unique: [["activityId", "attemptNo"]], relations: attemptRelations }),
    user: table("user", state.users),
    salesProject: table("project", state.salesProjects),
    imageSelectionProject: table("isel", state.imageSelectionProjects),
    projectProductionMessage: table("pm", state.productionMessages),
    imageSelectionWhatsAppNotification: table("notification", state.notifications),
  };
}

module.exports = { createActivityFakeClient };
