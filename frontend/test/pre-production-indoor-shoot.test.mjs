import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { preProductionFormSectionsFor } from "../src/constants/formPanelConfig.js";
import { preProductionVerticalFieldRuns } from "../src/constants/preProductionVerticalFields.js";
import { shootProgress, shootStarted } from "../src/lib/preProductionProgress.js";

/*
 * An indoor shoot (Studio / In-House) is not asked for travel, a location or a studio start, and is
 * not counted short for leaving them blank. Google Review is no longer asked on Pre Production.
 */

const names = (sections) => sections.flatMap((section) => section.fields.map((field) => field.name));

test("an indoor shoot's form has no Travel, and asks its branch in place of the location", () => {
  const indoor = preProductionFormSectionsFor("Qua Qua", { indoor: true });
  assert.ok(!indoor.some((section) => section.id === "travel"));
  const branch = indoor.find((section) => section.id === "location");
  assert.equal(branch.title, "Shoot Branch");
  assert.deepEqual(branch.fields.map((field) => [field.name, field.type, field.options]), [["shootBranchId", "select", "branches"]]);
  assert.ok(!names(preProductionFormSectionsFor("Qua Qua")).includes("shootBranchId"), "an outdoor shoot is not asked its branch");
  assert.ok(!names(indoor).some((name) => ["studioStartDate", "studioStartTime", "locationAddress", "travelAccommodationNeeded"].includes(name)));
  // Its own date it is asked, and mandatorily: a studio day still has to be a day.
  const date = indoor.flatMap((section) => section.fields).find((field) => field.name === "shootDate");
  assert.equal(date?.required, true);
  assert.ok(names(indoor).includes("reportingTime"), "the rest of Event Timing stays");
  const outdoor = preProductionFormSectionsFor("Qua Qua");
  assert.ok(names(outdoor).includes("shootDate") && outdoor.some((section) => section.id === "location"), "an outdoor shoot is asked as before");
});

test("an indoor shoot is complete without them, once its branch is chosen", () => {
  // Its own date is counted too - a studio day still has to be a day - and its branch in place of the
  // venue an outdoor shoot is counted on.
  const timed = { product: "CORP", subEventDate: "2026-11-12", eventStartTime: "09:00", eventEndTime: "12:00", reportingTime: "08:00" };
  assert.deepEqual(shootProgress({ ...timed, indoor: true, shootBranchId: 3 }), { filled: 5, total: 5, pending: 0, percent: 100 });
  assert.equal(shootProgress({ ...timed, indoor: true }).pending, 1, "the branch is still owed");
  assert.equal(shootProgress({ ...timed, subEventDate: null, indoor: true, shootBranchId: 3 }).pending, 1, "and so is the date");
  assert.equal(shootProgress({ ...timed, indoor: false }).pending, 1, "an outdoor one still owes its venue");
});

test("Google Review is not asked", () => {
  assert.ok(!Object.values(preProductionVerticalFieldRuns).flat().some((field) => field.id === "googleReview"));
});

test("Concepts Needed is asked first, and the list shows only on Yes", () => {
  const concepts = preProductionFormSectionsFor("Corp").find((section) => section.id === "concepts");
  assert.deepEqual(concepts.fields.map((field) => field.name), ["conceptsNeeded", "concepts"]);
  const list = concepts.fields[1];
  assert.equal(list.when({ conceptsNeeded: true }), true);
  assert.equal(list.when({ conceptsNeeded: false }), false);
  assert.equal(list.when({ conceptsNeeded: "" }), false, "not answered yet");
});

test("a concept is work to do, not an answer the shoot is held short for", () => {
  // Only the mandatory answers are counted, so a shoot that says it needs a concept is not kept off
  // Planned until one has a reference. The concept list is still asked for on the form.
  const timed = { product: "CORP", indoor: true, shootBranchId: 3, subEventDate: "2026-11-12", eventStartTime: "09:00", eventEndTime: "12:00", reportingTime: "08:00" };
  assert.equal(shootProgress({ ...timed, conceptsNeeded: true, concepts: [] }).pending, 0);
  assert.equal(shootProgress({ ...timed, conceptsNeeded: true, concepts: [{ reference: "https://x" }] }).pending, 0);
  assert.equal(shootProgress({ ...timed, conceptsNeeded: false, concepts: [] }).pending, 0);
  // It is still work begun, so the shoot does not read Yet to Start once a concept is listed.
  assert.equal(shootStarted({ product: "CORP", concepts: [{ reference: "https://x" }] }), true);
});

test("every yes/no on the form starts on No when it has no answer, and keeps one it has", async () => {
  const { yesNoDefaultsToNo } = await import("../src/constants/yesNoField.js");
  const sections = preProductionFormSectionsFor("Dum Dum");
  const defaults = yesNoDefaultsToNo(sections, { gettingDecorImages: null, postWeddingGift: true, siteVisit: false, conceptsNeeded: "" });
  assert.equal(defaults.gettingDecorImages, false);
  assert.equal(defaults.conceptsNeeded, false);
  assert.ok(!("postWeddingGift" in defaults) && !("siteVisit" in defaults), "an answer already given is kept");
  const form = fs.readFileSync(new URL("../src/components/project-management/PreProductionFormPanel.js", import.meta.url), "utf8");
  assert.match(form, /\.\.\.yesNoDefaultsToNo\(sections, emptyValues\(sections, row\)\),/);
});
