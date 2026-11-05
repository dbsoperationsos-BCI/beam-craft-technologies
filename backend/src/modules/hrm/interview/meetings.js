const { google } = require("googleapis");
const prisma = require("../../../config/db");
const {
  CALENDAR_SCOPE,
  connectionHasCalendarScope,
  getAuthorizedGoogleClientForUser,
  getConnectionForUser,
} = require("../../sales/google-oauth/service");

/**
 * The Google Calendar entry behind an interview round.
 *
 * A Meet link is not something this code can mint: Google issues one only as part of a calendar
 * event created with a `conferenceData` request. So "schedule an interview with a Meet" means
 * creating an event on the scheduler's own primary calendar and keeping the link it hands back -
 * exactly what `sales/crm-leads/meetingService.js` does for a lead, on **the same** stored Google
 * connection. One Google login per person already serves the CRM's meetings and the Interview
 * module's linked sheets, and the consent it was granted under already carries `calendar.events`.
 *
 * ── Why this is a module of its own rather than a call into the CRM's ──
 *
 * The CRM's `createMeeting` writes a `sales_crm_meeting` row against an `enquiryId`. An interview
 * has no enquiry and belongs to no lead, and a meeting filed against a lead that does not exist is
 * worse than no row at all. What an interview needs kept is the **link and the event id**, and it
 * already has somewhere to keep them: the round itself, in `interview_rounds`. So this module talks
 * to Google and hands back what it got; the register does the storing.
 *
 * ── Why the event is patched rather than replaced when a round is edited ──
 *
 * Moving an interview by an hour should move the entry everybody already has, keep the link the
 * candidate was sent, and let Google send its own update. Cancelling and re-booking would mail
 * every guest twice and change a link that has already gone out.
 */

/** Every event is written to the scheduler's own primary calendar - the studio has no calendar. */
const CALENDAR_ID = "primary";

/** How long an interview runs when the dialog offers no answer. */
const DEFAULT_DURATION_MINUTES = 30;

/** The studio's zone, for a caller whose browser would not say. */
const FALLBACK_TIME_ZONE = "Asia/Kolkata";

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/**
 * The Google account this interview will be booked through - **theirs if they have one, the
 * studio's if they do not**.
 *
 * Scheduling used to demand a connection from whoever pressed the button, so every recruiter had to
 * link their own Google account before they could book anything, and a studio that had already
 * connected one account still had to do it again for each person. That is the friction this removes:
 * once **any** account is linked, everybody schedules.
 *
 * The order matters and is not arbitrary:
 *
 *   1. **Their own**, when they have one that can book. The interview then lands in their own diary
 *      and the invite goes out in their name, which is the right answer whenever it is available.
 *   2. **The studio's** otherwise - the earliest linked account that carries the Calendar consent.
 *      Earliest rather than any, so the answer is the same every time: a studio with one connected
 *      account always books through that one, and the organiser does not change as people connect.
 *
 * A borrowed connection is **not a lesser one**: the event is real, the guests are really invited,
 * and the only difference is whose calendar owns it - which is why the caller is told, so the screen
 * can say so rather than leaving somebody to wonder why the interview is not in their diary.
 *
 * The same reading as the linked Google Sheets, which have always authenticated with the connection
 * stored on the **link** rather than the connection of whoever triggered the sync. One account
 * serving the studio is the existing pattern here, not a new idea.
 */
const SCHEDULING_CANDIDATE_LIMIT = 5;

