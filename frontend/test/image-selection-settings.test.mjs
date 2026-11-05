import assert from "node:assert/strict";
import test from "node:test";
import { NEW_SELECTION_ITEM_LIMIT, defaultValidUntil, formatClientPhone, hasSettingsChanges, newSelectionItemLimit, pendingSelectionDrafts, projectSettingsState, saveThenShare, settingsFormState, toDateInput, validateClientPhone, validateSelectionLimit } from "../src/lib/imageSelectionSettings.mjs";

const initial = { selectionValidityEnabled: true, allowPhotoSelection: true, selectionValidUntil: "2027-02-15", deliverables: [{ id: "config-1", enabled: true, selectionLimit: 20 }, { id: "config-2", enabled: false, selectionLimit: 10 }] };

test("validates selection limits as accepted integers", () => {
  assert.equal(validateSelectionLimit(1), true); assert.equal(validateSelectionLimit("100000"), true);
  assert.equal(validateSelectionLimit("2.5"), false); assert.equal(validateSelectionLimit(0), false); assert.equal(validateSelectionLimit(100001), false);
});

test("tracks toggle, checked state, and selection-limit changes as unsaved settings", () => {
  assert.equal(hasSettingsChanges(initial, structuredClone(initial)), false);
  assert.equal(hasSettingsChanges(initial, { ...initial, allowPhotoSelection: false }), true);
  assert.equal(hasSettingsChanges(initial, { ...initial, selectionValidityEnabled: false }), true);
  assert.equal(hasSettingsChanges(initial, { ...initial, deliverables: [{ ...initial.deliverables[0], enabled: false }, initial.deliverables[1]] }), true);
  assert.equal(hasSettingsChanges(initial, { ...initial, deliverables: [{ ...initial.deliverables[0], selectionLimit: 25 }, initial.deliverables[1]] }), true);
  assert.equal(hasSettingsChanges(initial, { ...initial, selectionValidUntil: "2027-03-01" }), true);
});

// The expiry the studio picks travels as the day it picked, not as an instant — the calendar reads
// and writes "YYYY-MM-DD", and only the stored value has a time on it.
test("shows a stored expiry as the day it falls on", () => {
  assert.equal(toDateInput("2026-08-15T23:59:59.999Z"), "2026-08-15");
  assert.equal(toDateInput(new Date("2026-08-15T23:59:59.999Z")), "2026-08-15");
  assert.equal(toDateInput(null), "");
  assert.equal(toDateInput("not a date"), "");
});

test("offers the studio-wide validity window as the default expiry", () => {
  const from = new Date("2026-08-15T00:00:00Z");
  assert.equal(defaultValidUntil(6, from), "2027-02-15");
  assert.equal(defaultValidUntil(12, from), "2027-08-15");
  assert.equal(defaultValidUntil(1, from), "2026-09-15");
  // Six months is what the backend falls back to, so it is what an unknown window offers.
  assert.equal(defaultValidUntil(undefined, from), "2027-02-15");
});

// Asked for once, on the Create New Project form, and only for a manually named project.
test("joins a client's country code and number into the shape the backend stores", () => {
  assert.equal(formatClientPhone("+91", "9876543210"), "+91 9876543210");
  assert.equal(formatClientPhone("", "9876543210"), "+91 9876543210");
  // No number is "no client recorded yet", not a half-written one the backend would reject.
  assert.equal(formatClientPhone("+91", ""), "");
});

test("accepts a blank client number but rejects a half-written one", () => {
  assert.equal(validateClientPhone("+91", ""), true);
  assert.equal(validateClientPhone("+91", "9876543210"), true);
  assert.equal(validateClientPhone("+91", "98765"), false);
  assert.equal(validateClientPhone("91", "9876543210"), false);
});

test("builds the settings form from a project row, defaulting both toggles to on", () => {
  // Absent is on: a project row predating either column must not read back as disabled.
  const fresh = projectSettingsState({});
  assert.equal(fresh.selectionValidityEnabled, true);
  assert.equal(fresh.allowPhotoSelection, true);
  // No stored expiry offers the one the gallery would be given rather than an empty box.
  assert.equal(fresh.selectionValidUntil, defaultValidUntil(6));
  const disabled = projectSettingsState({ selectionValidityEnabled: false, allowPhotoSelection: false, selectionValidUntil: "2026-12-31T23:59:59.999Z" }, { validityMonths: 12 });
  assert.equal(disabled.selectionValidityEnabled, false);
  assert.equal(disabled.allowPhotoSelection, false);
  // A stored date wins over the default, whatever the studio-wide window says.
  assert.equal(disabled.selectionValidUntil, "2026-12-31");
  // The client's name and number are still on the row; the rail no longer edits them, so they are
  // not carried into the form and cannot be written back by a save of the toggles.
  const state = projectSettingsState({ clientName: "Anika", clientMainNumber: "+91 9876543210" });
  assert.equal("clientName" in state, false);
  assert.equal("clientMainNumber" in state, false);
});

