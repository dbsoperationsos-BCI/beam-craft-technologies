const { z } = require("zod");
const { listAllMeetings } = require("./service");
const { cancelMeeting, createMeeting, meetingSchema } = require("../crm-leads/meetingService");

// Both bounds are optional: no window at all means every meeting ever booked, which is what
// the Meetings page asks for when it first opens.
const listSchema = z.object({
  from: z.string().trim().optional().default(""),
  to: z.string().trim().optional().default(""),
  includeCancelled: z.string().trim().optional().default(""),
});

function sendError(res, error, fallback) {
  console.error(fallback, error.message);
  return res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
}

function parseDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function list(req, res) {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid meeting window." });
  try {
    const data = await listAllMeetings({
      from: parseDate(parsed.data.from),
      to: parseDate(parsed.data.to),
      includeCancelled: parsed.data.includeCancelled !== "false",
      reader: { userId: Number(req.user.id), permissions: req.permission },
    });
    return res.json({ data });
  } catch (error) {
    return sendError(res, error, "Unable to load meetings.");
  }
}

/*
 * A meeting with no lead: the Calendar's Add Meet. The same fields as a lead's meeting, and the same
 * booking - a Google Meet on the organiser's calendar - with no lead named; it is seen by its
 * organiser and its guests (`service.listAllMeetings`). The fields are checked by the lead meeting's
 * own `meetingSchema`, so the two cannot drift apart.
 */
async function schedule(req, res) {
  const parsed = meetingSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid meeting details.", errors: parsed.error.flatten() });
  try {
    const meeting = await createMeeting({ ...parsed.data, enquiryId: null, userId: req.user?.id });
    return res.status(201).json({ message: "Meeting scheduled.", data: meeting });
  } catch (error) {
    // The code keys the dialog's Connect and Reconnect buttons, as on a lead's meeting.
    if (error.code) return res.status(error.status || 400).json({ message: error.message, code: error.code });
    return sendError(res, error, "Unable to schedule this meeting.");
  }
}

// Cancels a meeting with no lead - only one this person booked; anybody else's answers 404.
async function cancel(req, res) {
  try {
    const meeting = await cancelMeeting({ id: String(req.params.id || "").trim(), enquiryId: null, userId: req.user?.id });
    return res.json({ message: "Meeting cancelled.", data: meeting });
  } catch (error) {
    return sendError(res, error, "Unable to cancel this meeting.");
  }
}

module.exports = { cancel, list, schedule };
