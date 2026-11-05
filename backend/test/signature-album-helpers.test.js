const test = require("node:test");
const assert = require("node:assert/strict");
const { publishProblems, deriveStatus, applyOrder, resolveDesign, clientUrlFor, formatDay, transformOf, isDarkColor, logoFor, brandingFor, albumPdfFileName } = require("../src/modules/image-selection/signature-album/signatureAlbum.helpers");
const { albumMessage, generatePin } = require("../src/modules/image-selection/signature-album/signatureAlbum.share.service");
const { THEME_DEFAULTS, THEME_PRESETS, HEADING_FONTS, BODY_FONTS } = require("../src/modules/image-selection/signature-album/signatureAlbum.constants");

const now = new Date("2026-09-24T10:00:00Z");

test("publish validation names each missing thing, and an album with everything is READY", () => {
  const empty = publishProblems({ title: "", coverImageId: null, expiresAt: null }, { chapterCount: 0, photoCount: 0, now });
  assert.deepEqual(empty.map((problem) => problem.code), ["COVER", "TITLE", "PHOTOS"], "no chapter to add: an upload makes one");
  const past = publishProblems({ title: "A & P", coverImageId: "img-1", expiresAt: new Date("2026-01-01") }, { chapterCount: 1, photoCount: 1, now });
  assert.deepEqual(past.map((problem) => problem.code), ["EXPIRY"]);
  assert.deepEqual(publishProblems({ title: "A & P", coverImageId: "img-1", expiresAt: new Date("2027-01-01") }, { chapterCount: 1, photoCount: 1, now }), []);
});

test("the status the studio reads is derived: DRAFT / READY from the problems, PUBLISHED / EXPIRED from the row", () => {
  assert.equal(deriveStatus({ status: "DRAFT" }, [{ code: "COVER" }], now), "DRAFT");
  assert.equal(deriveStatus({ status: "DRAFT" }, [], now), "READY");
  assert.equal(deriveStatus({ status: "PUBLISHED", expiresAt: new Date("2027-01-01") }, [], now), "PUBLISHED");
  assert.equal(deriveStatus({ status: "PUBLISHED", expiresAt: new Date("2026-01-01") }, [], now), "EXPIRED");
  assert.equal(deriveStatus({ status: "EXPIRED" }, [], now), "EXPIRED");
});

test("reordering keeps unnamed rows after the named ones and refuses a stranger", () => {
  assert.deepEqual(applyOrder(["a", "b", "c", "d"], ["c", "a"]), ["c", "a", "b", "d"]);
  assert.deepEqual(applyOrder(["a", "b"], ["b", "a", "b"]), ["b", "a"]);
  assert.throws(() => applyOrder(["a"], ["z"]), /not in this list/);
});

