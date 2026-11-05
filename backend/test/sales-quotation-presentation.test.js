const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_PDF_ASSETS, DEFAULT_JOURNEY, mergePdfAssets } = require("../src/modules/sales/quotation-brands/defaults");

/*
 * The pictures and the timeline on the client's copy, and the rule that a version prints its own.
 *
 * The redesigned quotation opens on a photograph and closes on one, draws the India map under its
 * timeline and lays a collage per branch - none of which may be a file in the code. Each brand
 * uploads its own from Settings, the snapshot freezes them onto the version as it is raised, and
 * the public page reads the snapshot. The cleaning below is what keeps a half-typed settings form
 * from printing as a broken picture.
 */

test("stored assets are cleaned to the shape the page reads", () => {
  const merged = mergePdfAssets({
    coverImageUrl: "  https://cdn/cover.webp ",
    indiaMapUrl: null,
    infrastructure: [
      { title: " Erode ", subtitle: "Tamil Nadu", photos: ["https://cdn/a.webp", "", null, "https://cdn/b.webp"] },
      { title: "", subtitle: "", photos: [] },
      { title: "Vizag", photos: "not-a-list" },
    ],
    journey: [{ year: "2012", title: "Brand Inception" }, { year: "", title: "" }, { title: "Untitled year", detail: "x" }],
  });
  assert.equal(merged.coverImageUrl, "https://cdn/cover.webp");
  assert.equal(merged.indiaMapUrl, null);
  assert.equal("backgroundUrl" in merged, false, "the decorative background was removed");
  assert.equal(merged.thankYouImageUrl, null);
  assert.deepEqual(merged.infrastructure, [
    { title: "Erode", subtitle: "Tamil Nadu", photos: ["https://cdn/a.webp", "https://cdn/b.webp"] },
    { title: "Vizag", subtitle: "", photos: [] },
  ]);
  assert.deepEqual(merged.journey.map((row) => row.title), ["Brand Inception", "Untitled year"]);
  assert.deepEqual(mergePdfAssets(null), DEFAULT_PDF_ASSETS);
  assert.deepEqual(mergePdfAssets("garbage"), DEFAULT_PDF_ASSETS);
});

test("the standard timeline is the reference design's, and the page's copy matches it", () => {
  assert.equal(DEFAULT_JOURNEY.length, 7);
  assert.equal(DEFAULT_JOURNEY[0].year, "2012");
  const source = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/sales/quotationTemplateContent.js"), "utf8");
  for (const row of DEFAULT_JOURNEY) {
    assert.ok(source.includes(row.title), `frontend defaultJourney is missing "${row.title}"`);
    assert.ok(source.includes(row.place), `frontend defaultJourney is missing the place "${row.place}"`);
  }
});

/*
 * The write path, held to its rules by reading it - the failure mode is silence, as with the rest
 * of the snapshot: a version raised without its pictures prints today's, and nobody notices until
 * the pictures change.
 */
const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "service.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");

test("the snapshot carries the presentation - pictures, branch, studio name - as it stood", () => {
  assert.match(SERVICE, /async function snapshotForQuotation[\s\S]*?presentation: live\.presentation/);
  // The studio's name and mark come from Settings -> Organization, never from a constant.
  assert.match(SERVICE, /studioSettings\.read\(\)/);
  assert.match(SERVICE, /brandDisplayName: studioName,/);
  assert.equal(SERVICE.includes("pdfContent.brandDisplayName"), false, "a brand types no name of its own");
  // The website and the phone come from the quotation's branch, the head office standing in.
  assert.match(SERVICE, /websiteUrl: pdfContent\.websiteUrl \|\| branch\?\.websiteUrl \|\| headOffice\?\.websiteUrl/);
  assert.match(SERVICE, /phone: pdfContent\.contactPhone \|\| branch\?\.phone \|\| headOffice\?\.phone/);
  assert.equal(SERVICE.includes("dontblinkstudioz"), false, "no website may be written into the code");
});

test("the public page reads the version's own snapshot, and today's tables only where it is silent", () => {
  assert.match(SERVICE, /async function presentationForQuotation[\s\S]*?if \(snapshot\?\.presentation\?\.assets && snapshot\?\.presentation\?\.branch !== undefined\) return snapshot;/);
  assert.match(CONTROLLER, /async function publicQuotation[\s\S]*?quotationBrands\.presentationForQuotation\(quotation\)/);
  // The register's own reads are untouched: no live resolution on the list or the edit path.
  assert.doesNotMatch(CONTROLLER, /async function listQuotations[\s\S]*?presentationForQuotation[\s\S]*?async function getQuotation/);
});

test("the assets migration is additive and nullable", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260909180000_quotation_brand_pdf_assets", "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `pdf_assets` JSON NULL/);
  assert.equal(/DROP|ALTER COLUMN|MODIFY/i.test(sql), false);
});

