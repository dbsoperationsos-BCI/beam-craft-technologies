import test from "node:test";
import assert from "node:assert/strict";

import { groupNameFieldsForEnquiry, groupNamesForEnquiry, savedGroupNameForEnquiry, savedGroupNameModeAvailable } from "../src/lib/saleGroupName.mjs";

/*
 * Changing the enquiry on Create Project / Sale Details.
 *
 * The bug this pins: the form used to take a group name when the new enquiry had one and do
 * nothing at all when it did not, so switching from an enquiry that had a name to one that did not
 * left the first enquiry's name on screen — and its `whatsappGroupNameId` in the payload, which is
 * the generator row the save claims. A display bug and a data bug in one.
 */

const saved = { id: "gn_1", generatedName: "DBS-WED-ERD-001", groupType: "Dum Dum", vertical: "WED" };

test("an enquiry with a name waiting brings the name and its id", () => {
  assert.deepEqual(groupNameFieldsForEnquiry({ currentEnquiryId: "ENQ-1", nextEnquiryId: "ENQ-2", savedForEnquiry: saved }), {
    whatsappGroupNameId: "gn_1",
    whatsappGroupName: "DBS-WED-ERD-001",
    groupType: "Dum Dum",
    vertical: "WED",
  });
});

test("changing to an enquiry with no name clears the one before it", () => {
  assert.deepEqual(groupNameFieldsForEnquiry({ currentEnquiryId: "ENQ-1", nextEnquiryId: "ENQ-2", savedForEnquiry: null }), {
    whatsappGroupNameId: "",
    whatsappGroupName: "",
    groupType: "",
    vertical: "",
  });
});

test("the id is cleared with the text, so no project claims another enquiry's name", () => {
  // The whole point: the text going stale is visible, the id going stale is not.
  const fields = groupNameFieldsForEnquiry({ currentEnquiryId: "ENQ-1", nextEnquiryId: "ENQ-2", savedForEnquiry: null });
  assert.equal(fields.whatsappGroupNameId, "");
});

test("re-choosing the same enquiry leaves a name that was picked or typed by hand", () => {
  assert.deepEqual(groupNameFieldsForEnquiry({ currentEnquiryId: "ENQ-1", nextEnquiryId: "ENQ-1", savedForEnquiry: null }), {});
});

test("a search that resolves to no enquiry id at all changes nothing", () => {
  // `applyEnquiry` falls back to the id already held when the chosen row carries none, so the two
  // ids are equal here and nothing is touched.
  assert.deepEqual(groupNameFieldsForEnquiry({ currentEnquiryId: "ENQ-1", nextEnquiryId: "ENQ-1", savedForEnquiry: undefined }), {});
});

test("choosing an enquiry from a blank form takes its name without clearing anything first", () => {
  assert.deepEqual(groupNameFieldsForEnquiry({ currentEnquiryId: "", nextEnquiryId: "ENQ-2", savedForEnquiry: saved }).whatsappGroupName, "DBS-WED-ERD-001");
});

test("the cleared shape is fresh each time, so one call cannot alter another's result", () => {
  const first = groupNameFieldsForEnquiry({ currentEnquiryId: "ENQ-1", nextEnquiryId: "ENQ-2" });
  first.whatsappGroupName = "tampered";
  const second = groupNameFieldsForEnquiry({ currentEnquiryId: "ENQ-1", nextEnquiryId: "ENQ-3" });
  assert.equal(second.whatsappGroupName, "");
});

/*
 * Which names the picker may offer.
 *
 * A name is generated for a lead, so the studio's pool of unused names is not a menu of choices —
 * all but one belong to somebody else's booking.
 */

const pool = [
  { id: "gn_1", generatedName: "DBS-WED-ERD-001", enquiryId: "ENQ-1" },
  { id: "gn_2", generatedName: "DBS-WED-ERD-002", enquiryId: "ENQ-2" },
  { id: "gn_3", generatedName: "DBS-WED-ERD-003", enquiryId: "ENQ-1" },
  { id: "gn_legacy", generatedName: "DBS-OLD-001", enquiryId: null },
];

test("only the names saved against the chosen enquiry are offered", () => {
  assert.deepEqual(groupNamesForEnquiry(pool, "ENQ-1").map((name) => name.id), ["gn_1", "gn_3"]);
  assert.deepEqual(groupNamesForEnquiry(pool, "ENQ-2").map((name) => name.id), ["gn_2"]);
});

test("no enquiry chosen offers nothing, not everything", () => {
  for (const value of ["", "   ", null, undefined]) {
    assert.deepEqual(groupNamesForEnquiry(pool, value), []);
  }
});

test("a name carrying no enquiry is never offered against one", () => {
  // The column is nullable only for rows generated before the generator asked which lead a name
  // was for; such a name is used by typing it, not by claiming it from this list.
  assert.equal(groupNamesForEnquiry(pool, "ENQ-1").some((name) => name.id === "gn_legacy"), false);
  assert.equal(groupNamesForEnquiry(pool, "ENQ-9").length, 0);
});

test("an enquiry typed with stray spaces still matches its names", () => {
  assert.deepEqual(groupNamesForEnquiry(pool, "  ENQ-2  ").map((name) => name.id), ["gn_2"]);
});

test("the name filled in automatically is one the picker would also have listed", () => {
  const picked = savedGroupNameForEnquiry(pool, "ENQ-1");
  assert.equal(picked.id, "gn_1");
  assert.equal(groupNamesForEnquiry(pool, "ENQ-1").includes(picked), true);
  assert.equal(savedGroupNameForEnquiry(pool, "ENQ-9"), null);
  assert.equal(savedGroupNameForEnquiry(pool, ""), null);
});

