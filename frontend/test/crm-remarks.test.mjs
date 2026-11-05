import test from "node:test";
import assert from "node:assert/strict";

import { leadRemarkEntries, normalizeRemarkEntries, remarkSummary } from "../src/lib/crmRemarks.mjs";

/*
 * Which column a lead's remarks are read from.
 *
 * A lead keeps its remarks in one of two places and the reader cannot know which. The app writes
 * `remarkEntries` - a list, every note stamped with its time and carrying its files. The Google
 * Sheet sync and the CSV import write the flat `remarks` column and nothing else, because a
 * spreadsheet cell is one piece of text with no time against it.
 *
 * The bug these tests exist for: the list is *always* an array - the API answers `[]` for a NULL
 * column - and `[]` is truthy, so `remarkEntries || remarks` never reached the flat column. Every
 * lead that arrived from a sheet or a file read as "No remarks yet." in the table, in the lead
 * popup and in the info panel's Remarks tab, while its remark sat in the database the whole time.
 */

test("a lead imported from a sheet shows the remark it arrived with", () => {
  // Exactly what the sync leaves behind: the flat column filled in, the list empty.
  const entries = leadRemarkEntries([], "Called, asked for November dates");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, "Called, asked for November dates");
  assert.equal(remarkSummary(entries), "Called, asked for November dates");
});

test("an empty list does not count as having remarks", () => {
  // The whole defect in one line: `[]` is truthy, so emptiness has to be what is tested.
  assert.deepEqual(leadRemarkEntries([], "from the sheet")[0].text, "from the sheet");
  assert.deepEqual(leadRemarkEntries([], ""), []);
  assert.deepEqual(leadRemarkEntries([], undefined, null), []);
});

test("notes written in the app win over the column the sheet overwrites", () => {
  // Once the studio keeps its own notes, those are the record - the sync keeps rewriting the flat
  // column on every pass and must not displace them.
  const entries = leadRemarkEntries([{ text: "Spoke to the bride" }], "whatever the sheet says");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, "Spoke to the bride");
});

test("the sources are read in the order they are given", () => {
  // Details before lead, list before flat text - the order every caller passes them in.
  assert.equal(leadRemarkEntries([], [{ text: "on the lead" }], "details flat", "lead flat")[0].text, "on the lead");
  assert.equal(leadRemarkEntries([], [], "details flat", "lead flat")[0].text, "details flat");
});

test("a remark that is only a file is still a remark", () => {
  // A photo with no note - "here is the reference they sent" - is something somebody said.
  const entries = leadRemarkEntries([{ text: "", attachments: [{ name: "reference.jpg" }] }], "");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].attachments[0].name, "reference.jpg");
});

test("what comes back is always normalised, whichever column answered", () => {
  // The caller renders it without knowing where it came from, so a flat string cannot come back
  // as a string.
  for (const entries of [leadRemarkEntries([], "flat"), leadRemarkEntries(["listed"], "")]) {
    assert.ok(Array.isArray(entries));
    assert.deepEqual(entries, normalizeRemarkEntries(entries), "not idempotent");
    assert.equal(typeof entries[0].id, "string");
  }
});
