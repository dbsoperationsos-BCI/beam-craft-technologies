import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Settings → Quotation Settings → brand: Terms, PDF Content, PDF Image.
 *
 * The pictures moved from PDF Content to a tab of their own, and the category picker over them
 * became a row of tabs, one per category the brand's Field Settings list holds. Nothing about the
 * sets, the uploads, the fallback or the PDF changed - only where they sit and how a category is
 * chosen - and each tab saves only its own part of the brand. Read off the source, like the other
 * settings tests beside it.
 */
const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "settings", "QuotationSettingsPanel.js"), "utf8");
const between = (from, to) => PANEL.slice(PANEL.indexOf(from), PANEL.indexOf(to, PANEL.indexOf(from)));

test("a brand's screen carries the three tabs, and each draws its own", () => {
  assert.match(PANEL, /\{ id: "terms", label: "Terms" \},\s*\{ id: "pdf", label: "PDF Content" \},\s*\{ id: "images", label: "PDF Image" \},/);
  assert.match(PANEL, /\{tab === "terms" && <TermsTab/);
  assert.match(PANEL, /\{tab === "pdf" && <PdfContentTab/);
  assert.match(PANEL, /\{tab === "images" && <PdfImageTab/);
});

test("the pictures are PDF Image's and no longer PDF Content's, on the same editor", () => {
  const image = between("function PdfImageTab", "function PdfContentTab");
  const content = between("function PdfContentTab", "export function QuotationGeneralSettingsPanel");
  assert.match(image, /sectionTitle\("Pictures", `The photographs this brand's quotation opens and closes on/);
  assert.match(image, /<CoverSetsEditor/);
  assert.doesNotMatch(content, /sectionTitle\("Pictures",|<CoverSetsEditor|coverSets/);
  // The sets are read from, and written back to, the same stored `pdfAssets.coverSets` as before.
  assert.match(image, /coverSets: \(config\.pdfAssets\?\.coverSets \|\| \[\]\)\.map/);
  assert.match(image, /updateQuotationBrand\(code, \{ pdfAssets: \{ coverSets: cleanCoverSets\(values\.coverSets\) \} \}\)/);
  // PDF Content sends the words and the download answer only: the PATCH leaves the pictures alone.
  assert.match(content, /updateQuotationBrand\(code, \{\s*allowClientDownload: values\.allowClientDownload === true,\s*pdfContent: Object\.fromEntries\(PDF_FIELDS/);
  const contentSave = content.slice(content.indexOf("updateQuotationBrand(code, {"), content.indexOf("});", content.indexOf("updateQuotationBrand(code, {")));
  assert.doesNotMatch(contentSave, /pdfAssets/);
});

test("categories are tabs, from the brand's own list, and never written into the screen", () => {
  const editor = between("function CoverSetsEditor", "const cleanJourney");
  assert.match(editor, /<Tabs\s+tabs=\{religions\.map\(\(name\) => \(\{ id: name, label: name \}\)\)\}/);
  assert.match(editor, /value=\{religion\}/);
  assert.doesNotMatch(editor, /label="Category"[\s\S]*<Dropdown/, "the category dropdown is gone");
  // No category name is written into the screen as a value or a label - only the list is. The
  // comments are stripped first: one of them mentions a category by way of example.
  const code = PANEL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /["'`](Christianity|Hinduism|Hindu|Muslim|Islam)["'`]/, "no category name is written into the screen");
  // The list comes from Field Settings, per brand.
  assert.match(between("function PdfImageTab", "function PdfContentTab"), /getMasterData\("religions", \{ active: true, vertical: code \}\)/);
  // Every change still writes the whole list, so the other categories' sets survive an edit to one.
  assert.match(editor, /const publish = \(next\) => onChange\(\[\.\.\.others, \.\.\.next\]\);/);
});
