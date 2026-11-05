import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRANCHES,
  SCHEMES,
  VERTICALS,
  branchCode,
  formatIdentifier,
  identifierPlaceholder,
  isIdentifier,
  parseIdentifier,
  verticalCode,
} from "../src/lib/identifiers.mjs";

/*
 * Every identifier the studio hands out.
 *
 * Two things are worth pinning down and they are different in kind. The first is the shapes
 * themselves - the studio asked for these exact strings, and a scheme that quietly renders
 * `DBS-EID-QQ-ERD-1` instead of `...-000001` is wrong in a way no test of the mechanism would
 * catch. So the eleven are written out here as literals rather than derived, because a test that
 * builds the expected string the same way the code does proves only that the code is consistent
 * with itself.
 *
 * The second is that the browser and the server agree. The server mints identifiers and this file's
 * module reads them; if the two drift, an id the server writes is one a form here refuses - a
 * record that saves and then cannot be edited.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = fs.readFileSync(path.join(HERE, "..", "..", "backend", "src", "services", "identifiers.js"), "utf8");

/* ─────────────────────────────────────────────────── the eleven shapes, as they were asked for ── */

const EXPECTED = [
  ["Employee Repository", "EMPLOYEE", {}, "DBS-1"],
  ["Leads - Qua Qua", "CRM_LEAD", { vertical: "Qua Qua", branch: "Erode" }, "DBS-EID-QQ-ERD-000001"],
  ["Leads - Dum Dum", "CRM_LEAD", { vertical: "Dum Dum", branch: "Erode" }, "DBS-EID-DD-ERD-000001"],
  ["Leads - Corp", "CRM_LEAD", { vertical: "Corp", branch: "Erode" }, "DBS-EID-CORP-ERD-000001"],
  /*
   * A Callyzer call, which is not an enquiry and does not draw on the enquiry run.
   *
   * Neither part is carried: which of the three verticals a call belongs to is the question the
   * Calls board exists to answer, and a code that guessed one would be guessing in the place the
   * studio reads out loud. It becomes an enquiry, and takes an `EID` above, only when somebody
   * reads the caller and adds them as a lead.
   *
   * `CLID` rather than the `CID` this was minted under at first: read out beside `EID` the old tag
   * was a syllable away from it, and a Call ID heard as an Enquiry ID sends whoever heard it looking
   * for a lead nobody created. The codes already issued are rewritten to this form once, by
   * `renameCallIdTag` in the backend's callLogService - so there is one shape on the board and not
   * two, and this row is the whole of what "one shape" means.
   */
  ["Calls", "CALL_LOG", {}, "DBS-CLID-000001"],
  ["Bookings - Dum Dum", "SALES_PROJECT", { vertical: "Dum Dum", branch: "Erode" }, "DBS-BK-DD-ERD-000001"],
  ["Bookings - Qua Qua", "SALES_PROJECT", { vertical: "Qua Qua", branch: "Erode" }, "DBS-BK-QQ-ERD-000001"],
  ["Bookings - Corp", "SALES_PROJECT", { vertical: "Corp", branch: "Erode" }, "DBS-BK-CORP-ERD-000001"],
  ["Shoots - Dum Dum", "PROJECT_SHOOT", { vertical: "Dum Dum", branch: "Erode" }, "DBS-SID-DD-ERD-000001"],
  ["Shoots - Qua Qua", "PROJECT_SHOOT", { vertical: "Qua Qua", branch: "Coimbatore" }, "DBS-SID-QQ-CBE-000001"],
  ["Quotations - Qua Qua", "QUOTATION", { vertical: "Qua Qua", branch: "Erode" }, "DBS-QO-QQ-ERD-000001"],
  ["Quotations - Dum Dum", "QUOTATION", { vertical: "Dum Dum", branch: "Erode" }, "DBS-QO-DD-ERD-000001"],
  ["Quotations - Corp", "QUOTATION", { vertical: "Corp", branch: "Erode" }, "DBS-QO-CORP-ERD-000001"],
  ["CRD - Dum Dum", "CRD_DOCUMENT", { vertical: "Dum Dum" }, "DBS-CRD-DD-000001"],
  ["CRD - Qua Qua", "CRD_DOCUMENT", { vertical: "Qua Qua" }, "DBS-CRD-QQ-000001"],
  ["Image Selection", "IMAGE_SELECTION", {}, "DBS-VCIS-000001"],
  ["Accounts Spent - Qua Qua", "CASH_SPENT", { vertical: "Qua Qua", branch: "Erode" }, "DBS-MS-QQ-ERD-000001"],
  ["Accounts Spent - Dum Dum", "CASH_SPENT", { vertical: "Dum Dum", branch: "Erode" }, "DBS-MS-DD-ERD-000001"],
  ["Accounts Spent - Corp", "CASH_SPENT", { vertical: "Corp", branch: "Erode" }, "DBS-MS-CORP-ERD-000001"],
  ["Accounts Receive - Qua Qua", "CASH_RECEIVED", { vertical: "Qua Qua", branch: "Erode" }, "DBS-MR-QQ-ERD-000001"],
  ["Accounts Receive - Dum Dum", "CASH_RECEIVED", { vertical: "Dum Dum", branch: "Erode" }, "DBS-MR-DD-ERD-000001"],
  ["Accounts Receive - Corp", "CASH_RECEIVED", { vertical: "Corp", branch: "Erode" }, "DBS-MR-CORP-ERD-000001"],
  ["Asset Management", "ASSET", { branch: "Erode" }, "DBS-ASMGMT-ERD-000001"],
  ["Employee Referral", "EMPLOYEE_REFERRAL", {}, "DBS-REF-000001"],
  ["Vendor Management", "VENDOR", {}, "DBS-VNMGMT-000001"],
  ["Client Storage", "CLIENT_STORAGE", {}, "DBS-STOMGMT-000001"],
];

