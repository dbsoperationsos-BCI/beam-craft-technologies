const prisma = require("../../../config/db");
const { studioDateKey } = require("../../../services/studioTime");
const { recordCashEntry, formEntrySchema } = require("../cash-entries/controller");
const clientPush = require("../../../services/clientPush");
const { SHOOT, dueDateFromShoot, shootFor } = require("../../../services/shootLinkedDueDates");
const { publishedSaleExtrasTotal } = require("../../sales/sale-extras/totals");

/*
 * A project's payment schedule - what it is booked to receive, when - and where each payment stands.
 *
 * Saved by Create Project and Start / Edit Project (`saveProjectSchedule`) and worked on Accounts
 * Manager's Due / Overdue / On Hold tabs. What a payment comes to is a share of the signed quotation
 * (the project's Initial Converted Value) until a part payment fixes it. Received in full is never
 * stored: it is the receipts linked to the payment (`cash_entry.payment_schedule_id`) reaching that
 * figure, and such a payment is then only its cash entry under Received.
 */

/** How many days before its due date a payment turns Due. */
const DUE_WINDOW_DAYS = 5;

const STATUSES = ["Active", "Due", "Overdue", "On Hold", "Cleared"];

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const dayKeyOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const utcDay = (key) => Date.parse(`${key}T00:00:00.000Z`);
const daysBetween = (fromKey, toKey) => Math.round((utcDay(toKey) - utcDay(fromKey)) / 86400000);

/** What one payment comes to: its fixed amount after a split, otherwise its share of the quotation. */
function amountOf(row, signedQuotation) {
  if (row.amount !== null && row.amount !== undefined) return money(row.amount);
  return Math.round(Number(signedQuotation || 0) * (Number(row.percentage || 0) / 100));
}

/**
 * Where one payment stands, first that applies:
 *   Cleared            its receipts reach what it comes to
 *   On Hold            held by hand, with remarks - never Due or Overdue while held
 *   Overdue            its due date has passed
 *   Due                within the next five days of its due date - or the remainder a part payment
 *                      left, which is owed from the moment it is split off
 *   Active             otherwise
 */
function paymentStatus({ amount, received, dueDate, holdAt, splitFromId }, todayKey = studioDateKey()) {
  if (amount > 0 && received >= amount) return "Cleared";
  if (holdAt) return "On Hold";
  const due = dayKeyOf(dueDate);
  if (due) {
    const days = daysBetween(todayKey, due);
    if (days < 0) return "Overdue";
    if (days <= DUE_WINDOW_DAYS) return "Due";
  }
  if (splitFromId) return "Due";
  return "Active";
}

/**
 * The project's Accounts status, from its payments still to be received - as Pre Production and
 * Production have one: Hold when any is on hold, else Overdue, else Due, and **Active** otherwise -
 * every payment still to come, all received, or no schedule. The project's own status never changes it.
 */
function projectAccountsStatus(statuses) {
  const open = statuses.filter((status) => status !== "Cleared");
  if (open.includes("On Hold")) return "Hold";
  if (open.includes("Overdue")) return "Overdue";
  if (open.includes("Due")) return "Due";
  return "Active";
}

const scheduleSelect = {
  id: true, projectId: true, categoryId: true, category: true, dueDate: true, percentage: true, amount: true, remarks: true,
  sortOrder: true, splitFromId: true, holdAt: true, holdRemarks: true, createdAt: true,
  dueRule: true, dueShootId: true, dueOffsetDays: true,
  dueShoot: { select: { shoot: true, deletedAt: true } },
  holdByUser: { select: { name: true } },
  receipts: { where: { deletedAt: null }, select: { amount: true } },
  _count: { select: { splits: true } },
};

