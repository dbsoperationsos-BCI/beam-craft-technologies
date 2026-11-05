const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { verticalFromValue } = require("../src/modules/sales/crm-leads/callRouting");

/*
 * One number, one enquiry — within a vertical.
 *
 * The CRM identifies a client by the last ten digits of their number: it is what the Callyzer
 * webhook matches a delivered call on, what the Call Logs tab gathers a history by, and what
 * "Enquired : 2 times" counts. Two leads on one number inside one vertical are therefore the same
 * person written down twice, their calls and remarks and follow-ups split across two records that
 * neither knows about, and nothing on either screen saying so.
 *
 * Across verticals it is the opposite of a mistake. A wedding client who later books a corporate
 * shoot is one number and two enquiries on purpose — different work, different pipeline, different
 * team — and a rule written as "one number, one enquiry" full stop would make the second one
 * unwritable.
 *
 * The forms check before they save, but the forms are a convenience. This is where the rule lives,
 * because an import, a second tab, a request made by hand, or a form whose check had not answered
 * yet all arrive here and none of them asked first.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "sales", "crm-leads");
const SERVICE = fs.readFileSync(path.join(MODULE, "crmLeadService.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(MODULE, "controller.js"), "utf8");

/* ─────────────────────────────────────────────── which leads count as a clash ── */

/**
 * `findVerticalDuplicate`'s own rule, over rows the way `listLeadsSharingPhone` returns them.
 *
 * Written out rather than run, because running it needs MySQL. The three decisions it makes are
 * here — the vertical is normalised, the asking lead is skipped, and a different vertical is not a
 * clash — and the assertions below check the service still makes them the same way.
 */
function clashIn(rows, { vertical, excludeId = "" }) {
  const wanted = verticalFromValue(vertical);
  if (!wanted) return null;
  return rows.find((row) => row.enquiryId !== excludeId && verticalFromValue(row.vertical) === wanted) || null;
}

const ROWS = [
  { enquiryId: "DBS-EID-CORP-ERD-000006", vertical: "Corp", name: "Dheveesh" },
  { enquiryId: "DBS-EID-DD-ERD-000002", vertical: "Dum Dum", name: "Dheveesh" },
];

test("a second lead on the number in the same vertical is a clash", () => {
  assert.equal(clashIn(ROWS, { vertical: "Corp" })?.enquiryId, "DBS-EID-CORP-ERD-000006");
  assert.equal(clashIn(ROWS, { vertical: "Dum Dum" })?.enquiryId, "DBS-EID-DD-ERD-000002");
});

test("the same number in another vertical is not a clash", () => {
  // The case the scoping exists for: a wedding client booking a corporate shoot, and the reverse.
  assert.equal(clashIn(ROWS, { vertical: "Qua Qua" }), null);
  assert.equal(clashIn([ROWS[0]], { vertical: "Dum Dum" }), null);
});

test("a lead saving its own record never finds itself", () => {
  // Otherwise every Update on a lead would be refused over the number it has always held - the form
  // would become unsaveable the moment this rule was added.
  assert.equal(clashIn(ROWS, { vertical: "Corp", excludeId: "DBS-EID-CORP-ERD-000006" }), null);
});

test("the vertical is normalised on both sides of the comparison", () => {
  /*
   * `vertical` is written by hand in places - a sheet import, a CSV, the older spellings - so "corp",
   * "Corporate" and the "Crop" typo are all Corp. Comparing the raw strings would let a second Corp
   * lead through on a spelling, which is the one case this refusal exists for.
   */
  const typo = [{ enquiryId: "DBS-EID-CORP-ERD-000006", vertical: "Crop" }];
  assert.equal(clashIn(typo, { vertical: "Corp" })?.enquiryId, "DBS-EID-CORP-ERD-000006");
  assert.equal(clashIn(typo, { vertical: "corporate" })?.enquiryId, "DBS-EID-CORP-ERD-000006");
  assert.equal(clashIn([{ enquiryId: "X", vertical: "WED" }], { vertical: "Dum Dum" })?.enquiryId, "X");
  // And the service does the same thing rather than comparing text.
  assert.match(SERVICE, /const wanted = verticalFromValue\(vertical\);/);
  assert.match(SERVICE, /verticalFromValue\(row\.vertical\) === wanted/);
  assert.match(SERVICE, /row\.enquiryId !== skip/);
});

