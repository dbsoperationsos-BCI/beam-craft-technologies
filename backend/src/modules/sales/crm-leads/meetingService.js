const { z } = require("zod");
const { google } = require("googleapis");
const prisma = require("../../../config/db");
const {
  connectionHasCalendarScope,
  getAuthorizedGoogleClientForUser,
  getConnectionForUser,
} = require("../google-oauth/service");

/**
 * Meetings booked against a CRM lead, backed by Google Calendar.
 *
 * The Meet link is not something this code can mint on its own: Google issues one only as
 * part of a calendar event, when the event is created with a conferenceData request. So
 * scheduling here means creating an event on the organiser's primary calendar and keeping
 * the link it hands back.
 *
 * The same OAuth connection the Google Sheets integration uses is reused unchanged - one
 * account, one consent, one refresh path. This module only ever reads that connection and
 * asks it for a Calendar client; it never writes tokens, changes scopes or touches any of
 * the sheet-link code.
 */

// The meeting length offered when a caller gives a start but no end.
const DEFAULT_DURATION_MINUTES = 30;

// Every event is written to the organiser's own primary calendar. The CRM has no calendar of
// its own, and a meeting the salesperson cannot see in their own Google Calendar is worse
// than useless.
const CALENDAR_ID = "primary";

// What a meeting is booked with - a lead's, and the Calendar's Add Meet with no lead alike.
const meetingSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).optional().default(""),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().optional().default(""),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  attendees: z.array(z.string().trim().email()).max(50).optional().default([]),
  timeZone: z.string().trim().max(60).optional().default(""),
});

