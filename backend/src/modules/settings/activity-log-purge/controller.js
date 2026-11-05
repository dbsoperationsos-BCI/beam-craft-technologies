const service = require("./service");

/**
 * Settings → Activity Log Purge, over HTTP. Who may reach it is decided by the router
 * (`SETTINGS / Activity Log Purge`: Read to see what a purge would delete, Read / Write to delete).
 */

/** `months` from a query or a body, or null when it is not one of the offered choices. */
function monthsFrom(value) {
  // A number, or digits as a query string carries them - never a coerced value: this answer decides
  // what is deleted, and `Number(true)` is 1 and `Number([3])` is 3.
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const months = Number(value);
  return service.MONTH_CHOICES.includes(months) ? months : null;
}

/*
 * A custom range: two moments, From not after To, and To not ahead of now - a range reaching into the
 * future would read as deleting lines that do not exist yet. Only ISO date strings are taken; a
 * number or anything `Date` would coerce is refused, as `monthsFrom` refuses a coerced month.
 */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function rangeFrom(source, now = new Date()) {
  const { from, to } = source || {};
  if (typeof from !== "string" || typeof to !== "string" || !ISO.test(from) || !ISO.test(to)) return { error: "Choose a From and a To date and time." };
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { error: "Choose a From and a To date and time." };
  if (start > end) return { error: "From must be before To." };
  if (start > now) return { error: "The range is in the future, so there is nothing in it to delete." };
  return { from: start, to: end > now ? now : end };
}

const refuseMessage = () => `Choose ${service.MONTH_CHOICES.join(", ")} months, or a custom range.`;
const refuse = (res, message = refuseMessage()) => res.status(400).json({ message, choices: service.MONTH_CHOICES });

/** The request asks for months, or for a custom range - never both, and never neither. */
function askedFor(source) {
  const hasMonths = source?.months !== undefined && source?.months !== "";
  const hasRange = source?.from !== undefined || source?.to !== undefined;
  if (hasMonths === hasRange) return { error: refuseMessage() };
  if (hasMonths) {
    const months = monthsFrom(source.months);
    return months ? { months } : { error: refuseMessage() };
  }
  return rangeFrom(source);
}

async function previewPurge(req, res) {
  const asked = askedFor(req.query);
  if (asked.error) return refuse(res, asked.error);
  try {
    const result = asked.months ? await service.preview(asked.months) : await service.previewRange(asked.from, asked.to);
    return res.json({ ...result, choices: service.MONTH_CHOICES });
  } catch (error) {
    console.error("Unable to count the activity log lines to purge:", error);
    return res.status(500).json({ message: "Unable to count the activity log lines to purge." });
  }
}

async function purgeActivityLog(req, res) {
  const asked = askedFor(req.body);
  if (asked.error) return refuse(res, asked.error);
  try {
    return res.json(asked.months ? await service.purge(asked.months) : await service.purgeRange(asked.from, asked.to));
  } catch (error) {
    console.error("Unable to purge the activity log:", error);
    return res.status(500).json({ message: "Unable to purge the activity log." });
  }
}

module.exports = { previewPurge, purgeActivityLog, monthsFrom, rangeFrom, askedFor };
