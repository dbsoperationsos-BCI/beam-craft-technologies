import test from "node:test";
import assert from "node:assert/strict";

/*
 * Every field a details screen draws carries an ⓘ that says what it means, for somebody new to it.
 * `RecordDetails` asks `detailHelpFor(sectionTitle, key)`, which tries "<Section>.<key>" and then the
 * bare key, across the six area files `detailHelp/index.js` merges (misc < people < accounts < hrm <
 * project < sales - a later file wins).
 *
 * The modules are loaded for real rather than read as text, so sections built from shared constants
 * (the project panels, the pre production run per vertical) are checked as the screen draws them.
 */

const { detailHelpFor } = await import("../src/constants/detailHelp/index.js");
const infoPanelConfig = await import("../src/constants/infoPanelConfig.js");

const AREAS = ["misc", "people", "accounts", "hrm", "project", "sales"];
const areas = Object.fromEntries(await Promise.all(AREAS.map(async (area) => [area, (await import(`../src/constants/detailHelp/${area}.js`)).default])));

const isSection = (value) => value && typeof value === "object" && typeof value.title === "string" && Array.isArray(value.fields);

/** `title.key (label)` for every field of `sections` that has no help. */
const missingHelp = (sections) => [...new Set(sections.filter(isSection).flatMap((section) => section.fields
  .filter(([key]) => !String(detailHelpFor(section.title, key)).trim())
  .map(([key, label]) => `${section.title}.${key} (${label})`)))];

/** Every `{ title, fields }` section array a module exports, by export name. */
const exportedSections = (module) => Object.entries(module).filter(([, value]) => Array.isArray(value) && value.some(isSection));

test("infoPanelConfig exports the info panels' sections", () => {
  const names = exportedSections(infoPanelConfig).map(([name]) => name);
  assert.ok(names.length >= 20, `only ${names.length} section lists found`);
  assert.ok(names.includes("assetInfoSections"));
  assert.ok(names.includes("activityLogInfoSections"));
});

test("every field of every section exported from infoPanelConfig has help text", () => {
  for (const [name, sections] of exportedSections(infoPanelConfig)) {
    assert.deepEqual(missingHelp(sections), [], name);
  }
});

test("every vertical's pre production sections, checklists included, have help text", () => {
  for (const product of ["Dum Dum", "Qua Qua", "Corporate"]) {
    const sections = infoPanelConfig.preProductionInfoSectionsFor(product);
    if (product !== "Corporate") assert.ok(sections.some((section) => section.title.endsWith("Checklist")), product);
    assert.deepEqual(missingHelp(sections), [], product);
  }
});

test("every other module's view sections have help text", async () => {
  const configs = ["accountsConfig", "paymentRequestConfig", "interviewConfig", "speakUpConfig", "taskConfig"];
  for (const config of configs) {
    const configModule = await import(`../src/constants/${config}.js`);
    for (const [name, sections] of exportedSections(configModule).filter(([name]) => /InfoSections$|DetailSections$/.test(name))) {
      assert.deepEqual(missingHelp(sections), [], `${config}.${name}`);
    }
  }
});

test("a project's feedback, every stage and every shoot, has help text", async () => {
  const { feedbackRecordFor } = await import("../src/lib/feedbackRecord.mjs");
  const issues = [{ reviewLabel: "Sales", review: "Poor", assignedTo: "A", remarks: "Done" }, { reviewLabel: "Production", review: "Average", remarks: "Done" }];
  const row = (stage, extra = {}) => ({ id: `${stage}-${extra.shootKey || ""}`, projectKey: "p1", stage, feedbackCode: "DBS-FB-1", status: "Issues sorted", issues, ...extra });
  const rows = [
    row("NEW_PROJECT"),
    row("SHOOT_COMPLETION", { shootKey: "41", shootCode: "DBS-SID-1" }),
    row("SHOOT_COMPLETION", { shootKey: "42", shootCode: "DBS-SID-2", pending: true }),
    row("OVERALL"),
    row("PRODUCTION_COMPLETION"),
    row("PROJECT_COMPLETED"),
  ];
  const { sections } = feedbackRecordFor(rows[0], rows);
  assert.ok(sections.some((section) => section.title.startsWith("Shoot Completion Feedback - ")));
  assert.deepEqual(missingHelp(sections), []);
});

test("no help key is written twice with different text across the area files", () => {
  const seen = new Map();
  const clashes = [];
  for (const area of AREAS) {
    for (const [key, text] of Object.entries(areas[area])) {
      const earlier = seen.get(key);
      if (earlier && earlier.text !== text) clashes.push(`${key}: ${earlier.area} vs ${area}`);
      seen.set(key, { area, text });
    }
  }
  assert.deepEqual(clashes, []);
});
