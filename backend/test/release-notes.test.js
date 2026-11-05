const test = require("node:test");
const assert = require("node:assert/strict");
const { parseReleaseNotes } = require("../src/services/releaseNotes");

const changelog = `# Changelog

## How to Add an Entry

- Add one line under \`## Unreleased\`.

---

## Unreleased

### Added

- **Sales Manager can edit a project it sold.** Every row now carries "Edit Sale Details"
  ([SalesManagerPage.js](../frontend/src/components/sales/SalesManagerPage.js)).

### Fixed

- **HR's form shows the \`same as current address\` checkbox the way the candidate set
  it.** It used to be cleared.
- A plain entry with no bold opening. It still counts, as its first sentence.

## 1.2.41

- **An older release's entry.** Not this one.
`;

test("reads the first release section and the lead-in of each entry", () => {
  const { section, notes } = parseReleaseNotes(changelog);
  assert.equal(section, "Unreleased");
  assert.deepEqual(notes, [
    "Sales Manager can edit a project it sold.",
    "HR's form shows the same as current address checkbox the way the candidate set it.",
    "A plain entry with no bold opening.",
  ]);
});

test("names the version once Unreleased has been promoted", () => {
  const { section, notes } = parseReleaseNotes(changelog.replace("\n## Unreleased\n", "\n## 1.3.42\n"));
  assert.equal(section, "1.3.42");
  assert.equal(notes.length, 3);
});

test("an empty or missing changelog yields no notes rather than an error", () => {
  assert.deepEqual(parseReleaseNotes(""), { section: null, notes: [] });
  assert.deepEqual(parseReleaseNotes(undefined), { section: null, notes: [] });
});