/** One payment as the screens read it; `signedQuotation` is its project's Initial Converted Value. */
function toPayment(row, signedQuotation, todayKey) {
  const amount = amountOf(row, signedQuotation);
  const received = money((row.receipts || []).reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0));
  return {
    id: row.id,
    projectId: row.projectId,
    // Read through `resolvedNames.js`: the linked category's name, the text only where none is linked.
    category: row.category,
    categoryId: row.categoryId,
    dueDate: dayKeyOf(row.dueDate),
    percentage: row.percentage === null ? null : Number(row.percentage),
    amount,
    received,
    pending: money(Math.max(0, amount - received)),
    remarks: row.remarks || null,
    sortOrder: row.sortOrder,
    splitFromId: row.splitFromId,
    holdAt: row.holdAt,
    holdRemarks: row.holdRemarks || null,
    holdBy: row.holdByUser?.name || null,
    // Date not known: the shoot it follows (null is the main event) and how far from it. With no
    // `dueDate` it is waiting for that shoot's date - or for a shoot to be picked again, the one it
    // followed having been removed.
    dueRule: row.dueRule === SHOOT ? SHOOT : "DATE",
    dueShootId: row.dueShootId || null,
    dueShootName: row.dueShoot && !row.dueShoot.deletedAt ? row.dueShoot.shoot || null : null,
    dueShootRemoved: Boolean(row.dueShootId && (!row.dueShoot || row.dueShoot.deletedAt)),
    dueOffsetDays: row.dueRule === SHOOT ? Number(row.dueOffsetDays || 0) : null,
    waitingForShootDate: row.dueRule === SHOOT && !row.dueDate,
    // Worked in Accounts - a receipt, a hold or a split. The project form still lets it be changed or
    // removed, and shows where it stands beside it; it needs no date to be saved.
    locked: Boolean(received > 0 || row.holdAt || row.splitFromId || row._count?.splits),
    status: paymentStatus({ amount, received, dueDate: row.dueDate, holdAt: row.holdAt, splitFromId: row.splitFromId }, todayKey),
  };
}

