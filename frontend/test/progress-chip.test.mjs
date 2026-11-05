import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PROGRESS_CHIP_CLASS, PROGRESS_COLORS, progressChipStyle } from "../src/lib/progressStatus.mjs";

// The chip's look lives in the stylesheet so each theme can set its own; the style may only carry
// the color. An inline `color` or `backgroundColor` here would beat every dark-theme rule.
test("a progress chip passes its color as a custom property and nothing inline", () => {
  assert.deepEqual(progressChipStyle(PROGRESS_COLORS.inProgress), { "--progress-color": PROGRESS_COLORS.inProgress });
});

test("the stylesheet styles the chip class in light mode and both dark themes", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.ok(css.includes(`.${PROGRESS_CHIP_CLASS} {`));
  assert.ok(css.includes(`[data-theme="dark"] .${PROGRESS_CHIP_CLASS}`));
  assert.ok(css.includes(`[data-theme="enhanced-dark"] .${PROGRESS_CHIP_CLASS}`));
});
