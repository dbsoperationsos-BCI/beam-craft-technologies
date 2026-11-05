const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { resolveWindow, guestList, DEFAULT_DURATION_MINUTES } = require("../src/modules/hrm/interview/meetings");
const { scheduleSchema } = require("../src/modules/hrm/interview/controller");

/*
 * Scheduling an interview is **one act**: the round, the stage and the Google Meet.
 *
 * It used to be three things a person did, and two of them were the application's own work. HR typed
 * a date, pasted a Meet link created somewhere else, and then remembered to move the stage to
 * Interview Scheduled - and the one most often missed is the one the register is read by, so a
 * candidate with a conversation booked for Thursday sat in the Form Submitted tab until somebody
 * noticed.
 *
 * What has to stay true, and what this file holds:
 *
 *   * the hour is read as a **clock face**, never as an instant - the two columns behind it are text
 *     somebody typed, and converting them to a moment is how a 10:30 interview gets booked for 5am;
 *   * the Meet is created **before** anything is written, so a calendar Google refuses records no
 *     interview at all;
 *   * an edit **patches** the event rather than replacing it, so the link the candidate was sent
 *     goes on working and Google sends its own "this has moved";
 *   * an edit does **not** move the stage, because moving a date is not a decision about a person.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const CONTROLLER = read("src", "modules", "hrm", "interview", "controller.js");
const MEETINGS = read("src", "modules", "hrm", "interview", "meetings.js");
const ROUTES = read("src", "modules", "hrm", "interview", "routes.js");

/* ── The clock face ─────────────────────────────────────────────────────────────────────────── */

test("the day and the hour are handed to Google as wall clock, not as an instant", () => {
  // No offset and no Z: Google is told the local time and the zone to read it in, which is exactly
  // what `interview_date` and `interview_time` have always held - a day and an hour somebody typed.
  const window = resolveWindow({ interviewDate: "2026-09-25", interviewTime: "10:30", durationMinutes: 30 });
  assert.equal(window.start, "2026-09-25T10:30:00");
  assert.equal(window.end, "2026-09-25T11:00:00");
  assert.equal(/[zZ]|[+-]\d{2}:\d{2}$/.test(window.start), false, "a start with an offset is an instant, not a clock face");
});

test("the end is the start plus the length, across midnight too", () => {
  assert.equal(resolveWindow({ interviewDate: "2026-09-25", interviewTime: "23:45", durationMinutes: 30 }).end, "2026-09-26T00:15:00");
  // The default where the dialog offers no answer.
  assert.equal(resolveWindow({ interviewDate: "2026-09-25", interviewTime: "09:00" }).end, `2026-09-25T09:${String(DEFAULT_DURATION_MINUTES).padStart(2, "0")}:00`);
});

test("a Meet with no hour is refused where the answer can still be given", () => {
  // Google cannot book an event that starts "sometime Thursday", and a refusal from Google reads as
  // a bug where a refusal here reads as a question.
  assert.throws(() => resolveWindow({ interviewDate: "2026-09-25", interviewTime: "" }), /has to start at an hour/);
  assert.throws(() => resolveWindow({ interviewDate: "", interviewTime: "10:30" }), /day this interview is on/);
});

test("the guest list drops the blanks, the repeats and anything that is not an address", () => {
  assert.deepEqual(
    guestList(["hr@dbs.com", " hr@dbs.com ", "", null, "not-an-email", "lead@dbs.com"]),
    ["hr@dbs.com", "lead@dbs.com"],
  );
});

/* ── The act ────────────────────────────────────────────────────────────────────────────────── */

test("scheduling is its own route, and a POST so the guard asks for write", () => {
  assert.match(ROUTES, /router\.post\("\/candidates\/:id\/schedule", controller\.schedule\)/);
  // Above the ":id" routes is not the question here - it is a suffix - but it must still be a route
  // of its own rather than a body on the full update, which is not partial and would blank a record.
  assert.match(CONTROLLER, /async function schedule\(req, res\)/);
});

