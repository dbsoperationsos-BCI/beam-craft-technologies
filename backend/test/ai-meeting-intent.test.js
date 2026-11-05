const test = require("node:test");
const assert = require("node:assert");
const { looksLikeSchedulingRequest, toProposal, studioToday } = require("../src/services/ai/meetingIntent");

/**
 * Booking a meeting from a sentence.
 *
 * The model reads the sentence; everything that decides whether a real client gets an invite is
 * checked here. These are the checks - a wrong address or a misread time reaches somebody's inbox,
 * and cannot be recalled.
 */

test("a scheduling request is recognised", () => {
  for (const message of [
    "Schedule a meeting with priya@example.com tomorrow at 4pm",
    "book a call for monday 11:00",
    "set up a zoom with the client today 3pm",
    "call meeting podunga tomorrow 11am",
  ]) {
    assert.ok(looksLikeSchedulingRequest(message), message);
  }
});

test("an ordinary question is never mistaken for one", () => {
  /*
   * This gate runs before every answer, so a false positive costs a whole generation. It needs a
   * scheduling word AND something that pins it down - a time, a day, or an address.
   */
  for (const message of [
    "What should I do next with this lead?",
    "Draft a follow-up message",
    "How did the call go?",
    // Mentions a call, but asks nothing about scheduling one.
    "The client called yesterday and asked about the album",
  ]) {
    assert.ok(!looksLikeSchedulingRequest(message), message);
  }
});

test("a complete request becomes exactly what the meeting endpoint accepts", () => {
  const proposal = toProposal({
    message: "book a 45 minute meeting with priya@example.com on 2099-03-04 at 4pm",
    lead: { name: "Priya" },
    now: new Date("2099-03-01T09:00:00+05:30"),
  });

  assert.strictEqual(proposal.ready, true);
  assert.deepStrictEqual(proposal.request.attendees, ["priya@example.com"]);
  assert.strictEqual(proposal.request.durationMinutes, 45);
  assert.strictEqual(proposal.request.title, "Meeting with Priya");
  // Studio time, written with the offset rather than left for the server's clock to interpret.
  assert.strictEqual(proposal.request.startAt, "2099-03-04T16:00:00+05:30");
  assert.strictEqual(proposal.request.timeZone, "Asia/Kolkata");
});

test("a missing time or date asks rather than invents one", () => {
  const noTime = toProposal({
    message: "meeting with a@b.com on 2099-03-04",
    now: new Date("2099-03-01T09:00:00+05:30"),
  });
  assert.strictEqual(noTime.ready, false);
  assert.deepStrictEqual(noTime.missing, ["a time"]);

  const nothing = toProposal({ message: "set up a meeting" });
  assert.strictEqual(nothing.ready, false);
  assert.deepStrictEqual(nothing.missing, ["a date", "a time", "the client's email address"]);
});

test("anything that is not an email address is dropped, never repaired", () => {
  /*
   * The one that matters most. A model that "corrects" priya@exampl into priya@example.com sends a
   * client's meeting link to a stranger, and no one finds out.
   */
  const proposal = toProposal({
    message: "meet priya@example.com and second@example.com, not-an-email, missing@tld on 2099-03-04 at 4pm",
    now: new Date("2099-03-01T09:00:00+05:30"),
  });
  assert.deepStrictEqual(proposal.request.attendees, ["priya@example.com", "second@example.com"]);
});

test("the lead's own address is used only when the message named none", () => {
  const lead = { name: "Priya", email: "onrecord@example.com" };
  const fromRecord = toProposal({
    message: "book a meeting on 2099-03-04 at 4pm",
    lead,
    now: new Date("2099-03-01T09:00:00+05:30"),
  });
  assert.deepStrictEqual(fromRecord.request.attendees, ["onrecord@example.com"]);

  // What the person actually typed wins over what the row happens to hold.
  const fromMessage = toProposal({
    message: "book a meeting with typed@example.com on 2099-03-04 at 4pm",
    lead,
    now: new Date("2099-03-01T09:00:00+05:30"),
  });
  assert.deepStrictEqual(fromMessage.request.attendees, ["typed@example.com"]);
});

test("a meeting in the past is refused", () => {
  // Almost always a misread sentence. Inviting a client to yesterday is worse than asking again.
  const proposal = toProposal({
    message: "meeting with a@b.com on 2020-01-01 at 10:00",
    now: new Date("2099-03-01T09:00:00+05:30"),
  });
  assert.strictEqual(proposal.ready, false);
  assert.deepStrictEqual(proposal.missing, ["a date and time in the future"]);
});

