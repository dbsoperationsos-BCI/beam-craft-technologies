import assert from "node:assert/strict";
import test from "node:test";
import {
  BUNDLED_FAVICON, MAX_FAVICON_BYTES,
  faviconFileError, faviconFor,
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

test("the bundled mark is one file, not a pair chosen by tab theme", () => {
  assert.equal(BUNDLED_FAVICON, "/brand/favicon.svg");
  // The old signature took the tab strip's darkness; nothing may depend on it any more.
  assert.equal(faviconFor(null, true), faviconFor(null, false));
  assert.equal(faviconFor({ faviconUrl: MARK }, true), faviconFor({ faviconUrl: MARK }, false));
});

test("a file is checked before it is uploaded, on the same rules the API applies", () => {
  assert.equal(faviconFileError({ type: "image/png", size: 4096 }), "");
  assert.equal(faviconFileError({ type: "image/svg+xml", size: 900 }), "");
  assert.match(faviconFileError({ type: "image/jpeg", size: 900 }), /PNG or an SVG/);
  assert.match(faviconFileError({ type: "image/webp", size: 900 }), /PNG or an SVG/);
  assert.match(faviconFileError({ type: "image/png", size: MAX_FAVICON_BYTES + 1 }), /smaller than 5 MB/);
  assert.equal(faviconFileError(null), "", "nothing picked is not an error");
});
