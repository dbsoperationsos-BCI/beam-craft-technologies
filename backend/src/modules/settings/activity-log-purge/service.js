const prisma = require("../../../config/db");
const { deleteActivityLogsBefore, deleteActivityLogsBetween } = require("../../../services/activityLog");

/**
 * Settings → Activity Log Purge: deleting the User Activity Logs' older lines by hand.
 *
 * "3 months" keeps the most recent three months and deletes everything before them. A custom range
 * deletes exactly the lines written between its From and its To, both included, and nothing else. The months are
 * calendar months counted back from now - the same rule the log screen's "Last 3 months" uses - so
 * what a purge keeps is exactly what that period shows.
 *
 * The whole studio's log, not a branch's: like every Settings entry this is a studio-wide action,
 * granted to Super Admin only and given to anybody else in Role Management.
 */

const MONTH_CHOICES = [1, 2, 3, 6];

/**
 * The same moment `months` calendar months earlier, held to the last day of a shorter month: 31 March
 * less one month is 28 (or 29) February, where `setMonth` alone would roll over into 3 March.
 */
function cutoffFor(months, now = new Date()) {
  const cutoff = new Date(now);
  const day = cutoff.getDate();
  cutoff.setDate(1);
  cutoff.setMonth(cutoff.getMonth() - months);
  const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
  cutoff.setDate(Math.min(day, lastDay));
  return cutoff;
}

/** How many lines a purge of `months` would delete, and from before when. */
async function preview(months, now = new Date()) {
  const cutoff = cutoffFor(months, now);
  const count = await prisma.userActivityLog.count({ where: { createdAt: { lt: cutoff } } });
  return { months, cutoff, count };
}

/** Deletes every line older than `months` calendar months. */
async function purge(months, now = new Date()) {
  const cutoff = cutoffFor(months, now);
  const removed = await deleteActivityLogsBefore(cutoff);
  return { months, cutoff, removed };
}

/** How many lines a custom range would delete. */
async function previewRange(from, to) {
  const count = await prisma.userActivityLog.count({ where: { createdAt: { gte: from, lte: to } } });
  return { from, to, count };
}

/** Deletes every line written between `from` and `to`, both included. */
async function purgeRange(from, to) {
  return { from, to, removed: await deleteActivityLogsBetween(from, to) };
}

module.exports = { MONTH_CHOICES, cutoffFor, preview, purge, previewRange, purgeRange };