test("the PDF is printed as one sheet the length of the document, 1080 wide", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "services", "quotationPdfService.js"), "utf8");
  assert.match(renderer, /const SHEET_WIDTH_PX = 1080/);
  assert.match(renderer, /width: `\$\{SHEET_WIDTH_PX\}px`/);
  assert.match(renderer, /pageRanges: "1"/);
  assert.equal(renderer.includes('format: "A4"'), false);
});

/*
 * The template's old wording is not a brand's choice.
 *
 * A snapshot raised before the reference design stored the merged wording, defaults included, so
 * it carries "The celebration" as though somebody chose it. The template's defaults are the code's
 * to change; only the brand's own words are frozen.
 */
const { LEGACY_PDF_CONTENT, mergePdfContent, pdfContentOverrides } = require("../src/modules/sales/quotation-brands/defaults");

test("a stored value equal to the old default reads as nothing chosen, a brand's own words stay", () => {
  const merged = mergePdfContent({ eventSectionLabel: "The celebration", eventSectionTitle: "Project Itinerary" });
  assert.equal(merged.eventSectionLabel, "Ceremonial Itinerary");
  assert.equal(merged.eventSectionTitle, "Project Itinerary");
  assert.equal(pdfContentOverrides({ eventSectionLabel: "The celebration" }), null);
  assert.deepEqual(pdfContentOverrides({ eventSectionLabel: "Production scope" }), { eventSectionLabel: "Production scope" });
  for (const values of Object.values(LEGACY_PDF_CONTENT)) assert.ok(values.length);
});

test("the snapshot freezes the brand's overrides, and the page lays them over its defaults", () => {
  assert.match(SERVICE, /pdfContent: live\.pdfOverrides/);
  const page = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/sales/quotationTemplateContent.js"), "utf8");
  for (const [key, values] of Object.entries(LEGACY_PDF_CONTENT)) {
    assert.ok(page.includes(`${key}: [`), `frontend legacy list lacks ${key}`);
    for (const value of values) assert.ok(page.includes(JSON.stringify(value)), `frontend legacy list lacks ${value}`);
  }
});

/*
 * ── What is the studio's and what is a brand's ────────────────────────────────────────────────
 *
 * The notes and trademark cards, Journey & Legacy and Our Infrastructure read the same on every
 * brand's quotation, so they are kept once on the studio's settings row and a brand cannot hold
 * them; the cover and Thank You photographs and the rest of the words are the brand's.
 */
const { GENERAL_PDF_CONTENT_KEYS, BRAND_PDF_CONTENT_KEYS, GENERAL_ASSET_KEYS, BRAND_ASSET_KEYS, PDF_CONTENT_KEYS, combinePdfAssets, pdfContentOverrides: overridesFor } = require("../src/modules/sales/quotation-brands/defaults");

test("every word is either the studio's or a brand's, never both, and never neither", () => {
  const all = [...GENERAL_PDF_CONTENT_KEYS, ...BRAND_PDF_CONTENT_KEYS].sort();
  assert.deepEqual(all, [...PDF_CONTENT_KEYS].sort());
  for (const key of ["notesTitle", "notesDefault", "trademarkBody", "journeyTitle", "locationsTitle", "infrastructureTagline"]) assert.ok(GENERAL_PDF_CONTENT_KEYS.includes(key), key);
  for (const key of ["tagline", "coverQuote", "eventSectionTitle", "pricingLabel", "thankYouQuote", "websiteUrl"]) assert.ok(BRAND_PDF_CONTENT_KEYS.includes(key), key);
  assert.deepEqual([...GENERAL_ASSET_KEYS].sort(), ["indiaMapUrl", "infrastructure", "journey"]);
  // `coverSets` is the brand's too: the pictures are picked per group of shoots, and only the pair
  // a quotation resolved to is written onto `coverImageUrl` and `thankYouImageUrl` for the page.
  assert.deepEqual([...BRAND_ASSET_KEYS].sort(), ["coverImageUrl", "coverSets", "thankYouImageUrl"]);
});

test("a brand's stored words are filtered to its own keys, and the studio's to theirs", () => {
  assert.deepEqual(overridesFor({ tagline: "Weddings", trademarkBody: "Ours" }, BRAND_PDF_CONTENT_KEYS), { tagline: "Weddings" });
  assert.deepEqual(overridesFor({ tagline: "Weddings", trademarkBody: "Ours" }, GENERAL_PDF_CONTENT_KEYS), { trademarkBody: "Ours" });
});

test("the studio's map, collages and timeline lay over whatever a brand row still holds", () => {
  const combined = combinePdfAssets(
    { coverImageUrl: "https://cdn/cover.webp", indiaMapUrl: "https://cdn/old-map.webp", infrastructure: [{ title: "Old", photos: ["https://cdn/o.webp"] }] },
    { indiaMapUrl: "https://cdn/map.webp", infrastructure: [], journey: [{ year: "2012", title: "Start" }] },
  );
  assert.equal(combined.coverImageUrl, "https://cdn/cover.webp");
  assert.equal(combined.indiaMapUrl, "https://cdn/map.webp");
  assert.deepEqual(combined.infrastructure, []);
  assert.deepEqual(combined.journey.map((row) => row.title), ["Start"]);
});

