import test from "node:test";
import assert from "node:assert/strict";
import { definitionNameKey, definitionNameTaken, takenDefinitionNameKeys } from "../src/lib/projectDefinitionNames.mjs";

/*
 * A service or deliverable name that the server would refuse is refused in the dialog.
 *
 * Settings → Project stages every add and edit and writes them on one Save, so a duplicate used
 * to be found only then: "This service already exists" at the foot of a page whose Save had
 * otherwise worked, with the row already in the table. The dialogs ask first, by the server's own
 * rule for when two names are one.
 */

test("two names are one name when the server would make one code of them", () => {
  // `codeFor` in the projects controller: upper-cased, runs of anything else folded to one underscore.
  assert.equal(definitionNameKey("Demo Drone"), "DEMO_DRONE");
  assert.equal(definitionNameKey("  demo   drone "), "DEMO_DRONE");
  assert.equal(definitionNameKey("Demo - Drone!"), "DEMO_DRONE");
  assert.equal(definitionNameKey("Candid Photo + Reels"), "CANDID_PHOTO_REELS");
  assert.equal(definitionNameKey(""), "");
  assert.equal(definitionNameKey(null), "");
});

test("every other row's name is taken, and a row keeps its own", () => {
  const rows = [{ id: "a", name: "Demo Drone" }, { id: "b", name: "Candid Video" }, { id: "new-1", name: "Crane" }];
  assert.deepEqual(takenDefinitionNameKeys(rows), ["DEMO_DRONE", "CANDID_VIDEO", "CRANE"]);
  // Editing Demo Drone: its own name is not a conflict with itself.
  assert.deepEqual(takenDefinitionNameKeys(rows, "a"), ["CANDID_VIDEO", "CRANE"]);
  assert.equal(definitionNameTaken("demo drone", takenDefinitionNameKeys(rows, "a")), false);
  assert.equal(definitionNameTaken("demo drone", takenDefinitionNameKeys(rows)), true);
  // A row staged on this page but not yet saved counts: the server refuses the second of a pair.
  assert.equal(definitionNameTaken("CRANE", takenDefinitionNameKeys(rows)), true);
  // Blank is not a name, so it is never taken - the dialog refuses it for being blank instead.
  assert.equal(definitionNameTaken("   ", takenDefinitionNameKeys(rows)), false);
  assert.equal(definitionNameTaken("Drone", takenDefinitionNameKeys(rows)), false);
});
