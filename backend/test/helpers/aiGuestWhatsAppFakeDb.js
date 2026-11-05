/**
 * A small in-memory stand-in for the Prisma calls the guest WhatsApp summary makes: the tables it
 * reads and writes, their unique keys (a duplicate throws P2002 as MySQL would), relation filters one
 * level deep, and `$transaction` that rolls back when its callback throws. Enough to test the
 * deduplication and the races on the real code paths, with no database.
 */
const UNIQUE = { aiEventProcessingRun: ["openKey"], aiEventNotification: ["idempotencyKey"] };
const RELATIONS = {
  aiEventFaceMatch: { media: ["aiEventMedia", "mediaId"], guest: ["aiEventGuest", "guestId"] },
  aiEventGuestPhoneOtp: { guest: ["aiEventGuest", "guestId"] },
};
const DEFAULTS = {
  aiEventProcessingRun: () => ({ status: "OPEN", openKey: null, settledAt: null, mediaTotal: 0, mediaCompleted: 0, mediaFailed: 0, mediaSkipped: 0, mediaPending: 0 }),
  aiEventNotification: () => ({ status: "QUEUED", matchCount: 0, attempts: 0, provider: null, providerMessageId: null, errorCode: null, errorMessage: null, sentAt: null, runId: null }),
  aiEventGuestPhoneOtp: () => ({ attempts: 0, usedAt: null }),
};
const TIMESTAMPED = new Set(["aiEventProcessingRun", "aiEventNotification", "aiEventGuestPhoneOtp"]);

const clone = (value) => structuredClone(value);
let counter = 0;
const newId = (prefix) => `${prefix}_${(counter += 1)}`;
const isOps = (value) => value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value);
const comparable = (value) => (value instanceof Date ? value.getTime() : value);

function matchValue(actual, expected) {
  if (!isOps(expected)) return comparable(actual) === comparable(expected) || (actual == null && expected == null);
  for (const [op, operand] of Object.entries(expected)) {
    const a = comparable(actual); const b = comparable(operand);
    if (op === "in" && !operand.includes(actual)) return false;
    if (op === "notIn" && operand.includes(actual)) return false;
    if (op === "not" && (operand === null ? actual == null : a === b)) return false;
    if (op === "lt" && !(a < b)) return false;
    if (op === "lte" && !(a <= b)) return false;
    if (op === "gt" && !(a > b)) return false;
    if (op === "gte" && !(a >= b)) return false;
    if (op === "equals" && a !== b) return false;
  }
  return true;
}

