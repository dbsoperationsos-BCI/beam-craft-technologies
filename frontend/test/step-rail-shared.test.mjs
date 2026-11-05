import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const url = (path) => new URL(`../src/${path}`, import.meta.url);

test("StepRail lives in components/shared and the Events wizard uses it from there", () => {
  assert.ok(fs.existsSync(url("components/shared/StepRail.js")));
  assert.equal(fs.existsSync(url("components/ai-feature/events/wizard/StepRail.js")), false);
  const wizard = fs.readFileSync(url("components/ai-feature/events/CreateEventWizard.js"), "utf8");
  assert.match(wizard, /import StepRail from "@\/components\/shared\/StepRail";/);
  assert.match(wizard, /ariaLabel="Wizard steps"/);
});

test("the shared rail takes a label", () => {
  const rail = fs.readFileSync(url("components/shared/StepRail.js"), "utf8");
  assert.match(rail, /ariaLabel = "Steps"/);
  assert.match(rail, /flex h-11 w-full items-center/, "a 44px tap target on a phone");
});

test("on a phone the rail is the open step in full, Step N of M, a segment per step and previous / next", () => {
  const rail = fs.readFileSync(url("components/shared/StepRail.js"), "utf8");
  assert.match(rail, /Step \{current \+ 1\} of \{steps\.length\}/);
  assert.match(rail, /className=\{`flex flex-col gap-2 \$\{part === "bar" \? "lg:hidden" : "md:hidden"\}`\}/);
  assert.match(rail, /\{canPrev && <IconButton label="Previous step"/);
  assert.match(rail, /\{canNext && <IconButton label="Next step"/);
  // The segment bar fits any count, so it never scrolls; the numbered bar (production's ten) may.
  assert.match(rail, /: <ol className="flex gap-1">/);
  assert.match(rail, /\{numbered \? <ol ref=\{rowRef\} className="relative -mx-1 flex snap-x overflow-x-auto px-1">/);
  // The row opens on, and follows, the step being shown.
  assert.match(rail, /row\.scrollTo\(\{ left: Math\.max\(0, target\), behavior: "smooth" \}\);/);
  assert.match(rail, /\}, \[current\]\);/);
  // A line joins each circle to the one before it.
  assert.match(rail, /\{index > 0 && <span aria-hidden="true" className=\{`absolute left-\[-8px\] top-1\/2 h-1 w-4/);
});

test("production's rail is numbered on a phone; the Create Event wizard keeps its segments", () => {
  const rail = fs.readFileSync(url("components/shared/StepRail.js"), "utf8");
  assert.match(rail, /\{done && !open \? <CheckRounded style=\{\{ fontSize: 16 \}\} \/> : index \+ 1\}/);
  const tab = fs.readFileSync(url("components/project-management/production/ProductionExecutionTab.js"), "utf8");
  assert.match(tab, /<StepRail numbered part="bar" \{\.\.\.rail\} \/>/);
  // From lg up the list is its own pane - the shoot panel's left column - as the Plan's sections are.
  assert.match(tab, /<StepList><StepRail part="list" \{\.\.\.rail\} \/><\/StepList>/);
  const panel = fs.readFileSync(url("components/project-management/production/ProductionShootPanel.js"), "utf8");
  assert.match(panel, /rail=\{tab === "execution" && detail\?\.plan\?\.planSubmittedAt && !detail\?\.execution\?\.closedReason \? <div ref=\{setStepListNode\} \/> : undefined\}/);
  assert.match(fs.readFileSync(url("components/schema-form/SchemaFormPanel.js"), "utf8"), /\{!showSidebar && rail && <aside aria-label=\{railAriaLabel\} className="relative z-10 hidden w-60 shrink-0 overflow-y-auto overscroll-contain border-r border-slate-200 bg-slate-50 p-3 lg:block">/);
  assert.doesNotMatch(fs.readFileSync(url("components/ai-feature/events/CreateEventWizard.js"), "utf8"), /<StepRail[^>]*numbered/);
});