test("the first identifier of every scheme is the one the studio asked for", () => {
  for (const [label, scheme, context, expected] of EXPECTED) {
    assert.equal(formatIdentifier(scheme, context, 1), expected, label);
  }
});

test("every scheme the studio named is a scheme this module has", () => {
  // A scheme missing here is a module still minting its old code, which is exactly the state this
  // change exists to end.
  const named = new Set(EXPECTED.map(([, scheme]) => scheme));
  for (const scheme of Object.keys(SCHEMES)) {
    assert.ok(named.has(scheme), `${scheme} is defined but nothing pins the shape it renders`);
  }
});

test("a vertical runs one sequence across all of its branches", () => {
  /*
   * The branch is shown but not counted by. Dum Dum's leads run 1, 2, 3 … whichever office took
   * them, so a Coimbatore lead carries on Erode's run rather than restarting at one - five leads
   * all numbered 000001 read as five copies of the same record.
   *
   * That is the *server's* rule (`countedParts`), so what this file can pin is the half it owns:
   * the same number renders with whatever branch the record carries, and reads back the same.
   */
  const dumDum = (branch, value) => formatIdentifier("CRM_LEAD", { vertical: "Dum Dum", branch }, value);
  assert.equal(dumDum("Erode", 1), "DBS-EID-DD-ERD-000001");
  assert.equal(dumDum("Erode", 2), "DBS-EID-DD-ERD-000002");
  assert.equal(dumDum("Coimbatore", 3), "DBS-EID-DD-CBE-000003");
  assert.equal(dumDum("Vizag", 4), "DBS-EID-DD-VIZAG-000004");
  // And each reads back as the branch it names, at the number the vertical had reached.
  assert.deepEqual(parseIdentifier("CRM_LEAD", dumDum("Coimbatore", 3)), { vertical: "DD", branch: "CBE", value: 3 });
});

