import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The Hard Disk part of Pre-Production's General bar.
 *
 * Storage Needed is the project's own answer and saves with the project; the disk itself is Client
 * Storage's record, raised by the server when that answer becomes Yes. The two are a step apart, and
 * the gap between them is what this pins.
 */

const GENERAL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", "PreProductionGeneral.js"), "utf8");

test("switching Storage Needed to Yes says nothing about a disk that does not exist yet", () => {
  /*
   * Turning it on used to draw a dashed box reading "No hard disk record yet — saving Storage Needed as
   * Yes raises one", which is a sentence explaining the mechanism to somebody who has just used it: they
   * chose Yes, they are about to save, and the disk appears when they do. Nothing is being asked of them
   * and nothing has gone wrong, so there is nothing to say.
   *
   * The whole field waits instead of drawing an empty explanation. Not merely a `null` renderer, which
   * would leave the field's own div holding a column of the grid and a gap where the box was.
   */
  assert.equal(GENERAL.includes("No hard disk record yet"), false, "the placeholder should be gone");
  assert.match(GENERAL, /name: "storageRecord", type: "custom", colSpan: 2, when: \(values\) => values\.storageNeeded === "Yes" && Boolean\(project\.storageRecordId\)/);
});

test("the field appears on the render that first has a disk to show", () => {
  /*
   * The disk is raised by the **save**, so `project.storageRecordId` arrives with the reloaded project.
   * The sections are memoised, and without the project (which carries that id) among the dependencies
   * the field would stay hidden on exactly the render that first had something to draw - appearing
   * later, when something unrelated happened to rebuild them.
   */
  assert.match(GENERAL, /\]\.filter\(Boolean\), \[canWrite, project\]\);/);
});

test("the disk's own details still appear once there is a disk, and nothing more", () => {
  /*
   * The point of the field: the id, the status and who holds it. It used to carry the whole Client
   * Storage flow as well - a button per legal move - which is not this board's to run. Pre
   * production sets one status and sets it from the shoot: Hard Disk: Handed Over on the shoot's
   * own form starts the record off, and the journey from there is Client Storage's.
   */
  assert.match(GENERAL, /storageRecord: \(\) => <div/);
  assert.match(GENERAL, /\["Storage ID", storage\?\.storageId \|\| project\.storageId(?:, detailHelpFor\([^)]*\))?\]/);
  assert.doesNotMatch(GENERAL, /movesFor|useClientStorageMoves/);
});
