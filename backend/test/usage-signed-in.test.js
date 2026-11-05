const test = require("node:test");
const assert = require("node:assert/strict");
const { signedInSeconds, groupAuthEvents, measuredTotals } = require("../src/modules/sales/crm-reports/signedIn");
const { studioDayKey } = require("../src/services/studioDay");

/*
 * Inactive Time Track reads "signed in" from the audit log's Login and Logout lines: a Login opens
 * a session, a Logout closes it, and a session nobody closed runs to the end of the studio day -
 * 23:59:59 in Asia/Kolkata - or to now, on the day that is still going.
 */

const ist = (day, time) => new Date(`${day}T${time}+05:30`);
const DAY = "2026-10-21";
const later = ist("2026-10-25", "12:00:00");

test("a sign-in with no sign-out runs to the end of the studio day", () => {
  const seconds = signedInSeconds({ day: DAY, events: [{ action: "Login", at: ist(DAY, "09:00:00") }], now: later });
  // 09:00:00 to 23:59:59.999 is 15 hours, to the second.
  assert.equal(seconds, 15 * 3600);
});

test("a sign-in and a sign-out are the session between them", () => {
  const seconds = signedInSeconds({ day: DAY, events: [
    { action: "Logout", at: ist(DAY, "18:30:00") },
    { action: "Login", at: ist(DAY, "09:15:00") },
  ], now: later });
  assert.equal(seconds, 9 * 3600 + 15 * 60);
});

test("today's open session runs to now, not into the evening", () => {
  const now = ist(DAY, "14:00:00");
  assert.equal(signedInSeconds({ day: DAY, events: [{ action: "Login", at: ist(DAY, "10:00:00") }], now }), 4 * 3600);
});

test("two sessions in a day are added, and the hour signed out between them is not signed in", () => {
  const seconds = signedInSeconds({ day: DAY, events: [
    { action: "Login", at: ist(DAY, "09:00:00") },
    { action: "Logout", at: ist(DAY, "13:00:00") },
    { action: "Login", at: ist(DAY, "14:00:00") },
  ], now: later });
  assert.equal(seconds, 4 * 3600 + 10 * 3600);
});

test("a second sign-in while signed in does not open a second session", () => {
  const seconds = signedInSeconds({ day: DAY, events: [
    { action: "Login", at: ist(DAY, "09:00:00") },
    { action: "Login", at: ist(DAY, "11:00:00") },
    { action: "Logout", at: ist(DAY, "12:00:00") },
  ], now: later });
  assert.equal(seconds, 3 * 3600);
});

test("a day with no sign-in has nothing to read, and a stray sign-out is not a session", () => {
  assert.equal(signedInSeconds({ day: DAY, events: [], now: later }), null);
  assert.equal(signedInSeconds({ day: DAY, events: [{ action: "Logout", at: ist(DAY, "10:00:00") }], now: later }), null);
  // A failed sign-in is not a sign-in.
  assert.equal(signedInSeconds({ day: DAY, events: [{ action: "Login failed", at: ist(DAY, "10:00:00") }], now: later }), null);
});

test("lines are filed under the studio day they fall on", () => {
  // 00:30 IST on the 22nd is 19:00 UTC on the 21st; it belongs to the 22nd.
  assert.equal(studioDayKey(ist("2026-10-22", "00:30:00")), "2026-10-22");
  const grouped = groupAuthEvents([
    { employee: "A", action: "Login", at: ist("2026-10-22", "00:30:00") },
    { employee: "A", action: "Login", at: ist("2026-10-21", "09:00:00") },
    // A name is free text; one with a separator in it is still one person.
    { employee: "B|C", action: "Login", at: ist("2026-10-21", "09:00:00") },
  ]);
  assert.deepEqual([...grouped.get("A").keys()].sort(), ["2026-10-21", "2026-10-22"]);
  assert.deepEqual([...grouped.get("B|C").keys()], ["2026-10-21"]);
});

test("a day with a sign-in reads inactive as signed-in time less use; a day without falls back to the span of use", () => {
  const totals = measuredTotals({
    dayRows: [
      // Signed in 09:00, never signed out: 15h signed in, 2h used -> 13h inactive.
      { employee: "A", day: ist(DAY, "00:00:00"), seconds: 7200, sessions: 3, spanSeconds: 30000, lastLoginAt: ist(DAY, "09:00:00") },
      // No sign-in line that day: the span of use stands in. 30,000s span, 7,200s used -> 22,800s.
      { employee: "A", day: ist("2026-10-20", "00:00:00"), seconds: 7200, sessions: 2, spanSeconds: 30000, lastLoginAt: null },
    ],
    authRows: [{ employee: "A", action: "Login", at: ist(DAY, "09:00:00") }],
    now: later,
  });
  const a = totals.get("A");
  assert.equal(a.seconds, 14400);
  assert.equal(a.sessions, 5);
  assert.equal(a.inactiveSeconds, 13 * 3600 + 22800);
  assert.equal(a.lastLoginAt.getTime(), ist(DAY, "09:00:00").getTime());
});

test("a day signed in and never used is all inactive, and use beyond the signed-in time never reads as negative", () => {
  const totals = measuredTotals({
    dayRows: [{ employee: "B", day: ist(DAY, "00:00:00"), seconds: 5000, sessions: 1, spanSeconds: 5000 }],
    authRows: [
      // B: signed in 10:00 to 11:00 (3,600s) but used it for 5,000s that day - clamped to zero.
      { employee: "B", action: "Login", at: ist(DAY, "10:00:00") },
      { employee: "B", action: "Logout", at: ist(DAY, "11:00:00") },
      // C: signed in at 09:00, no use at all - 15h inactive, and a row of their own.
      { employee: "C", action: "Login", at: ist(DAY, "09:00:00") },
    ],
    now: later,
  });
  assert.equal(totals.get("B").inactiveSeconds, 0);
  assert.equal(totals.get("C").seconds, 0);
  assert.equal(totals.get("C").inactiveSeconds, 15 * 3600);
});

test("two logins under one name are one row: use adds up and the day runs over both", () => {
  const totals = measuredTotals({
    dayRows: [
      { employee: "D", day: ist(DAY, "00:00:00"), seconds: 1000, sessions: 1, spanSeconds: 4000 },
      { employee: "D", day: ist(DAY, "00:00:00"), seconds: 2000, sessions: 1, spanSeconds: 9000 },
    ],
    now: later,
  });
  assert.equal(totals.get("D").seconds, 3000);
  assert.equal(totals.get("D").inactiveSeconds, 9000 - 3000);
});
