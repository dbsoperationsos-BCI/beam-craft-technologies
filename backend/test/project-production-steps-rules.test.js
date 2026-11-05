const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/modules/project-management/production/steps");

const submitted = (overrides = {}) => ({ planSubmittedAt: new Date(), currentStep: "STARTED_FROM_STUDIO", shootStatus: null, ...overrides });

test("the seven steps run in one order and end in DONE", () => {
  assert.deepEqual(S.STEPS, [
    "STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_MEETING", "SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS",
    "PHOTO_COPY",
  ]);
  assert.equal(S.nextStep("SHOOT_STARTED"), "HAPPENING_NOW");
  // Happy clients ends the shoot; the footage is the one thing after it.
  assert.equal(S.nextStep("HAPPY_CLIENTS"), "PHOTO_COPY");
  assert.equal(S.nextStep("STARTED_FROM_STUDIO"), "REACHED_SHOOT_PLACE");
  assert.equal(S.nextStep("PHOTO_COPY"), S.DONE);
  assert.equal(S.nextStep("NOT_A_STEP"), null);
  assert.equal(S.nextStep("SHOOT_STATUS"), null, "a step nobody works is no step at all");
  assert.equal(S.stepIndex(S.DONE), 7);
});

test("a shoot left on the shoot status or the trip back reads as being on File in", () => {
  for (const retired of ["SHOOT_STATUS", "STARTED_FROM_VENUE", "REACHED_STUDIO"]) {
    assert.ok(S.RETIRED_STEPS.has(retired));
    assert.equal(S.effectiveStep(retired, false), "PHOTO_COPY", retired);
    assert.equal(S.effectiveStep(retired, true), "PHOTO_COPY", retired);
    assert.equal(S.stepIndex(retired), 6);
  }
  // And one standing on an indoor shoot's missing travel step still reads forward as it always did.
  assert.equal(S.effectiveStep("STARTED_FROM_STUDIO", true), "SHOOT_STARTED");
});

test("Happy clients is the step that stamps the shoot Completed", () => {
  assert.equal(S.COMPLETES_SHOOT, "HAPPY_CLIENTS");
  assert.equal(S.COMPLETED_STATUS, "COMPLETED");
  // Nothing hands anybody a status to choose any more: pausing is the one thing left, and it is a
  // switch across the step the shoot is on, not a place in the order.
  assert.equal(S.statusChoices, undefined);
  assert.equal(S.RESUME_STEP, undefined);
});

test("the shoot can be paused from Shoot started being done until Happy clients ends it", () => {
  const at = (overrides) => ({ planSubmittedAt: new Date(), shootStatus: null, ...overrides });
  // Before the shoot has started there is nothing to stop, and it says what has to happen first.
  for (const step of ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE", "PINEAPPLE_MEETING", "SHOOT_STARTED"]) {
    assert.match(S.pauseRefusal(at({ currentStep: step }), true), /paused once "Shoot started" is done/, step);
  }
  assert.equal(S.pauseRefusal(at({ currentStep: "HAPPENING_NOW" }), true), null);
  assert.equal(S.pauseRefusal(at({ currentStep: "HAPPY_CLIENTS" }), true), null);
  // After it, the shoot is over and a copy being made is not a shoot stopping.
  assert.match(S.pauseRefusal(at({ currentStep: "PHOTO_COPY" }), true), /only its File in is left/);
  assert.match(S.pauseRefusal(at({ currentStep: S.DONE }), true), /only its File in is left/);
  assert.match(S.pauseRefusal(at({ currentStep: "HAPPENING_NOW", planSubmittedAt: null }), true), /plan/);
  // An indoor shoot says it in its own words, since it has no Shoot started of that name.
  assert.match(S.pauseRefusal(at({ currentStep: "SHOOT_STARTED", indoor: true }), true), /paused once "Ready" is done/);
  // Twice over is refused rather than logged twice, each way round.
  const paused = at({ currentStep: "HAPPENING_NOW", shootStatus: S.PAUSED_STATUS });
  assert.equal(S.isPaused(paused), true);
  assert.match(S.pauseRefusal(paused, true), /already paused/);
  assert.equal(S.pauseRefusal(paused, false), null);
  assert.match(S.pauseRefusal(at({ currentStep: "HAPPENING_NOW" }), false), /not paused/);
  assert.equal(S.RESUMED_STATUS, "STARTED");
});

