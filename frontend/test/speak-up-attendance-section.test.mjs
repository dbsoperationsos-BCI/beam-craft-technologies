import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");

test("Speak-up and Speak-up Review are each gated on their own permission, like Register and Events are on theirs", () => {
  // READ sees the section; READ_WRITE also lets you submit, read separately to gate the form inside it.
  assert.match(PAGE, /\{ label: "Speak-up", value: SECTION_SPEAK_UP, permission: \["HRM", "Speak-up", "READ"\] \}/);
  assert.match(PAGE, /\{ label: "Speak-up Review", value: SECTION_SPEAK_UP_REVIEW, permission: \["HRM", "Speak-up Review", "READ"\] \}/);
});

test("Speak-up and Speak-up Review deep-link, like Request, Register and Events do", () => {
  assert.match(PAGE, /const DEEP_LINK_SECTIONS = new Set\(\[SECTION_REQUEST, SECTION_REGISTER, SECTION_EVENTS, SECTION_SPEAK_UP, SECTION_SPEAK_UP_REVIEW\]\);/);
});

test("each section renders its own panel and nothing else", () => {
  assert.match(PAGE, /shownSection === SECTION_SPEAK_UP\) \{/);
  assert.match(PAGE, /<SpeakUpPanel onNotice=\{onNotice\} onError=\{onError\} canWrite=\{hasPermission\("HRM", "Speak-up", "READ_WRITE"\)\} \/>/);
  assert.match(PAGE, /shownSection === SECTION_SPEAK_UP_REVIEW\) \{/);
  // Deciding is Speak-up Review with write; reading alone gets the list and no ⋮.
  assert.match(PAGE, /<SpeakUpReviewPanel onError=\{onError\} onNotice=\{onNotice\} canDecide=\{hasPermission\("HRM", "Speak-up Review", "READ_WRITE"\)\} \/>/);
});
