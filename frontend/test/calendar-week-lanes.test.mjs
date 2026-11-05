import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { weekLanes } from "../src/lib/weekLanes.mjs";
import { periodCells, scheduleByDay } from "../src/lib/schedule.js";

/*
 * Calendar → Week, laid out as the Shoot Board: a project's shoots on days one after another are one
 * bar on one line; a gap day ends the run; everything else is a bar of one day; no two bars share a
 * line over the same day.
 */

const days = periodCells("week", new Date(2026, 9, 16)); // Mon 12 - Sun 18 Oct 2026
const shoot = (id, project, day, title) => ({ id, kind: "shoot", title, subject: project, reference: id, day, location: "Erode", meta: {} });
const lines = (entries) => {
  const { spans, lanes } = weekLanes(days, scheduleByDay(entries));
  return { lanes, spans: spans.map((span) => [span.entries.map((entry) => entry.title).join(" · "), days[span.start].key.slice(8), days[span.end].key.slice(8), span.lane]) };
};

test("a project's shoots on days one after another are one bar on one line - Reception on the 16th, Wedding on the 17th", () => {
  const { spans } = lines([
    shoot("SID-20", "BK-12", "2026-10-16", "Reception"),
    shoot("SID-21", "BK-12", "2026-10-17", "Wedding"),
    shoot("SID-16", "BK-10", "2026-10-17", "Haldi"),
    shoot("SID-17", "BK-10", "2026-10-17", "Mehendi"),
    shoot("SID-18", "BK-11", "2026-10-17", "Engagement"),
    shoot("SID-19", "BK-11", "2026-10-17", "Reception"),
  ]);
  assert.deepEqual(spans, [
    ["Reception · Wedding", "16", "17", 0],
    ["Haldi · Mehendi", "17", "17", 1],
    ["Engagement · Reception", "17", "17", 2],
  ]);
});

test("a day with no shoot of the project ends its run; other bookings are a day each; a free line is reused", () => {
  const { spans, lanes } = lines([
    shoot("A", "BK-1", "2026-10-12", "Haldi"),
    shoot("B", "BK-1", "2026-10-14", "Wedding"),
    { id: "m1", kind: "meeting", title: "Call", startAt: new Date(2026, 9, 13, 10).toISOString(), endAt: new Date(2026, 9, 13, 11).toISOString() },
    { id: "h1", kind: "holiday", title: "Holiday", day: "2026-10-15" },
  ]);
  assert.deepEqual(spans, [["Haldi", "12", "12", 0], ["Call", "13", "13", 0], ["Wedding", "14", "14", 0], ["Holiday", "15", "15", 0]]);
  assert.equal(lanes, 1);
});

test("the Week view draws the bars; Month keeps its day boxes", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "MeetingsPage.js"), "utf8");
  assert.match(page, /\{period === "week" \? <CalendarWeekLanes\s+days=\{grid\}\s+byDay=\{byDay\}/);
  const view = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CalendarWeekLanes.js"), "utf8");
  assert.match(view, /style=\{\{ gridColumn: `\$\{span\.start \+ 1\} \/ \$\{span\.end \+ 2\}`, gridRow: span\.lane \+ 1 \}\}/);
  assert.match(view, /onClick=\{\(\) => onOpen\(first, span\.entries\)\}/);
  assert.doesNotMatch(view, /<button/);
});
