import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A submitted CRD document is read back whole.
 *
 * The studio's View and the share link both render `CrdDocumentResponse`, so an answer that renderer
 * does not read is an answer nobody ever sees - the client filled it in, the row holds it, and both
 * screens are silent about it. Two had gone that way: a side's Last Name, which nothing read, and the
 * four dated Birthdays questions, which were read back only for the Shoot Type's own category and so
 * disappeared when that was blank or had since been changed.
 *
 * The rule is now one rule, held in `Answer`: an answer that was given is shown, a blank question is
 * not drawn, and a section with nothing under it goes too. These tests read the schemas rather than a
 * fixed list, so a question added to either document has to be read back as well or this fails.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", ...parts), "utf8");

const RESPONSE = read("src", "components", "sales", "CrdDocumentResponse.js");
const DUM_DUM = read("..", "backend", "src", "modules", "sales", "crd-documents", "document.js");
const QUA_QUA = read("..", "backend", "src", "modules", "sales", "crd-documents", "documentQQ.js");

/** The field names one Zod object in a schema file declares. */
function schemaFields(source, from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `${from} is no longer in the schema - this test is reading the wrong thing`);
  const block = to ? source.slice(start, source.indexOf(to)) : source.slice(start);
  return [...new Set([...block.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((match) => match[1]))];
}

/*
 * Prefilled from the project and printed in the dialog's own title and the public page's header
 * (`CrdDocumentViewPanel` and `PublicCrdDocumentResponse`) rather than as an answer row - it is which
 * booking this is, not something the client told the studio.
 */
const SHOWN_IN_THE_HEADER = ["eventId"];

test("every question a Dum Dum document asks is read back", () => {
  const fields = [
    ...schemaFields(DUM_DUM, "const sideSchema", "const commonSchema"),
    ...schemaFields(DUM_DUM, "const commonSchema", "const documentSchema"),
  ];
  for (const field of fields) {
    if (SHOWN_IN_THE_HEADER.includes(field)) continue;
    assert.match(RESPONSE, new RegExp(`\\.${field}\\b`), `${field} is asked but never read back`);
  }
});

test("every question a Qua Qua document asks is read back", () => {
  for (const field of schemaFields(QUA_QUA, "const documentSchema = z.object")) {
    if (SHOWN_IN_THE_HEADER.includes(field)) continue;
    assert.match(RESPONSE, new RegExp(`\\.${field}\\b`), `${field} is asked but never read back`);
  }
});

test("an answer that was given is shown, and a blank question is not drawn", () => {
  // The rule sits in `Answer` rather than at each call site, so no section can forget it.
  assert.match(RESPONSE, /if \(!shown\) return null;/);
  // The dashed row it replaces is gone: a submitted document shows answers, not placeholders.
  assert.equal(RESPONSE.includes('shown || "—"'), false, "a blank answer is no longer dashed");
  assert.equal(RESPONSE.includes("text-slate-400"), false, "and the dash's own styling went with it");
});

test("a section whose every question is blank is not drawn either", () => {
  // Otherwise hiding the rows leaves a heading standing over nothing.
  assert.match(RESPONSE, /if \(!hasAnswer\(children\)\) return null;/);
});

test("a side's Last Name is read back", () => {
  assert.match(RESPONSE, /<Answer label="Last Name" value=\{values\.lastName\} \/>/);
});

test("a Birthdays answer is read back whatever the Shoot Type now says", () => {
  /*
   * Each of the four was drawn only for its own Shoot Type category, which lost answers twice: a
   * blank Shoot Type matched no category, and a Shoot Type changed after the client answered showed
   * the wrong category's questions. They are drawn unconditionally now and `Answer` hides the
   * blank ones.
   */
  for (const field of ["babyName", "babyDateOfBirth", "expectedDeliveryDate", "childBirthdayOrExpectedDeliveryDate"]) {
    assert.match(RESPONSE, new RegExp(`<Answer label="[^"]+" value=\\{document\\.${field}\\}`), `${field} is not read back plainly`);
  }
  assert.equal(RESPONSE.includes('{category === "baby" && <>'), false, "the baby block is no longer category-only");
  assert.equal(RESPONSE.includes('{category === "maternity" && <Answer'), false, "the maternity question is no longer category-only");
  assert.equal(RESPONSE.includes('{category === "combo" && <Answer'), false, "the combo question is no longer category-only");
  // The one thing the category still decides is a label's wording, which is not an answer.
  assert.match(RESPONSE, /category === "baby" \? "Mother's Birthday" : "Mother Date of Birth"/);
});

test("one renderer still serves both the studio's View and the share link", () => {
  // The point of the change: neither screen owns the markup, so they cannot disagree about an answer.
  for (const screen of ["CrdDocumentViewPanel.js", "PublicCrdDocumentResponse.js"]) {
    assert.match(read("src", "components", "sales", screen), /CrdDocumentResponse/, `${screen} no longer renders the shared response`);
  }
});
