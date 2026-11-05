import test from "node:test";
import assert from "node:assert/strict";
import { permittedSources, sourceScheduleEntries } from "../src/lib/meetingSources.js";

/*
 * A crew member - Production and Shoot Board, none of Projects, Pre Production, Post Production or
 * Sales Manager - sees on the calendar the shoots they are named on, as the Shoot Board shows them.
 * The server already narrowed the shoots it sent to theirs; All used to drop every one, because it
 * asked for a project source the crew member does not hold.
 */
const holds = (granted) => ({ module, feature }) => granted.includes(`${module}/${feature}`);
const crew = permittedSources(holds(["PROJECT/Production", "PROJECT/Shoot Board", "HRM/Employee Attendance"])).map((entry) => entry.value);
const shoot = { id: "shoot-1", kind: "shoot", day: "2026-10-29", reference: "DBS-SID-1" };
const holiday = { id: "holiday-1", kind: "holiday", day: "2026-10-30" };

test("a crew member holds no project source, and still sees the shoots the server sent on All", () => {
  assert.ok(!crew.some((value) => ["projects", "pre-production", "post-production"].includes(value)));
  assert.deepEqual(sourceScheduleEntries("all", [shoot, holiday], { sources: crew }).map((entry) => entry.id).sort(), ["holiday-1", "shoot-1"]);
});

test("whoever holds a project source still sees shoots on All, as before", () => {
  assert.deepEqual(sourceScheduleEntries("all", [shoot], { sources: ["projects"] }).map((entry) => entry.id), ["shoot-1"]);
});
