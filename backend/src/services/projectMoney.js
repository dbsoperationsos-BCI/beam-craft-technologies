const prisma = require("../config/db");

/*
 * What each of many projects has received, spent and still has to receive - the three figures a
 * project's Payments tab shows (`listProjectPayments` and the Still to Receive list), worked out for
 * a whole Board at once instead of one project per request.
 *
 * - received / spent: the project's live cash entries, Received and Spent.
 * - toReceive: every part of its payment schedule not received in full - due, overdue, on hold and
 *   parts not near their date yet - which is what Still to Receive lists. Read through the scheduled
 *   payments' own `toPayment`, so "pending" has one definition.
 *
 * Callers pass only project ids already checked against the reader's reach.
 */
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

async function projectMoneySummary(projectIds, { client = prisma } = {}) {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  if (!ids.length) return {};
  // Required here rather than at the top: the scheduled payments service reaches the cash book.
  const { toPayment } = require("../modules/accounts/scheduled-payments/service");
  const { studioDateKey } = require("./studioTime");
  const todayKey = studioDateKey();
  const [cash, schedule] = await Promise.all([
    client.cashEntry.groupBy({
      by: ["projectId", "entryType"],
      where: { projectId: { in: ids }, deletedAt: null, entryType: { in: ["Received", "Spent"] } },
      _sum: { amount: true },
    }),
    client.projectPaymentSchedule.findMany({
      where: { projectId: { in: ids }, deletedAt: null },
      // Only what `toPayment` reads for the amount owed and the status - not the listing's joins.
      select: {
        id: true, projectId: true, amount: true, percentage: true, dueDate: true, holdAt: true, splitFromId: true, dueRule: true,
        receipts: { where: { deletedAt: null }, select: { amount: true } },
        project: { select: { initialConvertedValue: true } },
      },
    }),
  ]);
  const summary = Object.fromEntries(ids.map((id) => [id, { received: 0, spent: 0, toReceive: 0 }]));
  for (const row of cash) {
    const key = row.entryType === "Received" ? "received" : "spent";
    summary[row.projectId][key] = money(summary[row.projectId][key] + Number(row._sum.amount || 0));
  }
  for (const row of schedule) {
    const payment = toPayment(row, row.project.initialConvertedValue, todayKey);
    if (payment.status !== "Cleared") summary[row.projectId].toReceive = money(summary[row.projectId].toReceive + payment.pending);
  }
  return summary;
}

module.exports = { projectMoneySummary };
