import assert from "node:assert/strict";
import test from "node:test";
import { PREVIEW_LADDER } from "../src/lib/imageDerivatives.mjs";
import {
  QUALITY_PRESETS,
  readProcessingSettings,
  storeProcessingSettings,
} from "../src/lib/imageSelectionProcessingSettings.mjs";

/** A stand-in for the browser's store, so the round-trip can be exercised off a page. */
function withStorage(run) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
  try { return run(); } finally { delete globalThis.localStorage; }
}

const presets = Object.entries(QUALITY_PRESETS);

// The label is the only part of a preset anyone reads, and it repeats the two numbers beside it.
// Nothing ties them together, so a preset added or retuned without its label rewritten leaves the
// picker quoting a size the encoder is not aiming at — the one failure here that a user would see.
test("every preset's label quotes the long edge and ceiling it actually carries", () => {
  for (const [key, preset] of presets) {
    assert.match(preset.label, new RegExp(`\\b${preset.previewLongEdge}px\\b`), `${key} label disagrees with its long edge`);
    assert.match(preset.label, new RegExp(`~${preset.previewTargetKb} KB\\b`), `${key} label disagrees with its ceiling`);
  }
});

// The picker is handed this list `sorted={false}` and shows it as it stands, so the declaration
// order is the scale the user reads. Alphabetising it, or appending a preset to the end, would put
// a heavier option below a lighter one.
test("the presets are declared heaviest first, which is the order the picker shows", () => {
  const ceilings = presets.map(([, preset]) => preset.previewTargetKb);
  const edges = presets.map(([, preset]) => preset.previewLongEdge);
  assert.deepEqual(ceilings, [...ceilings].sort((a, b) => b - a));
  assert.deepEqual(edges, [...edges].sort((a, b) => b - a));
});

/*
 * The encoder walks `PREVIEW_LADDER` and accepts the last rung whatever it weighs, so a ceiling the
 * ladder cannot reach from a preset's long edge is not a smaller preview — it is the same preview
 * with a smaller number printed next to it in the picker.
 *
 * The rungs are scales of the long edge, so the pixels the bottom rung encodes are the check: a
 * preset whose smallest encode is still far larger than a preset with a comparable ceiling would
 * quietly overshoot. Measured in pixels rather than bytes because a real encode needs a canvas.
 */
test("each preset's ceiling leaves it room on the ladder, in step with the presets beside it", () => {
  const bottom = PREVIEW_LADDER[PREVIEW_LADDER.length - 1];
  const pixelsPerKb = presets.map(([key, preset]) => {
    const edge = preset.previewLongEdge * bottom.scale;
    return { key, ratio: (edge * edge) / preset.previewTargetKb };
  });
  // Every preset buys roughly the same pixels per kilobyte at the bottom of the ladder, so none is
  // asking its ceiling for something the rungs above it cannot deliver.
  const ratios = pixelsPerKb.map((entry) => entry.ratio);
  assert.ok(Math.max(...ratios) / Math.min(...ratios) < 2, `presets are out of step: ${JSON.stringify(pixelsPerKb)}`);
});

test("a stored preset is read back, including the two light ones", () => {
  for (const key of Object.keys(QUALITY_PRESETS)) {
    withStorage(() => {
      storeProcessingSettings({ quality: key });
      assert.equal(readProcessingSettings().quality, key);
    });
  }
});

// A preset dropped from a later build, or a hand-edited store, must not leave the uploader encoding
// against `undefined` — it falls back rather than carrying a preset that no longer exists.
test("a quality that is no longer a preset falls back to standard", () => {
  withStorage(() => {
    globalThis.localStorage.setItem("dbs.imageSelection.processingSettings", JSON.stringify({ quality: "ultra" }));
    assert.equal(readProcessingSettings().quality, "standard");
  });
});
