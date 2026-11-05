const { AsyncLocalStorage } = require("node:async_hooks");
const { fieldChanges, humanLabel } = require("./recordChanges");

/**
 * **What every save changed, written down without anybody wiring it up.**
 *
 * The activity log could say that somebody saved a project and nothing about what they saved. A
 * handler can describe its own change (`activityLog.describeChanges`), and the two or three that do
 * read well - but a studio's question is "he says he updated it and it is not reflecting", and that
 * is asked about whichever screen the person used, including the ones nobody remembered to wire. The
 * save they were actually pressing turned out to be one of those.
 *
 * So this watches the **database** instead of the handlers: one Prisma extension, and every update to
 * a watched record describes itself. New screens are covered the day they ship.
 *
 * ── What it watches, and why that is a short list ──
 *
 * `WATCHED` names the records the studio asks questions about. It is not every table on purpose:
 * each watched update costs one extra read, and a log that records every bookkeeping column of every
 * row nobody asks about is a log nobody reads. Widen it when a question cannot be answered, not
 * before.
 *
 * ── Why the lines live here and not on `req` ──
 *
 * A Prisma extension has no request. It has the async context it runs in, which is this module's own
 * store - deliberately **not** `requestCache`'s, because `forgetRequestCache()` empties that after a
 * write and would drop the lines of the very save it was called for.
 *
 * ── What it does not do ──
 *
 * `updateMany` and `deleteMany` have no cheap before-state, so they record how many rows moved and
 * not what each became. A write made outside a request - a scheduled sweep, a worker - has no store
 * and records nothing, which is right: nobody is claiming anything about it.
 *
 * A write inside a transaction is described from the state **before the transaction**: the extension
 * reads through the ordinary client, so it cannot see that transaction's own earlier writes. For a
 * line that says what a save changed, that is the honest before. A transaction that then rolls back
 * leaves its lines behind, which is why `entryForRequest` writes none of them for an answer of 400
 * or worse.
 */

const storage = new AsyncLocalStorage();

/**
 * The records worth describing, by Prisma model name, with the columns that are noise.
 *
 * `skip` is what makes the difference between a readable line and a wall: a save touches `updatedAt`
 * every time, `nameCopies.js` rewrites the text columns that sit beside an id whenever anything is
 * renamed, and a drag changes `sortOrder` on rows nobody edited. None of those is what somebody is
 * claiming they changed.
 */
const COMMON_SKIP = ["updatedAt", "createdAt", "createdBy", "updatedBy", "sortOrder", "deletedAt"];

const WATCHED = {
  SalesProject: { label: "Project", skip: [...COMMON_SKIP, "groupNameGeneratorJson"] },
  ProjectShoot: { label: "Shoot", skip: [...COMMON_SKIP, "shootLocations"] },
  Employee: { label: "Employee", skip: COMMON_SKIP },
  PaymentRequest: { label: "Payment request", skip: COMMON_SKIP },
};

/** Express middleware: everything this request's writes describe collects here. */
function trackChanges(req, res, next) {
  storage.run({ lines: [] }, next);
}

/** The lines this request's writes have described, or null outside a request. */
const collectedChanges = () => storage.getStore()?.lines || null;

/** How a watched record is named in a line - "Project DBS-EVT-0001", else by its id. */
function subjectOf(model, row) {
  const { label } = WATCHED[model] || {};
  const name = row?.eventId || row?.shootId || row?.employeeId || row?.requestCode || row?.id;
  return [label || humanLabel(model), name].filter(Boolean).join(" ");
}

/**
 * The extension. Composed in `config/db.js` **after** the resolved-names one, so what it compares is
 * what a read of the record would have shown.
 */
function extendWithChangeTracking(prisma) {
  return prisma.$extends({
    name: "changeTracking",
    query: {
      $allModels: {
        async update({ model, args, query }) {
          const watching = WATCHED[model] && collectedChanges();
          if (!watching) return query(args);
          // Read through the base client: an extension has no transaction handle, so this is the
          // state the save is about to write over as anybody else would have read it.
          const before = await prisma[lowerFirst(model)].findFirst({ where: args.where }).catch(() => null);
          const after = await query(args);
          describe(model, before, after);
          return after;
        },
        async updateMany({ model, args, query }) {
          const answer = await query(args);
          const lines = WATCHED[model] && collectedChanges();
          // No before-state worth the queries it would cost: the count is what is honest here.
          if (lines && answer?.count) lines.push(`${answer.count} ${WATCHED[model].label.toLowerCase()}${answer.count === 1 ? "" : "s"} changed together`);
          return answer;
        },
        async delete({ model, args, query }) {
          const lines = WATCHED[model] && collectedChanges();
          const before = lines ? await prisma[lowerFirst(model)].findFirst({ where: args.where }).catch(() => null) : null;
          const answer = await query(args);
          if (lines && before) lines.push(`${subjectOf(model, before)} deleted`);
          return answer;
        },
      },
    },
  });
}

const lowerFirst = (text) => `${String(text).charAt(0).toLowerCase()}${String(text).slice(1)}`;

/**
 * Only the record's **own** columns.
 *
 * The resolved-names extension hands a write's answer the linked rows it resolved names from, and the
 * read taken a moment earlier did not ask for them - so a plain diff reported
 * `Branch: — → {"name":"Malaysia"}` on a save that touched no branch. A relation is not a field
 * anybody edited, and its shape depends on what each query asked for, so it is dropped on both sides.
 * A `Date` is a value, not a relation, and stays.
 */
const ownColumns = (row) => Object.fromEntries(Object.entries(row || {})
  .filter(([, value]) => value === null || value === undefined || typeof value !== "object" || value instanceof Date));

/** One update's lines, prefixed with the record they are about, since a save often touches several. */
function describe(model, before, after) {
  const lines = collectedChanges();
  if (!lines || !after) return;
  const changes = fieldChanges(ownColumns(before), ownColumns(after), { skip: WATCHED[model].skip });
  if (!changes.length) return;
  const subject = subjectOf(model, after);
  for (const change of changes) lines.push(`${subject} — ${change}`);
}

module.exports = { WATCHED, COMMON_SKIP, trackChanges, collectedChanges, extendWithChangeTracking, subjectOf, ownColumns };
