import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { groupBranchCode, buildGroupName } from "../src/components/sales/whatsappGroupNameUtils.js";

/*
 * A group name says the branch as a short code, not as a word.
 *
 * The name is read in WhatsApp's own chat list, where the whole thing is truncated to a phone's
 * width - so "Erode" spends five characters saying what "ERD" says in three, and the part somebody
 * is scanning for (the couple, the date) is what falls off the end.
 */

const BASE = { enquiryId: "DBS-EID-DD-ERD-000001", socialMediaPosting: "Yes", mainEventDateKnown: false };

test("each branch reads as the studio's own code", () => {
  for (const [branch, code] of [
    ["Erode", "ERD"],
    ["Tiruppur", "TPR"],
    ["Coimbatore", "CBE"],
    ["Bangalore", "BLR"],
    ["Hyderabad", "HYD"],
    ["Vizag", "VSKP"],
  ]) {
    assert.equal(groupBranchCode(branch), code);
  }
});

test("the spellings the register and the sheets actually use all reach the same code", () => {
  /*
   * The register writes a branch with its state after it - "Erode TN", "Visakhapatnam AP" - while a
   * form or a sheet does not, and the studio says Vizag where the branch list says Visakhapatnam.
   * Matching on the front of the normalised name covers all of them without a row per spelling.
   */
  assert.equal(groupBranchCode("Erode TN"), "ERD");
  assert.equal(groupBranchCode("Visakhapatnam"), "VSKP");
  assert.equal(groupBranchCode("Visakhapatnam AP"), "VSKP");
  assert.equal(groupBranchCode("Bengaluru"), "BLR");
  assert.equal(groupBranchCode("Tirupur"), "TPR", "the one-r spelling is as common as the two-r one");
  assert.equal(groupBranchCode("  coimbatore  "), "CBE");
});

test("a branch nobody has a code for is left as it was typed", () => {
  // A name nobody recognises is still better than a group with no branch on it at all.
  assert.equal(groupBranchCode("Salem"), "Salem");
  assert.equal(groupBranchCode(""), "");
  assert.equal(groupBranchCode(null), "");
});

test("all three group shapes use the code", () => {
  const dumDum = buildGroupName({
    ...BASE, groupType: "Dum Dum", tier: "Premium", branch: "Visakhapatnam AP",
    groomName: "Arun", brideName: "Meena", place: "Vizag",
  });
  assert.match(dumDum, /^WED Premium VSKP Arun & Meena/);
  assert.doesNotMatch(dumDum, /Visakhapatnam/, "the full branch name is still in the Dum Dum name");

  const quaQua = buildGroupName({
    ...BASE, groupType: "Qua Qua", branch: "Tiruppur", clientName: "Asha",
    eventName: "Maternity", houseType: "Own", gou: "No", place: "Tiruppur",
  });
  /*
   * A space, as the other two verticals have. It ran straight onto the prefix - "QQTPR", and before the
   * codes, "QQErode" - which read as one word and is the odd one out beside "WED Premium VSKP" and
   * "CORP CBE": the three names are read side by side in a list of groups, and only this one hid where
   * the prefix stopped and the branch began.
   */
  assert.match(quaQua, /^QQ TPR Asha/, "the branch code is a segment of its own, as it is on the other verticals");
  assert.doesNotMatch(quaQua, /QQTPR/);

  const corp = buildGroupName({ ...BASE, groupType: "Corp", branch: "Coimbatore", clientName: "Acme", place: "Coimbatore" });
  assert.match(corp, /^CORP CBE Acme/);
});

test("the identifier codes are a separate list, and stay that way", () => {
  /*
   * `backend/src/services/identifiers.js` holds six of the same branches, but it mints enquiry ids -
   * `DBS-EID-DD-ERD-000001` - and two of its codes are not the ones wanted here: it writes Tiruppur
   * as `TUP` and Vizag as `VIZAG`. Changing it there would rename the branch segment of every id
   * minted from that day on, leaving one studio's records split across two spellings of one branch.
   *
   * So there are deliberately two lists. This pins that the identifier one was not quietly edited.
   */
  const identifiers = fs.readFileSync(
    path.join(import.meta.dirname, "..", "..", "backend", "src", "services", "identifiers.js"),
    "utf8",
  );
  assert.match(identifiers, /\{ code: "TUP", name: "Tiruppur"/, "the enquiry-id branch code for Tiruppur was changed");
  assert.match(identifiers, /\{ code: "VIZAG", name: "Vizag"/, "the enquiry-id branch code for Vizag was changed");
});
