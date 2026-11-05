import test from "node:test";
import assert from "node:assert/strict";
import { projectTabStatuses as preStatuses, shootsInTab as preShoots, shootTabStatus as preShoot } from "../src/lib/preProductionProgress.js";
import { inProjectTab, projectBoardCards, projectTabStatuses, shootsInTab, shootTabStatus } from "../src/lib/productionBoard.mjs";

const planned = { subEventDate: "2026-11-02", eventStartTime: "10:00", eventEndTime: "18:00", reportingTime: "09:00", locationAddress: "Hall" };

test("Pre Production: a project stands under every status its shoots are at, each tab showing those shoots", () => {
  const shoots = [{ id: "a", ...planned }, { id: "b", eventStartTime: "10:00", reportingTime: "09:00" }, { id: "c", shootStatus: "HOLD" }];
  assert.equal(preShoot(shoots[0]), "Planned");
  assert.equal(preShoot(shoots[1]), "Work in Progress");
  assert.equal(preShoot(shoots[2]), "Hold");
  assert.deepEqual(preStatuses(shoots), ["Planned", "Work in Progress", "Hold"]);
  assert.deepEqual(preShoots(shoots, "Planned").map((shoot) => shoot.id), ["a"]);
  assert.deepEqual(preShoots(shoots, "All").map((shoot) => shoot.id), ["a", "b", "c"]);
  // WCR is a follow-up, not a status: the shoot stands where its details put it.
  assert.equal(preShoot({ ...planned, shootStatus: "WCR" }), "Planned");
  // Set by hand on the project as a whole, that one status is the answer, with every shoot.
  const held = shoots.map((shoot) => ({ ...shoot, preProductionStatus: "HOLD" }));
  assert.deepEqual(preStatuses(held), ["Hold"]);
  assert.equal(preShoots(held, "Hold").length, 3);
});

test("Production: the same, with Execution for a shoot whose day has begun, and one Board card per status", () => {
  const shoots = [
    { id: "p", planSubmittedAt: "x", planMissing: [], currentStep: "STARTED_FROM_STUDIO" },
    { id: "w", planStarted: true },
    { id: "e", planSubmittedAt: "x", planMissing: [], currentStep: "HAPPENING_NOW" },
  ];
  assert.deepEqual(shoots.map(shootTabStatus), ["Planned", "Work in Progress", "Execution"]);
  const project = { id: "proj", projectId: "proj", status: "Execution", shoots };
  assert.deepEqual(projectTabStatuses(project), ["Planned", "Work in Progress", "Execution"]);
  assert.equal(inProjectTab(project, "Planned"), true);
  assert.equal(inProjectTab(project, "Hold"), false);
  assert.deepEqual(shootsInTab(project, "Work in Progress").map((shoot) => shoot.id), ["w"]);
  const cards = projectBoardCards([project]);
  assert.deepEqual(cards.map((card) => [card.id, card.boardStatus, card.shoots.length, card.projectId]), [
    ["proj:Planned", "Planned", 1, "proj"], ["proj:Work in Progress", "Work in Progress", 1, "proj"], ["proj:Execution", "Execution", 1, "proj"],
  ]);
  // A status set on the project by hand keeps it whole.
  const handSet = { ...project, status: "Hold", shoots: shoots.map((shoot) => ({ ...shoot, productionStatus: "HOLD" })) };
  assert.deepEqual(projectTabStatuses(handSet), ["Hold"]);
  assert.equal(shootsInTab(handSet, "Hold").length, 3);
});
