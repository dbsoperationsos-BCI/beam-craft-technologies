import test from "node:test";
import assert from "node:assert/strict";
import { logoToneFor, BUNDLED_MARKS, LOGO_VARIANT_OPTIONS, contrastRatio, withAlpha, linkLabel, rowAspect, editorialRows, patternRows, storyRows, mixedRows, pairingFor, spacingPx, designVariables, fontStylesheetUrl, isDark, statusPresentation, publishBlocker, highlightsRemark, coverFormState, hasFormChanges, toDateInput, chapterNumber, aspectRatio, downloadAlbumLabel, isDownloadAlbumBusy, previewEditable } from "../src/lib/signatureAlbum.mjs";

const land = (id) => ({ id, width: 6000, height: 4000 });
const port = (id) => ({ id, width: 4000, height: 6000 });

test("the editorial layout falls into the story pattern and never shows a portrait alone at full width", () => {
  const rows = editorialRows([land(1), land(2), land(3), land(4), land(5), land(6), land(7), land(8)]);
  assert.deepEqual(rows.map((row) => row.length), [1, 2, 1, 3, 1]);
  const withPortrait = editorialRows([port(1), port(2), land(3)]);
  assert.deepEqual(withPortrait.map((row) => row.length), [2, 1]);
  assert.deepEqual(editorialRows([]), []);
  // Stable as more arrive: the first rows of a longer list are the rows of the shorter one.
  const short = editorialRows([land(1), land(2), land(3)]);
  const long = editorialRows([land(1), land(2), land(3), land(4), land(5)]);
  assert.deepEqual(long.slice(0, short.length - 1), short.slice(0, -1));
});

