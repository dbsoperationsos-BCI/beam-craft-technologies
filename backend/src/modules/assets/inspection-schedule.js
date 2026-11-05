/**
 * Inspection periods are stored as whole months, so the due date is derived with calendar
 * arithmetic rather than a fixed day count: a 3-month period always lands on the same day
 * of the month, whatever the month lengths in between.
 */

/** Adds whole months in UTC, clamping to the last day when the target month is shorter (31 Jan + 1 month -> 28 Feb). */
function addMonths(date, months) {
  const base = new Date(date);
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + Number(months), 1));
  const daysInTargetMonth = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, daysInTargetMonth));
  return target;
}

/** Due date for the next inspection, or null when the asset has no period or nothing to count from. */
function nextInspectionDate(baseDate, inspectionPeriodMonths) {
  if (!baseDate || inspectionPeriodMonths === null || inspectionPeriodMonths === undefined) return null;
  return addMonths(baseDate, inspectionPeriodMonths);
}

module.exports = { addMonths, nextInspectionDate };
