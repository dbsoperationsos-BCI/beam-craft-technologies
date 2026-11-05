const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

/*
 * Settings → Offer Letter → Sections → Import from .docx: a Word document read into the letter's
 * sections for review - titles, paragraphs, bullets, numbers and table rows; nothing of its styling.
 */

const { importOfferSections, sectionsFromHtml } = require("../src/services/offerLetterImport");

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
// Escaped as Word writes it - a raw "&" or "<" is not XML.
const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (text, { bold = false } = {}) => `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const para = (body, { style = "", numId = 0 } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : ""}</w:pPr>${body}</w:p>`;
const cell = (text) => `<w:tc>${para(run(text))}</w:tc>`;

/** A small real .docx: Word's parts, styles for its headings, numbering for its lists. */
async function docx(body) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`);
  zip.file("word/styles.xml", `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`);
  zip.file("word/numbering.xml", `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("a Word document reads into sections: headings and bold lines title them; paragraphs, bullets, numbers and table rows fill them", async () => {
  const buffer = await docx([
    para(run("Probation Period"), { style: "Heading1" }),
    para(run("Six months from the date of joining.")),
    para(run("Reviewed monthly & confirmed in writing.")),
    para(run("Leave Policy", { bold: true })),
    para(run("12 casual leaves a year"), { numId: 1 }),
    para(run("Holidays <as declared>"), { numId: 1 }),
    para(run("Duties"), { style: "Heading1" }),
    para(run("Shoot"), { numId: 2 }),
    para(run("Edit"), { numId: 2 }),
    para(run("Working Hours", { bold: true })),
    `<w:tbl><w:tr>${cell("Mon-Sat")}${cell("9:30 AM - 6:30 PM")}</w:tr><w:tr>${cell("Sunday")}${cell("Off")}</w:tr></w:tbl>`,
  ].join(""));
  const { sections, warnings } = await importOfferSections(buffer, "Offer terms.docx");
  assert.deepEqual(sections, [
    { title: "Probation Period", format: "PARAGRAPH", content: "Six months from the date of joining.\nReviewed monthly & confirmed in writing." },
    { title: "Leave Policy", format: "POINTS", points: ["12 casual leaves a year", "Holidays <as declared>"] },
    { title: "Duties", format: "NUMBERED", points: ["Shoot", "Edit"] },
    { title: "Working Hours", format: "POINTS", points: ["Mon-Sat - 9:30 AM - 6:30 PM", "Sunday - Off"] },
  ]);
  assert.deepEqual(warnings, []);
});

test("text with no title, and a list after a paragraph under one title, come back untitled - the review asks", () => {
  const { sections, warnings } = sectionsFromHtml("<p>Opening words.</p><h1>Benefits</h1><p>As below.</p><ul><li>Insurance</li><li>Bonus<ul><li>Annual</li></ul></li></ul>");
  assert.deepEqual(sections, [
    { title: "", format: "PARAGRAPH", content: "Opening words." },
    { title: "Benefits", format: "PARAGRAPH", content: "As below." },
    { title: "", format: "POINTS", points: ["Insurance", "Bonus", "Annual"] },
  ]);
  // No note about it: the review's own check marks each untitled section by line.
  assert.deepEqual(warnings, []);
});

test("past the editor's limits it is cut, and said", () => {
  const many = `<h1>Rules</h1><ul>${Array.from({ length: 35 }, (unused, index) => `<li>Rule ${index + 1}</li>`).join("")}</ul>`;
  const { sections, warnings } = sectionsFromHtml(many);
  assert.equal(sections[0].points.length, 30);
  assert.match(warnings[0], /35 points; the first 30 are kept/);
  const long = sectionsFromHtml(`<h1>Terms</h1><p>${"x".repeat(3100)}</p>`);
  assert.equal(long.sections[0].content.length, 3000);
});

test("only a real .docx, of 5 MB or less, is read - anything else is refused before it is opened", async () => {
  await assert.rejects(importOfferSections(Buffer.from("hello"), "terms.pdf"), { status: 400, message: /Only Word \.docx/ });
  await assert.rejects(importOfferSections(Buffer.from("not a zip at all"), "terms.docx"), { status: 400, message: /not a Word \.docx/ });
  await assert.rejects(importOfferSections(Buffer.alloc(0), "terms.docx"), { status: 400 });
  await assert.rejects(importOfferSections(Buffer.alloc(5 * 1024 * 1024 + 1, 1), "big.docx"), { status: 400, message: /5 MB/ });
  // A zip that is not a Word document.
  const zip = new JSZip();
  zip.file("readme.txt", "hi");
  await assert.rejects(importOfferSections(await zip.generateAsync({ type: "nodebuffer" }), "fake.docx"), { status: 400, message: /not a Word \.docx/ });
  // A zip bomb: a part that inflates past the cap is stopped as it inflates, before it is read - what
  // the file declares about its own sizes is never believed.
  const bomb = await JSZip.loadAsync(await docx(""));
  bomb.file("word/media/padding.bin", Buffer.alloc(21 * 1024 * 1024, 0));
  const packed = await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.ok(packed.length < 5 * 1024 * 1024);
  await assert.rejects(importOfferSections(packed, "bomb.docx"), { status: 400, message: /too large/ });
  // Nothing in it.
  await assert.rejects(importOfferSections(await docx(""), "empty.docx"), { status: 400, message: /no text/ });
});

test("an administrator's, under the Certificate guard; read in memory and never kept", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "certificates", "routes.js"), "utf8");
  assert.ok(routes.indexOf("router.use(controller.requireAdministrator);") < routes.indexOf('router.post("/offer-letter/sections/import"'));
  assert.match(routes, /multer\.memoryStorage\(\), limits: \{ fileSize: MAX_FILE_BYTES, files: 1 \}/);
});

test("a document's own numbering leaves its titles - the letter numbers them itself", () => {
  const { stripTitleNumber } = require("../src/services/offerLetterImport");
  const { sections } = sectionsFromHtml("<h1>1. Appointment and Role</h1><p>Text.</p><p><strong>2.1) Leave</strong></p><ul><li>One</li></ul><h2>IV. Notice</h2><p>Thirty days.</p>");
  assert.deepEqual(sections.map((section) => section.title), ["Appointment and Role", "Leave", "Notice"]);
  assert.equal(stripTitleNumber("Compensation"), "Compensation");
});

test("the letter is drawn with sections still being edited, checked as a save is, and nothing saved", () => {
  const { offerSectionsPreviewSchema } = require("../src/modules/settings/certificates/controller");
  assert.equal(offerSectionsPreviewSchema.safeParse({ sections: [{ title: "Leave", format: "POINTS", points: ["One"] }] }).success, true);
  assert.equal(offerSectionsPreviewSchema.safeParse({ sections: [{ title: "", format: "PARAGRAPH", content: "x" }] }).success, false);
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "certificates", "routes.js"), "utf8");
  assert.ok(routes.indexOf("router.use(controller.requireAdministrator);") < routes.indexOf('router.post("/offer-letter/sections/preview", controller.previewOfferLetterSections);'));
});
