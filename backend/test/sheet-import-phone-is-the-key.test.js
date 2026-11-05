const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { classifyAgainstExisting, normalizePhone } = require("../src/modules/hrm/interview/sheetImport");

/*
 * ── The phone number is the only thing that decides a duplicate ───────────────────────────────
 *
 * The studio's rule for every Google Sheet integration. A row whose phone is already in the register
 * is not imported; a row whose phone is new **is** imported, whatever else about it disagrees -
 * a different spelling of the name, a second email address, a changed source id, a column that has
 * moved. Those are the sheet being untidy, not a second person.
 *
 * Both importers used to fall back through a chain - the interview one on `phone || email ||
 * sourceRowId`, the CRM one on `sourceId || phone || contactNumber || email || shootId` - which meant
 * two real people sharing an office email were one person, and one real person whose row id changed
 * was two.
 *
 * And a row with **no phone at all** is skipped and reported, because there is nothing to check it
 * for uniqueness by: importing it would be the one case where the rule cannot be applied.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const LEADS = read("src", "modules", "sales", "crm-leads", "googleSheetsService.js");

const row = (phone, extra = {}) => ({
  candidate: { name: "A", phone, email: extra.email || "" },
  details: { sourceRowId: extra.sourceRowId || "", spreadsheetId: "s", gid: "0", sourceRowNumber: extra.rowNumber || 2 },
});
const noIndexes = () => ({ byId: new Map(), bySheetPosition: new Map(), byPhone: new Map(), byEmail: new Map() });

test("a phone already in the register is not imported again", () => {
  const indexes = noIndexes();
  // Keyed the way the real index is keyed: `normalizePhone` puts a bare ten-digit number into the
  // studio's own country code, so "9876543210" and "+91 98765 43210" are one person.
  indexes.byPhone.set(normalizePhone("9876543210"), { id: "existing" });
  const out = classifyAgainstExisting(row("9876543210"), indexes, new Map());
  assert.equal(out.classification, "EXISTING");
  assert.equal(out.matchBy, "phone");
});

test("a new phone comes in however much else disagrees", () => {
  /*
   * The half that matters most to the studio: the sheet is edited by hand, so a name respelled, an
   * email reused across a family, or a row that has moved must not stop a real new person arriving.
   */
  const indexes = noIndexes();
  indexes.byEmail.set("shared@example.com", { id: "someone-else" });
  indexes.byId.set("row-7", { id: "an-older-row" });
  indexes.bySheetPosition.set("s::0::2", { id: "whoever-was-here-before" });
  const out = classifyAgainstExisting(row("9000000001", { email: "shared@example.com", sourceRowId: "row-7", rowNumber: 2 }), indexes, new Map());
  assert.equal(out.classification, "NEW", "a unique phone is a new person whatever else matches");
});

test("the same phone twice in one sheet is imported once", () => {
  const seen = new Map();
  const indexes = noIndexes();
  assert.equal(classifyAgainstExisting(row("9000000002"), indexes, seen).classification, "NEW");
  const second = classifyAgainstExisting(row("9000000002", { rowNumber: 9 }), indexes, seen);
  assert.equal(second.classification, "DUPLICATE_IN_SHEET");
  assert.equal(second.matchBy, "phone");
});

test("a row with no phone is skipped and reported, not guessed at", () => {
  /*
   * There is nothing to check it for uniqueness by, so importing it is the one case where the
   * studio's rule cannot be applied at all. It is refused as a row - not blanked as a cell, which is
   * what happens to every other unreadable value here - and named in the sync summary so the sheet
   * can be fixed.
   */
  for (const empty of ["", "   ", null, undefined]) {
    assert.equal(classifyAgainstExisting(row(empty), noIndexes(), new Map()).classification, "NO_PHONE");
  }
  const SYNC = read("src", "modules", "hrm", "interview", "sheetSyncService.js");
  assert.match(SYNC, /classification\.classification === "NO_PHONE"/);
  assert.match(SYNC, /A phone number is required/);
  assert.match(SYNC, /missingPhoneRows/);
});

test("the CRM importer matches on the phone and nothing else", () => {
  assert.match(LEADS, /const duplicateKey = phone;/);
  assert.equal(/duplicateKey = sourceId \|\| phone/.test(LEADS), false, "the fallback chain is back");
});