test("the server counts by the vertical, never by the branch", () => {
  /*
   * Read out of the server's source, because a counter keyed by the branch as well is the whole
   * fault this rule exists to prevent - and it is invisible until two records share a number.
   */
  assert.match(SERVER, /function countedParts\(scheme\) \{\s*return SCHEMES\[scheme\]\.parts\.filter\(\(part\) => part !== "branch"\);/);
  // And the counter key is built from that, not from the identifier's own parts.
  assert.match(SERVER, /function sequenceKey\(scheme, context = \{\}\) \{\s*const codes = countedParts\(scheme\)/);
});

test("the number is padded to six, and counts on from there", () => {
  assert.equal(formatIdentifier("CRM_LEAD", { vertical: "QQ", branch: "ERD" }, 2), "DBS-EID-QQ-ERD-000002");
  assert.equal(formatIdentifier("CRM_LEAD", { vertical: "QQ", branch: "ERD" }, 1234), "DBS-EID-QQ-ERD-001234");
  // Six digits hold a million records; a studio that passes that gets a longer number rather than a
  // truncated one, because a wrapped identifier would collide with one already issued.
  assert.equal(formatIdentifier("CRM_LEAD", { vertical: "QQ", branch: "ERD" }, 1234567), "DBS-EID-QQ-ERD-1234567");
});

test("an employee is DBS-1, unpadded, the way the staff list is read out", () => {
  assert.equal(formatIdentifier("EMPLOYEE", {}, 1), "DBS-1");
  assert.equal(formatIdentifier("EMPLOYEE", {}, 27), "DBS-27");
  assert.equal(formatIdentifier("EMPLOYEE", {}, 100), "DBS-100");
});

/* ──────────────────────────────────────────────────────────── the branch and vertical codes ── */

test("every branch the studio has is coded the way it asked", () => {
  assert.deepEqual(
    BRANCHES.map((entry) => [entry.name, entry.code]),
    [["Erode", "ERD"], ["Bangalore", "BLR"], ["Coimbatore", "CBE"], ["Hyderabad", "HYD"], ["Tiruppur", "TUP"], ["Vizag", "VIZAG"]],
  );
});

test("a branch is recognised however it was written down", () => {
  /*
   * Four producers write this column - the app's pickers, CSV import, Google Sheets and the Callyzer
   * webhook - and each has its own habit. All of them have to reach one code, or the same office
   * would show up under two of them and nobody could tell from the identifier where a lead came
   * from.
   */
  for (const written of ["Erode", "erode", "ERD", "Erode TN", "Erode, Tamil Nadu", "  erode  "]) {
    assert.equal(branchCode(written), "ERD", written);
  }
  assert.equal(branchCode("Coimbatore, Tamil Nadu"), "CBE");
  assert.equal(branchCode("Cbe"), "CBE");
  assert.equal(branchCode("Bangalore KA"), "BLR");
  assert.equal(branchCode("Bengaluru"), "BLR");
  assert.equal(branchCode("Hyderabad TL"), "HYD");
  assert.equal(branchCode("Tirupur"), "TUP");
  assert.equal(branchCode("TPR"), "TUP");
  // The studio says Vizag; HR's own branch list says Visakhapatnam AP.
  assert.equal(branchCode("Visakhapatnam AP"), "VIZAG");
  assert.equal(branchCode("Vizag"), "VIZAG");
});

test("a record that names no branch is still given one", () => {
  // A deliberate fallback rather than a refusal: a lead reaches this application from the Callyzer
  // webhook with nothing on it, and an identifier that cannot be minted is a record that cannot be
  // saved. A wrongly-branched code can be read and corrected; a lost enquiry cannot.
  for (const missing of ["", "   ", null, undefined, "Somewhere Else"]) {
    assert.equal(branchCode(missing), "ERD", String(missing));
  }
});

test("a vertical is recognised however it was written down, and folds onto the three", () => {
  assert.deepEqual(VERTICALS.map((entry) => entry.code), ["DD", "QQ", "CORP"]);
  for (const written of ["Qua Qua", "quaqua", "QQ", "qua qua"]) assert.equal(verticalCode(written), "QQ", written);
  for (const written of ["Corp", "Corporate", "corporation", "CORP"]) assert.equal(verticalCode(written), "CORP", written);
  // Blank reads as Dum Dum, which is what the rest of the application already reads an unnamed
  // vertical as - see VERTICAL_SQL in leadQueryService.js.
  assert.equal(verticalCode(""), "DD");
  assert.equal(verticalCode("Something else"), "DD");
});

/* ─────────────────────────────────────────────────────────────────────────── reading one back ── */

test("an identifier parses back into the parts it was built from", () => {
  for (const [label, scheme, context] of EXPECTED) {
    const text = formatIdentifier(scheme, context, 7);
    const parsed = parseIdentifier(scheme, text);
    assert.ok(parsed, `${label}: ${text} did not parse`);
    assert.equal(parsed.value, 7, label);
    if (SCHEMES[scheme].parts.includes("branch")) assert.equal(parsed.branch, branchCode(context.branch), label);
    if (SCHEMES[scheme].parts.includes("vertical")) assert.equal(parsed.vertical, verticalCode(context.vertical), label);
  }
});

test("the shapes the application used to hand out are not identifiers of these schemes", () => {
  // The old codes, one per module. They have to fail to parse, because that is how the backfill
  // tells a row it has already renumbered from one still carrying its old code.
  const OLD = [
    ["CRM_LEAD", "DBS-DD-EID-4867"],
    ["SALES_PROJECT", "DBS-EVT-00005"],
    ["QUOTATION", "QT-00001"],
    ["ASSET", "AST-000001"],
    ["VENDOR", "VEN-000001"],
    ["CLIENT_STORAGE", "SM-000001"],
    ["CASH_RECEIVED", "RCP-000001"],
    ["CASH_SPENT", "PAY-000001"],
    ["EMPLOYEE", "DBS001"],
  ];
  for (const [scheme, old] of OLD) assert.equal(parseIdentifier(scheme, old), null, `${old} still reads as a ${scheme}`);
});

test("a malformed identifier is refused rather than half-read", () => {
  assert.equal(parseIdentifier("CRM_LEAD", "DBS-EID-XX-ERD-000001"), null, "an unknown vertical");
  assert.equal(parseIdentifier("CRM_LEAD", "DBS-EID-QQ-ZZZ-000001"), null, "an unknown branch");
  assert.equal(parseIdentifier("CRM_LEAD", "DBS-EID-QQ-ERD-1"), null, "a number that is not padded");
  assert.equal(parseIdentifier("CRM_LEAD", "DBS-BK-QQ-ERD-000001"), null, "another scheme's tag");
  assert.equal(parseIdentifier("CRM_LEAD", ""), null);
  assert.equal(parseIdentifier("CRM_LEAD", null), null);
});

test("the loose test accepts every scheme and rejects what is not one", () => {
  for (const [label, scheme, context] of EXPECTED) {
    assert.equal(isIdentifier(formatIdentifier(scheme, context, 3)), true, label);
  }
  for (const wrong of ["", "QT-00001", "AST-000001", "DBS", "DBS-", "hello", "DBS-EID-QQ-ERD-"]) {
    assert.equal(isIdentifier(wrong), false, wrong);
  }
});

test("a placeholder is the first identifier that scheme would hand out", () => {
  assert.equal(identifierPlaceholder("CRM_LEAD", { vertical: "Qua Qua", branch: "Erode" }), "DBS-EID-QQ-ERD-000001");
  assert.equal(identifierPlaceholder("VENDOR", {}), "DBS-VNMGMT-000001");
});

/* ────────────────────────────────────────────────── and the server says exactly the same thing ── */

test("the server's schemes are this file's schemes", () => {
  /*
   * Read out of the server's source rather than imported: it is CommonJS and it opens a database
   * connection, neither of which belongs in a `node --test` run. Comparing the tags and the parts is
   * enough - those are what decide the string, and a mismatch in either is an id the server writes
   * that a form here refuses.
   */
  for (const [scheme, definition] of Object.entries(SCHEMES)) {
    const source = SERVER.match(new RegExp(`\\n  ${scheme}: \\{([^}]*)\\}`));
    assert.ok(source, `the server has no ${scheme} scheme`);
    assert.match(source[1], new RegExp(`tag: "${definition.tag}"`), `${scheme} tag`);
    assert.match(source[1], new RegExp(`width: ${definition.width}\\b`), `${scheme} width`);
    assert.match(
      source[1],
      new RegExp(`parts: \\[${definition.parts.map((part) => `"${part}"`).join(", ")}\\]`),
      `${scheme} parts`,
    );
  }
});

test("the server's branch and vertical codes are this file's", () => {
  // Same reason: the code is the key the counter is addressed by, so a branch this file folds one
  // way and the server folds another is two branches sharing a run of numbers.
  for (const entry of [...BRANCHES, ...VERTICALS]) {
    const source = SERVER.match(new RegExp(`\\{ code: "${entry.code}", name: "${entry.name}", aliases: \\[([^\\]]*)\\] \\}`));
    assert.ok(source, `the server does not carry ${entry.name} (${entry.code})`);
    const serverAliases = [...source[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(serverAliases, entry.aliases, `${entry.name} is spelled differently on the server`);
  }
  assert.match(SERVER, /const DEFAULT_BRANCH_CODE = "ERD"/);
  assert.match(SERVER, /const DEFAULT_VERTICAL_CODE = "DD"/);
});
