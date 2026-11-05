import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { PRODUCTION_STEPS, MESSAGE_STEP_FOR, stepIndex, stepLabel, activityText, messageFor, unsentNotice } from "../src/lib/productionSteps.mjs";

test("the rail's steps match the server's order, in the words the screens use", () => {
  assert.deepEqual(PRODUCTION_STEPS, [
    ["STARTED_FROM_STUDIO", "Started to shoot"],
    ["REACHED_SHOOT_PLACE", "Reached venue"],
    ["PINEAPPLE_MEETING", "Pineapple meeting"],
    ["SHOOT_STARTED", "Shoot started"],
    ["HAPPENING_NOW", "Happening now"],
    ["HAPPY_CLIENTS", "Happy clients"],
    ["PHOTO_COPY", "File in"],
  ]);
  assert.equal(stepIndex("PINEAPPLE_MEETING"), 2);
  assert.equal(stepIndex("DONE"), 7);
  // The shoot status step and the trip back are gone: nobody pauses, holds or rejects a shoot.
  assert.doesNotMatch(JSON.stringify(PRODUCTION_STEPS), /SHOOT_STATUS|STARTED_FROM_VENUE|REACHED_STUDIO/);
});

test("the log reads as sentences", () => {
  assert.equal(activityText({ action: "STEP_COMPLETED", detail: "PINEAPPLE_MEETING" }), "Step completed: Pineapple meeting");
  assert.equal(activityText({ action: "PLAN_SUBMITTED", detail: null }), "Plan submitted");
  assert.equal(activityText({ action: "WHATSAPP_FAILED", detail: "Started to shoot: not connected" }), "WhatsApp not sent: Started to shoot: not connected");
});

test("Happy clients is the step that completes the shoot and sends the shoot-completed message", () => {
  assert.equal(MESSAGE_STEP_FOR.HAPPY_CLIENTS, "SHOOT_COMPLETED");
  assert.equal(MESSAGE_STEP_FOR.SHOOT_STATUS, undefined);
  assert.deepEqual(messageFor([{ step: "SHOOT_COMPLETED", status: "SENT" }], "SHOOT_COMPLETED"), { step: "SHOOT_COMPLETED", status: "SENT" });
  assert.equal(messageFor([], "SHOOT_COMPLETED"), null);
});

test("a step whose WhatsApp message did not go says so, with the reason", () => {
  assert.equal(unsentNotice(null), null);
  assert.equal(unsentNotice({ step: "SHOOT_COMPLETED", status: "SENT" }), null);
  assert.equal(unsentNotice({ step: "SHOOT_COMPLETED", status: "FAILED", reason: "WhatsApp not connected" }), "Done — WhatsApp not sent: WhatsApp not connected. Retry it on Happy clients.");
  assert.equal(unsentNotice({ step: "SHOOT_COMPLETED", status: "FAILED", reason: null }), "Done — WhatsApp not sent: Send failed. Retry it on Happy clients.");
  assert.equal(unsentNotice({ step: "SHOOT_COMPLETED", status: "SENDING" }), "Done — WhatsApp is still sending. Check Happy clients for the result.");
});

test("nobody pauses, holds or rejects a shoot: the step and its choices are gone from the screens", async () => {
  const steps = await import("../src/lib/productionSteps.mjs");
  assert.equal(steps.SHOOT_STATUS_OPTIONS, undefined);
  assert.equal(steps.shootStatusChoices, undefined);
  assert.equal(steps.STOPPED_STATUSES, undefined);
  const form = fs.readFileSync(new URL("../src/components/project-management/production/ProductionStepForm.js", import.meta.url), "utf8");
  assert.doesNotMatch(form, /SHOOT_STATUS|shootStatus|changeProductionShootStatus/);
  const service = fs.readFileSync(new URL("../src/services/project-management/production.service.js", import.meta.url), "utf8");
  assert.doesNotMatch(service, /shoot-status/);
});

