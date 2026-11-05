import test from "node:test";
import assert from "node:assert/strict";
import { sectionsToText, stripTitleNumber, textToSections } from "../src/lib/offerSectionsText.mjs";

/*
 * Import from .docx → one box: the sections as text (## a title, - a point, 1. a numbered point,
 * anything else a paragraph) and back, with what has to change said by line.
 */

const sections = [
  { title: "Appointment and Role", format: "PARAGRAPH", content: "You will be appointed as [Designation].\nReporting to [Manager]." },
  { title: "Leave", format: "POINTS", points: ["12 casual leaves a year", "Holidays as declared"] },
  { title: "Duties", format: "NUMBERED", points: ["Shoot", "Edit"] },
];

test("sections read out as text and back again, unchanged", () => {
  const text = sectionsToText(sections);
  assert.equal(text, "## Appointment and Role\nYou will be appointed as [Designation].\nReporting to [Manager].\n\n## Leave\n- 12 casual leaves a year\n- Holidays as declared\n\n## Duties\n1. Shoot\n2. Edit");
  assert.deepEqual(textToSections(text), { sections, errors: [] });
});

test("bullets may be • or -, numbers 1. or 1); blank lines are only gaps; a document's own numbering leaves the title", () => {
  const { sections: read, errors } = textToSections("## 1. Leave\n\n• One\n* Two\n\n## 2.1) Duties\n1) Shoot\n2. Edit\n\n## IV. Notice\nThirty days.");
  assert.deepEqual(errors, []);
  assert.deepEqual(read.map((section) => [section.title, section.format]), [["Leave", "POINTS"], ["Duties", "NUMBERED"], ["Notice", "PARAGRAPH"]]);
  assert.deepEqual(read[0].points, ["One", "Two"]);
  assert.equal(stripTitleNumber("Appointment and Role"), "Appointment and Role");
  assert.equal(stripTitleNumber("3. Compensation and Payroll"), "Compensation and Payroll");
});

test("what has to change is said by line: text before a title, a title with nothing under it, a mixed section", () => {
  const { errors } = textToSections("Opening words.\n## Empty\n## Mixed\nA paragraph.\n- then a point");
  assert.match(errors[0], /Line 1: start with a title/);
  assert.ok(errors.some((error) => /"Mixed" mixes a paragraph and a list/.test(error)));
  assert.ok(errors.some((error) => /"Empty" has nothing under it/.test(error)));
  assert.match(textToSections("##\nText").errors[0], /Line 1: give the section a title/);
});