function parseAttendees(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toMeeting(row) {
  return {
    id: row.id,
    enquiryId: row.enquiryId,
    title: row.title,
    description: row.description || "",
    startAt: row.startAt,
    endAt: row.endAt,
    attendees: parseAttendees(row.attendees),
    organizerEmail: row.organizerEmail || "",
    meetLink: row.meetLink || "",
    htmlLink: row.htmlLink || "",
    googleEventId: row.googleEventId || "",
    status: row.status,
    createdAt: row.createdAt,
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/**
 * The Google connection to schedule with, or an error the CRM can act on.
 *
 * Two failures are told apart deliberately. No connection at all means "connect your Google
 * account"; a connection made before Calendar was part of the consent means "reconnect".
 * Both are surfaced with a code the panel keys its button off, rather than letting Google
 * return a raw 403 that reads as a bug.
 */
async function requireCalendarConnection(userId) {
  const connection = await getConnectionForUser(userId);
  if (!connection) {
    const error = new Error("Connect your Google account to schedule meetings.");
    error.status = 400;
    error.code = "GOOGLE_NOT_CONNECTED";
    throw error;
  }
  if (!connectionHasCalendarScope(connection)) {
    const error = new Error("Reconnect your Google account to allow Google Meet scheduling.");
    error.status = 400;
    error.code = "GOOGLE_CALENDAR_SCOPE_REQUIRED";
    throw error;
  }
  return connection;
}

async function listMeetings(enquiryId) {
  const rows = await prisma.salesCrmMeeting.findMany({
    where: { enquiryId },
    orderBy: [{ startAt: "desc" }],
  });
  return rows.map(toMeeting);
}

function resolveWindow({ startAt, endAt, durationMinutes }) {
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) throw badRequest("Pick a valid date and time for the meeting.");

  let end = endAt ? new Date(endAt) : null;
  if (!end || Number.isNaN(end.getTime())) {
    const minutes = Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MINUTES;
    end = new Date(start.getTime() + minutes * 60 * 1000);
  }
  if (end <= start) throw badRequest("The meeting must end after it starts.");
  return { start, end };
}

/**
 * Books a meeting and returns it with its Meet link.
 *
 * The event is created with `conferenceDataVersion: 1` and a `createRequest`, which is what
 * makes Google attach a Meet conference; without both, the event is created but comes back
 * with no link and the meeting is unjoinable.
 *
 * The row is written only after Google has accepted the event, so the CRM never lists a
 * meeting that does not exist in anyone's calendar.
 */
async function createMeeting({ enquiryId, userId, title, description, startAt, endAt, durationMinutes, attendees, timeZone }) {
  const trimmedTitle = String(title || "").trim();
  if (!trimmedTitle) throw badRequest("Give the meeting a title.");

  const { start, end } = resolveWindow({ startAt, endAt, durationMinutes });
  const guestList = parseAttendees(attendees);

  const connection = await requireCalendarConnection(userId);
  const { oauth2Client } = await getAuthorizedGoogleClientForUser(userId);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const response = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    conferenceDataVersion: 1,
    sendUpdates: guestList.length ? "all" : "none",
    requestBody: {
      summary: trimmedTitle,
      description: String(description || "").trim() || undefined,
      start: { dateTime: start.toISOString(), timeZone: timeZone || undefined },
      end: { dateTime: end.toISOString(), timeZone: timeZone || undefined },
      attendees: guestList.map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          // Unique per attempt, so a retry after a network error creates one conference
          // rather than being silently de-duplicated onto the first.
          requestId: `dbs-crm-${enquiryId || "meet"}-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  const event = response?.data || {};
  const meetLink = event.hangoutLink
    || (event.conferenceData?.entryPoints || []).find((entry) => entry.entryPointType === "video")?.uri
    || "";

  const created = await prisma.salesCrmMeeting.create({
    data: {
      // Null for a meeting booked from the Calendar's Add Meet, which belongs to no lead.
      enquiryId: enquiryId || null,
      title: trimmedTitle,
      description: String(description || "").trim() || null,
      startAt: start,
      endAt: end,
      attendees: guestList.length ? JSON.stringify(guestList) : null,
      // Google's own organizer is authoritative, but it is only returned on some responses;
      // the connected account is the same address and is always known.
      organizerEmail: event.organizer?.email || connection.googleEmail || null,
      googleEventId: event.id || null,
      googleCalendarId: CALENDAR_ID,
      meetLink: meetLink || null,
      htmlLink: event.htmlLink || null,
      status: "SCHEDULED",
      createdByUserId: userId ?? null,
    },
  });

  return toMeeting(created);
}

/**
 * Cancels a meeting in the CRM and in Google.
 *
 * A Google failure is logged but does not fail the call: the row is what the CRM lists, and
 * leaving a meeting shown as scheduled because Google was unreachable is the worse outcome.
 * The event id is kept so the stale event can still be traced.
 */
async function cancelMeeting({ id, enquiryId = null, userId }) {
  // A lead's meeting through that lead; a meeting with no lead only by the person who booked it -
  // with nobody signed in, there is nobody it can be.
  const booker = Number(userId);
  const meeting = enquiryId
    ? await prisma.salesCrmMeeting.findFirst({ where: { id, enquiryId } })
    : booker > 0 ? await prisma.salesCrmMeeting.findFirst({ where: { id, enquiryId: null, createdByUserId: booker } }) : null;
  if (!meeting) {
    const error = new Error("Meeting not found.");
    error.status = 404;
    throw error;
  }

  if (meeting.googleEventId) {
    try {
      const { oauth2Client } = await getAuthorizedGoogleClientForUser(userId);
      const calendar = google.calendar({ version: "v3", auth: oauth2Client });
      await calendar.events.delete({
        calendarId: meeting.googleCalendarId || CALENDAR_ID,
        eventId: meeting.googleEventId,
        sendUpdates: "all",
      });
    } catch (error) {
      // 410 is Google's "already gone", which is the state we wanted anyway.
      if (error?.code !== 410 && error?.response?.status !== 410) {
        console.warn(`[crm-meetings] could not delete Google event ${meeting.googleEventId}:`, error?.message || error);
      }
    }
  }

  const updated = await prisma.salesCrmMeeting.update({ where: { id }, data: { status: "CANCELLED" } });
  return toMeeting(updated);
}

// `toMeeting` is shared with the crm-meetings module, so a meeting is shaped the same whether
// it is read through its lead or through the Meetings page.
module.exports = { cancelMeeting, createMeeting, listMeetings, meetingSchema, parseAttendees, requireCalendarConnection, toMeeting };