test("an out-of-range duration falls back to the default", () => {
  for (const stated of ["3 min", "5000 minutes", "no length given"]) {
    const proposal = toProposal({
      message: `meeting with a@b.com on 2099-03-04 at 4pm, ${stated}`,
      now: new Date("2099-03-01T09:00:00+05:30"),
    });
    // 5..1440 is what the endpoint's own schema allows; anything else would be rejected there.
    assert.ok(proposal.request.durationMinutes >= 5 && proposal.request.durationMinutes <= 1440, stated);
  }
});

test("today is read in studio time, not the server's", () => {
  assert.match(studioToday(new Date("2099-03-04T20:30:00Z")), /^\d{4}-\d{2}-\d{2}$/);
  // 20:30 UTC is already the 5th in Coimbatore.
  assert.strictEqual(studioToday(new Date("2099-03-04T20:30:00Z")), "2099-03-05");
});

/*
 * The parsing, which is now the whole of it.
 *
 * These were a model's job for one commit, and it got both of them wrong on the first real
 * sentence: no attendees at all, and "tomorrow" resolved to today. Everything below is exact.
 */
const { parseDate, parseTime, parseAttendees, parseDuration } = require("../src/services/ai/meetingIntent");

test("dates people actually type", () => {
  const today = "2026-08-26"; // a Wednesday

  assert.strictEqual(parseDate("meet on 2026-09-04", today), "2026-09-04");
  assert.strictEqual(parseDate("meet on 4/9", today), "2026-09-04", "day-first, as the studio writes");
  assert.strictEqual(parseDate("meet on 04-09-2026", today), "2026-09-04");
  assert.strictEqual(parseDate("call today", today), today);
  // The one the model got wrong.
  assert.strictEqual(parseDate("call tomorrow at 4pm", today), "2026-08-27");
  assert.strictEqual(parseDate("day after tomorrow", today), "2026-08-28");
  assert.strictEqual(parseDate("meet on friday", today), "2026-08-28", "the next Friday");
  // Said on a Wednesday, "Wednesday" means the one coming - not this morning.
  assert.strictEqual(parseDate("meet on wednesday", today), "2026-09-02");
  assert.strictEqual(parseDate("sometime soon", today), "", "nothing to go on");
});

test("times people actually type", () => {
  assert.strictEqual(parseTime("at 4pm"), "16:00");
  assert.strictEqual(parseTime("at 4:30 pm"), "16:30");
  assert.strictEqual(parseTime("11:30"), "11:30");
  assert.strictEqual(parseTime("at 9am"), "09:00");
  assert.strictEqual(parseTime("12am"), "00:00", "midnight, not noon");
  assert.strictEqual(parseTime("12pm"), "12:00", "noon, not midnight");
  // A bare hour is not guessed at - 4am in a client's calendar is worse than asking.
  assert.strictEqual(parseTime("meet at 4"), "");
});

test("addresses are copied exactly, and only real ones", () => {
  assert.deepStrictEqual(parseAttendees("mail priya.r@example.com and ramesh@corp.co.in"),
    ["priya.r@example.com", "ramesh@corp.co.in"]);
  // Never repaired into something plausible.
  assert.deepStrictEqual(parseAttendees("send to priya@exampl and bad@"), []);
  assert.deepStrictEqual(parseAttendees("a@b.com, a@b.com"), ["a@b.com"], "de-duplicated");
  assert.deepStrictEqual(parseAttendees("no addresses here"), []);
});

test("a stated length is read, and an unstated one is not invented", () => {
  assert.strictEqual(parseDuration("a 45 minute call"), 45);
  assert.strictEqual(parseDuration("45 mins"), 45);
  assert.strictEqual(parseDuration("2 hour meeting"), 120);
  assert.strictEqual(parseDuration("a call tomorrow"), null);
});

test("a whole sentence, end to end", () => {
  const proposal = toProposal({
    message: "Schedule a meeting with priya.r@example.com tomorrow at 4pm about the album review",
    lead: { name: "Priya R" },
    now: new Date("2026-08-26T09:00:00+05:30"),
  });

  assert.strictEqual(proposal.ready, true);
  // Tomorrow, not today - the exact failure that moved this out of the model.
  assert.strictEqual(proposal.request.startAt, "2026-08-27T16:00:00+05:30");
  assert.deepStrictEqual(proposal.request.attendees, ["priya.r@example.com"]);
  assert.strictEqual(proposal.request.durationMinutes, 30);
});
