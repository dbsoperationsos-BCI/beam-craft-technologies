import test from "node:test";
import assert from "node:assert/strict";
import { preProductionVerticalFieldRuns, preProductionVerticalFormSection, preProductionVerticalDefaults } from "../src/constants/preProductionVerticalFields.js";
import { shootCompletionStatus } from "../src/lib/preProductionProgress.js";

test("the Dum Dum checklist no longer asks for the team reached or shoot completion messages", () => {
  const ids = preProductionVerticalFieldRuns.dumdum.map((field) => field.id);
  assert.ok(!ids.includes("teamReachedMessage"));
  assert.ok(!ids.includes("shootCompletionMessage"));
});

test("the Dum Dum intro calls are a Yes / No pair saving Completed / Pending, and start on No", () => {
  const fields = preProductionVerticalFormSection("Dum Dum").fields;
  for (const name of ["introCallGroom", "introCallBride"]) {
    const field = fields.find((entry) => entry.name === name);
    assert.equal(field.type, "radio");
    assert.deepEqual(field.options, [{ value: "Completed", label: "Yes" }, { value: "Pending", label: "No" }]);
  }
  assert.deepEqual(preProductionVerticalDefaults("Dum Dum", {}), { introCallGroom: "Pending", introCallBride: "Pending" });
  assert.deepEqual(preProductionVerticalDefaults("Dum Dum", { introCallGroom: "Completed" }), { introCallBride: "Pending" });
});

test("a Yes intro call still counts toward the shoot's pre production progress", () => {
  const answered = Object.fromEntries(preProductionVerticalFieldRuns.dumdum.map((field) => [field.id, field.type === "toggle" ? true : field.type === "yesno" ? "Completed" : "x"]));
  assert.equal(shootCompletionStatus({ product: "Dum Dum", ...answered, introCallBride: "Pending" }) === "Completed", false);
});

test("Qua Qua matches: its intro call is a Yes / No pair starting on No, and it no longer asks for the shoot completion message", () => {
  const ids = preProductionVerticalFieldRuns.quaqua.map((field) => field.id);
  assert.ok(!ids.includes("shootCompletionMessage"));
  const field = preProductionVerticalFormSection("Qua Qua").fields.find((entry) => entry.name === "introCall");
  assert.equal(field.type, "radio");
  assert.deepEqual(preProductionVerticalDefaults("Qua Qua", {}), { introCall: "Pending" });
});

test("the shoot's info panel reads an intro call as Yes / No", async () => {
  const { preProductionInfoFormatters, preProductionInfoSectionsFor } = await import("../src/constants/infoPanelConfig.js");
  const checklist = preProductionInfoSectionsFor("Dum Dum").find((section) => section.title === "Dum Dum Checklist");
  assert.deepEqual(checklist.fields.find(([id]) => id === "introCallGroom"), ["introCallGroom", "Intro Call - Groom", "preProductionYesNo"]);
  assert.equal(preProductionInfoFormatters.preProductionYesNo("Completed"), "Yes");
  assert.equal(preProductionInfoFormatters.preProductionYesNo("Pending"), "No");
});
