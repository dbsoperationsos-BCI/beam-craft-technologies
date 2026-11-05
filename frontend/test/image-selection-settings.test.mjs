import assert from "node:assert/strict";
import test from "node:test";
import { defaultValidUntil, formatClientPhone, hasSettingsChanges, projectSettingsState, settingsFormState, toDateInput, validateClientPhone, validateSelectionLimit } from "../src/lib/imageSelectionSettings.mjs";

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
