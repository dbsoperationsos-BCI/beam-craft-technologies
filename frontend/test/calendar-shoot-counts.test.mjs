import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { monthShootCounts, scheduleEntryCell, shootsByProject } from "../src/lib/schedule.js";

/*
 * A month day's shoots as one "Shoots · N" chip, opening to its projects (with each one's count),
 * then a project's shoots, then a shoot's form on the board it is worked on now.
 */

const shoot = (id, project, extra = {}) => ({ id: `shoot:${id}`, kind: "shoot", title: id, reference: `SID-${id}`, day: "2026-10-20", subject: project, meta: { projectName: `${project} name`, shootRecordId: id, stage: "pre-production" }, ...extra });
const meeting = { id: "meeting:1", kind: "meeting", title: "Call", day: "2026-10-20" };
const holiday = { id: "holiday:1", kind: "holiday", title: "Diwali", day: "2026-10-20" };

test("a month day's shoots become one count chip where the first shoot was", () => {
  const shoots = [shoot("a", "EV1"), shoot("b", "EV2"), shoot("c", "EV1")];
  const day = monthShootCounts([holiday, shoots[0], meeting, shoots[1], shoots[2]]);
  assert.deepEqual(day.map((entry) => entry.kind), ["holiday", "shootCount", "meeting"]);
  assert.equal(day[1].title, "Shoots · 3");
  assert.deepEqual(day[1].meta.shoots, shoots);
  assert.match(scheduleEntryCell(day[1]), /amber/, "the shoots' own colour");
  assert.deepEqual(monthShootCounts([meeting]), [meeting], "a day with no shoots is untouched");
});

test("the pop-up's first list is the projects, each with its shoots in order", () => {
  const projects = shootsByProject([shoot("a", "EV1"), shoot("b", "EV2"), shoot("c", "EV1")]);
  assert.deepEqual(projects.map((project) => [project.eventId, project.name, project.shoots.map((entry) => entry.title)]), [["EV1", "EV1 name", ["a", "c"]], ["EV2", "EV2 name", ["b"]]]);
});

test("the calendar draws the count on Month only, and a shoot opens on Projects", () => {
  const page = fs.readFileSync(new URL("../src/components/sales/MeetingsPage.js", import.meta.url), "utf8");
  assert.match(page, /const dayEntries = monthShootCounts\(byDay\.get\(cell\.key\) \|\| \[\]\);/);
  // Whatever board the shoot is on now, a press goes to Projects on that shoot; the ⋮ goes anywhere else.
  assert.match(page, /if \(canOpenProjects && \(shoot\.subject \|\| shoot\.reference\)\) return openOnProjects\(shoot\.subject, shoot\.reference\);/);
  assert.equal(/stage === "production"|ProductionShootPanel/.test(page), false);
  for (const board of ["PreProductionPage.js", "production/ProductionPage.js"]) {
    const source = fs.readFileSync(new URL(`../src/components/project-management/${board}`, import.meta.url), "utf8");
    assert.match(source, /useLinkedParam\("shoot"\)/, `${board} opens a linked shoot`);
  }
});

test("the pop-up draws the Shoot Board's own cards, a project card first", () => {
  const dialog = fs.readFileSync(new URL("../src/components/sales/CalendarShootsDialog.js", import.meta.url), "utf8");
  assert.match(dialog, /<ShootBoardCard key=\{card\.id\} shoot=\{card\} colour=\{project\.colour\} onOpen=\{\(\) => onOpenShoot\(shoot\)\} menuItems=\{menuFor\?\.\(card\) \|\| \[\]\} \/>/);
  assert.match(dialog, /<ShootProjectCard/);
});