test("an empty pool is handled the same as no match", () => {
  assert.deepEqual(groupNamesForEnquiry([], "ENQ-1"), []);
  assert.deepEqual(groupNamesForEnquiry(undefined, "ENQ-1"), []);
  assert.equal(savedGroupNameForEnquiry(undefined, "ENQ-1"), null);
});

/*
 * Which of the two the switch lands on when an enquiry is chosen.
 *
 * The saved list and the manual box answer the same question, and only one of them can answer it
 * for a given enquiry: a lead the generator has prepared a name for wants the list, and one it has
 * not wants the box. Leaving the switch where it was showed a new project an empty dropdown saying
 * no name had been generated, with the way to type one behind a control nobody had a reason to
 * press.
 *
 * `savedGroupNameForEnquiry` is the first of the names for that enquiry, so "has a saved name" and
 * "has any names to list" are one question - which is what makes this decidable from it alone.
 */

const modeForEnquiry = (names, enquiryId) => savedGroupNameForEnquiry(names, enquiryId) ? "saved" : "manual";

test("an enquiry the generator has a name for opens on the saved list", () => {
  const names = [{ id: 1, generatedName: "DD-ERD-Sharma", enquiryId: "ENQ-1" }];
  assert.equal(modeForEnquiry(names, "ENQ-1"), "saved");
});

test("an enquiry with no generated name opens on the manual box", () => {
  const names = [{ id: 1, generatedName: "DD-ERD-Sharma", enquiryId: "ENQ-1" }];
  // Somebody else's name is not this enquiry's list, so this is the empty case even though the
  // studio holds a name.
  assert.equal(modeForEnquiry(names, "ENQ-2"), "manual");
  assert.equal(modeForEnquiry([], "ENQ-1"), "manual");
});

test("the decision is the same one the dropdown fills itself from", () => {
  // If these two ever disagreed, the switch would land on a list the picker then draws as empty.
  const names = [{ id: 1, generatedName: "DD-ERD-Sharma", enquiryId: "ENQ-1" }, { id: 2, generatedName: "QQ-CBE-Rao", enquiryId: "ENQ-1" }];
  assert.equal(groupNamesForEnquiry(names, "ENQ-1").length > 0, modeForEnquiry(names, "ENQ-1") === "saved");
  assert.equal(groupNamesForEnquiry(names, "ENQ-9").length > 0, modeForEnquiry(names, "ENQ-9") === "saved");
});

/*
 * Whether the Saved side of the switch has anything behind it.
 *
 * The rule has to tell three different "no"s apart, and getting any of them wrong is a control that
 * misleads rather than one that breaks: greying out the side somebody is standing on, flickering
 * while the list loads, or offering a dropdown whose only content is a sentence saying it is empty.
 */

const names = [
  { id: "gn_1", enquiryId: "ENQ-1", generatedName: "WED 2t2 Erode TN A & B" },
  { id: "gn_2", enquiryId: "ENQ-1", generatedName: "WED 3t3 Erode TN C & D" },
];

test("an enquiry with names saved for it can use the saved list", () => {
  assert.equal(savedGroupNameModeAvailable({ groupNames: names, enquiryId: "ENQ-1", mode: "manual" }), true);
});

test("an enquiry with none cannot — which is the whole point", () => {
  assert.equal(savedGroupNameModeAvailable({ groupNames: names, enquiryId: "ENQ-2", mode: "manual" }), false);
  assert.equal(savedGroupNameModeAvailable({ groupNames: [], enquiryId: "ENQ-1", mode: "manual" }), false);
});

test("the side already selected is never disabled", () => {
  // An existing project whose enquiry has since lost its generated names would otherwise have the
  // button it is standing on greyed out.
  assert.equal(savedGroupNameModeAvailable({ groupNames: [], enquiryId: "ENQ-2", mode: "saved" }), true);
});

test("a list still loading is not an answer", () => {
  // Otherwise the button greys out for a moment on every enquiry and comes back, which reads as a
  // control that flickers rather than one that is off.
  assert.equal(savedGroupNameModeAvailable({ groupNames: [], enquiryId: "ENQ-2", isLoading: true, mode: "manual" }), true);
});

test("with no enquiry chosen the switch stays open", () => {
  // The dropdown says "Choose an enquiry first", which is the one place that guidance appears —
  // disabling the switch would hide it and invite a name typed before the enquiry it belongs to.
  assert.equal(savedGroupNameModeAvailable({ groupNames: names, enquiryId: "", mode: "manual" }), true);
  assert.equal(savedGroupNameModeAvailable({ groupNames: names, enquiryId: "   ", mode: "manual" }), true);
});

test("a saved group name hands the project its vertical as a code, whatever it stored", async () => {
  const { projectVerticalFor } = await import("../src/lib/saleGroupName.mjs");
  assert.equal(projectVerticalFor({ vertical: "QQ", groupType: "Qua Qua" }), "QQ");
  // Older rows spelled the vertical out; the project accepts only the code.
  assert.equal(projectVerticalFor({ vertical: "Dum Dum", groupType: "Dum Dum" }), "WED");
  assert.equal(projectVerticalFor({ vertical: "", groupType: "Corp" }), "CORP");
  assert.equal(projectVerticalFor({}), "");
});