test("a design becomes CSS variables and a Google Fonts sheet, and a dark background is read as dark", () => {
  const variables = designVariables({ backgroundColor: "#0b0b0d", textColor: "#f5f5f4", accentColor: "#c9a86a", headingFont: "DM Serif Display", bodyFont: "Nunito Sans", imageSpacing: "SPACIOUS" });
  assert.equal(variables["--album-bg"], "#0b0b0d");
  // A design carrying its theme's muted tone, border and overlay draws them; an older one is
  // answered from the background as before.
  const themed = designVariables({ backgroundColor: "#111111", mutedTextColor: "#aaa7a0", borderColor: "#2b2b2b", overlay: { color: "#000000", from: 0.86, to: 0.3 } });
  assert.equal(themed["--album-muted"], "#aaa7a0");
  assert.equal(themed["--album-line"], "#2b2b2b");
  assert.match(themed["--album-overlay"], /^linear-gradient\(to top, rgba\(0,0,0,0\.86\), rgba\(0,0,0,0\.3\) 55%/);
  assert.equal(withAlpha("#c6a86a", 0.5), "rgba(198,168,106,0.5)");
  assert.equal(Math.round(contrastRatio("#ffffff", "#000000")), 21);
  assert.ok(contrastRatio("#f5f5f3", "#111111") > 15);
  assert.ok(contrastRatio("#a3a3a3", "#ffffff") < 3);
  assert.equal(contrastRatio("nope", "#000000"), null);
  assert.equal(variables["--album-gap"], "28px");
  assert.match(variables["--album-heading-font"], /"DM Serif Display"/);
  // The album's logo tone: pinned, else from the surface the server named, else from the colour.
  assert.equal(logoToneFor({ logoVariant: "LIGHT", darkSurface: true }), "LIGHT");
  assert.equal(logoToneFor({ logoVariant: "AUTO", darkSurface: true }), "DARK");
  assert.equal(logoToneFor({ backgroundColor: "#111111" }), "DARK");
  assert.equal(logoToneFor({ backgroundColor: "#f7f1e7" }), "LIGHT");
  assert.equal(logoToneFor(null), "LIGHT");
  assert.deepEqual(LOGO_VARIANT_OPTIONS.map((option) => option.value), ["AUTO", "DARK", "LIGHT"]);
  assert.match(BUNDLED_MARKS.DARK, /white-text/);
  assert.match(BUNDLED_MARKS.LIGHT, /black-text/);
  assert.equal(isDark("#0b0b0d"), true);
  assert.equal(isDark("#faf7f2"), false);
  assert.equal(isDark("nope"), false);
  const url = fontStylesheetUrl({ headingFont: "Playfair Display", bodyFont: "Inter" });
  assert.match(url, /family=Playfair\+Display/);
  assert.match(url, /family=Inter/);
  assert.equal(fontStylesheetUrl({ headingFont: "Inter", bodyFont: "Inter" }).split("family=").length, 2);
  assert.equal(fontStylesheetUrl({}), "");
  // A family names only the axes it has, so Prata (400 alone) cannot break the request.
  assert.equal(fontStylesheetUrl({ headingFont: "Prata", bodyFont: "Lato" }), "https://fonts.googleapis.com/css2?family=Prata&family=Lato:ital,wght@0,300;0,400;0,700;1,400&display=swap");
  assert.match(fontStylesheetUrl({ headingFont: "Cinzel" }), /family=Cinzel:wght@400;500;600/);
});

test("the added layouts fall into fixed patterns and the spacing scale keeps Standard where it was", () => {
  const items = Array.from({ length: 9 }, (_, index) => ({ id: index }));
  assert.deepEqual(storyRows(items).map((row) => row.length), [1, 2, 1, 2, 1, 2]);
  assert.deepEqual(mixedRows(items).map((row) => row.length), [1, 2, 3, 2, 1]);
  assert.deepEqual(patternRows([], [1, 2]), []);
  assert.equal(spacingPx("STANDARD"), 12);
  assert.equal(spacingPx("TIGHT"), 2);
  assert.equal(spacingPx("AIRY"), 48);
  assert.equal(spacingPx(undefined), 12);
  assert.equal(pairingFor("Playfair Display", "Inter"), "ELEGANT");
  assert.equal(pairingFor("Playfair Display", "Lato"), "");
});

test("a row's frame follows what is in it, so the crop is the smallest it can be", () => {
  const land = { width: 6000, height: 4000 }; const port = { width: 4000, height: 6000 }; const square = { width: 3000, height: 3000 };
  assert.equal(rowAspect([land, land]), "3 / 2");
  assert.equal(rowAspect([port, port, port]), "2 / 3");
  assert.equal(rowAspect([port, land]), "4 / 5");
  assert.equal(rowAspect([land, land, port]), "5 / 4");
  assert.equal(rowAspect([square, square]), "1 / 1");
  assert.equal(rowAspect([{}, {}]), "3 / 2");
});

test("an ending link is named after the site or the handle it points at", () => {
  assert.equal(linkLabel("https://www.dontblinkstudioz.com/"), "dontblinkstudioz.com");
  assert.equal(linkLabel("operations.dontblinkstudioz.com"), "operations.dontblinkstudioz.com");
  assert.equal(linkLabel("https://instagram.com/dontblinkstudioz", "instagram"), "@dontblinkstudioz");
  assert.equal(linkLabel("https://www.instagram.com/@dontblinkstudioz/", "instagram"), "@dontblinkstudioz");
  assert.equal(linkLabel("https://operations.dontblinkstudioz.com/", "instagram"), "operations.dontblinkstudioz.com");
  assert.equal(linkLabel("", "instagram"), "");
  assert.equal(linkLabel("not a url at all", "website"), "Website");
});

test("status, blockers and remarks read as the rail shows them", () => {
  assert.equal(statusPresentation("PUBLISHED").label, "Published");
  assert.equal(statusPresentation("nonsense").label, "Draft");
  assert.equal(publishBlocker([]), "");
  assert.equal(publishBlocker([{ message: "Please select a cover image." }]), "Please select a cover image.");
  assert.equal(publishBlocker([{ message: "A" }, { message: "B" }, { message: "C" }]), "A (2 more)");
  assert.match(highlightsRemark(0), /10 to 30/);
  assert.match(highlightsRemark(4), /recommended/);
  assert.match(highlightsRemark(30), /most the section holds/);
});

test("the cover form is built from the album and knows when it changed", () => {
  const initial = coverFormState({ title: "Ajay & Priya", subtitle: "", eventDate: "2026-02-11T18:30:00.000Z", coverAlignment: "CENTER" });
  assert.equal(initial.eventDate, "2026-02-12");
  assert.equal(hasFormChanges(initial, { ...initial }), false);
  assert.equal(hasFormChanges(initial, { ...initial, subtitle: "Our Wedding Story" }), true);
  assert.equal(toDateInput(null), "");
  assert.equal(chapterNumber(0), "01");
  assert.equal(aspectRatio(port(1)), "4000 / 6000");
  assert.equal(aspectRatio({}), "3 / 2");
});

test("the Download Album control reads its state and is busy while the PDF is prepared and handed over", () => {
  assert.equal(downloadAlbumLabel("idle"), "Download album");
  assert.equal(downloadAlbumLabel("preparing"), "Preparing album...");
  assert.equal(downloadAlbumLabel("downloading"), "Downloading…");
  assert.equal(downloadAlbumLabel("error"), "Retry Download");
  assert.equal(downloadAlbumLabel(undefined), "Download album");
  assert.deepEqual(["idle", "preparing", "downloading", "error"].map(isDownloadAlbumBusy), [false, true, true, false]);
});

test("the studio's preview is editable only when asked for and the viewer may write the album", () => {
  assert.equal(previewEditable(true, true), true);
  assert.equal(previewEditable(true, false), false, "?edit=1 alone is not enough");
  assert.equal(previewEditable(false, true), false);
});
