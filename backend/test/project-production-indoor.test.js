const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/modules/project-management/production/steps");
const { completeStep } = require("../src/modules/project-management/production/execution");
const { createProductionFake, productionRow, coordinator } = require("./production-fake-client");

/*
 * An indoor shoot - Shoot Type "Studio / In-House" - has no travel steps and no pineapple meeting:
 * Started to shoot, Reached venue and Pineapple meeting are skipped, four steps instead of seven, and
 * its first reads Ready rather than Shoot started - nothing has gone anywhere. No type, or anything
 * else, is outdoor and keeps all seven.
 */
const INDOOR = { shootType: "Studio / In-House", shootTypes: ["Studio / In-House"] };

test("indoor is the shoot's own Shoot Type; no type, or any other, is outdoor", () => {
  assert.equal(S.isIndoorShoot(INDOOR), true);
  assert.equal(S.isIndoorShoot({ shootType: "Studio / In-House", shootTypes: null }), true);
  assert.equal(S.isIndoorShoot({ shootTypes: ["Outdoor / On-Location"] }), false);
  assert.equal(S.isIndoorShoot({ shootType: null, shootTypes: null }), false);
  assert.equal(S.isIndoorShoot({ shootType: "Candid" }), false, "an old sheet's stray value is not indoor");
  assert.deepEqual(S.stepsFor(true), ["SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS", "PHOTO_COPY"]);
  assert.equal(S.stepsFor(false).length, 7);
  assert.equal(S.STEP_LABELS.PHOTO_COPY, "File in");
  // Its first step is the studio saying it is set, not a crew saying it has started out.
  assert.equal(S.labelFor("SHOOT_STARTED", true), "Ready");
  assert.equal(S.labelFor("SHOOT_STARTED", false), "Shoot started");
  assert.equal(S.labelFor("HAPPY_CLIENTS", true), "Happy clients", "the rest it calls what every shoot calls them");
});

test("an indoor shoot stored on a step it lacks is on its next indoor step", () => {
  assert.equal(S.effectiveStep("STARTED_FROM_STUDIO", true), "SHOOT_STARTED");
  assert.equal(S.effectiveStep("REACHED_SHOOT_PLACE", true), "SHOOT_STARTED");
  // A shoot already on its pineapple meeting when this changed carries on at Shoot started.
  assert.equal(S.effectiveStep("PINEAPPLE_MEETING", true), "SHOOT_STARTED");
  assert.equal(S.effectiveStep("PINEAPPLE_MEETING", false), "PINEAPPLE_MEETING");
  assert.equal(S.effectiveStep("STARTED_FROM_VENUE", true), "PHOTO_COPY");
  assert.equal(S.effectiveStep("REACHED_STUDIO", true), "PHOTO_COPY");
  assert.equal(S.effectiveStep("STARTED_FROM_STUDIO", false), "STARTED_FROM_STUDIO");
  const raised = { planSubmittedAt: new Date(), currentStep: "STARTED_FROM_STUDIO", shoot: INDOOR };
  assert.equal(S.pendingLabel(raised), "Step 1/4 · Ready");
  assert.equal(S.boardStatus(raised), "Not started");
  assert.equal(S.pendingLabel({ ...raised, shoot: null }), "Step 1/7 · Started to shoot");
});

test("an indoor shoot runs Shoot started to File in, with no travel step, pineapple meeting or travel message", async () => {
  const sent = [];
  const notify = async (productionId, step) => { sent.push(step); return { step, status: "SENT" }; };
  const client = createProductionFake({
    productions: [productionRow({ currentStep: "STARTED_FROM_STUDIO", shoot: INDOOR })],
    employees: [{ id: 14 }],
    travelPhotos: true,
  });
  // The travel steps are not this shoot's.
  await assert.rejects(completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client, notify }), (error) => error.status === 400 && /indoor shoot has no/.test(error.message));
  await assert.rejects(completeStep("shoot-1", "PINEAPPLE_MEETING", { remarks: "Met the family" }, coordinator, { client, notify }), (error) => error.status === 400 && /indoor shoot has no/.test(error.message));
  await completeStep("shoot-1", "SHOOT_STARTED", {}, coordinator, { client, notify });
  await completeStep("shoot-1", "HAPPENING_NOW", {}, coordinator, { client, notify });
  await completeStep("shoot-1", "HAPPY_CLIENTS", {}, coordinator, { client, notify });
  assert.equal(client.state.productions[0].currentStep, "PHOTO_COPY", "Happy clients goes straight to File in");
  assert.equal(client.state.productions[0].shootStatus, "COMPLETED", "and marks the shoot complete itself");
  assert.deepEqual(sent, ["SHOOT_COMPLETED"], "only the shoot-completed message");
});
