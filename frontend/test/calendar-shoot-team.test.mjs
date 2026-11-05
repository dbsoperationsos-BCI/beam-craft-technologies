import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { shootRunOf } from "../src/lib/schedule.js";

/*
 * A shoot opened from the calendar says who is going.
 *
 * The window the diary opens is the Shoot Board's own card, which has always drawn the Production
 * Coordinator, the Production Team and each service with its person - and showed none of them here,
 * because the calendar's feed never read them. So the diary could say where a shoot was and when,
 * and nothing about who was on it, which is the first thing anybody opens it to find out.
 */
const entry = (meta) => ({ id: "shoot:1", title: "Reception", reference: "DBS-SID-1", day: "2026-11-12", subject: "DBS-EV-1", location: "Hall A", meta });

test("the card is given the coordinator, the team and each service's people", () => {
  const { run } = shootRunOf([entry({
    projectName: "Asha weds Arun",
    coordinator: "Sneha Iyer",
    team: ["Arun Prakash", "Divya Ramesh"],
    crew: [{ service: "Candid Photo", person: "Karthik Subramanian", assistants: ["Anitha Selvam"] }],
  })]);
  const [card] = run.shoots;
  assert.equal(card.coordinator, "Sneha Iyer");
  assert.deepEqual(card.team, ["Arun Prakash", "Divya Ramesh"]);
  assert.deepEqual(card.crew, [{ service: "Candid Photo", person: "Karthik Subramanian", assistants: ["Anitha Selvam"] }]);
});

test("a shoot with no production raised yet says nothing rather than empty headings", () => {
  const [card] = shootRunOf([entry({})]).run.shoots;
  assert.equal(card.coordinator, null);
  assert.deepEqual(card.team, []);
  assert.deepEqual(card.crew, []);
});

test("one shape for both screens: the board and the calendar read the same helper", () => {
  const service = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "src", "services", "productionTeam.js"), "utf8");
  assert.match(service, /const productionTeam = \(production, handed = null/);
  for (const file of ["modules/project-management/shoot-board/read.js", "modules/schedule/calendar/service.js"]) {
    const source = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "backend", "src", file), "utf8");
    assert.match(source, /PRODUCTION_TEAM_SELECT/, file);
    assert.match(source, /productionTeam\(/, file);
  }
});
