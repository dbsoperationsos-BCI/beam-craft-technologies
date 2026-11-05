import assert from "node:assert/strict";
import test from "node:test";
import { VEIL_CLASSES, veilClassesFor } from "../src/lib/heroContrast.mjs";

test("each veil level keeps the foot behind the card deep, and an unknown level draws the medium veil", () => {
  for (const level of ["light", "medium", "strong"]) assert.match(VEIL_CLASSES[level], /to-black\/(65|70|75)/, "the foot behind the card is always deep");
  assert.equal(veilClassesFor("strong"), VEIL_CLASSES.strong);
  assert.equal(veilClassesFor(null), VEIL_CLASSES.medium);
  assert.equal(veilClassesFor(undefined), VEIL_CLASSES.medium);
  assert.equal(veilClassesFor("bogus"), VEIL_CLASSES.medium);
});