test("a design answers from the theme where the album left a column null, and keeps what the studio chose", () => {
  const design = resolveDesign({ theme: "CINEMATIC", coverStyle: "SPLIT", layoutStyle: "GRID", imageSpacing: "COMPACT", coverAlignment: "LEFT", accentColor: "#ff0000", backgroundColor: null, textColor: null, headingFont: null, bodyFont: null });
  assert.equal(design.backgroundColor, THEME_DEFAULTS.CINEMATIC.backgroundColor);
  assert.equal(design.accentColor, "#ff0000");
  assert.equal(design.headingFont, THEME_DEFAULTS.CINEMATIC.headingFont);
  assert.deepEqual(design.overrides, { backgroundColor: null, textColor: null, accentColor: "#ff0000", headingFont: null, bodyFont: null });
  // An unknown theme falls back rather than drawing nothing.
  assert.equal(resolveDesign({ theme: "NOPE" }).theme, "EDITORIAL");
  // Every theme is a full preset, and a design carries the theme's muted tone, border and overlay
  // beside the five the studio may change; "customized" is those five differing from the preset.
  for (const [theme, preset] of Object.entries(THEME_PRESETS)) {
    for (const key of ["backgroundColor", "textColor", "mutedTextColor", "accentColor", "borderColor"]) assert.match(preset[key], /^#[0-9a-f]{6}$/, `${theme}.${key}`);
    assert.ok(HEADING_FONTS.includes(preset.headingFont) && BODY_FONTS.includes(preset.bodyFont), `${theme} fonts are offered`);
    assert.ok(preset.overlay.from > preset.overlay.to, `${theme} overlay fades`);
    const resolved = resolveDesign({ theme });
    assert.equal(resolved.customized, false);
    assert.equal(resolved.mutedTextColor, preset.mutedTextColor);
    assert.deepEqual(resolved.overlay, preset.overlay);
  }
  assert.equal(THEME_DEFAULTS, THEME_PRESETS);
  assert.equal(resolveDesign({ theme: "CINEMATIC" }).headingFont, "Cormorant Garamond");
  const custom = resolveDesign({ theme: "CINEMATIC", accentColor: "#800020" });
  assert.equal(custom.customized, true);
  assert.equal(custom.accentColor, "#800020");
  assert.equal(resolveDesign({ theme: "CINEMATIC", accentColor: "#C6A86A" }).customized, false, "the preset's own value in another case is not a customisation");
});

test("the album draws the Global Logo for its ground: the dark-mode mark on a dark background, the light-mode mark on a light one, pinned only on request", () => {
  assert.equal(isDarkColor("#111111"), true);
  assert.equal(isDarkColor("#f7f1e7"), false);
  assert.equal(isDarkColor("not a colour"), false);
  // Every dark preset is a dark surface and every light one is not, so AUTO answers by theme too.
  for (const theme of ["CINEMATIC", "LUXURY"]) assert.equal(resolveDesign({ theme }).darkSurface, true, theme);
  for (const theme of ["CLASSIC", "EDITORIAL", "MINIMAL", "ROMANTIC", "MODERN", "VINTAGE"]) assert.equal(resolveDesign({ theme }).darkSurface, false, theme);
  // A background changed by hand decides, not the theme's name; an unknown variant reads as AUTO.
  assert.equal(resolveDesign({ theme: "CLASSIC", backgroundColor: "#0b0b0d" }).darkSurface, true);
  assert.equal(resolveDesign({ theme: "CINEMATIC", backgroundColor: "#ffffff" }).darkSurface, false);
  assert.equal(resolveDesign({ theme: "CLASSIC" }).logoVariant, "AUTO");
  assert.equal(resolveDesign({ theme: "CLASSIC", logoVariant: "nope" }).logoVariant, "AUTO");
  assert.equal(resolveDesign({ theme: "CLASSIC", logoVariant: "DARK" }).logoVariant, "DARK");

  const both = { light: "https://cdn/light.png", dark: "https://cdn/dark.png" };
  assert.deepEqual(logoFor({ logoVariant: "AUTO", darkSurface: true }, both), { tone: "DARK", url: "https://cdn/dark.png", ownMark: true });
  assert.deepEqual(logoFor({ logoVariant: "AUTO", darkSurface: false }, both), { tone: "LIGHT", url: "https://cdn/light.png", ownMark: true });
  assert.deepEqual(logoFor({ logoVariant: "LIGHT", darkSurface: true }, both), { tone: "LIGHT", url: "https://cdn/light.png", ownMark: true }, "a pinned variant wins over the ground");
  assert.deepEqual(logoFor({ logoVariant: "DARK", darkSurface: false }, both), { tone: "DARK", url: "https://cdn/dark.png", ownMark: true });
  // Only one upload: the other ground borrows it and says so, so the page can plate it.
  assert.deepEqual(logoFor({ logoVariant: "AUTO", darkSurface: true }, { light: "https://cdn/light.png" }), { tone: "DARK", url: "https://cdn/light.png", ownMark: false });
  assert.deepEqual(logoFor({ logoVariant: "AUTO", darkSurface: false }, { dark: "https://cdn/dark.png" }), { tone: "LIGHT", url: "https://cdn/dark.png", ownMark: false });
  // No upload: the bundled mark in the wanted tone, which is the page's own.
  assert.deepEqual(logoFor({ logoVariant: "AUTO", darkSurface: true }, {}), { tone: "DARK", url: null, ownMark: true });

  const settings = { useGlobalLogo: true, showStudioName: true, showStudioLogo: true, showBrandingFooter: true, endingShowLogo: true };
  const studio = { studioName: "Dont Blink", galleryLogoUrl: "https://cdn/light.png", galleryLogoDarkUrl: "https://cdn/dark.png" };
  const cinematic = brandingFor({ theme: "CINEMATIC" }, settings, studio);
  assert.equal(cinematic.logoUrl, "https://cdn/dark.png");
  assert.deepEqual(cinematic.logo, { tone: "DARK", url: "https://cdn/dark.png", ownMark: true });
  assert.equal(brandingFor({ theme: "CLASSIC" }, settings, studio).logoUrl, "https://cdn/light.png");
  // A snapshot from before the dark-mode mark travelled on it reads today's dark-mode mark, so a
  // published dark album gains the right logo without being republished.
  const old = brandingFor({ theme: "LUXURY", brandingSnapshot: { studioName: "Then", galleryLogoUrl: "https://cdn/then-light.png" } }, settings, studio);
  assert.equal(old.studioName, "Then");
  assert.deepEqual(old.logo, { tone: "DARK", url: "https://cdn/dark.png", ownMark: true });
  // The Global Logo switched off: the bundled mark, in the album's tone; the logo switched off: none.
  assert.deepEqual(brandingFor({ theme: "LUXURY" }, { ...settings, useGlobalLogo: false }, studio).logo, { tone: "DARK", url: null, ownMark: true });
  assert.equal(brandingFor({ theme: "LUXURY" }, { ...settings, showStudioLogo: false }, studio).logo, null);
});

test("a photo's position reads as FILL, centred, 1x until the studio adjusts it, and never outside its limits", () => {
  assert.deepEqual(transformOf({}), { displayMode: "FILL", focalX: 50, focalY: 50, zoom: 1, adjusted: false });
  assert.deepEqual(transformOf({ displayMode: "FIT", focalX: 52, focalY: 38, zoom: 1.15 }), { displayMode: "FIT", focalX: 52, focalY: 38, zoom: 1.15, adjusted: true });
  assert.equal(transformOf({ focalX: 400, zoom: 9 }).focalX, 100);
  assert.equal(transformOf({ focalX: 400, zoom: 9 }).zoom, 2);
  assert.deepEqual(transformOf({ coverDisplayMode: "FIT", coverFocalX: 10, coverFocalY: 90, coverZoom: 1.5 }, "cover"), { displayMode: "FIT", focalX: 10, focalY: 90, zoom: 1.5, adjusted: true });
  assert.equal(transformOf({ coverFocalX: null }, "cover").adjusted, false);
});

test("the client link is the short code under the album host, never an id", () => {
  process.env.SIGNATURE_ALBUM_PUBLIC_URL = "https://album.example.com/";
  assert.equal(clientUrlFor("X7K9P2"), "https://album.example.com/X7K9P2");
  delete process.env.SIGNATURE_ALBUM_PUBLIC_URL;
  process.env.FRONTEND_URL = "http://localhost:3000";
  assert.equal(clientUrlFor("X7K9P2"), "http://localhost:3000/a/X7K9P2");
  assert.equal(clientUrlFor(null), null);
});

test("the WhatsApp message carries the link, the PIN and the expiry, and drops the lines it cannot fill", () => {
  const withPin = albumMessage({ clientName: "Ajay & Priya", clientUrl: "https://a/X", pin: "0047", expiresAt: new Date("2027-03-23T00:00:00Z"), studioName: "Studio" });
  assert.match(withPin, /Hi Ajay & Priya,/);
  assert.match(withPin, /PIN:\n0047/);
  assert.match(withPin, /Valid until:\n23 March 2027/);
  const noPin = albumMessage({ clientName: "", clientUrl: "https://a/X", pin: null, expiresAt: null, studioName: "" });
  assert.ok(!noPin.includes("PIN"));
  assert.ok(!noPin.includes("Valid until"));
  assert.match(noPin, /Hi there,/);
});

test("a PIN is padded digits of the configured length, and the day is read in the studio's time zone", () => {
  for (let index = 0; index < 50; index += 1) assert.match(generatePin(4), /^\d{4}$/);
  assert.match(generatePin(6), /^\d{6}$/);
  assert.match(generatePin(99), /^\d{6}$/);
  assert.equal(formatDay("2027-03-22T20:00:00Z"), "23 March 2027");
  assert.equal(formatDay(null), "");
});

test("the album's PDF is named safely after its title", () => {
  assert.equal(albumPdfFileName({ title: "Ranju & Raj" }), "ranju-raj-signature-album.pdf");
  assert.equal(albumPdfFileName({ title: "  ../../etc/passwd  " }), "etc-passwd-signature-album.pdf");
  assert.equal(albumPdfFileName({ title: "Émilie 🎉" }), "emilie-signature-album.pdf");
  assert.equal(albumPdfFileName({ title: "" }), "signature-album.pdf");
});