async function resolveSchedulingConnection(userId) {
  const own = userId ? await getConnectionForUser(userId).catch(() => null) : null;
  if (own && connectionHasCalendarScope(own)) return { connection: own, actingUserId: userId, borrowed: false };

  /*
   * Every linked account that *claims* the Calendar consent, oldest first. A handful rather than
   * one, because `getConnectionForUser` is what actually proves a connection still works - it
   * refreshes the token and answers null for one Google has since rejected - and a studio whose
   * first-connected account was revoked should fall through to the next rather than be refused.
   */
  const candidates = await prisma.salesGoogleAccountConnection.findMany({
    where: { status: "CONNECTED", scopes: { contains: CALENDAR_SCOPE }, ...(userId ? { userId: { not: userId } } : {}) },
    orderBy: [{ createdAt: "asc" }],
    select: { userId: true },
    take: SCHEDULING_CANDIDATE_LIMIT,
  });
  for (const candidate of candidates) {
    const connection = await getConnectionForUser(candidate.userId).catch(() => null);
    if (connection && connectionHasCalendarScope(connection)) {
      return { connection, actingUserId: candidate.userId, borrowed: true };
    }
  }

  /*
   * Nothing to book with, and the two reasons are told apart because the answers differ: connect an
   * account, or reconnect one that predates the Calendar consent. Worded for the **studio** rather
   * than for the person reading it, since one connection now serves everybody - telling a recruiter
   * to connect their own account would be asking them to solve it the expensive way.
   */
  const anyConnection = await prisma.salesGoogleAccountConnection.count({ where: { status: "CONNECTED" } });
  const error = new Error(anyConnection
    ? "The studio's Google account has to be reconnected under Settings → Integrations → Interview before a Meet can be created — the one that is linked was connected before Calendar access was asked for."
    : "No Google account is linked yet. Connect one under Settings → Integrations → Interview and everybody schedules through it.");
  error.status = 400;
  error.code = anyConnection ? "GOOGLE_CALENDAR_SCOPE_REQUIRED" : "GOOGLE_NOT_CONNECTED";
  throw error;
}

/**
 * The two ends of the appointment, as **wall clock** rather than as instants.
 *
 * `interview_date` and `interview_time` are text columns holding a day and an hour somebody typed -
 * "the 25th at half past ten" - and never a moment in time. Google takes exactly that: a `dateTime`
 * with no offset plus the `timeZone` it is to be read in. Converting to an instant here would need
 * this server to know the scheduler's zone and its daylight saving, which is how a 10:30 interview
 * ends up booked for 5:00am somewhere.
 *
 * So the end is the start's wall clock plus the duration, computed by treating the naive string as
 * UTC and formatting it back - arithmetic on the clock face, which is what "half an hour later"
 * means to the person booking it.
 */
