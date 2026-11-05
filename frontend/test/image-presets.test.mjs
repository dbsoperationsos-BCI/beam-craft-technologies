import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import * as presets from "../src/lib/imagePresets.mjs";
import { planDerivatives, fitWithin, PREVIEW_TYPE, THUMBNAIL_TYPE } from "../src/lib/imageDerivatives.mjs";

const require = createRequire(import.meta.url);
// The server's one definition of the presets. Read directly so the browser's table cannot drift
// from the one the server's sharp fallbacks and validation use: a preset that meant one picture
// here and another there would be exactly the bug the shared table exists to prevent.
const server = require("../../backend/src/services/imagePresets.js");

const { PRESET_KEYS, IMAGE_PREVIEW_PRESETS, IMAGE_THUMBNAIL_PRESETS, COMPRESSION_MODULES, PREVIEW_LADDER, MIN_LADDER_QUALITY, PREVIEW_PRESET_OPTIONS, THUMBNAIL_PRESET_OPTIONS } = presets;

test("the browser's presets are the server's, table for table", () => {
  assert.deepEqual(PRESET_KEYS, server.PRESET_KEYS);
  assert.deepEqual(IMAGE_PREVIEW_PRESETS, server.IMAGE_PREVIEW_PRESETS);
  assert.deepEqual(IMAGE_THUMBNAIL_PRESETS, server.IMAGE_THUMBNAIL_PRESETS);
  assert.deepEqual(COMPRESSION_MODULES, server.COMPRESSION_MODULES);
  assert.deepEqual(PREVIEW_LADDER, server.PREVIEW_LADDER);
  assert.equal(MIN_LADDER_QUALITY, server.MIN_LADDER_QUALITY);
  // And the functions answer alike for the same inputs.
  for (const key of PRESET_KEYS) {
    assert.deepEqual(presets.recipeFor({ previewPreset: key, thumbnailPreset: key }), server.recipeFor({ previewPreset: key, thumbnailPreset: key }), key);
    assert.deepEqual(presets.previewRungs(presets.recipeFor({ previewPreset: key }).preview), server.previewRungs(server.recipeFor({ previewPreset: key }).preview), key);
    assert.equal(presets.previewPresetLabel(key), server.previewPresetLabel(key));
    assert.equal(presets.thumbnailPresetLabel(key), server.thumbnailPresetLabel(key));
  }
  for (const key of presets.MODULE_KEYS) assert.deepEqual(presets.resolveModulePresets(key, { previewMaxDimension: 1250, thumbnailSize: 300 }), server.resolveModulePresets(key, { previewMaxDimension: 1250, thumbnailSize: 300 }));
});

// The label is the only part of a preset anyone reads, and it repeats the numbers beside it, so
// a preset retuned without its label rewritten would leave the picker quoting a size the encoder
// is not aiming at - the one failure here a user would see.
test("every option's label quotes the long edge and the target it actually carries, heaviest first, in the order the picker shows", () => {
  for (const [options, family] of [[PREVIEW_PRESET_OPTIONS, IMAGE_PREVIEW_PRESETS], [THUMBNAIL_PRESET_OPTIONS, IMAGE_THUMBNAIL_PRESETS]]) {
    assert.deepEqual(options.map((option) => option.value), PRESET_KEYS);
    for (const option of options) {
      assert.match(option.label, new RegExp(`\\(${family[option.value].longEdge}px, ~${family[option.value].targetKb} KB\\)$`), option.label);
      assert.match(option.label, new RegExp(`^${family[option.value].label} `));
    }
  }
  assert.equal(PREVIEW_PRESET_OPTIONS[0].label, "High (2048px, ~300 KB)");
  assert.equal(THUMBNAIL_PRESET_OPTIONS[1].label, "Standard (480px, ~50 KB)");
});

test("the plan for a photo: the standard ladder is exactly the ladder this engine always walked, and the thumbnail its 480 px WebP", () => {
  const plan = planDerivatives();
  assert.deepEqual(plan.rungs, [{ longEdge: 1600, quality: 0.82 }, { longEdge: 1600, quality: 0.72 }, { longEdge: 1400, quality: 0.66 }, { longEdge: 1200, quality: 0.6 }, { longEdge: 1000, quality: 0.55 }]);
  assert.equal(plan.targetBytes, 200 * 1024);
  assert.deepEqual(plan.thumbnail, { longEdge: 480, quality: 0.76, type: THUMBNAIL_TYPE });
  assert.equal(PREVIEW_TYPE, "image/jpeg");
});

test("the older option pair still moves the standard ladder to that edge and ceiling, as it always did", () => {
  const plan = planDerivatives({ previewLongEdge: 2048, previewMaxBytes: 300 * 1024 });
  assert.deepEqual(plan.rungs.map((rung) => rung.longEdge), [2048, 2048, 1792, 1536, 1280]);
  assert.equal(plan.targetBytes, 300 * 1024);
});

test("a module recipe is taken as it is: the AI Feature gets one rung at the preset quality and never steps down", () => {
  const ai = planDerivatives(presets.recipeFor({ previewPreset: "high", thumbnailPreset: "light", byteLadder: false }));
  assert.deepEqual(ai.rungs, [{ longEdge: 2048, quality: 0.84 }]);
  assert.deepEqual(ai.thumbnail, { longEdge: 240, quality: 0.72, type: THUMBNAIL_TYPE });
  const jpegThumb = planDerivatives({ ...presets.recipeFor({ previewPreset: "high" }), thumbnail: { longEdge: 480, quality: 0.76, type: "image/jpeg" } });
  assert.equal(jpegThumb.thumbnail.type, "image/jpeg");
});

test("a photo is never enlarged, and a portrait keeps its aspect ratio", () => {
  assert.deepEqual(fitWithin(300, 200, 480), { width: 300, height: 200 });
  assert.deepEqual(fitWithin(4000, 6000, 1600), { width: 1067, height: 1600 });
  assert.deepEqual(fitWithin(0, 0, 480), { width: 1, height: 1 });
});
