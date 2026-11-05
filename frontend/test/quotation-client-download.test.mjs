import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Allow Client Download, as the screens read it.
 *
 * The setting is the brand's - Settings → Quotation Settings → <brand> → PDF Content - and the
 * client's copy asks the quotation what its brand answered. Three things are worth holding: the
 * field sits where it was asked for and saves with the rest of the tab, the download control is
 * absent rather than disabled when the answer is No, and the studio's own download no longer goes
 * through the client's link, which now refuses it for a brand answering No.
 *
 * Reads the source, the way the other control tests in this suite do: there is no DOM here.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const SETTINGS = src("components", "settings", "QuotationSettingsPanel.js");
const PUBLIC_PAGE = src("components", "sales", "PublicQuotationPage.js");
const REGISTER = src("components", "sales", "QuotationPage.js");
const SERVICE = src("services", "sales", "projects.service.js");

test("the brand's PDF Content tab asks the question first, and saves it with the tab", () => {
  const tab = SETTINGS.slice(SETTINGS.indexOf("function PdfContentTab"), SETTINGS.indexOf("export function QuotationGeneralSettingsPanel"));
  assert.ok(tab.indexOf('label="Allow Client Download"') > -1, "the field is on the PDF Content tab");
  // The pictures have a tab of their own now - PDF Image - so the question opens PDF Content.
  assert.equal(tab.indexOf('sectionTitle("Pictures")'), -1, "the pictures are not on the PDF Content tab");
  assert.ok(
    tab.indexOf('sectionTitle("Client download")') < tab.indexOf('sectionTitle("Wording on the client\'s copy")'),
    "the question is asked above the wording, where the studio asked for it",
  );
  // Yes/No in that order, not the alphabet's, and No is where an unanswered brand opens.
  assert.match(tab, /allowClientDownload: config\.brand\.allowClientDownload === true/);
  assert.match(tab, /options=\{\["Yes", "No"\]\}/);
  assert.match(tab, /allowClientDownload: values\.allowClientDownload === true/);
});

test("the client's copy hides the control unless its own brand allows it", () => {
  /*
   * `=== true` rather than a truthy read, and on the quotation rather than on a brand the page
   * picked: a quotation raised before this existed answers with nothing, and nothing is No.
   */
  assert.match(PUBLIC_PAGE, /quotation\.allowClientDownload === true\s*\n?\s*&& <FloatingDownload/);
  // Absent, not disabled - a control the viewer may not use is not drawn at all.
  assert.doesNotMatch(PUBLIC_PAGE, /<FloatingDownload[^>]*disabled/);
});

test("the studio downloads through its own signed-in route, not the client's link", () => {
  assert.doesNotMatch(REGISTER, /publicQuotationPdfUrl/, "the register must not use the client's link, which the brand may refuse");
  assert.match(REGISTER, /downloadSalesQuotationPdf\(quotation\.id/);
  assert.match(SERVICE, /\/api\/sales\/quotations\/\$\{id\}\/pdf/);
  // Signed in, so the token rides on the request rather than on an address the browser follows.
  assert.match(SERVICE, /Authorization: `Bearer \$\{token\}`/);
});
