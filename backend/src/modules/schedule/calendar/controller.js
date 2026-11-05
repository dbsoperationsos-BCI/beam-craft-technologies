const { z } = require("zod");
const iamService = require("../../../services/iam.service");
const { listSchedule } = require("./service");
const { isAdministrator } = require("../../../services/administrator");

function sendError(res, error, fallback) {
  console.error(fallback, error.message);
  return res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
}

// Both bounds are optional, the way the meetings list's are: no window means everything booked,
// which is what a calendar asks for when it first opens and has no month in mind yet.
const listSchema = z.object({
  from: z.string().trim().optional().default(""),
  to: z.string().trim().optional().default(""),
});

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The studio's calendar.
 *
 * What a viewer sees is decided source by source, against each module's own Read permission - so
 * opening the calendar never becomes a way to read a module they are refused everywhere else. A
 * viewer who holds only the CRM gets their meetings and an honest calendar, not a 403.
 */
async function list(req, res) {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid calendar window." });

  try {
    const can = ({ module, feature }) => iamService.hasPermission(req.user.id, module, feature, "READ");
    const { entries, kinds, unavailable } = await listSchedule({
      can,
      // Who is asking, not only what they may see. Attendance shows a person their own days
      // whatever permissions they hold, so one source needs to know whose calendar this is.
      viewer: { userId: req.user.id },
      from: parseDate(parsed.data.from),
      to: parseDate(parsed.data.to),
      // Team Attendance - everybody's absences - is an administrator's, as the attendance Dashboard is.
      isAdministrator: await isAdministrator(req.user.id),
    });
    // `kinds` is what this viewer may see, which is not the same as what happens to be booked -
    // the page needs the difference to draw a legend rather than guess it from the entries.
    return res.json({ data: entries, kinds, unavailable });
  } catch (error) {
    return sendError(res, error, "Unable to load the calendar.");
  }
}

module.exports = { list };
