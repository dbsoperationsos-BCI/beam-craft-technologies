import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import manifest from "../src/app/manifest.js";

/*
 * Whether this application can still be installed to a home screen.
 *
 * Installing is decided entirely by things no screen ever shows: a field in the manifest, the size
 * of a PNG, a `<meta>` under a name nobody reads. Every one of them can be edited away by somebody
 * tidying up, and nothing in the application looks any different afterwards - the Install item just
 * quietly stops being offered, on devices the person making the change is not holding. So the rules
 * are written down here rather than left to be rediscovered.
 *
 * The rules themselves are Chrome's published installability criteria, which Edge and Android
 * Chrome share: https://web.dev/articles/install-criteria. Safari asks for none of this and installs
 * anything, but reads the manifest's name and the apple-touch-icon when they are there - which is
 * why the last test reads the layout as text.
 */

const ROOT = path.join(import.meta.dirname, "..");
const LAYOUT = fs.readFileSync(path.join(ROOT, "src", "app", "layout.js"), "utf8");

/** A PNG's real size, from its IHDR header - the first chunk, at a fixed offset in every PNG. */
function pngSize(file) {
  const header = Buffer.alloc(24);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, header, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  assert.equal(header.toString("ascii", 12, 16), "IHDR", `${file} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

test("the manifest meets Chrome's installability criteria", () => {
  const m = manifest();

  // One of the two is enough for the criteria; both are set so the install dialog and the label
  // under the icon each get the length they have room for.
  assert.ok(m.name, "a manifest with no name is not installable");
  assert.ok(m.short_name, "without short_name the home screen label is the full name, truncated");

  assert.ok(m.start_url, "start_url is required");
  /*
   * Chrome refuses to install when `display` is anything but these four - `browser`, the default,
   * means "this is a tab", and an installed tab is what the whole exercise is avoiding.
   */
  assert.ok(["fullscreen", "standalone", "minimal-ui", "window-controls-overlay"].includes(m.display));

  /*
   * Absent or false. Set true, it means "there is a real native app, offer that instead", and Chrome
   * takes it at its word and offers nothing.
   */
  assert.ok(!m.prefer_related_applications);

  // The launch has to be inside the scope, or the installed window opens straight back into a
  // browser tab.
  assert.ok(m.start_url.startsWith(m.scope), "start_url must sit inside scope");
});

test("the icons Chrome requires exist, at the sizes they claim", () => {
  const m = manifest();
  const any = m.icons.filter((icon) => icon.purpose === "any");

  /*
   * 192 and 512 both, and this is the criterion that breaks most often: an icon set regenerated at
   * one size, or a file renamed, and the manifest still names what is no longer there. A missing
   * icon is not an error anywhere - the install option simply stops appearing.
   */
  for (const size of [192, 512]) {
    assert.ok(any.some((icon) => icon.sizes === `${size}x${size}`), `no ${size}px icon`);
  }

  for (const icon of m.icons) {
    const file = path.join(ROOT, "public", icon.src);
    assert.ok(fs.existsSync(file), `${icon.src} is named by the manifest but not on disk`);
    const [declared] = icon.sizes.split("x").map(Number);
    const actual = pngSize(file);
    assert.deepEqual(actual, { width: declared, height: declared }, `${icon.src} is not ${icon.sizes}`);
  }
});

test("Android is given a maskable pair of its own", () => {
  const maskable = manifest().icons.filter((icon) => icon.purpose === "maskable");
  /*
   * Not decoration. A launcher cuts its own shape - circle, squircle, rounded square - out of
   * whatever it is handed and keeps the central 80%, so the `any` file, whose mark runs the full
   * width, comes out with the B and the C sliced off. Given no maskable icon at all Android does
   * the same cut to the `any` one, so dropping these does not fall back to something safe.
   */
  assert.equal(maskable.length, 2, "both sizes, or the launcher picks the any icon and crops it");
  for (const size of [192, 512]) {
    assert.ok(maskable.some((icon) => icon.sizes === `${size}x${size}`), `no ${size}px maskable icon`);
  }
});

test("iOS gets the tags it installs from, under both names", () => {
  /*
   * Safari reads none of the manifest's install fields. What it reads is here, and each line is a
   * device that otherwise gets something worse: no apple icon and the home screen shows a
   * screenshot of the page; no `apple-mobile-web-app-capable` and an iPhone on iOS 16 or earlier
   * opens the icon inside Safari, address bar and all.
   */
  assert.match(LAYOUT, /apple-touch-icon-180\.png/, "no apple-touch-icon for Add to Home Screen");
  assert.match(LAYOUT, /appleWebApp:\s*\{\s*capable:\s*true/, "iOS 17+ needs capable");
  assert.match(LAYOUT, /"apple-mobile-web-app-capable":\s*"yes"/, "iOS 16 and earlier need the old name");
});

test("the theme colour is on the viewport export, where Next 16 reads it", () => {
  /*
   * `themeColor` inside `metadata` is ignored by Next 16 - not warned about, ignored - and the
   * colour simply never reaches the page. It is the kind of move a tidy-up makes, gathering
   * appearance next to the other appearance, so it is pinned.
   */
  assert.match(LAYOUT, /export const viewport = \{[\s\S]*themeColor:/, "themeColor must live on viewport");
  assert.doesNotMatch(
    LAYOUT.slice(0, LAYOUT.indexOf("export const viewport")),
    /themeColor/,
    "themeColor inside metadata is silently dropped by Next 16",
  );
});
