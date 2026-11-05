import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PROJECT_TABS, executionStarted, followupDue, inProjectTab, planPhaseStatus, planStatusChange, productionProjects, projectProductionLabel, projectProductionStatus, shootProductionStatus, shootStatusLabel, shootsInOrder, shootStepProgress } from "../src/lib/productionBoard.mjs";
import { PRODUCTION_STEPS } from "../src/lib/productionSteps.mjs";

const shoot = (overrides) => ({ projectId: "p1", eventId: "EV1", clientName: "Anu", shootDate: "2099-01-02T00:00:00.000Z", planSubmittedAt: "x", currentStep: "PINEAPPLE_MEETING", ...overrides });

test("a shoot's Production status: the plan's phase, then the shoot day's, then done", () => {
  assert.equal(shootProductionStatus({ planSubmittedAt: null, planStarted: false, currentStep: "STARTED_FROM_STUDIO" }), "Yet to Start");
  assert.equal(shootProductionStatus({ planSubmittedAt: null, planStarted: true, currentStep: "STARTED_FROM_STUDIO" }), "Work in Progress");
  // A shoot never reads Planned once its day has a step: that is the plan's own word, and the day
  // says what is being done instead (named below).
  assert.notEqual(shootProductionStatus({ planSubmittedAt: "x", currentStep: "PINEAPPLE_MEETING" }), "Planned", "a shoot has no Planned");
  // The day's own status, named by what is done: the crew has left, arrived, or is shooting.
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "REACHED_SHOOT_PLACE" }), "Travelling");
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "PINEAPPLE_MEETING" }), "Setting up");
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "HAPPENING_NOW" }), "Shoot in progress");
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "HAPPY_CLIENTS" }), "Shoot in progress");
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "HAPPENING_NOW", shootStatus: "PAUSED" }), "Paused");
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "PHOTO_COPY" }), "File in pending");
  // A shoot left standing on a step nobody works any more is as far as File in, as the server reads it.
  for (const retired of ["SHOOT_STATUS", "STARTED_FROM_VENUE", "REACHED_STUDIO"]) {
    assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: retired }), "File in pending", retired);
  }
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "DONE" }), "Shoot completed");
  // An indoor shoot has neither travel status, and its first step is nothing done yet.
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", planMissing: [], indoor: true, currentStep: "SHOOT_STARTED" }), "Planned");
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", indoor: true, currentStep: "HAPPENING_NOW" }), "Shoot in progress");
});

test("the plan's Hold and Rejected are the only ones left; the shoot day has none of its own", () => {
  assert.equal(shootProductionStatus({ planStatus: "HOLD", currentStep: "HAPPENING_NOW" }), "Hold");
  assert.equal(shootProductionStatus({ planStatus: "REJECTED", currentStep: "PINEAPPLE_MEETING" }), "Rejected");
  // Nobody pauses, holds or rejects the shoot day any more, so a status left on an older record
  // never speaks for the shoot - the step it is on does.
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "HAPPENING_NOW", shootStatus: "HOLD" }), "Shoot in progress");
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "SHOOT_STATUS", shootStatus: "REJECT" }), "File in pending");
  // A status left where the shoot cannot be paused is not read as a stop either.
  assert.equal(shootProductionStatus({ planSubmittedAt: "x", currentStep: "PINEAPPLE_MEETING", shootStatus: "PAUSED" }), "Setting up");
});

test("a project's production status: Yet to Start, Execution with its percentage, Completed", () => {
  const untouched = { planSubmittedAt: null, planStarted: false, currentStep: "STARTED_FROM_STUDIO" };
  assert.equal(projectProductionStatus([untouched, untouched]), "Yet to Start");
  assert.equal(projectProductionStatus([shoot({ currentStep: "DONE" }), shoot({ currentStep: "DONE" })]), "Completed", "every shoot Shoot completed is the project Completed");
  assert.equal(projectProductionStatus([shoot({ currentStep: "DONE" }), untouched]), "Execution", "one shoot done, more to come");
  assert.equal(projectProductionLabel([shoot({ currentStep: "SHOOT_STARTED" }), shoot({ currentStep: "DONE" })], PRODUCTION_STEPS), "Execution (72%)");
  assert.equal(projectProductionLabel([untouched], PRODUCTION_STEPS), "Yet to Start");
});