test("the Meet is created before anything is written", () => {
  // A calendar Google refuses has to refuse the whole schedule. An interview recorded with no Meet
  // behind it is the failure that costs somebody the conversation.
  const meetAt = CONTROLLER.indexOf("await syncInterviewMeeting({");
  const writeAt = CONTROLLER.indexOf("await service.updateCandidate(candidate.id, values, req.user, { partial: true })");
  assert.ok(meetAt > -1 && writeAt > -1, "the schedule no longer books a Meet or no longer writes");
  assert.ok(meetAt < writeAt, "the register is written before Google has accepted the event");
});

test("an existing round's event is patched, and only a vanished one is replaced", () => {
  assert.match(MEETINGS, /calendar\.events\.patch\(\{/);
  // 404 and 410 are "that event is gone", which is answered with a new one; anything else is a real
  // failure and belongs to the caller.
  assert.match(MEETINGS, /if \(status !== 404 && status !== 410\) throw error;/);
  // And a new event only gets a Meet at all with both of these.
  assert.match(MEETINGS, /conferenceDataVersion: 1/);
  assert.match(MEETINGS, /conferenceSolutionKey: \{ type: "hangoutsMeet" \}/);
});

test("scheduling moves the stage, and editing leaves it alone", () => {
  // The stage of a candidate with a round in the diary *is* Interview Scheduled, so the act sets it
  // and records why. Moving a date is not a decision about a person: a candidate already Selected
  // whose final round moves by an hour is still Selected.
  assert.match(CONTROLLER, /if \(!editing && candidate\.status !== INTERVIEW_SCHEDULED_STATUS\) \{/);
  assert.match(CONTROLLER, /values\.status = INTERVIEW_SCHEDULED_STATUS;/);
  assert.match(CONTROLLER, /values\.statusNotes = \[\.\.\.held, \{ status: INTERVIEW_SCHEDULED_STATUS, note, at: new Date\(\)\.toISOString\(\) \}\]/);
});

test("a round that stops being a Meet has its event called off", () => {
  // Otherwise everybody goes on holding an invite to a conference nobody will join.
  assert.match(CONTROLLER, /await cancelInterviewMeeting\(\{ userId: req\.user\?\.id, googleEventId: existing\.googleEventId \}\)/);
});

test("a Meet's link is Google's answer, and a link already held is never blanked", () => {
  /*
   * No screen sends a link at any mode - a Meet's cannot be typed, because it does not exist until
   * Google issues it, and an in-person round has none to give.
   *
   * So both halves fall back to the round that is already there rather than to "": a patch that came
   * back without a conference must not blank a link people are already using, and an edit that was
   * only moving an in-person round's date must not throw away a link a linked sheet or an earlier
   * booking wrote. Not asking for a value is not the same as deciding it is wrong.
   */
  assert.match(CONTROLLER, /meetLink: isMeet\s*\n\s*\? \(meet\?\.meetLink \|\| existing\?\.meetLink \|\| ""\)\s*\n\s*: \(input\.meetLink \?\? existing\?\.meetLink \?\? ""\)/);
  // `undefined` rather than a default, because that is what tells "no link" apart from "blank it".
  const parsed = scheduleSchema.safeParse({ interviewDate: "2026-09-25" });
  assert.equal(parsed.success, true);
  assert.equal("meetLink" in parsed.data, false, "an omitted link must stay omitted");
});

test("the schedule body is validated, and says which errand it is", () => {
  const ok = scheduleSchema.safeParse({ mode: "next", interviewDate: "2026-09-25", interviewTime: "10:30", interviewMode: "Google Meet", durationMinutes: 45 });
  assert.equal(ok.success, true);
  assert.equal(ok.data.mode, "next");
  // A day is the one answer a round cannot do without: the flat columns the table and the linked
  // sheets read follow the latest round, so a round saying nothing would erase the one in the diary.
  assert.equal(scheduleSchema.safeParse({ interviewDate: "  " }).success, false);
  // And nothing rides along: an object schema drops what it does not name.
  const parsed = scheduleSchema.safeParse({ interviewDate: "2026-09-25", name: "Somebody Else", status: "Selected" });
  assert.equal(parsed.data.name, undefined);
  assert.equal(parsed.data.status, undefined);
});

test("the guest list is served by its own route, guarded a notch tighter than the screen", () => {
  /*
   * The roster with everybody's work email on it is for somebody booking an interview, not for
   * everybody who may read the register - which is what the router's own `requireModule` would give
   * a GET. That is also why it is not part of the options payload.
   */
  assert.match(ROUTES, /router\.get\("\/meet-guests", checkPermission\("HRM", "Interview", "READ_WRITE"\), controller\.meetGuestOptions\)/);
  const SERVICE = read("src", "modules", "hrm", "interview", "service.js");
  assert.match(SERVICE, /async function meetGuests\(\)/);
  // Work address first: it is the one a meeting invite belongs on. An employee with neither is left
  // out rather than offered as a guest nobody can invite.
  assert.match(SERVICE, /email: String\(row\.workEmailId \|\| row\.emailId \|\| ""\)\.trim\(\)/);
  assert.match(SERVICE, /\.filter\(\(row\) => row\.email\)/);
});

test("one Google connection serves the CRM's meetings and this", () => {
  // Same stored account, same consent, and that consent already carries `calendar.events`. A second
  // connection for interviews would be a second thing to reconnect when a token expires.
  assert.match(MEETINGS, /require\("\.\.\/\.\.\/sales\/google-oauth\/service"\)/);
  // The two refusals are told apart, because the answers differ: connect an account, or reconnect
  // one made before Calendar was part of the consent.
  assert.match(MEETINGS, /error\.code = anyConnection \? "GOOGLE_CALENDAR_SCOPE_REQUIRED" : "GOOGLE_NOT_CONNECTED";/);
  // And both are passed through with their code, rather than flattened into the fallback sentence.
  assert.match(CONTROLLER, /error\?\.code === "GOOGLE_NOT_CONNECTED" \|\| error\?\.code === "GOOGLE_CALENDAR_SCOPE_REQUIRED"/);
});

test("one linked account books for the whole studio", () => {
  /*
   * Scheduling used to demand a connection from whoever pressed the button, so every recruiter had
   * to link their own Google account and a studio that had already connected one still had to do it
   * again per person. Once **any** account is linked, everybody schedules through it.
   *
   * Their own still wins where they have one - the interview then lands in their own diary and the
   * invite goes out in their name - and the studio's is the fallback rather than the rule.
   */
  assert.match(MEETINGS, /if \(own && connectionHasCalendarScope\(own\)\) return \{ connection: own, actingUserId: userId, borrowed: false \};/);
  // Oldest first, so the organiser does not change as other people connect their own accounts.
  assert.match(MEETINGS, /orderBy: \[\{ createdAt: "asc" \}\]/);
  // A connection Google has since rejected is skipped rather than refusing the studio: the claim is
  // in the `scopes` column, but only `getConnectionForUser` proves the token still works.
  assert.match(MEETINGS, /for \(const candidate of candidates\) \{/);
  assert.match(MEETINGS, /status: "CONNECTED", scopes: \{ contains: CALENDAR_SCOPE \}/);
});

test("the event is written and cancelled by the account that owns it", () => {
  // Both halves of the answer are needed. Building the client for the wrong account asks Google to
  // write to one person's diary with another person's token - and an interview booked on the
  // studio's calendar cannot be deleted with a recruiter's own.
  assert.match(MEETINGS, /const \{ connection, actingUserId, borrowed \} = await resolveSchedulingConnection\(userId\);/);
  assert.match(MEETINGS, /const \{ oauth2Client \} = await getAuthorizedGoogleClientForUser\(actingUserId\);/);
  const cancel = MEETINGS.slice(MEETINGS.indexOf("async function cancelInterviewMeeting"));
  assert.match(cancel, /const \{ actingUserId \} = await resolveSchedulingConnection\(userId\);/);
  // And the caller is told whose calendar it landed on, so the screen can say rather than leave
  // somebody wondering why the interview is not in their own.
  assert.match(MEETINGS, /borrowed,/);
});
