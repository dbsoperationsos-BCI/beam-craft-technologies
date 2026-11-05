import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  RETIRED_KEYS,
  SECTIONS,
  addListEntry,
  aiDependencies,
  PROBLEM_STEPS,
  firstProblem,
  formState,
  guestAccessProblems,
  hasChanges,
  hasProblems,
  keysDrawn,
  matchingProblems,
  settingsProblems,
  eventFormProblems,
  payloadOf,
  removeListEntry,
  SERVER_WRITTEN_KEYS,
  watermarkProblems,
  watermarkSwitches,
} from "../src/lib/aiEventDefaults.mjs";

const require = createRequire(import.meta.url);
// The server's one definition of the record. Read directly so the workspace cannot drift from it:
// a key the server stores that no section draws is a setting nobody can configure any more.
const { DEFAULTS } = require("../../backend/src/modules/ai-feature/shared/settingsDefaults.js");

test("every stored setting is drawn by exactly one section", () => {
  const drawn = keysDrawn();
  const stored = Object.entries(DEFAULTS).flatMap(([group, keys]) => Object.keys(keys).map((key) => `${group}.${key}`)).filter((key) => !SERVER_WRITTEN_KEYS.includes(key) && !RETIRED_KEYS.includes(key));
  assert.deepEqual([...drawn].sort(), [...stored].sort());
  assert.equal(new Set(drawn).size, drawn.length, "no key is drawn twice");
  assert.deepEqual(SECTIONS.map((section) => section.id), ["general", "guestAccess", "ai", "matching", "processing", "mediaUpload", "privacy"]);
});

test("the payload leaves an emptied number out so the stored value survives", () => {
  const values = formState({ ai: { minFaceQuality: "", similarityHigh: 0.7 }, media: { maxFileSizeMb: 60 } });
  const payload = payloadOf(values);
  assert.deepEqual(payload.ai, { similarityHigh: 0.7 });
  assert.deepEqual(payload.media, { maxFileSizeMb: 60 });
  assert.equal("bogus" in payload, false);
});

test("Save is offered only when something would be sent, and not after an edit is put back", () => {
  const saved = formState({ general: { eventTypes: ["Wedding", "Birthday"], defaultDurationDays: 1 }, ai: { faceRecognition: true } });
  const same = formState({ general: { eventTypes: ["Wedding", "Birthday"], defaultDurationDays: 1 }, ai: { faceRecognition: true } });
  assert.equal(hasChanges(saved, same), false);
  const edited = { ...same, ai: { ...same.ai, faceRecognition: false } };
  assert.equal(hasChanges(saved, edited), true);
  const reordered = { ...same, general: { ...same.general, eventTypes: ["Birthday", "Wedding"] } };
  assert.equal(hasChanges(saved, reordered), true, "order is part of the list");
  const restored = { ...edited, ai: { ...edited.ai, faceRecognition: true } };
  assert.equal(hasChanges(saved, restored), false);
  assert.equal(hasChanges(null, same), false, "nothing to compare with before the record arrives");
});

test("a chip list refuses blanks, duplicates, overlong entries and one past the cap", () => {
  assert.deepEqual(addListEntry(["Wedding"], "  "), { list: ["Wedding"], error: "" });
  assert.equal(addListEntry(["Wedding"], "wedding").error, '"wedding" is already listed.');
  assert.equal(addListEntry(["Wedding"], "x".repeat(61)).error, "Keep it under 60 characters.");
  assert.equal(addListEntry(["a", "b"], "c", { max: 2 }).error, "Up to 2 entries.");
  assert.deepEqual(addListEntry(["Wedding"], " Reception ").list, ["Wedding", "Reception"]);
  assert.deepEqual(addListEntry(["jpg"], ".PNG", { normalize: (text) => text.replace(/^\./, "").toLowerCase() }).list, ["jpg", "png"]);
});

test("a chip list never drops below its minimum", () => {
  assert.deepEqual(removeListEntry(["Wedding", "Birthday"], "Birthday", { min: 1 }), ["Wedding"]);
  const only = ["Wedding"];
  assert.equal(removeListEntry(only, "Wedding", { min: 1 }), only);
  assert.deepEqual(removeListEntry(["jpg"], "jpg"), []);
});

test("the AI switches make the right settings inert, as the worker reads them", () => {
  const off = aiDependencies({ ai: { faceRecognition: false, faceClustering: true, selfieSearch: true, automaticMatching: true }, guestAccess: { enableSelfie: true } });
  assert.deepEqual(off, { faceOn: false, clusteringOn: false, matchingOn: false, selfieSearchOn: false, selfieSearchUsable: false });
  const on = aiDependencies({ ai: { faceRecognition: true, faceClustering: false, selfieSearch: true, automaticMatching: true }, guestAccess: { enableSelfie: false } });
  assert.equal(on.clusteringOn, false);
  assert.equal(on.matchingOn, true);
  assert.equal(on.selfieSearchOn, true);
  assert.equal(on.selfieSearchUsable, false, "selfie search also needs Enable guest selfie");
});

