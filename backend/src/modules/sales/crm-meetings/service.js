const prisma = require("../../../config/db");
const { parseAttendees, toMeeting } = require("../crm-leads/meetingService");
const { readableEnquiryIds } = require("../../../services/leadScope");

/**
 * Every meeting in the CRM, across all leads.
 *
 * The CRM books meetings one lead at a time, and until now they could only be read the same
 * way - open the lead, open its meetings. That answers "what is booked for this lead" but
 * never "what is booked this week", which is the question the Meetings page exists for.
 *
 * A lead's meetings are scheduled and cancelled through the lead's own endpoints. A meeting with no
 * lead - booked from the Calendar's Add Meet - is scheduled and cancelled here (`controller.js`),
 * through the same crm-leads/meetingService that owns the Google Calendar side.
 */

// The lead a meeting was booked against, so a row can name the client without a second call.
// Read by primary key and never written.
async function leadsByEnquiryId(enquiryIds) {
  if (!enquiryIds.length) return new Map();
  const leads = await prisma.salesCrmLead.findMany({
    where: { enquiryId: { in: enquiryIds }, deletedAt: null },
    select: { enquiryId: true, name: true, phone: true, verticalName: true, status: true, crm: true, branchId: true, branch: { select: { name: true } } },
  });
  return new Map(leads.map((lead) => [lead.enquiryId, lead]));
}

/**
 * Meetings in a window, newest last.
 *
 * `from` and `to` bound the start time. The Meetings page asks for a month at a time and the
 * reminder asks for the next half hour, so the same query serves both rather than every
 * caller pulling the whole table and throwing most of it away.
 *
 * Cancelled meetings are included: the list view greys them out rather than hiding them, so
 * a meeting someone remembers booking does not simply vanish. `includeCancelled: false`
 * drops them, which is what the reminder wants - there is nothing to remind anyone of.
 */
async function listAllMeetings({ from, to, includeCancelled = true, reader = null } = {}) {
  /*
   * `reader` is `{ userId, permissions }` - who is asking, and under which guard. A meeting is
   * seen by the people who may see its lead, plus whoever booked it. There is no unscoped read:
   * a caller that forgets to say who is asking is answered nothing rather than everything, the
   * same way a missing data scope is.
   */
  if (!reader?.userId) {
    console.warn("[crm-meetings] listAllMeetings called with no reader; answering no meetings");
    return [];
  }
  const where = {};

  const startAt = {};
  if (from instanceof Date && !Number.isNaN(from.getTime())) startAt.gte = from;
  if (to instanceof Date && !Number.isNaN(to.getTime())) startAt.lte = to;
  if (Object.keys(startAt).length) where.startAt = startAt;
  if (!includeCancelled) where.status = { not: "CANCELLED" };

  const rows = await prisma.salesCrmMeeting.findMany({ where, orderBy: [{ startAt: "asc" }] });
  /*
   * The window bounds the meetings first, then the handful of leads they name are asked about. A
   * meeting is kept when its lead is readable, or when this person booked it - booking a meeting
   * puts your name on it, and losing sight of what you put in the diary is never right.
   */
  const readable = await readableEnquiryIds(rows.map((row) => row.enquiryId).filter(Boolean), reader);
  const mine = Number(reader.userId);
  /*
   * A meeting with no lead has nobody's lead to be read through, so it is seen by the people on it:
   * whoever booked it, and a guest whose sign-in email is on its list. A Super Admin sees them all -
   * the studio's decision, and IAM's own rule that a Super Admin holds everything; there is no lead
   * permission to ask instead, because these meetings have no lead to scope.
   */
  const viewer = rows.some((row) => !row.enquiryId)
    ? await prisma.user.findUnique({ where: { id: mine }, select: { email: true, role: true } })
    : null;
  const viewerEmail = String(viewer?.email || "").trim().toLowerCase();
  const onIt = (row) => row.createdByUserId === mine || viewer?.role === "SUPER_ADMIN"
    || (Boolean(viewerEmail) && parseAttendees(row.attendees).some((email) => email.toLowerCase() === viewerEmail));
  const visible = rows.filter((row) => (row.enquiryId ? readable.has(row.enquiryId) : onIt(row)) || row.createdByUserId === mine);
  // Only the meetings that name a lead: `null` in an `in` list is refused by Prisma.
  const leads = await leadsByEnquiryId([...new Set(visible.map((row) => row.enquiryId).filter(Boolean))]);

  return visible.map((row) => {
    const lead = leads.get(row.enquiryId);
    return {
      ...toMeeting(row),
      // Booked by the person reading - who alone may cancel a meeting with no lead.
      mine: row.createdByUserId === mine,
      // A lead deleted after its meeting was booked leaves the meeting behind. It still shows,
      // named by its enquiry id, rather than disappearing from the calendar without warning.
      lead: lead
        ? {
          enquiryId: lead.enquiryId, name: lead.name || "", phone: lead.phone || "", vertical: lead.verticalName || "", status: lead.status || "", crm: lead.crm || "",
          // The lead's branch, which the Calendar's list filters a meeting by.
          branchId: lead.branchId ?? null, branchName: lead.branch?.name || "",
        }
        : null,
    };
  });
}

module.exports = { listAllMeetings };
