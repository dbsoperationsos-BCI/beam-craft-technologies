import test from "node:test";
import assert from "node:assert/strict";
import { CREW_TABS, PROJECT_TABS, boardForViewer, boardStatuses, crewSeesShoot, projectBoardCards, projectTabStatuses } from "../src/lib/productionBoard.mjs";

/*
 * Production's status bar: whoever runs a project - its Production Manager, Project Manager or
 * Coordinator, an administrator, a Super Admin, Show All Projects - sees it at every status. Somebody
 * only on its crew sees it only from Planned on: Planned, Execution, Hold, Rejected, Completed - and
 * somebody who runs no project at all is offered only those tabs.
 */

// A lead (Production / Project Manager, or a senior role) manages it too; a Coordinator only manages it.
const project = (status, viewerManages, viewerLeads = viewerManages) => ({ projectId: `${status}-${viewerManages}`, status, viewerManages, viewerLeads, shoots: [] });

test("crew only: the five statuses from Planned on, and only their tabs", () => {
  const board = boardForViewer(["Yet to Start", "Work in Progress", "Planned", "Execution", "Hold", "Rejected", "Completed"].map((status) => project(status, false)));
  assert.deepEqual(board.projects.map((row) => row.status), ["Planned", "Execution", "Hold", "Rejected", "Completed"]);
  assert.deepEqual(board.tabs, CREW_TABS);
  assert.deepEqual(CREW_TABS, ["All", "Planned", "Execution", "Hold", "Rejected", "Completed"]);
});

test("whoever runs a project sees it at every status, and every tab", () => {
  const board = boardForViewer([project("Yet to Start", true), project("Work in Progress", true)]);
  assert.equal(board.projects.length, 2);
  assert.deepEqual(board.tabs, PROJECT_TABS);
});

test("running one project and crewing another: the one run at every status, the other from Planned on", () => {
  const board = boardForViewer([project("Yet to Start", true), project("Yet to Start", false), project("Execution", false)]);
  assert.deepEqual(board.projects.map((row) => row.projectId), ["Yet to Start-true", "Execution-false"]);
  assert.deepEqual(board.tabs, PROJECT_TABS);
});

test("a Coordinator lists their own project at every status, but is offered only the crew's tabs", () => {
  const board = boardForViewer([project("Work in Progress", true, false), project("Yet to Start", false), project("Execution", false)]);
  assert.deepEqual(board.projects.map((row) => row.projectId), ["Work in Progress-true", "Execution-false"], "their project under All, whatever its status");
  assert.deepEqual(board.tabs, CREW_TABS, "the full status bar is the leads'");
});

// A shoot whose plan is submitted and complete reads Planned (`shootProductionStatus`); one not yet submitted, Work in Progress.
const planned = (id, viewerOnShoot) => ({ shootId: id, viewerOnShoot, planSubmittedAt: "2026-10-30", planStarted: true, currentStep: null, travelMode: "OWN", productionCoordinator: "X" });
const planning = (id, viewerOnShoot) => ({ shootId: id, viewerOnShoot, planStarted: true });

test("crew see a shoot of theirs once it is planned, before the rest of the project is", () => {
  const shoots = [planned("mine-planned", true), planning("mine-planning", true), planned("theirs-planned", false), planning("theirs", false)];
  const board = boardForViewer([{ projectId: "P", status: "Work in Progress", viewerManages: false, viewerLeads: false, shoots }]);
  assert.equal(board.projects.length, 1, "the project is listed");
  assert.equal(board.projects[0].status, "Planned", "under Planned, read from the shoots they are shown");
  assert.deepEqual(board.projects[0].shoots.map((shoot) => shoot.shootId).filter((id) => crewSeesShoot(shoots.find((s) => s.shootId === id))), board.projects[0].shoots.map((shoot) => shoot.shootId), "only shoots the crew member may see");
  assert.equal(board.projects[0].shoots.some((shoot) => shoot.shootId === "theirs-planned"), false, "not somebody else's shoot");
  assert.equal(board.projects[0].shoots.some((shoot) => shoot.shootId === "mine-planning"), false, "not one of theirs still being planned");
  assert.equal(boardForViewer([{ projectId: "Q", status: "Work in Progress", viewerManages: false, shoots: [planning("mine", true)] }]).projects.length, 0, "nothing planned of theirs: not listed");
});

const rejected = (id, viewerOnShoot) => ({ shootId: id, viewerOnShoot, planStatus: "REJECTED", planStarted: true });

test("crew: a Rejected shoot stands under Rejected and leaves a Planned one beside it Planned", () => {
  const board = boardForViewer([{ projectId: "P", status: "Work in Progress", viewerManages: false, viewerLeads: false, shoots: [planned("a", true), rejected("b", true)] }]);
  assert.equal(board.projects[0].status, "Planned", "not Work in Progress");
  assert.deepEqual(projectTabStatuses(board.projects[0]), ["Planned", "Rejected"], "under both tabs, as the table lists it");
  const onlyRejected = boardForViewer([{ projectId: "Q", status: "Work in Progress", viewerManages: false, viewerLeads: false, shoots: [rejected("c", true)] }]);
  assert.equal(onlyRejected.projects[0].status, "Rejected", "every shoot they are shown Rejected: the project is");
});

test("the Board has a column for every project the table lists - a Coordinator's own one before Planned too", () => {
  const coordinated = { projectId: "C", status: "Yet to Start", viewerManages: true, viewerLeads: false, shoots: [{ shootId: "s1", viewerOnShoot: false }] };
  const working = { projectId: "W", status: "Work in Progress", viewerManages: true, viewerLeads: false, shoots: [planning("s2", false)] };
  const crewed = { projectId: "X", status: "Planned", viewerManages: false, viewerLeads: false, shoots: [planned("s3", true)] };
  const board = boardForViewer([coordinated, working, crewed]);
  assert.deepEqual(board.tabs, CREW_TABS, "the tabs stay the crew's");
  const cards = projectBoardCards(board.projects);
  const columns = boardStatuses(board.tabs, cards);
  for (const card of cards) assert.ok(columns.includes(card.boardStatus), `${card.projectId} has its ${card.boardStatus} column`);
  assert.deepEqual(columns, ["Planned", "Execution", "Hold", "Rejected", "Completed", "Yet to Start", "Work in Progress"]);
  assert.deepEqual(boardStatuses(PROJECT_TABS, []), ["Yet to Start", "Work in Progress", "Planned", "Execution", "Hold", "Rejected", "Completed"], "never All or Follow-up");
});
