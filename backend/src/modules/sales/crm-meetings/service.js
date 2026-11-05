const prisma = require("../../../config/db");
const { toMeeting } = require("../crm-leads/meetingService");
const { readableEnquiryIds } = require("../../../services/leadScope");

/**
 * Every meeting in the CRM, across all leads.
 *
 * The CRM books meetings one lead at a time, and until now they could only be read the same
 * way - open the lead, open its meetings. That answers "what is booked for this lead" but
 * never "what is booked this week", which is the question the Meetings page exists for.
 *
 * Read only. Scheduling and cancelling still go through the lead's own endpoints in
 * crm-leads/meetingService, which own the Google Calendar side; nothing here writes.
 */

// The lead a meeting was booked against, so a row can name the client without a second call.
// Read by primary key and never written.
async function leadsByEnquiryId(enquiryIds) {
  if (!enquiryIds.length) return new Map();
  const leads = await prisma.salesCrmLead.findMany({
    where: { enquiryId: { in: enquiryIds }, deletedAt: null },
    select: { enquiryId: true, name: true, phone: true, verticalName: true, status: true, crm: true },
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
  const readable = await readableEnquiryIds(rows.map((row) => row.enquiryId), reader);
  const mine = Number(reader.userId);
  const visible = rows.filter((row) => readable.has(row.enquiryId) || row.createdByUserId === mine);
  const leads = await leadsByEnquiryId([...new Set(visible.map((row) => row.enquiryId))]);

  return visible.map((row) => {
    const lead = leads.get(row.enquiryId);
    return {
      ...toMeeting(row),
      // A lead deleted after its meeting was booked leaves the meeting behind. It still shows,
      // named by its enquiry id, rather than disappearing from the calendar without warning.
      lead: lead
        ? { enquiryId: lead.enquiryId, name: lead.name || "", phone: lead.phone || "", vertical: lead.verticalName || "", status: lead.status || "", crm: lead.crm || "" }
        : null,
    };
  });
}

/**
 * Leads matching a typed search, for the Add Meet picker.
 *
 * The CRM holds tens of thousands of leads, so the picker cannot simply be handed the list -
 * searching happens here and only the handful that match travel. Name and enquiry id are both
 * matched because a salesperson booking a meeting has one or the other to hand, and the label
 * carries both so two clients of the same name can be told apart.
 *
 * Read only, and capped: an empty search returns the most recent leads rather than everything.
 */
async function searchLeads({ query = "", limit = 20 } = {}) {
  const trimmed = String(query || "").trim();
  const take = Math.min(Math.max(Number(limit) || 20, 1), 50);

  /*
   * Every lead, not only the reader's own. This is a picker: it exists to book a meeting *onto* a
   * lead, and the person arranging a meeting is often not the CRM working it. The Meetings list is
   * what the rule narrows - and a meeting booked here is then visible to whoever booked it, so
   * arranging one never hides it from the person who arranged it.
   */
  const rows = await prisma.salesCrmLead.findMany({
    where: {
      deletedAt: null,
      ...(trimmed ? { OR: [{ name: { contains: trimmed } }, { enquiryId: { contains: trimmed } }] } : {}),
    },
    select: { enquiryId: true, name: true, verticalName: true },
    orderBy: { createdAt: "desc" },
    take,
  });

  return rows.map((row) => ({ enquiryId: row.enquiryId, name: row.name || "", vertical: row.verticalName || "" }));
}

module.exports = { listAllMeetings, searchLeads };