test("shoots fold into one row per project, in the order they happen", () => {
  const rows = [
    shoot({ shootId: "S2", shootDate: "2099-01-05T00:00:00.000Z" }),
    shoot({ shootId: "S1", shootDate: "2099-01-03T00:00:00.000Z", currentStep: "DONE" }),
    shoot({ projectId: "p2", eventId: "EV2", shootId: "X1" }),
  ];
  const projects = productionProjects(rows);
  assert.equal(projects.length, 2);
  assert.deepEqual(projects[0].shoots.map((row) => row.shootId), ["S1", "S2"]);
  assert.equal(projects[0].shootsDone, "1/2 Done");
  assert.equal(projects[0].nextShootDate, "2099-01-05T00:00:00.000Z", "the next shoot not yet done");
  assert.equal(projects[0].status, "Execution");
  assert.deepEqual(shootsInOrder([shoot({ shootId: "a" }), shoot({ shootId: "b", isMainEvent: true })]).map((row) => row.shootId), ["b", "a"]);
});

test("a shoot's tile says how far through its own steps it is - four for an indoor shoot", () => {
  // Before it is Planned the tile counts the plan's own parts.
  assert.deepEqual(shootStepProgress({ planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO" }, PRODUCTION_STEPS), { done: 0, total: 0, percent: 0, text: "Plan pending", phase: "plan" });
  assert.deepEqual(shootStepProgress({ planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO", planProgress: { filled: 3, total: 7, percent: 43 } }, PRODUCTION_STEPS), { done: 3, total: 7, percent: 43, text: "4 details pending", phase: "plan" });
  assert.equal(shootStepProgress({ planSubmittedAt: "x", currentStep: "STARTED_FROM_STUDIO", planMissing: ["Travel Mode"], planProgress: { filled: 6, total: 7, percent: 86 } }, PRODUCTION_STEPS).text, "1 detail pending", "submitted short: still the plan's");
  assert.equal(shootStepProgress({ planSubmittedAt: null, planProgress: { filled: 7, total: 7, percent: 100 } }, PRODUCTION_STEPS).text, "Plan filled - submit it");
  // Planned, the day's steps.
  assert.equal(shootStepProgress({ planSubmittedAt: "x", currentStep: "STARTED_FROM_STUDIO", planMissing: [] }, PRODUCTION_STEPS).text, "Next: Started to shoot");
  assert.deepEqual(shootStepProgress({ planSubmittedAt: "x", currentStep: "SHOOT_STARTED" }, PRODUCTION_STEPS), { done: 3, total: 7, percent: 43, text: "Next: Shoot started" });
  assert.deepEqual(shootStepProgress({ planSubmittedAt: "x", currentStep: "HAPPENING_NOW", indoor: true }, PRODUCTION_STEPS), { done: 1, total: 4, percent: 25, text: "Next: Happening now" });
  assert.equal(shootStepProgress({ planSubmittedAt: "x", currentStep: "DONE" }, PRODUCTION_STEPS).percent, 100);
});

test("the plan's status saved with the plan: nothing when unchanged, Hold and Rejected need remarks", () => {
  assert.equal(planPhaseStatus({ planSubmittedAt: null, planStarted: true }), "Work in Progress");
  assert.equal(planStatusChange({}, { choice: "AUTO" }).change, null);
  assert.match(planStatusChange({}, { choice: "HOLD", remarks: " " }).problem, /remarks for Hold/);
  assert.deepEqual(planStatusChange({}, { choice: "REJECTED", remarks: "Cancelled" }).change, { status: "REJECTED", remarks: "Cancelled" });
  assert.deepEqual(planStatusChange({ planStatus: "HOLD", planStatusRemarks: "x" }, { choice: "AUTO" }).change, { status: null, remarks: null });
});

test("one held shoot holds the project's production; Rejected stays the shoot's; the project's own status changes nothing", () => {
  const wip = { planSubmittedAt: "2026-10-01", currentStep: "HAPPENING_NOW" };
  assert.equal(projectProductionStatus([wip, { planStatus: "HOLD" }]), "Hold");
  assert.equal(projectProductionStatus([wip, { planStatus: "REJECTED" }]), "Execution");
  assert.equal(projectProductionLabel([{ planStatus: "HOLD" }], PRODUCTION_STEPS), "Hold");
  const delivered = [{ projectStatus: "Delivered", planStatus: "HOLD" }, { projectStatus: "Delivered", currentStep: "DONE" }];
  assert.equal(projectProductionStatus(delivered), "Hold", "Delivered does not finish production - the shoots say where it is");
  assert.equal(shootProductionStatus(delivered[0]), "Hold");
  assert.equal(projectProductionStatus([{ projectStatus: "On Hold", ...wip }]), "Execution");
  assert.equal(projectProductionStatus([{ projectStatus: "Rejected", ...wip }]), "Execution");
});

test("a submitted plan with nothing yet done on the day is Planned - automatically, shoot and project", () => {
  assert.equal(shootProductionStatus({ planSubmittedAt: "2026-10-01", currentStep: "STARTED_FROM_STUDIO" }), "Planned");
  assert.equal(shootProductionStatus({ planSubmittedAt: "2026-10-01", currentStep: "SHOOT_STARTED", indoor: true }), "Planned", "an indoor shoot starts at Shoot started - no pineapple meeting");
  // The day has begun, so it is no longer Planned - and it says which part of the day it is in.
  assert.equal(shootProductionStatus({ planSubmittedAt: "2026-10-01", currentStep: "REACHED_SHOOT_PLACE" }), "Travelling", "the day has begun");
  assert.equal(shootProductionStatus({ planStarted: true, currentStep: "STARTED_FROM_STUDIO" }), "Work in Progress", "on the plan, not submitted");
  assert.equal(shootProductionStatus({ planSubmittedAt: "2026-10-01", planStatus: "HOLD" }), "Hold");
  assert.equal(planPhaseStatus({ planSubmittedAt: "2026-10-01" }), "Planned");
  const planned = { planSubmittedAt: "2026-10-01", currentStep: "STARTED_FROM_STUDIO" };
  assert.equal(projectProductionStatus([planned, planned]), "Planned");
  assert.equal(projectProductionStatus([planned, { planStarted: true }]), "Work in Progress");
  assert.equal(projectProductionLabel([planned], PRODUCTION_STEPS), "Planned");
});

test("a submitted plan still lacking a part stays Work in Progress, and says what it lacks", () => {
  const submitted = { planSubmittedAt: "2026-10-01", currentStep: "STARTED_FROM_STUDIO" };
  assert.equal(shootProductionStatus({ ...submitted, planMissing: ["Production Team"] }), "Work in Progress");
  assert.equal(planPhaseStatus({ ...submitted, planMissing: ["Candid Photo - Camera"] }), "Work in Progress");
  assert.equal(shootProductionStatus({ ...submitted, planMissing: [] }), "Planned");
  const field = fs.readFileSync(new URL("../src/components/project-management/production/ProductionPlanStatusField.js", import.meta.url), "utf8");
  assert.match(field, /Still to fill before it reads Planned: \{detail\.planMissing\.join\(", "\)\}/);
});

test("WCR on the plan, as in Pre Production: remarks and the Next Followup Date, shown on the shoot", () => {
  const today = "2026-10-14";
  assert.match(planStatusChange({}, { choice: "WCR", remarks: "", followupDate: "2026-10-20" }, today).problem, /remarks for WCR/);
  assert.equal(planStatusChange({}, { choice: "WCR", remarks: "Venue pending" }, today).problem, "Choose the Next Followup Date.");
  assert.match(planStatusChange({}, { choice: "WCR", remarks: "Venue pending", followupDate: "2026-10-01" }, today).problem, /cannot be in the past/);
  assert.deepEqual(planStatusChange({}, { choice: "WCR", remarks: "Venue pending", followupDate: "2026-10-20" }, today).change, { status: "WCR", remarks: "Venue pending", followupDate: "2026-10-20" });
  // Unchanged is no write; Hold sends no date.
  assert.equal(planStatusChange({ planStatus: "WCR", planStatusRemarks: "Venue pending", planFollowupDate: "2026-10-20" }, { choice: "WCR", remarks: "Venue pending", followupDate: "2026-10-20" }, today).change, null);
  assert.deepEqual(planStatusChange({}, { choice: "HOLD", remarks: "Postponed", followupDate: "2026-10-20" }, today).change, { status: "HOLD", remarks: "Postponed" });
  assert.equal(shootProductionStatus({ planStatus: "WCR", planSubmittedAt: "x" }), "WCR");
  assert.equal(shootStatusLabel({ planStatus: "WCR", planFollowupDate: "2026-10-20" }), "WCR · follow up 20 Oct 2026");
  const field = fs.readFileSync(new URL("../src/components/project-management/production/ProductionPlanStatusField.js", import.meta.url), "utf8");
  assert.match(field, /current\.choice === "WCR" && <DateField label="Next Followup Date" required/);
});

test("the Follow-up tab lists a project only once its follow-up is due - today or past, never ahead", () => {
  const today = "2026-10-16";
  const onWcr = (planFollowupDate) => ({ status: "Work in Progress", shoots: [{ planStatus: "WCR", planFollowupDate }, {}] });
  assert.equal(inProjectTab(onWcr("2026-10-16"), "Follow-up", today), true, "due today");
  assert.equal(inProjectTab(onWcr("2026-10-15"), "Follow-up", today), true, "overdue");
  assert.equal(inProjectTab(onWcr("2026-10-17"), "Follow-up", today), false, "tomorrow waits");
  assert.equal(inProjectTab(onWcr("2026-10-16"), "Work in Progress", today), true, "and still under its own status");
  assert.equal(inProjectTab({ status: "Planned", shoots: [{ planFollowupDate: "2026-10-01" }] }, "Follow-up", today), false, "only a shoot on WCR");
  assert.ok(PROJECT_TABS.includes("Follow-up"));
  assert.equal(followupDue("2026-10-16T00:00:00.000Z", today), true, "an ISO date reads as its stored day");
  assert.equal(followupDue(null, today), false);
  const page = fs.readFileSync(new URL("../src/components/project-management/PreProductionPage.js", import.meta.url), "utf8");
  // On Pre Production a WCR date joins the project's follow-ups, so the earliest pending one decides.
  assert.match(page, /if \(tab === "Follow-up"\) return followupDue\(project\.nextFollowupDate\);/);
});

test("a project whose shoot day has begun is in Execution, with its own tab, until every shoot is Completed", () => {
  const planned = { planSubmittedAt: "2026-10-01", currentStep: "STARTED_FROM_STUDIO" };
  const onTheRoad = { planSubmittedAt: "2026-10-01", currentStep: "REACHED_SHOOT_PLACE" };
  assert.equal(executionStarted(planned), false, "nothing done on the day");
  assert.equal(executionStarted({ ...planned, currentStep: "SHOOT_STARTED", indoor: true }), false, "an indoor shoot starts at Shoot started - no pineapple meeting");
  assert.equal(executionStarted(onTheRoad), true);
  assert.equal(projectProductionStatus([planned, planned]), "Planned");
  assert.equal(projectProductionStatus([onTheRoad, planned]), "Execution");
  assert.equal(projectProductionStatus([{ ...onTheRoad, currentStep: "SHOOT_STATUS", shootStatus: "PAUSED" }]), "Execution", "a shoot left on a retired step is still on");
  assert.equal(projectProductionStatus([onTheRoad, { planStatus: "HOLD" }]), "Hold", "a hold still comes first");
  assert.equal(projectProductionStatus([{ ...onTheRoad, currentStep: "DONE" }]), "Completed");
  assert.equal(projectProductionStatus([{ ...onTheRoad, productionStatus: "PLANNED" }]), "Planned", "a status set by hand still wins");
  assert.ok(PROJECT_TABS.indexOf("Execution") === PROJECT_TABS.indexOf("Planned") + 1);
  assert.equal(inProjectTab({ status: "Execution", shoots: [] }, "Execution"), true);
});
