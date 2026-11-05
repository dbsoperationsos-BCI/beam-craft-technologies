import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BUNDLED_FAVICON, MAX_FAVICON_BYTES,
  faviconFileError, faviconFor, faviconIcons,
} from "../src/lib/favicon.mjs";

const MARK = "https://cdn.example.com/favicon.svg";

test("the uploaded mark is worn on every tab", () => {
  assert.equal(faviconFor({ faviconUrl: MARK }), MARK);
});

test("with nothing uploaded, the bundled mark stands", () => {
  assert.equal(faviconFor(null), BUNDLED_FAVICON);
  assert.equal(faviconFor(undefined), BUNDLED_FAVICON);
  assert.equal(faviconFor({}), BUNDLED_FAVICON);
  // Blank and whitespace are "not uploaded", not "uploaded as nothing" — a saved empty string must
  // not leave a tab with no icon at all.
  assert.equal(faviconFor({ faviconUrl: "" }), BUNDLED_FAVICON);
  assert.equal(faviconFor({ faviconUrl: "   " }), BUNDLED_FAVICON);
});

const DARK_MARK = "https://cdn.example.com/favicon-dark.svg";

test("each tab strip wears the mark uploaded for it", () => {
  const both = { faviconUrl: MARK, faviconDarkUrl: DARK_MARK };
  assert.equal(faviconFor(both, false), MARK);
  assert.equal(faviconFor(both, true), DARK_MARK);
});

test("a single upload serves both strips, whichever it was made for", () => {
  // Uploaded once, for the light strip: the dark strip borrows it rather than falling to the bundle.
  assert.equal(faviconFor({ faviconUrl: MARK }, true), MARK);
  // Uploaded once, for the dark strip: the light strip borrows it the same way.
  assert.equal(faviconFor({ faviconDarkUrl: DARK_MARK }, false), DARK_MARK);
  assert.equal(faviconFor({ faviconDarkUrl: DARK_MARK }, true), DARK_MARK);
  // Blank in one slot is "not uploaded", and the other slot stands in.
  assert.equal(faviconFor({ faviconUrl: "  ", faviconDarkUrl: DARK_MARK }, false), DARK_MARK);
});

test("the bundled mark is one file, and stands behind an empty pair on either strip", () => {
  assert.equal(BUNDLED_FAVICON, "/brand/favicon.svg");
  assert.equal(faviconFor(null, true), BUNDLED_FAVICON);
  assert.equal(faviconFor({ faviconUrl: "", faviconDarkUrl: null }, true), BUNDLED_FAVICON);
  // The strip is optional in the call, and unstated means light.
  assert.equal(faviconFor({ faviconUrl: MARK, faviconDarkUrl: DARK_MARK }), MARK);
});

test("a file is checked before it is uploaded, on the same rules the API applies", () => {
  assert.equal(faviconFileError({ type: "image/png", size: 4096 }), "");
  assert.equal(faviconFileError({ type: "image/svg+xml", size: 900 }), "");
  assert.match(faviconFileError({ type: "image/jpeg", size: 900 }), /PNG or an SVG/);
  assert.match(faviconFileError({ type: "image/webp", size: 900 }), /PNG or an SVG/);
  assert.match(faviconFileError({ type: "image/png", size: MAX_FAVICON_BYTES + 1 }), /smaller than 5 MB/);
  assert.equal(faviconFileError(null), "", "nothing picked is not an error");
});

test("the page's own head carries the uploaded marks, one per tab strip, and the bundled one only when nothing is uploaded", () => {
  const light = "https://r2.test/favicons/light.png";
  const dark = "https://r2.test/favicons/dark.svg";
  assert.deepEqual(faviconIcons({ faviconUrl: light, faviconDarkUrl: dark }), [
    { url: light, type: "image/png", media: "(prefers-color-scheme: light)" },
    { url: dark, type: "image/svg+xml", media: "(prefers-color-scheme: dark)" },
  ]);
  // One upload serves both strips.
  assert.deepEqual(faviconIcons({ faviconUrl: light }), [{ url: light, type: "image/png" }]);
  assert.deepEqual(faviconIcons({ faviconDarkUrl: dark }), [{ url: dark, type: "image/svg+xml" }]);
  // Nothing uploaded, or the branding unreadable: the bundled mark.
  assert.deepEqual(faviconIcons(null), [{ url: BUNDLED_FAVICON, type: "image/svg+xml" }]);
  assert.deepEqual(faviconIcons({}), [{ url: BUNDLED_FAVICON, type: "image/svg+xml" }]);
});

test("the root layout writes the studio's marks on the server, and the tab script waits for the branding before touching them", () => {
  const layout = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "app", "layout.js"), "utf8");
  assert.match(layout, /export async function generateMetadata\(\)/);
  assert.match(layout, /icon: faviconIcons\(branding\)/);
  assert.ok(!/icon: \[\{ url: BUNDLED_FAVICON/.test(layout), "the bundled mark is no longer declared unconditionally");
  const tab = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "shared", "StudioFavicon.js"), "utf8");
  assert.match(tab, /const href = branding \? faviconFor\(branding, dark\) : "";/);
});

test("a competing mark is disarmed, never removed - React owns the tags the server wrote", () => {
  /*
   * `metadata.icons` reaches the page as `<link rel="icon" href>` elements, and React hoists every
   * one of those into the head as a resource it deletes itself. Detaching one leaves React removing
   * a node whose `parentNode` is already null, which throws "Cannot read properties of null
   * (reading 'removeChild')" out of `commitDeletionEffectsOnFiber` - on a later navigation, with a
   * stack that names nothing in this application. So the tab may rewrite a competing tag but must
   * never take it out of the head.
   */
  const tab = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "shared", "StudioFavicon.js"), "utf8");
  assert.ok(!/\.remove\(\)/.test(tab), "a <link rel=\"icon\"> is detached again - React deletes the ones it hoisted");
  // Dropping the `rel` is all the browser needs to ignore a tag, and the node stays where React put it.
  assert.match(tab, /stale\.setAttribute\("rel", "studio-favicon-replaced"\);/);
  // And the `rel` goes back, so nothing is left disarmed once the tab stops drawing its own mark.
  assert.match(tab, /if \(rel !== null\) stale\.setAttribute\("rel", rel\);/);
});