test("carries only the editable columns of each selection item into the form", () => {
  const form = settingsFormState({}, [
    { id: "config-1", enabled: true, selectionLimit: 20, name: "Candid", shootId: "shoot-1" },
  ]);
  assert.deepEqual(form.deliverables, [{ id: "config-1", enabled: true, selectionLimit: 20 }]);
  // A project with no Project Management link has no selection items at all.
  assert.deepEqual(settingsFormState({}, undefined).deliverables, []);
  // Round-trips through the change check the workspace rail uses to decide whether to offer Save.
  assert.equal(hasSettingsChanges(form, structuredClone(form)), false);
});

test("a typed selection item with no limit is given 1, and a typed limit is kept", () => {
  assert.equal(NEW_SELECTION_ITEM_LIMIT, 1);
  assert.equal(newSelectionItemLimit(""), 1);
  assert.equal(newSelectionItemLimit("   "), 1);
  assert.equal(newSelectionItemLimit(undefined), 1);
  assert.equal(newSelectionItemLimit("5"), 5);
  assert.equal(newSelectionItemLimit("50"), 50);
  // An invalid number is passed through for validation to refuse, not quietly turned into 1.
  assert.equal(validateSelectionLimit(newSelectionItemLimit("0")), false);
});

test("an existing item's saved limit survives the form being rebuilt from the server", () => {
  const form = settingsFormState({}, [{ id: "a", enabled: true, selectionLimit: 5 }, { id: "b", enabled: true, selectionLimit: 50 }]);
  assert.deepEqual(form.deliverables.map((item) => item.selectionLimit), [5, 50]);
});

test("only add rows holding a name are pending, each carrying its shoot and its limit", () => {
  const pending = pendingSelectionDrafts({
    "g1": { name: " Album ", limit: "", shootName: "Wedding", shootFolderId: "f-wedding" },
    "g2": { name: "", limit: "9", shootName: "Reception" },
    "g3": { name: "Prints", limit: "12", shootName: null },
  });
  // The shoot rides by its folder's id where the group is a folder, so a renamed folder still files
  // the item under the same shoot.
  assert.deepEqual(pending, [
    { groupId: "g1", name: "Album", selectionLimit: 1, shootName: "Wedding", shootFolderId: "f-wedding" },
    { groupId: "g3", name: "Prints", selectionLimit: 12, shootName: null, shootFolderId: null },
  ]);
  assert.deepEqual(pendingSelectionDrafts(undefined), []);
});

test("Review & Share saves, adds the pending items and publishes, in that order, before it opens", async () => {
  const calls = [];
  const step = (name) => async () => { calls.push(name); return true; };
  const result = await saveThenShare({ validate: () => true, save: step("save"), addDrafts: step("addDrafts"), publish: step("publish"), open: () => calls.push("open") });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["save", "addDrafts", "publish", "open"]);
});

test("Review & Share with nothing pending opens as it always did", async () => {
  let opened = 0;
  assert.deepEqual(await saveThenShare({ open: () => { opened += 1; } }), { ok: true });
  assert.equal(opened, 1);
});

test("Review & Share stops at a failed validation, save or add, and never opens", async () => {
  for (const failing of ["validate", "save", "addDrafts", "publish"]) {
    const calls = [];
    const step = (name) => async () => { calls.push(name); return name !== failing; };
    const result = await saveThenShare({
      validate: () => { calls.push("validate"); return failing !== "validate"; },
      save: step("save"), addDrafts: step("addDrafts"), publish: step("publish"),
      open: () => calls.push("open"),
    });
    assert.equal(result.ok, false, failing);
    assert.equal(result.step, failing);
    assert.ok(!calls.includes("open"), `${failing} failing must not open the share flow`);
    assert.equal(calls.at(-1), failing, "nothing after the failed step runs");
  }
});

test("a save that throws - a dropped network - stops Review & Share rather than escaping", async () => {
  let opened = false;
  const error = new Error("Network down");
  const result = await saveThenShare({ save: async () => { throw error; }, open: () => { opened = true; } });
  assert.equal(result.ok, false);
  assert.equal(result.error, error);
  assert.equal(opened, false);
});
