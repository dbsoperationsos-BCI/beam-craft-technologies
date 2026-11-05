import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clockMinutes, dayTimeline, entrySpan, hourLabel, minutesLabel, spanSlots } from "../src/lib/dayTimeline.mjs";

/*
 * Calendar → Day: one day hour by hour, as the Shoot Board lays out days - each booking a bar from
 * its start to its end, and what has no hour listed above as the whole day.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("a shoot runs from the start to the end the studio wrote, or for its session, or for an hour", () => {
  assert.deepEqual(entrySpan({ kind: "shoot", meta: { eventStartTime: "18:30", eventEndTime: "22:00" } }), { start: 1110, end: 1320 });
  assert.deepEqual(entrySpan({ kind: "shoot", meta: { eventStartTime: "09:00", sessionDurationHours: 2, sessionDurationMinutes: 30 } }), { start: 540, end: 690 });
  assert.deepEqual(entrySpan({ kind: "shoot", meta: { eventStartTime: "09:00" } }), { start: 540, end: 600 });
  // Past midnight: drawn to the end of the day.
  assert.deepEqual(entrySpan({ kind: "shoot", meta: { eventStartTime: "21:00", eventEndTime: "01:00" } }), { start: 1260, end: 1440 });
  // No start time: the whole day.
  assert.equal(entrySpan({ kind: "shoot", meta: { sessionTiming: "Full day" } }), null);
});

test("a meeting runs in the viewer's clock; an interview for an hour; the rest have no hour", () => {
  const start = new Date(2026, 9, 14, 10, 15).toISOString();
  const end = new Date(2026, 9, 14, 11, 0).toISOString();
  assert.deepEqual(entrySpan({ kind: "meeting", startAt: start, endAt: end }), { start: 615, end: 660 });
  assert.deepEqual(entrySpan({ kind: "meeting", startAt: start, endAt: new Date(2026, 9, 15, 1, 0).toISOString() }), { start: 615, end: 1440 });
  assert.deepEqual(entrySpan({ kind: "interview", meta: { clock24: "14:00" } }), { start: 840, end: 900 });
  for (const kind of ["holiday", "project", "attendance"]) assert.equal(entrySpan({ kind, day: "2026-10-14", meta: {} }), null);
  assert.equal(clockMinutes("25:00"), null);
});

test("the hours are the whole day, midnight to midnight; timed rows run in order", () => {
  const quiet = dayTimeline([{ id: "h", kind: "holiday" }]);
  assert.deepEqual([quiet.firstHour, quiet.hours.length, quiet.hours.at(-1)], [0, 24, 23]);
  // A holiday has no hour: it is a row across the whole day, in the timeline.
  assert.deepEqual(quiet.timed.map((row) => [row.entry.id, row.start, row.end, row.allDay]), [["h", 0, 1440, true]]);
  const busy = dayTimeline([
    { id: "late", kind: "shoot", meta: { eventStartTime: "19:00", eventEndTime: "23:30" } },
    { id: "early", kind: "interview", meta: { clock24: "06:30" } },
  ]);
  assert.deepEqual(busy.timed.map((row) => row.entry.id), ["early", "late"]);
  assert.equal(busy.hours.length, 24);
  // Five-minute columns from midnight: 6:30 to 7:30 is columns 78 to 90.
  assert.deepEqual(spanSlots(busy.timed[0], busy.firstHour), { from: 78, to: 90 });
  // And a time between quarters lands where it is: 4:25 to 4:50 is columns 197 to 202.
  assert.deepEqual(spanSlots({ start: 16 * 60 + 25, end: 16 * 60 + 50 }, 0), { from: 197, to: 202 });
  assert.equal(hourLabel(0), "12 am");
  assert.equal(hourLabel(12), "12 pm");
  assert.equal(minutesLabel(1110), "6:30 pm");
});

test("the Day period draws the timeline in place of the single day cell; week and month keep their cells", () => {
  const page = read("components", "sales", "MeetingsPage.js");
  assert.match(page, /\{period === "day" \? grid\.slice\(0, 1\)\.map\(\(cell\) => <CalendarDayTimeline/);
  assert.match(page, /onOpen=\{openEntry\}\s+tooltip=\{entryTooltip\}/);
  // The day's ⋮ sits in each hour's header, still only with what this viewer may start, and passes
  // that hour on as the start time.
  assert.match(page, /hourMenu=\{dayActions\.length > 0 \? \(hour\) => <OptionsMenu/);
  assert.match(page, /startDayAction\(action\.kind, cell\.key, `\$\{String\(hour\)\.padStart\(2, "0"\)\}:00`\)/);
  assert.match(read("components", "sales", "CalendarDayTimeline.js"), /\{hourMenu\?\.\(hour\)\}/);
  const timeline = read("components", "sales", "CalendarDayTimeline.js");
  assert.doesNotMatch(timeline, /<button|<table/);
  assert.match(timeline, /sticky left-0/);
});

test("a blocked period runs from its start to its end time, on the Day view and in a cell's lead", async () => {
  assert.deepEqual(entrySpan({ kind: "block", meta: { startTime: "14:00", endTime: "16:30" } }), { start: 840, end: 990 });
  const { scheduleEntryLead, scheduleKind } = await import("../src/lib/schedule.js");
  assert.equal(scheduleEntryLead({ kind: "block", meta: { startTime: "14:00" } }), "2:00 pm");
  assert.equal(scheduleKind("block").label, "Blocked Periods");
});

test("everything is in the timeline: Absent and a main event run across the whole day, first; a timed booking at its time", async () => {
  const day = dayTimeline([
    { id: "meet", kind: "interview", meta: { clock24: "11:00" } },
    { id: "absent", kind: "attendance", title: "Absent", meta: { status: "Absent" } },
    { id: "main", kind: "project", day: "2026-10-14", meta: {} },
  ]);
  assert.deepEqual(day.timed.map((row) => [row.entry.id, row.allDay, row.start, row.end]), [
    ["absent", true, 0, 1440],
    ["main", true, 0, 1440],
    ["meet", false, 660, 720],
  ]);
  assert.equal(day.allDay, undefined, "no separate all-day list any more");
  const timeline = read("components", "sales", "CalendarDayTimeline.js");
  assert.doesNotMatch(timeline, /All day<\/span>|allDay\.map/);
  assert.match(timeline, /const when = row\.allDay \? "All day" :/);
  // It still opens at the first booking that has an hour, not at midnight for an all-day row.
  assert.match(timeline, /const firstTimed = timed\.find\(\(row\) => !row\.allDay\);/);
});

test("a project's shoots that run into each other share a row, as on the Shoot Board; a gap keeps them apart", () => {
  const shoot = (id, project, start, end, title) => ({ id, kind: "shoot", title, subject: project, reference: id, meta: { eventStartTime: start, eventEndTime: end } });
  const day = dayTimeline([
    shoot("SID-14", "BK-9", "13:05", "19:05", "Wedding"),
    shoot("SID-15", "BK-9", "18:30", "22:05", "Reception"),
    // The same project again after a gap: a row of its own.
    shoot("SID-16", "BK-9", "22:30", "23:00", "After party"),
    // Another project at the same time: never merged with this one.
    shoot("SID-20", "BK-10", "14:00", "15:00", "Engagement"),
    // A meeting overlapping them: its own row too.
    { id: "meeting:1", kind: "meeting", title: "Call", startAt: new Date(2026, 10, 25, 18, 45).toISOString(), endAt: new Date(2026, 10, 25, 19, 0).toISOString() },
  ]);
  const rows = day.timed.map((row) => [row.entries.map((one) => one.title).join(" · "), minutesLabel(row.start), minutesLabel(row.end)]);
  assert.deepEqual(rows, [
    ["Wedding · Reception", "1:05 pm", "10:05 pm"],
    ["Engagement", "2:00 pm", "3:00 pm"],
    ["Call", "6:45 pm", "7:00 pm"],
    ["After party", "10:30 pm", "11:00 pm"],
  ]);
  // Touching is not a gap: one ending as the next starts shares the row.
  const touching = dayTimeline([shoot("A", "BK-1", "10:00", "12:00", "Haldi"), shoot("B", "BK-1", "12:00", "13:00", "Mehendi")]);
  assert.deepEqual(touching.timed.map((row) => row.entries.length), [2]);
});

test("clicking a shoot opens the Shoot Board's shoot window: the project, then each shoot as a card", async () => {
  const { shootRunOf } = await import("../src/lib/schedule.js");
  const entry = (id, title, start, end, main) => ({ id, kind: "shoot", title, reference: id, subject: "DBS-BK-9", location: "Sri Murugan Mahal, Erode", day: "2026-11-25", meta: { projectName: "WED Gold Erode TN Karthik & Divya", eventStartTime: start, eventEndTime: end, isMainEvent: main } });
  const { project, run } = shootRunOf([entry("SID-14", "Wedding", "13:05", "19:05", true), entry("SID-15", "Reception", "18:30", "22:05", false)]);
  assert.deepEqual(project, { label: "WED Gold Erode TN Karthik & Divya", eventId: "DBS-BK-9" });
  assert.deepEqual(run.shoots.map((shoot) => [shoot.shoot, shoot.shootId, shoot.isMainEvent, shoot.startTime, shoot.endTime, shoot.shootPlace, shoot.shootDate]), [
    ["Wedding", "SID-14", true, "13:05", "19:05", "Sri Murugan Mahal, Erode", "2026-11-25"],
    ["Reception", "SID-15", false, "18:30", "22:05", "Sri Murugan Mahal, Erode", "2026-11-25"],
  ]);
  const page = read("components", "sales", "MeetingsPage.js");
  assert.match(page, /if \(entry\.kind === "shoot"\) \{\s*setShootRun\(shootRunOf\(group\?\.length \? group : \[entry\]\)\);/);
  assert.match(page, /\{shootRun && <ShootRunDialog/);
  assert.match(read("components", "sales", "CalendarDayTimeline.js"), /onClick=\{\(\) => onOpen\(entry, row\.entries\)\}/);
});
