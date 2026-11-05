const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { eventSchema } = require("../src/modules/hrm/events/controller");

/*
 * Posting an event needs photos and a title. The event date is gone from the form, and the
 * description is optional.
 */

const PHOTO = "data:image/jpeg;base64,/9j/4AAQ";

test("an event posts with photos and a title alone", () => {
  const parsed = eventSchema.safeParse({ title: "Annual Day", images: [PHOTO] });
  assert.equal(parsed.success, true, parsed.error?.issues?.[0]?.message);
  assert.equal(parsed.data.description, "");
  assert.equal(parsed.data.eventDate, undefined);
});

test("a description and a date are still taken when sent, and a date must be a real day", () => {
  const parsed = eventSchema.safeParse({ title: "Annual Day", description: "  A good day.  ", eventDate: "2026-09-20", images: [PHOTO] });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.description, "A good day.");
  assert.equal(eventSchema.safeParse({ title: "x", eventDate: "2026-02-31", images: [PHOTO] }).success, false);
});

test("a title is still needed", () => {
  const parsed = eventSchema.safeParse({ title: "  ", images: [PHOTO] });
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /Give the event a title/);
});

test("the form asks for no event date, and does not require a description", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "hrm", "EventsPage.js"), "utf8");
  const dialog = page.slice(page.indexOf("function UploadEventDialog("));
  assert.doesNotMatch(dialog, /Event Date|eventDate|<DateField/);
  assert.match(dialog, /<TextAreaField label="Description" (?:helperText="[^"]*" )?rows=\{5\}/);
  // Photos and a title are the two things asked for, each said under its own box on Post.
  assert.match(dialog, /images: form\.images\.length \? "" : "Add at least one photo\."/);
  assert.match(dialog, /title: isBlankText\(form\.title\) \? "Enter the event's title\." : ""/);
  assert.doesNotMatch(dialog, /description: isBlankText/);
});

test("an event's card shows no date", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "hrm", "EventsPage.js"), "utf8");
  const card = page.slice(page.indexOf("<h2 className=\"break-words text-base font-semibold text-slate-950\">"), page.indexOf("Who posted it, then View, Download and Remove"));
  assert.ok(card.length > 0, "the card was not found");
  assert.doesNotMatch(card, /eventDate|displayDay/);
});

test("the date filter is the posting day, on the studio's clock, both ends counted", () => {
  const { postedRange } = require("../src/modules/hrm/events/controller");
  // 29 Sep 2026 in Kolkata runs from 28 Sep 18:30 UTC to 29 Sep 18:30 UTC.
  const day = postedRange({ from: "2026-09-29", to: "2026-09-29" });
  assert.equal(day.gte.toISOString(), "2026-09-28T18:30:00.000Z");
  assert.equal(day.lt.toISOString(), "2026-09-29T18:30:00.000Z");
  // Either end alone; a range picked back to front; a day that is not one.
  assert.deepEqual(Object.keys(postedRange({ from: "2026-09-01" })), ["gte"]);
  assert.deepEqual(Object.keys(postedRange({ to: "2026-09-30" })), ["lt"]);
  const reversed = postedRange({ from: "2026-09-30", to: "2026-09-01" });
  assert.ok(reversed.gte < reversed.lt);
  assert.equal(postedRange({ from: "2026-02-31" }), null);
  assert.equal(postedRange({}), null);
});

test("the Events page filters with the shared date-range switch", () => {
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "hrm", "EventsPage.js"), "utf8");
  assert.match(page, /import DateRangeSwitch from "@\/components\/shared\/DateRangeSwitch";/);
  assert.match(page, /leadingActions=\{<DateRangeSwitch/);
  assert.match(page, /listEvents\(\{ from: rangeFrom, to: rangeTo \}\)/);
  assert.match(page, /No events posted in this range/);
});