test("the pending pill says what the shoot is waiting on", () => {
  assert.equal(S.pendingLabel({ planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO" }), "Plan pending");
  assert.equal(S.pendingLabel(submitted({ currentStep: "PINEAPPLE_MEETING" })), "Step 3/7 · Pineapple meeting");
  // A status left on an older record says nothing: the step it is on does, and that is File in.
  assert.equal(S.pendingLabel(submitted({ currentStep: "SHOOT_STATUS", shootStatus: "PAUSED" })), "Step 7/7 · File in");
  assert.equal(S.pendingLabel(submitted({ currentStep: "HAPPY_CLIENTS" })), "Step 6/7 · Happy clients");
  // A paused shoot is waiting on being started again, not on its step.
  assert.equal(S.pendingLabel(submitted({ currentStep: "HAPPENING_NOW", shootStatus: "PAUSED" })), "Paused");
  // An indoor shoot has four, and calls its first Ready.
  assert.equal(S.pendingLabel(submitted({ indoor: true, currentStep: "SHOOT_STARTED" })), "Step 1/4 · Ready");
  assert.equal(S.pendingLabel(submitted({ currentStep: S.DONE })), "Done");
});

test("the three WhatsApp steps map to their messages", () => {
  assert.equal(S.MESSAGE_FOR_STEP.STARTED_FROM_STUDIO, "STARTED_FROM_STUDIO");
  assert.equal(S.MESSAGE_FOR_STEP.REACHED_SHOOT_PLACE, "REACHED_SHOOT_PLACE");
  assert.equal(S.MESSAGE_FOR_STEP.HAPPY_CLIENTS, "SHOOT_COMPLETED");
  assert.equal(S.MESSAGE_FOR_STEP.SHOOT_STATUS, undefined);
  assert.equal(S.MESSAGE_FOR_STEP.PINEAPPLE_MEETING, undefined);
});

test("tickets can change until the shoot is done", () => {
  assert.equal(S.fileAddRefusal({ planSubmittedAt: null, currentStep: "STARTED_FROM_STUDIO" }, "TICKET"), null);
  assert.match(S.fileAddRefusal(submitted({ currentStep: S.DONE }), "TICKET"), /done/);
  assert.equal(S.fileRemoveRefusal(submitted({ currentStep: "SHOOT_STATUS" }), "TICKET"), null);
});

test("the pineapple photo belongs to the pineapple meeting step only", () => {
  assert.match(S.fileAddRefusal({ planSubmittedAt: null, currentStep: "PINEAPPLE_MEETING" }, "PINEAPPLE_GROUP"), /plan/);
  assert.equal(S.fileAddRefusal(submitted({ currentStep: "PINEAPPLE_MEETING" }), "PINEAPPLE_GROUP"), null);
  assert.ok(S.fileAddRefusal(submitted({ currentStep: "REACHED_SHOOT_PLACE" }), "PINEAPPLE_GROUP"));
  assert.ok(S.fileRemoveRefusal(submitted({ currentStep: "SHOOT_STARTED" }), "PINEAPPLE_GROUP"));
});

test("the three new steps each take their own photos, only while that step is open", () => {
  for (const step of ["SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS"]) {
    assert.equal(S.STEP_PHOTO_KINDS[step], step);
    assert.equal(S.fileAddRefusal(submitted({ currentStep: step }), step), null);
    assert.equal(S.fileRemoveRefusal(submitted({ currentStep: step }), step), null);
    assert.match(S.fileAddRefusal(submitted({ currentStep: "PINEAPPLE_MEETING" }), step), /step/);
    assert.match(S.fileRemoveRefusal(submitted({ currentStep: "PHOTO_COPY" }), step), /done/);
  }
  // Happening-now photos no longer belong to Shoot started.
  assert.ok(S.fileAddRefusal(submitted({ currentStep: "SHOOT_STARTED" }), "HAPPENING_NOW"));
  assert.equal(S.minPhotos("HAPPENING_NOW"), 2);
  assert.equal(S.minPhotos("HAPPY_CLIENTS"), 1);
});

test("a shoot that has not reached a step yet is told so, not that the step is done", () => {
  // A shoot older than the new steps can sit on Shoot started holding happening-now photos.
  assert.match(S.fileRemoveRefusal(submitted({ currentStep: "SHOOT_STARTED" }), "HAPPENING_NOW"), /can be changed at the Happening now step/);
});

test("the travel steps each take their own photo, only while that step is open", () => {
  for (const step of ["STARTED_FROM_STUDIO", "REACHED_SHOOT_PLACE"]) {
    assert.equal(S.STEP_PHOTO_KINDS[step], step);
    assert.equal(S.fileAddRefusal(submitted({ currentStep: step }), step), null);
    assert.equal(S.fileRemoveRefusal(submitted({ currentStep: step }), step), null);
    assert.match(S.fileAddRefusal(submitted({ currentStep: "SHOOT_STARTED" }), step), /step/);
    assert.match(S.fileRemoveRefusal(submitted({ currentStep: "SHOOT_STARTED" }), step), /done/);
    assert.match(S.fileAddRefusal({ planSubmittedAt: null, currentStep: step }, step), /plan/);
  }
});

test("an unknown kind is refused", () => {
  assert.ok(S.fileAddRefusal(submitted(), "SELFIE"));
  assert.ok(S.fileRemoveRefusal(submitted(), "SELFIE"));
});

test("each shoot has one board status, named by what is done: travelling, setting up, shooting, paused, file in, completed", () => {
  const at = (overrides) => S.boardStatus({ planSubmittedAt: new Date(), currentStep: "STARTED_FROM_STUDIO", shootStatus: null, ...overrides });
  assert.equal(at({ planSubmittedAt: null }), "Plan pending");
  assert.equal(at({}), "Not started");
  // Standing on a step, the crew has done the one before it: that is what the status says.
  assert.equal(at({ currentStep: "REACHED_SHOOT_PLACE" }), "Travelling");
  assert.equal(at({ currentStep: "PINEAPPLE_MEETING" }), "Setting up");
  assert.equal(at({ currentStep: "SHOOT_STARTED" }), "Setting up");
  assert.equal(at({ currentStep: "HAPPENING_NOW" }), "Shoot in progress");
  assert.equal(at({ currentStep: "HAPPY_CLIENTS" }), "Shoot in progress");
  assert.equal(at({ currentStep: "HAPPENING_NOW", shootStatus: "PAUSED" }), "Paused");
  assert.equal(at({ currentStep: "PHOTO_COPY" }), "File in pending");
  assert.equal(at({ currentStep: S.DONE }), "Shoot completed");
  // An indoor shoot's first step is Ready, which is not Setting up - nothing has happened yet.
  assert.equal(at({ currentStep: "SHOOT_STARTED", indoor: true }), "Not started");
  // Only an older record carries On hold, from the step that went, and the tab still answers for it.
  assert.equal(at({ currentStep: "HAPPENING_NOW", shootStatus: "HOLD" }), "On hold");
  assert.deepEqual(S.BOARD_STATUSES, ["Plan pending", "Not started", "Travelling", "Setting up", "Shoot in progress", "Paused", "File in pending", "Shoot completed", "On hold"]);
});