test("the high cut-off must sit at or above the medium one, and an emptied box is not judged", () => {
  assert.deepEqual(matchingProblems({ similarityHigh: 0.4, similarityMedium: 0.5 }), { similarityHigh: "Must be at or above the medium-confidence similarity." });
  assert.deepEqual(matchingProblems({ similarityHigh: 0.5, similarityMedium: 0.5 }), {});
  assert.deepEqual(matchingProblems({ similarityHigh: "", similarityMedium: 0.5 }), {});
  assert.deepEqual(matchingProblems(undefined), {});
});

test("both selfie ways off while the guest selfie is on is refused before the save", () => {
  const message = "Enable at least one selfie option: Take Selfie or Upload Selfie.";
  assert.deepEqual(guestAccessProblems({ enableSelfie: true, allowTakeSelfie: false, allowUploadSelfie: false }), { allowTakeSelfie: message });
  assert.deepEqual(guestAccessProblems({ enableSelfie: false, allowTakeSelfie: false, allowUploadSelfie: false }), {}, "inert while the selfie is off");
  assert.deepEqual(guestAccessProblems({ enableSelfie: true, allowTakeSelfie: true, allowUploadSelfie: false }), {});
  assert.deepEqual(guestAccessProblems({ enableSelfie: true }), {}, "an event from before the switches has both");
  const problems = settingsProblems({ ai: { similarityHigh: 0.4, similarityMedium: 0.5 }, guestAccess: { enableSelfie: true, allowTakeSelfie: false, allowUploadSelfie: false } });
  assert.deepEqual(Object.keys(problems).sort(), ["guestAccess", "matching", "privacy"]);
  assert.equal(hasProblems(problems), true);
  assert.equal(hasProblems(settingsProblems({ ai: {}, guestAccess: {} })), false);
  assert.equal(hasProblems(undefined), false);
});

test("a refused rule is said in one sentence and points at the wizard step at fault", () => {
  const problems = settingsProblems({ ai: { similarityHigh: 0.4, similarityMedium: 0.5 }, guestAccess: { enableSelfie: true, allowTakeSelfie: false, allowUploadSelfie: false } });
  assert.equal(firstProblem(problems), "Must be at or above the medium-confidence similarity.");
  assert.equal(firstProblem({ guestAccess: { allowTakeSelfie: "x" } }), "x");
  assert.equal(firstProblem({}), "");
  assert.equal(firstProblem(undefined), "");
  assert.deepEqual(PROBLEM_STEPS, { guestAccess: "guests", gallery: "settings" });
  // Create Event and the event's Settings draw no threshold field, so the threshold rule is not
  // theirs to refuse on; the Guest Access rule, whose fields they do draw, still is.
  const eventForm = eventFormProblems({ ai: { similarityHigh: 0.4, similarityMedium: 0.5 }, guestAccess: { enableSelfie: true, allowTakeSelfie: false, allowUploadSelfie: false } });
  assert.deepEqual(Object.keys(eventForm), ["guestAccess", "gallery"]);
  assert.ok(eventForm.guestAccess.allowTakeSelfie);
  assert.equal(hasProblems(eventFormProblems({ ai: { similarityHigh: 0.4, similarityMedium: 0.5 }, guestAccess: {} })), false);
});

test("a watermark switched on with no preset is refused before the save, on the step that draws it", () => {
  const message = "Choose a watermark preset, or turn the watermark off.";
  assert.deepEqual(watermarkProblems({ watermark: true, watermarkPresetId: null }), { watermarkPresetId: message });
  assert.deepEqual(watermarkProblems({ watermark: true, watermarkPresetId: "p1" }), {});
  assert.deepEqual(watermarkProblems({ watermark: false, watermarkPresetId: null }), {}, "off needs no preset");
  assert.equal(settingsProblems({ gallery: { watermark: true } }).privacy.watermarkPresetId, message, "Event Default Settings files it under Privacy & Access, where it is drawn");
  assert.equal(eventFormProblems({ gallery: { watermark: true } }).gallery.watermarkPresetId, message);
  assert.equal(PROBLEM_STEPS.gallery, "settings", "Create Event lands on Event Settings");
});

test("the watermark is two switches, view and download, and an old single switch reads as both", () => {
  assert.deepEqual(watermarkSwitches({ watermarkOnView: true, watermarkOnDownload: false }), { view: true, download: false });
  assert.deepEqual(watermarkSwitches({ watermarkOnView: false, watermarkOnDownload: true, watermark: true }), { view: false, download: true });
  assert.deepEqual(watermarkSwitches({ watermark: true }), { view: true, download: true });
  assert.deepEqual(watermarkSwitches({}), { view: false, download: false });
  assert.ok(watermarkProblems({ watermarkOnView: false, watermarkOnDownload: true, watermarkPresetId: null }).watermarkPresetId, "either switch needs a preset");
  assert.deepEqual(watermarkProblems({ watermarkOnView: false, watermarkOnDownload: false, watermarkPresetId: null }), {}, "both off needs none");
  assert.ok(SERVER_WRITTEN_KEYS.includes("gallery.watermark"), "the old switch is the server's to keep in step");
});