function createFakeDb(seed = {}) {
  const tables = {};
  const table = (name) => (tables[name] ||= []);
  for (const [name, rows] of Object.entries(seed)) for (const row of rows) table(name).push({ ...row });
  const calls = [];

  function matches(model, row, where = {}) {
    for (const [key, expected] of Object.entries(where)) {
      if (key === "OR") { if (!expected.some((part) => matches(model, row, part))) return false; continue; }
      if (key === "NOT") { if (matches(model, row, expected)) return false; continue; }
      const relation = RELATIONS[model]?.[key];
      if (relation) {
        const target = table(relation[0]).find((candidate) => candidate.id === row[relation[1]]);
        if (!target || !matches(relation[0], target, expected)) return false;
        continue;
      }
      // A compound unique key (`guestId_mediaId: { guestId, mediaId }`) is its fields together.
      if (key.includes("_") && !(key in row) && isOps(expected)) { if (!matches(model, row, expected)) return false; continue; }
      if (!matchValue(row[key], expected)) return false;
    }
    return true;
  }

  function apply(row, data) {
    for (const [key, value] of Object.entries(data)) {
      if (isOps(value) && ("increment" in value || "decrement" in value)) row[key] = (row[key] || 0) + (value.increment || 0) - (value.decrement || 0);
      else row[key] = value instanceof Date ? new Date(value) : value;
    }
  }

  function checkUnique(model, row) {
    for (const field of UNIQUE[model] || []) {
      if (row[field] == null) continue;
      if (table(model).some((other) => other !== row && other[field] === row[field])) throw Object.assign(new Error(`Unique constraint failed on ${field}`), { code: "P2002" });
    }
  }

  function sort(rows, orderBy) {
    if (!orderBy) return rows;
    const [[field, direction]] = Object.entries(orderBy);
    return [...rows].sort((a, b) => (comparable(a[field]) - comparable(b[field])) * (direction === "desc" ? -1 : 1));
  }

  function select(row, chosen) {
    if (!chosen) return clone(row);
    return Object.fromEntries(Object.keys(chosen).map((key) => [key, row[key]]));
  }

  function withIncludes(model, row, include) {
    if (!row || !include) return row;
    const out = { ...row };
    if (model === "aiEvent") {
      if (include.setting) out.setting = clone(table("aiEventSetting").find((setting) => setting.eventId === row.id) || null);
      if (include.share) out.share = clone(table("aiEventShare").find((share) => share.eventId === row.id) || null);
    }
    return out;
  }

  function delegate(model) {
    const rows = () => table(model);
    return {
      async findUnique({ where, include, select: chosen }) { calls.push([model, "findUnique", where]); const row = rows().find((candidate) => matches(model, candidate, where)); return row ? withIncludes(model, select(row, chosen), include) : null; },
      async findFirst({ where, orderBy, select: chosen }) { const row = sort(rows().filter((candidate) => matches(model, candidate, where)), orderBy)[0]; return row ? select(row, chosen) : null; },
      async findMany({ where, orderBy, select: chosen, take }) { return sort(rows().filter((candidate) => matches(model, candidate, where)), orderBy).slice(0, take ?? Infinity).map((row) => select(row, chosen)); },
      async count({ where }) { return rows().filter((candidate) => matches(model, candidate, where)).length; },
      async create({ data }) {
        calls.push([model, "create", data]);
        const now = new Date();
        const row = { id: newId(model), ...(DEFAULTS[model]?.() || {}), ...(TIMESTAMPED.has(model) ? { createdAt: now, updatedAt: now } : {}), ...(model === "aiEventProcessingRun" ? { openedAt: now, lastActivityAt: now } : {}) };
        apply(row, data);
        rows().push(row);
        try { checkUnique(model, row); } catch (error) { rows().splice(rows().indexOf(row), 1); throw error; }
        return clone(row);
      },
      async update({ where, data }) {
        const row = rows().find((candidate) => matches(model, candidate, where));
        if (!row) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
        apply(row, data); if (TIMESTAMPED.has(model) && !("updatedAt" in data)) row.updatedAt = new Date();
        checkUnique(model, row);
        return clone(row);
      },
      async updateMany({ where, data }) {
        calls.push([model, "updateMany", where, data]);
        const hit = rows().filter((candidate) => matches(model, candidate, where));
        for (const row of hit) { apply(row, data); if (TIMESTAMPED.has(model) && !("updatedAt" in data)) row.updatedAt = new Date(); checkUnique(model, row); }
        return { count: hit.length };
      },
      async delete({ where }) { const row = rows().find((candidate) => matches(model, candidate, where)); if (!row) throw Object.assign(new Error("Record to delete does not exist."), { code: "P2025" }); rows().splice(rows().indexOf(row), 1); return clone(row); },
      async deleteMany({ where }) { const hit = rows().filter((candidate) => matches(model, candidate, where)); for (const row of hit) rows().splice(rows().indexOf(row), 1); return { count: hit.length }; },
      async groupBy({ by, where, _count }) {
        const groups = new Map();
        for (const row of rows().filter((candidate) => matches(model, candidate, where))) {
          const key = by.map((field) => row[field]).join("|");
          if (!groups.has(key)) groups.set(key, { ...Object.fromEntries(by.map((field) => [field, row[field]])), _count: { _all: 0 } });
          groups.get(key)._count._all += 1;
        }
        return [...groups.values()].map((group) => (_count ? group : Object.fromEntries(by.map((field) => [field, group[field]]))));
      },
    };
  }

  const db = new Proxy({ tables, calls }, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === "$transaction") {
        return async (callback) => {
          const snapshot = clone(tables);
          try { return await callback(db); } catch (error) {
            for (const name of Object.keys(tables)) delete tables[name];
            Object.assign(tables, snapshot);
            throw error;
          }
        };
      }
      if (property === "then") return undefined;
      return (target[`__${String(property)}`] ||= delegate(property));
    },
  });
  return db;
}

module.exports = { createFakeDb };
