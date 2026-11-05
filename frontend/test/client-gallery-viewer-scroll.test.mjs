import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Opening a photograph must not cost the client their place in the gallery.
 *
 * A client who had scrolled to the thousandth photograph, opened it and closed it again was put
 * back at the first: the viewer was returned *instead of* the gallery, so `FolderGrid` and
 * `FolderCards` unmounted and the pane that actually scrolls went with them. Closing built a new
 * pane, and a new pane starts at the top. The data was never the problem - the photos, the page
 * reached, the folder and the chosen people live on `PublicGallery`, which does not unmount.
 *
 * So the rule these hold is structural: the gallery stays in the tree while a photo is open, in
 * the same position, so React reconciles rather than remounts and the scroll position is never
 * lost in the first place. There is nothing to save and nothing to restore.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const GALLERY = src("components", "image-selection", "PublicGallery.js");
const VIEWER = src("components", "image-selection", "client-gallery", "ImageViewer.js");

test("the open photo is drawn over the gallery, never instead of it", () => {
  // The viewer is a value, not a branch that returns early before the gallery is rendered.
  assert.match(GALLERY, /const viewer = viewerIndex !== null && viewerItems\[viewerIndex\] \? \(/);
  assert.doesNotMatch(
    GALLERY,
    /if \(viewerIndex !== null[\s\S]{0,120}?\n\s*return \(/,
    "returning the viewer early is what unmounted the gallery and lost the scroll position",
  );
  // Both gallery branches keep it in the tree beside them.
  assert.match(GALLERY, /\{viewer\}\s*\n\s*<FolderGrid/, "the folder keeps its grid mounted under the photo");
  assert.match(GALLERY, /\{peoplePicker\}\{viewer\}<FolderCards/, "so does the gallery home");
});

test("the gallery underneath is held still while a photo is open, and let go afterwards", () => {
  assert.match(VIEWER, /document\.body\.style\.overflow = "hidden";[\s\S]*?document\.body\.style\.overflow = previous;/);
});

test("closing never waits on the history, and the entry is pushed once", () => {
  // Back - and a phone's back gesture - closes the photo rather than leaving the gallery.
  assert.match(VIEWER, /window\.history\.pushState\(\{ imageSelectionViewer: true \}, ""\)/);
  assert.match(VIEWER, /window\.addEventListener\("popstate", onPop\)/);
  // Pushed behind a ref: React mounts an effect twice in development, and a push in the effect
  // with a pop in its cleanup closed the photo the instant it was opened.
  assert.match(VIEWER, /if \(!entryRef\.current\) \{ window\.history\.pushState/);
  assert.doesNotMatch(VIEWER, /return \(\) => \{[^}]*if \(!popped\) window\.history\.back\(\)/, "the cleanup must not pop the entry");
  // The caller is told first and the history is tidied after, so the button always works.
  const from = VIEWER.indexOf("const close = () =>");
  const close = VIEWER.slice(from, VIEWER.indexOf("};", from));
  assert.ok(close.indexOf("closeRef.current?.()") < close.indexOf("window.history.back()"), "the photo closes before the history is touched");
  // Every way out goes through it.
  assert.match(VIEWER, /useEscapeKey\(close\)/);
  assert.match(VIEWER, /onClick=\{close\} aria-label="Back to gallery"/);
});