function resolveWindow({ interviewDate, interviewTime, durationMinutes }) {
  const day = String(interviewDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw badRequest("Pick the day this interview is on.");
  const time = String(interviewTime || "").trim();
  if (!/^\d{2}:\d{2}$/.test(time)) throw badRequest("Pick the time this interview is at — a Meet has to start at an hour.");

  const minutes = Number(durationMinutes) > 0 ? Math.min(Number(durationMinutes), 480) : DEFAULT_DURATION_MINUTES;
  const start = `${day}T${time}:00`;
  const endAt = new Date(`${start}Z`);
  if (Number.isNaN(endAt.getTime())) throw badRequest("Pick a valid date and time for this interview.");
  endAt.setUTCMinutes(endAt.getUTCMinutes() + minutes);
  return { start, end: endAt.toISOString().slice(0, 19) };
}

/** A guest list with the blanks, the duplicates and anything that is not an address dropped. */
function guestList(emails) {
  const seen = new Set();
  const guests = [];
  for (const value of Array.isArray(emails) ? emails : []) {
    const email = String(value || "").trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    seen.add(key);
    guests.push(email);
  }
  return guests;
}

/** The Meet link off an event, whichever of the two places Google put it in. */
function meetLinkOf(event) {
  return event?.hangoutLink
    || (event?.conferenceData?.entryPoints || []).find((entry) => entry.entryPointType === "video")?.uri
    || "";
}

/**
 * Creates the round's Google Meet, or moves the one it already has.
 *
 * `googleEventId` is what decides which: a round that has one is **patched**, so the entry already
 * in everybody's calendar moves and the link the candidate was sent still works; a round without one
 * gets a new event with `conferenceDataVersion: 1` and a `createRequest`, which is what makes Google
 * attach a Meet conference at all - without both, the event is created and comes back with no link.
 *
 * An event that has been deleted in Google since - somebody cleared their calendar - patches with a
 * 404 or a 410. That is not a failure to schedule: the answer is a new event, so it falls through to
 * creating one rather than refusing an interview because of a calendar entry nobody has any more.
 *
 * Returns `{ meetLink, googleEventId, htmlLink, organizerEmail }` for the caller to store on the
 * round. It writes nothing itself.
 */
async function syncInterviewMeeting({
  userId,
  candidate,
  round,
  interviewDate,
  interviewTime,
  durationMinutes,
  attendees,
  timeZone,
  googleEventId,
}) {
  const { start, end } = resolveWindow({ interviewDate, interviewTime, durationMinutes });
  const guests = guestList(attendees);
  const zone = String(timeZone || "").trim() || FALLBACK_TIME_ZONE;

  /*
   * Whose account books it - theirs when they have one, the studio's otherwise. Both halves of the
   * answer are needed: the client has to be built for the account that actually owns the calendar,
   * or Google is asked to write to one person's diary with another person's token.
   */
  const { connection, actingUserId, borrowed } = await resolveSchedulingConnection(userId);
  const { oauth2Client } = await getAuthorizedGoogleClientForUser(actingUserId);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const who = candidate?.name || candidate?.candidateCode || "candidate";
  const summary = `Interview · ${who}${round ? ` · Round ${round}` : ""}`;
  const description = [
    candidate?.position ? `Position: ${candidate.position}` : "",
    candidate?.candidateCode ? `Candidate: ${candidate.candidateCode}` : "",
    candidate?.phone ? `Phone: ${candidate.phone}` : "",
  ].filter(Boolean).join("\n") || undefined;

  const body = {
    summary,
    description,
    start: { dateTime: start, timeZone: zone },
    end: { dateTime: end, timeZone: zone },
    attendees: guests.map((email) => ({ email })),
  };

  if (googleEventId) {
    try {
      const patched = await calendar.events.patch({
        calendarId: CALENDAR_ID,
        eventId: googleEventId,
        conferenceDataVersion: 1,
        // Google's own "this has moved" mail, which is the whole reason the event is patched rather
        // than replaced - the candidate and the interviewer are told without anybody writing to them.
        sendUpdates: guests.length ? "all" : "none",
        requestBody: body,
      });
      const event = patched?.data || {};
      return {
        meetLink: meetLinkOf(event),
        googleEventId: event.id || googleEventId,
        htmlLink: event.htmlLink || "",
        organizerEmail: event.organizer?.email || connection.googleEmail || "",
        // Whether it was booked on somebody else's calendar, so the screen can say whose rather
        // than leaving the scheduler to wonder why it is not in their own diary.
        borrowed,
      };
    } catch (error) {
      const status = error?.code || error?.response?.status;
      // Anything but "that event is gone" is a real failure and belongs to the caller.
      if (status !== 404 && status !== 410) throw error;
    }
  }

  const created = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    conferenceDataVersion: 1,
    sendUpdates: guests.length ? "all" : "none",
    requestBody: {
      ...body,
      conferenceData: {
        createRequest: {
          // Unique per attempt, so a retry after a network error creates one conference rather than
          // being silently de-duplicated onto the first.
          requestId: `dbs-interview-${candidate?.id || "new"}-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  const event = created?.data || {};
  return {
    meetLink: meetLinkOf(event),
    googleEventId: event.id || "",
    htmlLink: event.htmlLink || "",
    organizerEmail: event.organizer?.email || connection.googleEmail || "",
    borrowed,
  };
}

/**
 * Calls off the round's event in Google, and never fails the call it is part of.
 *
 * The register is what the studio reads; leaving an interview shown as cancelled because Google was
 * unreachable is the worse outcome, so this logs and moves on. 410 is Google's "already gone", which
 * is the state that was wanted anyway.
 */
async function cancelInterviewMeeting({ userId, googleEventId }) {
  if (!googleEventId) return;
  try {
    // As the account that **owns** the event, which is not necessarily the person cancelling it:
    // an interview booked on the studio's calendar cannot be deleted with a recruiter's own token.
    const { actingUserId } = await resolveSchedulingConnection(userId);
    const { oauth2Client } = await getAuthorizedGoogleClientForUser(actingUserId);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: googleEventId, sendUpdates: "all" });
  } catch (error) {
    const status = error?.code || error?.response?.status;
    if (status !== 404 && status !== 410) {
      console.warn(`[interview-meetings] could not delete Google event ${googleEventId}:`, error?.message || error);
    }
  }
}

module.exports = {
  DEFAULT_DURATION_MINUTES,
  cancelInterviewMeeting,
  guestList,
  resolveSchedulingConnection,
  resolveWindow,
  syncInterviewMeeting,
};