test("a shoot shows only its own steps - four for an indoor one, whose first reads Ready", async () => {
  const { stepsOf, stepIndex, stepLabel } = await import("../src/lib/productionSteps.mjs");
  const indoor = stepsOf(["SHOOT_STARTED", "HAPPENING_NOW", "HAPPY_CLIENTS", "PHOTO_COPY"], true);
  assert.deepEqual(indoor, [["SHOOT_STARTED", "Ready"], ["HAPPENING_NOW", "Happening now"], ["HAPPY_CLIENTS", "Happy clients"], ["PHOTO_COPY", "File in"]]);
  assert.equal(stepIndex("HAPPY_CLIENTS", indoor), 2);
  assert.equal(stepIndex("DONE", indoor), 4);
  assert.equal(stepsOf(undefined).length, 7, "without a list, all seven");
  assert.equal(stepLabel("SHOOT_STARTED"), "Shoot started", "an outdoor shoot keeps the crew's own word");
  assert.equal(stepLabel("SHOOT_STARTED", true), "Ready");
  assert.equal(stepLabel("PHOTO_COPY"), "File in");
  // The tab asks the shoot which kind it is, and the step's own heading reads the same words as the rail.
  const tab = fs.readFileSync(new URL("../src/components/project-management/production/ProductionExecutionTab.js", import.meta.url), "utf8");
  assert.match(tab, /const indoor = Boolean\(detail\.execution\.indoor\);/);
  assert.match(tab, /const steps = stepsOf\(detail\.execution\.steps, indoor\);/);
  assert.match(tab, /indoor=\{indoor\}/);
  const form = fs.readFileSync(new URL("../src/components/project-management/production/ProductionStepForm.js", import.meta.url), "utf8");
  assert.match(form, /\{stepLabel\(stepId, indoor\)\}<\/h3>/);
});

test("File in can be saved as it stands, service by service, beside Complete", () => {
  /*
   * A shoot's footage is copied card by card, so the step has to hold the services already filled in
   * while the rest are still being read.
   *
   * **Complete photo copy** is the way the step finishes and is never a dead button: pressed with
   * gaps it marks the answers that are missing, the way every other form here answers a refused
   * save, and names the other way out. **Mark as pending** is that other way out, and it shows only
   * while something is still missing - once every service is answered there is nothing to leave
   * pending, so there is one button to press.
   */
  const form = fs.readFileSync(new URL("../src/components/project-management/production/ProductionStepForm.js", import.meta.url), "utf8");
  assert.match(form, /\{!footageComplete && <Button[\s\S]{0,200}?>Mark as pending<\/Button>\}/);
  assert.match(form, /onClick=\{\(\) => void completeFootage\(\)\}>Complete photo copy<\/Button>/);
  // Pressed with gaps: the boxes are marked and nothing is sent.
  assert.match(form, /if \(!footageComplete\) \{\n\s+fields\.check\(footageProblems\(\)\);/);
  assert.match(form, /or Mark as pending to save what is filled in\./);
  assert.match(form, /const errorOf = \(field\) => fields\.errors\[`\$\{service\.key\}\.\$\{field\}`\];/);
  // Quiet until that press, and then following the answers, so a box clears its own mark.
  assert.match(form, /fields\.clear\(`\$\{key\}\.\$\{field\}`\);/);
  // No standing state beside each service's name: the cards carry their answers, not a status.
  assert.doesNotMatch(form, /ProgressChip|Ready to save|Part filled/);
  assert.match(form, /await saveProductionFootage\(shootId, pendingFootagePayload\(footageServices, footage\)\)/);
  // Nothing is coerced on the way out: a blank must stay blank for the server to leave it pending.
  assert.match(form, /const pendingFootagePayload = \(services, values\) => services\.map\(\(service\) => \(\{\n\s+serviceDefinitionId: service\.definitionId,\n\s+\.\.\.values\[service\.key\],\n\}\)\);/);
  /*
   * What was actually kept, and what to do next. A card saved part way **is** saved, so the notice
   * says so: the server's `held` is what it wrote and `pending` is what the step still waits on, and
   * reading "no service finished" as "nothing saved" told people their work was lost when it was on
   * disk. "Nothing to save yet" is only for a form with nothing in it at all.
   */
  assert.match(form, /const held = Number\(response\?\.held \|\| 0\);/);
  assert.match(form, /Saved as it stands\. \$\{pending\} \$\{pending === 1 \? "service" : "services"\} still to fill in, then complete photo copy\./);
  assert.match(form, /: "Nothing to save yet - fill in a service and mark it pending\."/);
  assert.doesNotMatch(form, /Nothing saved\./);
  // One save at a time, and only the button that was pressed says what it is doing.
  assert.match(form, /busy=\{busy && pendingSave\} busyLabel="Saving\.\.\." disabled=\{busy && !pendingSave\}/);
  assert.match(form, /busy=\{busy && !pendingSave\} busyLabel="Saving\.\.\." disabled=\{busy && pendingSave\}/);
  // And the form opens on what a pending save kept, rather than blank over saved answers.
  assert.match(form, /useState\(\(\) => footageFrom\(footageServices, execution\.footage\)\)/);
  assert.match(form, /const held = new Map\(\(saved \|\| \[\]\)\.map\(\(entry\) => \[entry\.serviceDefinitionId \?\? WHOLE_SHOOT, entry\]\)\);/);
  // The log says it happened, as every other change on the shoot does.
  assert.equal(activityText({ action: "FOOTAGE_SAVED", detail: "1 of 2 services filled in" }), "File in saved: 1 of 2 services filled in");
});