test("with no vertical to compare against, there is no rule to apply", () => {
  /*
   * Answering "no clash" rather than "clash with the first row". This guards a pair - a number and a
   * vertical - and half a pair is not one; refusing on the strength of a number alone would be the
   * unscoped rule the whole design rejects, arrived at by accident.
   */
  assert.equal(clashIn(ROWS, { vertical: "" }), null);
  assert.equal(clashIn(ROWS, { vertical: "Erode" }), null, "a place name is not a vertical");
  assert.match(SERVICE, /if \(!wanted\) return null;/);
});

/* ───────────────────────────────────────────────────── and what the API does ── */

test("both write paths are guarded, not only the one the form uses", () => {
  const create = CONTROLLER.slice(CONTROLLER.indexOf("async function create(req, res)"), CONTROLLER.indexOf("async function createBulk"));
  const update = CONTROLLER.slice(CONTROLLER.indexOf("async function update(req, res)"), CONTROLLER.indexOf("async function remove(req"));
  assert.match(create, /verticalClashResponse\(res, \{ phone: record\.lead\.phone, vertical: record\.lead\.vertical, excludeId: record\.lead\.id \}\)/);
  assert.match(update, /verticalClashResponse\(res, \{ phone, vertical, excludeId: id \}\)/);
  // Refused before the counter moves: an id minted for a lead that was never written leaves a gap in
  // the vertical's run, and gaps are read as deletions by whoever audits the board.
  assert.ok(create.indexOf("verticalClashResponse") < create.indexOf("nextLeadId"), "the id is minted before the clash is checked");
});

test("an update reads the vertical it is in, not the one its patch happens to carry", () => {
  /*
   * The popup writes a patch. A write that changes only the number says nothing about the vertical,
   * and taking that blank as "no vertical" would skip the guard on exactly the write it exists to
   * catch - which is the quietest way this whole rule could be nothing at all.
   */
  const update = CONTROLLER.slice(CONTROLLER.indexOf("async function update(req, res)"), CONTROLLER.indexOf("async function remove(req"));
  assert.match(update, /stored\?\.lead\?\.vertical \|\| stored\?\.details\?\.vertical/);
  // And the lookup is paid for only when a number is actually being *changed*: one PUT per field
  // means the overwhelming majority of updates carry no phone at all, and re-saving the number a
  // lead already holds is not this rule's business either - see `crm-duplicate-phone-guard`, which
  // is why: the paths that never asked this question left pairs of leads sharing a number, and
  // guarding an unchanged number would make every one of those pairs impossible to correct.
  assert.match(update, /if \(phone && changingPhone\) \{/);
  assert.match(update, /phoneMatchKey\(phone\) !== phoneMatchKey\(storedPhone\)/);
});

test("the refusal names the enquiry, and says so in a code the browser can read", () => {
  /*
   * "Already an enquiry" with no id leaves somebody hunting a board for a record they cannot see.
   * The id is the only thing that makes this answerable, and the form uses it to offer to open it.
   */
  const guard = CONTROLLER.slice(CONTROLLER.indexOf("async function verticalClashResponse"), CONTROLLER.indexOf("async function create(req, res)"));
  assert.match(guard, /res\.status\(409\)/);
  assert.match(guard, /code: "DUPLICATE_PHONE_IN_VERTICAL"/);
  assert.match(guard, /\$\{clash\.enquiryId\} in \$\{verticalFromValue\(vertical\)\}/);
  assert.match(guard, /data: \{ enquiryId: clash\.enquiryId/);
  // A write with no number in it is not this rule's business at all.
  assert.match(guard, /if \(!String\(phone \|\| ""\)\.trim\(\)\) return null;/);
});
