const { studioDateKey } = require("./studioTime");

/**
 * A scheduled payment whose date is not known follows a shoot instead (`dueRule = "SHOOT"`): its
 * own shoot (`dueShootId`), or the project's main event where none is picked - so many days before
 * it, on the day, or after it (`dueOffsetDays`). Its `dueDate` is worked out here and written, so
 * Accounts' Due / Overdue, the two-days-before reminder and every screen keep reading `dueDate`.
 *
 * No date comes out - and the payment reads "Waiting for shoot date" - while the shoot has none, and
 * when the shoot it followed is removed (it is not moved onto the main event: the studio picked that
 * shoot, so somebody should pick again).
 *
 * A payment Accounts has worked - money received, held, or split - keeps the date it has, as the
 * schedule form leaves it alone; a shoot moving does not move a payment already being collected.
 */

const SHOOT = "SHOOT";
const MAX_OFFSET_DAYS = 365;

/** The due date for a shoot day and an offset: midnight UTC of that calendar day, or null. */
function dueDateFromShoot(shootDate, offsetDays) {
  if (!shootDate) return null;
  const key = studioDateKey(new Date(shootDate));
  const day = Date.parse(`${key}T00:00:00.000Z`) + (Number(offsetDays) || 0) * 86400000;
  return new Date(day);
}

/** The shoot a linked payment follows among the project's live shoots: its own, or the main event. */
function shootFor(payment, shoots) {
  if (payment.dueShootId) return shoots.find((shoot) => shoot.id === payment.dueShootId) || null;
  return shoots.find((shoot) => shoot.isMainEvent) || null;
}

const sameDay = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

/**
 * Brings every shoot-linked payment of `projectId` in step with its shoot's date. Called wherever a
 * shoot is added, moved, made the main event or removed - in the same transaction (`client`).
 */
async function syncShootLinkedDueDates(client, projectId) {
  if (!projectId) return 0;
  const payments = await client.projectPaymentSchedule.findMany({
    where: { projectId, deletedAt: null, dueRule: SHOOT },
    select: { id: true, dueShootId: true, dueOffsetDays: true, dueDate: true, holdAt: true, splitFromId: true, _count: { select: { receipts: { where: { deletedAt: null } }, splits: true } } },
  });
  if (!payments.length) return 0;
  const shoots = await client.projectShoot.findMany({ where: { projectId, deletedAt: null }, select: { id: true, dateCreated: true, isMainEvent: true } });
  let moved = 0;
  for (const payment of payments) {
    if (payment.holdAt || payment.splitFromId || payment._count.receipts || payment._count.splits) continue;
    const dueDate = dueDateFromShoot(shootFor(payment, shoots)?.dateCreated, payment.dueOffsetDays);
    if (sameDay(dueDate, payment.dueDate)) continue;
    await client.projectPaymentSchedule.update({ where: { id: payment.id }, data: { dueDate } });
    moved += 1;
  }
  return moved;
}

module.exports = { MAX_OFFSET_DAYS, SHOOT, dueDateFromShoot, shootFor, syncShootLinkedDueDates };
