import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { viewerIndexAfterRemoval } from "../src/lib/aiFeature.mjs";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", "components", "ai-feature", ...parts), "utf8");

/*
 * The AI Feature media viewer: one picture over the gallery on the application's own surfaces,
 * Delete that asks first, and a delete that leaves the viewer on a photo that exists.
 */
test("after a delete the viewer lands on the photo that slid into place, the previous one at the end, and closes when none is left", () => {
  assert.equal(viewerIndexAfterRemoval(49, 99), 49, "the next photo now sits at the same index");
  assert.equal(viewerIndexAfterRemoval(0, 99), 0, "deleting the first shows the new first");
  assert.equal(viewerIndexAfterRemoval(99, 99), 98, "deleting the last shows the new last");
  assert.equal(viewerIndexAfterRemoval(0, 0), -1, "the only photo: the viewer closes");
  assert.equal(viewerIndexAfterRemoval(5, undefined), -1);
});

test("the viewer shell is a theme-aware layer: neutral backdrop, light control surfaces, no hard-coded dark page", () => {
  // The shell moved to the shared components (develop), the media viewer's design with it.
  const shell = fs.readFileSync(path.join(process.cwd(), "src", "components", "shared", "Lightbox.js"), "utf8");
  assert.match(shell, /bg-slate-800\/65 backdrop-blur-\[6px\]/, "a translucent, blurred scrim: the gallery stays recognisable, the picture dominates");
  assert.doesNotMatch(shell, /bg-slate-950|bg-black|shadow-|bg-white|bg-white\/9/, "no dark page, no cards, no shadows");
  assert.match(shell, /export const GLASS = "border border-white\/15 bg-slate-900\/35 text-white\/85 backdrop-blur-md transition-colors duration-150/, "one glass language for every control");
  assert.match(shell, /<IconButton label="Close" size="md" shape="circle" variant="plain"/, "a 40 px round close target");
  assert.match(shell, /disabled=\{!hasPrev \|\| paused\}/, "both arrows always drawn, disabled at the ends");
  assert.match(shell, /disabled=\{!hasNext \|\| paused\}/);
  assert.match(shell, /useFocusTrap\(true\)/);
  assert.match(shell, /document\.body\.style\.overflow = "hidden"/, "the page under the layer is locked");
  assert.match(shell, /document\.body\.style\.overflow = previous/, "and restored on close");
  assert.match(shell, /px-16 py-4 sm:px-24/, "a lane either side so the arrows never sit on the photo");
  assert.match(shell, /max-h-full max-w-full rounded-sm object-contain/, "the picture keeps its ratio inside the stage");
  assert.match(shell, /event\.key === "ArrowLeft" && hasPrev/);
  assert.match(shell, /event\.key === "ArrowRight" && hasNext/);
  assert.match(shell, /event\.key === "Delete" && onDeleteKey/, "Delete only asks");
  assert.doesNotMatch(shell, /Backspace/, "Backspace is too easy to hit by accident");
  assert.match(shell, /if \(paused \|\| event\.defaultPrevented\) return;/, "keys are silent under a confirmation or while a delete runs");
  assert.match(shell, /useEscapeKey\(onClose, !paused\)/);
  assert.doesNotMatch(shell, /hover:bg-white|hover:bg-slate-50|hover:bg-red-50/, "no hover fill the dark themes do not repaint");
  assert.match(shell, /focus-visible:ring-2 focus-visible:ring-white\/70/, "a visible focus ring on the glass");
  for (const icon of ["ChevronLeft", "ChevronRight", "Close"]) assert.match(shell, new RegExp(`from "@mui/icons-material/${icon}"`));
  assert.doesNotMatch(shell, />[✕‹›]</, "no text glyphs for icons");
});

test("the media viewer shows the file name, faces and size, no processing pill, and a quiet Delete that asks first", () => {
  const viewer = read("event", "MediaLightbox.js");
  assert.doesNotMatch(viewer, /StatusChip/, "no Processed / Queued / Completed badge");
  assert.match(viewer, /title=\{media\.fileName\}/);
  assert.match(viewer, /\.join\(" · "\)/, "faces · size on the second line");
  assert.match(viewer, /media\.aiStatus === "FAILED" &&/, "only the exceptional state is said, in words");
  assert.match(viewer, /from "@mui\/icons-material\/DeleteOutlined"/, "the icon the installed package ships (DeleteOutline does not resolve)");
  assert.match(viewer, /size="md" variant="plain" className=\{`gap-1\.5 rounded-full px-4 text-red-200 hover:text-red-100 \$\{GLASS\}`\} disabled=\{paused\} onClick=\{askDelete\}/, "a 40 px glass pill in the shell's language, inert while paused");
  assert.doesNotMatch(viewer, /bg-white|shadow-/, "no card under the picture");
  assert.match(viewer, /onDeleteKey=\{askDelete\}/);
  assert.match(viewer, /scanning \? "Finding faces…"/, "a photo still being scanned says so instead of showing no count");
  assert.match(viewer, /Face processing failed\. Retry from the processing card above the gallery\./, "the failed state names the next step, the raw error stays in the title");
  const tab = read("event", "tabs", "MediaTab.js");
  assert.match(tab, /onDelete=\{canWrite \? \(media\) => setConfirm\(\{ kind: "media", media \}\) : undefined\}/, "the viewer's Delete opens the confirmation, never deletes");
  assert.match(tab, /if \(lightbox >= 0\) setLightbox\(viewerIndexAfterRemoval\(/);
  assert.match(tab, /paused=\{busy \|\| confirm\?\.kind === "media"\}/, "the viewer is inert under its confirmation and during the delete");
  assert.match(tab, /photoIndex=\{index\}/);
  assert.match(tab, /querySelector\(`\[data-photo-index="\$\{at\}"\]`\)/, "closing returns focus to the tile the viewer was left on");
  assert.match(tab, /loadFolders\(\); reloadEvent\?\.\(\); reloadProcessing\(\);/, "counts are the server's, and the list is not reloaded");
  assert.doesNotMatch(tab.slice(tab.indexOf("async function removeMedia"), tab.indexOf("async function removeFolder")), /bumpMedia\(\)/, "a single delete never resets the gallery");
});