test("the presentation reads the shared words from the settings row and a brand PATCH cannot carry them", () => {
  assert.match(SERVICE, /pdfContentOverrides\(settings\?\.pdfContent \|\| null, GENERAL_PDF_CONTENT_KEYS\)/);
  assert.match(SERVICE, /combinePdfAssets\(brand\?\.pdfAssets, settings\?\.pdfAssets\)/);
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "controller.js"), "utf8");
  assert.match(controller, /pdfContentOverrides\(data\.pdfContent \|\| \{\}, BRAND_PDF_CONTENT_KEYS\)/);
  assert.match(controller, /pickAssets\(await storePdfAssets\(data\.pdfAssets\), BRAND_ASSET_KEYS\)/);
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "quotation-brands", "routes.js"), "utf8");
  assert.ok(routes.indexOf('admin.patch("/general"') < routes.indexOf('admin.patch("/:code"'), "general must be routed before a brand code");
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260909200000_quotation_general_pdf_content", "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `pdf_content` JSON NULL/);
  assert.match(sql, /ADD COLUMN `pdf_assets` JSON NULL/);
  assert.equal(/DROP|MODIFY/i.test(sql), false);
});

/*
 * ── The four switches ─────────────────────────────────────────────────────────────────────────
 *
 * The studio can leave the notes card, the trademark card, Journey & Legacy or Our Infrastructure
 * off the client's copy. Only a stored `false` hides one, so a settings row nobody has saved -
 * and every version raised before the switches existed - prints all four exactly as before.
 */
const { SECTION_KEYS, DEFAULT_PDF_SECTIONS, mergePdfSections, pdfSectionsFor } = require("../src/modules/sales/quotation-brands/defaults");

test("a section is on unless it was explicitly switched off", () => {
  assert.deepEqual(SECTION_KEYS, ["notes", "trademark", "journey", "infrastructure"]);
  assert.deepEqual(mergePdfSections(null), DEFAULT_PDF_SECTIONS);
  assert.deepEqual(mergePdfSections({}), DEFAULT_PDF_SECTIONS);
  assert.deepEqual(mergePdfSections("garbage"), DEFAULT_PDF_SECTIONS);
  assert.equal(mergePdfSections({ journey: false }).journey, false);
  assert.equal(mergePdfSections({ journey: false }).notes, true);
  // Unknown keys are dropped and nothing but false is off.
  assert.deepEqual(pdfSectionsFor({ notes: false, nonsense: false }), { notes: false, trademark: true, journey: true, infrastructure: true });
});

test("the switches ride on the presentation, so a version keeps the ones it was raised under", () => {
  assert.match(SERVICE, /sections: mergePdfSections\(settings\?\.pdfSections\)/);
  const page = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/sales/PublicQuotationPage.js"), "utf8");
  for (const key of SECTION_KEYS) assert.ok(page.includes(`content.sections.${key}`), `the page does not gate ${key}`);
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260909210000_quotation_section_switches", "migration.sql"), "utf8");
  assert.match(sql, /ADD COLUMN `pdf_sections` JSON NULL/);
  assert.equal(/DROP|MODIFY/i.test(sql), false);
});

/*
 * ── The terms are read on a page of their own ─────────────────────────────────────────────────
 *
 * The quotation closes on the link, as the studio's design does; `/q/<token>/terms` is the same
 * sheet with the clauses set to be read. The link is absolute while printing, because a link
 * annotation in a PDF is followed with no page to resolve it against.
 */
test("the quotation links to its terms rather than printing them", () => {
  const page = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/sales/PublicQuotationPage.js"), "utf8");
  assert.match(page, /const termsPath = `\/q\/\$\{encodeURIComponent\(token\)\}\/terms`/);
  assert.match(page, /printMode && typeof window !== "undefined" \? `\$\{window\.location\.origin\}\$\{termsPath\}` : termsPath/);
  assert.match(page, /<a href=\{termsHref\}[\s\S]{0,160}\{content\.termsTitle\}<\/a>/);
  // The clauses themselves are no longer on the quotation.
  assert.equal(page.includes("content.terms.map"), false, "the quotation still prints the clauses inline");

  const terms = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/components/sales/PublicQuotationTermsPage.js"), "utf8");
  assert.match(terms, /content\.terms\.map/);
  // The same sheet: one stylesheet and one ground, shared rather than described twice.
  assert.match(terms, /SHEET_CSS/);
  assert.match(terms, /sheetBackground/);
  // And the version's own terms, from its snapshot, like everything else it prints.
  assert.match(terms, /templateContentFor\(quotation, branding\)/);

  const route = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/app/q/[token]/terms/page.js"), "utf8");
  assert.match(route, /PublicQuotationTermsPage/);
  // The faces are on the layout, so both pages are set in them.
  const layout = fs.readFileSync(path.resolve(__dirname, "../../frontend/src/app/q/[token]/layout.js"), "utf8");
  assert.match(layout, /--q-font-display/);
});
