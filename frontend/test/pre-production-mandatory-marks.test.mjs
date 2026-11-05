import test from "node:test";
import assert from "node:assert/strict";

/*
 * What a shoot is read as Planned on, marked on the form that asks for it.
 *
 * The rule lives in `preProductionProgress.mandatoryAnswers` - six answers on an outdoor shoot,
 * four on an indoor one - and the form showed none of them as required, so the only way to learn
 * which fields held a shoot at 60-something per cent was to fill them one at a time. The mark is
 * a mark and not a gate: a coordinator fills this form over days, so the save is never refused.
 */
import { preProductionFormSectionsFor } from "../src/constants/formPanelConfig.js";

const fieldsOf = (sections) => Object.fromEntries(sections.flatMap((section) => section.fields).map((field) => [field.name, field]));

test("the outdoor shoot's five counted answers carry the mark, and nothing else does", () => {
  const fields = fieldsOf(preProductionFormSectionsFor("WED"));
  const required = Object.entries(fields).filter(([, field]) => field.required).map(([name]) => name).sort();
  assert.deepEqual(required, ["eventEndTime", "eventStartTime", "locationAddress", "reportingTime", "shootDate"]);
  // When the crew leaves the studio is Production's to plan now (productionFormConfig.js), not asked here.
  assert.equal(fields.studioStartDate, undefined);
  assert.equal(fields.studioStartTime, undefined);
  // The plan's other answers are work to do, not answers a shoot is held short for.
  for (const name of ["locationLink", "scheduleRemarks", "accommodationAddress"]) {
    assert.ok(!fields[name]?.required, `${name} is not mandatory`);
  }
});

test("an indoor shoot is asked its branch instead of the venue", () => {
  const fields = fieldsOf(preProductionFormSectionsFor("WED", { indoor: true }));
  const required = Object.entries(fields).filter(([, field]) => field.required).map(([name]) => name).sort();
  assert.deepEqual(required, ["eventEndTime", "eventStartTime", "reportingTime", "shootBranchId", "shootDate"]);
});

test("the marks do not refuse the save", async () => {
  const panel = (await import("node:fs")).readFileSync(new URL("../src/components/project-management/PreProductionFormPanel.js", import.meta.url), "utf8");
  assert.match(panel, /validateRequired=\{false\}/);
});