/** A project's live schedule, in order. */
async function projectSchedule(projectId, { client = prisma, todayKey = studioDateKey() } = {}) {
  const [project, rows] = await Promise.all([
    client.salesProject.findUnique({ where: { id: projectId }, select: { initialConvertedValue: true } }),
    client.projectPaymentSchedule.findMany({ where: { projectId, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: scheduleSelect }),
  ]);
  return rows.map((row) => toPayment(row, project?.initialConvertedValue, todayKey));
}

/** The Spent category a refund to the client is filed under (Accounts → Add Entry). */
const REFUND_CATEGORY = "Client Refund";

/**
 * Where a project stands against what it is signed for: the Balance Amount Schedule Payment shows
 * in its summary. `schedule` is `projectSchedule(projectId)`.
 *
 * Read from the books every time and never stored, so a receipt corrected, withdrawn or refunded in
 * Accounts moves it the next time it is read - there is no second figure to fall out of step.
 *
 *   updatedTotal   the Initial Converted Value, plus the published Sale Extras (Edit Sale Details'
 *                  Net Extra) and the approved Extra Quotations - the receipt's "Balance due" and
 *                  the Payments tab's "Total signed" add the same three
 *   received       every Received entry against the project, withdrawn ones left out
 *   refunded       every Spent entry against it filed as a Client Refund, which is owed again
 *   balance        updatedTotal - received + refunded, never below zero; what is paid past the
 *                  total is `overpaid`, kept apart rather than shown as a negative balance
 *
 * A payment Due, Overdue, On Hold or still to come has received nothing, so it takes nothing off.
 * `unscheduledReceived` is money received against the project but on no payment. `rows` names each
 * saved payment and what it has received - the screen offers Receive on the ones it lists.
 */
async function projectLedger(projectId, schedule, { client = prisma } = {}) {
  const [project, extraQuotations, saleExtras, received, refunded] = await Promise.all([
    client.salesProject.findUnique({ where: { id: projectId }, select: { initialConvertedValue: true } }),
    client.projectExtraQuotation.aggregate({ where: { projectId, status: "APPROVED", deletedAt: null }, _sum: { amount: true } }),
    publishedSaleExtrasTotal(projectId, client),
    client.cashEntry.aggregate({ where: { projectId, entryType: "Received", deletedAt: null }, _sum: { amount: true } }),
    client.cashEntry.aggregate({ where: { projectId, entryType: "Spent", category: REFUND_CATEGORY, deletedAt: null }, _sum: { amount: true } }),
  ]);
  const signedQuotation = money(project?.initialConvertedValue);
  const updatedTotal = money(signedQuotation + Number(saleExtras || 0) + Number(extraQuotations._sum.amount || 0));
  const rows = (schedule || []).map((row) => ({ id: row.id, received: money(row.received) }));
  const scheduledReceived = money(rows.reduce((sum, row) => sum + row.received, 0));
  const totalReceived = money(received._sum.amount);
  const totalRefunded = money(refunded._sum.amount);
  const outstanding = money(updatedTotal - totalReceived + totalRefunded);
  return {
    signedQuotation,
    saleExtras: money(saleExtras),
    extraQuotations: money(extraQuotations._sum.amount),
    updatedTotal,
    received: totalReceived,
    unscheduledReceived: money(Math.max(0, totalReceived - scheduledReceived)),
    refunded: totalRefunded,
    balance: Math.max(0, outstanding),
    overpaid: Math.max(0, money(-outstanding)),
    rows,
  };
}

/** "Partial Payment 2" is a Partial Payment: the Field Settings row a typed category names, if any. */
async function categoryFor(name, client) {
  const categories = await client.paymentScheduleCategory.findMany({ select: { id: true, name: true, repeatable: true } });
  const typed = String(name || "").trim();
  const lower = typed.toLocaleLowerCase();
  const match = categories.find((row) => row.name.toLocaleLowerCase() === lower)
    || categories.find((row) => row.repeatable && new RegExp(`^${row.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+\\d+$`, "i").test(typed));
  return match ? { categoryId: match.id, category: match.name } : { categoryId: null, category: typed };
}

/**
 * Saves a project's schedule from its form. `rows` are the form's - `{ id, category, date, remarks,
 * percentage }` - where `id` is a saved payment's id or the form's own key for a new row.
 *
 * Every payment is the form's to change, the ones Accounts has worked (a receipt, a hold or a split)
 * included: each listed payment is updated or added, in the form's order, and a saved one the form no
 * longer lists is withdrawn. Withdrawing a worked payment never touches the money: its receipts stay
 * on the project's books and are only unlinked from it, so they count as received on no payment
 * (`projectLedger`'s `unscheduledReceived`) and can be edited in Accounts like any other receipt.
 * A hold stays with its payment.
 *
 * A payment fixed at an amount (what a part payment left) stays fixed while the form sends the same
 * figure back as a share of the quotation; a different share makes it a share like any other.
 */
async function saveProjectSchedule(projectId, rows, actorId, { client = prisma } = {}) {
  const [existing, project] = await Promise.all([
    projectSchedule(projectId, { client }),
    client.salesProject.findUnique({ where: { id: projectId }, select: { initialConvertedValue: true } }),
  ]);
  const byId = new Map(existing.map((row) => [row.id, row]));
  const wanted = (rows || []).filter((row) => String(row.category || "").trim() && String(row.percentage ?? "").trim() !== "");
  /*
   * Every payment falls due on a day, except the one settling the balance - the category flagged so
   * in Settings, which the form draws no date for. A payment already worked is kept as it is below,
   * so it is not asked for one. Checked before anything is written, so a refused save changes nothing.
   */
  const settling = new Set((await client.paymentScheduleCategory.findMany({ where: { settlesBalance: true }, select: { name: true } }))
    .map((row) => row.name.toLocaleLowerCase()));
  const undated = wanted.find((row) => !byId.get(row.id)?.locked
    && row.dueRule !== SHOOT
    && !settling.has(String(row.category).trim().toLocaleLowerCase())
    && !String(row.date || "").trim());
  if (undated) throw fail(400, "Choose a date for every payment under Shedule Payment.");
  // A payment that follows a shoot follows one of this project's own, and the date comes from it.
  const shoots = wanted.some((row) => row.dueRule === SHOOT)
    ? await client.projectShoot.findMany({ where: { projectId, deletedAt: null }, select: { id: true, dateCreated: true, isMainEvent: true } })
    : [];
  const strayShoot = wanted.find((row) => !byId.get(row.id)?.locked && row.dueRule === SHOOT && row.dueShootId && !shoots.some((shoot) => shoot.id === row.dueShootId));
  if (strayShoot) throw fail(400, "A payment follows a shoot this project does not have. Pick the shoot again.");
  const keepIds = new Set();
  let order = 0;
  for (const row of wanted) {
    const saved = byId.get(row.id);
    order += 1;
    const onShoot = row.dueRule === SHOOT;
    const link = onShoot
      ? { dueRule: SHOOT, dueShootId: row.dueShootId || null, dueOffsetDays: Number(row.dueOffsetDays || 0) }
      : { dueRule: null, dueShootId: null, dueOffsetDays: null };
    const data = {
      ...(await categoryFor(row.category, client)),
      ...link,
      dueDate: onShoot
        ? dueDateFromShoot(shootFor(link, shoots)?.dateCreated, link.dueOffsetDays)
        : (row.date ? new Date(`${String(row.date).slice(0, 10)}T00:00:00.000Z`) : null),
      percentage: Number(row.percentage),
      remarks: String(row.remarks || "").trim() || null,
      sortOrder: order,
    };
    if (saved && saved.percentage === null) {
      // Fixed at an amount: kept so while the share sent comes to it, to the rupee.
      const asShare = amountOf({ percentage: data.percentage, amount: null }, project?.initialConvertedValue);
      if (Math.abs(asShare - saved.amount) <= 1) data.percentage = null;
      else data.amount = null;
    }
    if (saved) {
      keepIds.add(saved.id);
      await client.projectPaymentSchedule.update({ where: { id: saved.id }, data });
    } else {
      await client.projectPaymentSchedule.create({ data: { ...data, projectId, createdByUserId: actorId || null } });
    }
  }
  const withdrawn = existing.filter((row) => !keepIds.has(row.id)).map((row) => row.id);
  if (withdrawn.length) {
    await client.projectPaymentSchedule.updateMany({ where: { id: { in: withdrawn } }, data: { deletedAt: new Date() } });
    // The money stays on the books; it is only no longer this payment's.
    await client.cashEntry.updateMany({ where: { paymentScheduleId: { in: withdrawn } }, data: { paymentScheduleId: null } });
  }
  return projectSchedule(projectId, { client });
}

/*
 * ── The writes Accounts makes to one payment ──
 *
 * Each runs in one transaction that first locks the payment's row and reads it again, so two presses
 * (or two tabs) cannot both find it uncleared and both record the cash: the second waits, then finds
 * it cleared and is refused. `id` is one the caller already reached through its own scope.
 */
const fail = (status, message) => Object.assign(new Error(message), { status });

async function lockedPayment(tx, id) {
  await tx.$queryRaw`SELECT id FROM project_payment_schedule WHERE id = ${id} FOR UPDATE`;
  const row = await tx.projectPaymentSchedule.findUnique({ where: { id }, select: { ...scheduleSelect, deletedAt: true, project: { select: { initialConvertedValue: true } } } });
  if (!row || row.deletedAt) throw fail(404, "That scheduled payment could not be found.");
  return { row, payment: toPayment(row, row.project.initialConvertedValue) };
}

const releasedHold = { holdAt: null, holdRemarks: null, holdByUserId: null };

/**
 * A Received cash entry for `row`'s project, linked to it, through the cash book's own recorder.
 * `record` is the recorder's own options - the schema and source of the screen the money came from.
 */
async function recordReceipt(tx, row, entry, amount, actorId, record = {}) {
  const created = await recordCashEntry(
    { ...entry, amount, projectId: row.projectId, shootId: null, entryType: "Received" },
    actorId,
    tx,
    { enforceBranchReach: true, schema: formEntrySchema, ...record },
  );
  await tx.cashEntry.update({ where: { id: created.id }, data: { paymentScheduleId: row.id } });
  return { ...created, paymentScheduleId: row.id };
}

async function setPaymentHold(id, { hold, remarks }, actorId) {
  return prisma.$transaction(async (tx) => {
    const { payment } = await lockedPayment(tx, id);
    if (payment.status === "Cleared") throw fail(409, "A cleared payment cannot be put on hold.");
    await tx.projectPaymentSchedule.update({ where: { id }, data: hold ? { holdAt: new Date(), holdRemarks: String(remarks).trim(), holdByUserId: actorId } : releasedHold });
  });
}

// Once the receipt is saved, the client's phone hears of the money received.
async function withPush(saved) {
  const created = await saved;
  clientPush.notifyPaymentReceived(created);
  return created;
}

const SETTLE_MODES = ["FULL", "PARTIAL"];
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The one rule every way of recording money against a scheduled payment goes through - Clear and
 * Partially paid on the Due tabs, Add Entry and the Payments tab, the advance at booking, the CSV
 * import - inside the caller's transaction, after locking the payment.
 *
 *   FULL     the entry is the whole of what is pending, and the payment reads Cleared.
 *   PARTIAL  the entry is less than what is pending; the payment is fixed at what has been received
 *            in all (so it reads Cleared) and the rest becomes a payment of its own, due on
 *            `pendingDueDate`, which is today or later.
 *
 * Either ends a hold. `projectId`, when given, is the project the entry was filed against, and the
 * payment must be one of that project's. Refusals are thrown with a status, before anything is
 * written, so the transaction rolls the whole entry back.
 */
async function settleInTx(tx, id, { mode, pendingDueDate = null, projectId } = {}, entry, actorId, record = {}) {
  if (!SETTLE_MODES.includes(mode)) throw fail(400, "Choose Full or Partial payment.");
  const { row, payment } = await lockedPayment(tx, id);
  if (projectId !== undefined && row.projectId !== projectId) throw fail(400, "That scheduled payment is not one of this project's.");
  if (payment.status === "Cleared") throw fail(409, "This payment is already cleared.");
  if (!(payment.pending > 0)) throw fail(409, "This payment has nothing to receive yet - its project has no Signed Quotation.");
  const paid = money(entry.amount);
  if (mode === "FULL") {
    if (paid !== payment.pending) throw fail(400, `A full payment is the whole pending amount, ₹${payment.pending}. Record less as a partial payment.`);
    const created = await recordReceipt(tx, row, entry, payment.pending, actorId, record);
    if (row.holdAt) await tx.projectPaymentSchedule.update({ where: { id }, data: releasedHold });
    return created;
  }
  if (!(paid > 0 && paid < payment.pending)) throw fail(400, `A partial payment must be less than the pending ₹${payment.pending}. Record all of it as a full payment.`);
  const dueKey = String(pendingDueDate || "").trim();
  if (!DATE_KEY.test(dueKey)) throw fail(400, "Choose the date the rest is due.");
  if (dueKey < studioDateKey()) throw fail(400, "The pending amount's due date cannot be in the past.");
  const created = await recordReceipt(tx, row, entry, paid, actorId, record);
  await tx.projectPaymentSchedule.update({ where: { id }, data: { amount: money(payment.received + paid), percentage: null, ...releasedHold } });
  await tx.projectPaymentSchedule.create({
    data: {
      projectId: row.projectId,
      categoryId: row.categoryId,
      category: row.category,
      dueDate: new Date(`${dueKey}T00:00:00.000Z`),
      amount: money(payment.pending - paid),
      remarks: `Pending from ${row.category}`,
      sortOrder: row.sortOrder,
      splitFromId: row.id,
      createdByUserId: actorId,
    },
  });
  return created;
}

/** `settleInTx` in a transaction of its own, telling the client's phone once it is saved. */
function settlePayment(id, settles, entry, actorId, record = {}) {
  return withPush(prisma.$transaction((tx) => settleInTx(tx, id, settles, entry, actorId, record)));
}

/** Clear: the whole of what is still pending, in one cash entry. Ends any hold. */
async function clearPayment(id, entry, actorId) {
  return settlePayment(id, { mode: "FULL" }, entry, actorId);
}

/**
 * Partially paid: what is received now is recorded against this payment, which is fixed at what has
 * been received in all and so reads Cleared; the rest becomes a payment of its own, due on
 * `pendingDueDate`, reading Due until that date passes.
 */
async function partPayPayment(id, { paidAmount, pendingDueDate, entry }, actorId) {
  return withPush(prisma.$transaction(async (tx) => {
    // Locked first, as every write here is; `settleInTx` takes the same lock again in this transaction.
    await lockedPayment(tx, id);
    if (money(entry.amount) !== money(paidAmount)) throw fail(400, "The cash received must be the amount paid.");
    return settleInTx(tx, id, { mode: "PARTIAL", pendingDueDate }, entry, actorId);
  }));
}

module.exports = { setPaymentHold, clearPayment, partPayPayment, settleInTx, settlePayment, SETTLE_MODES, lockedPayment, DUE_WINDOW_DAYS, STATUSES, amountOf, paymentStatus, projectAccountsStatus, toPayment, scheduleSelect, projectSchedule, projectLedger, REFUND_CATEGORY, saveProjectSchedule, categoryFor, dayKeyOf, money };
