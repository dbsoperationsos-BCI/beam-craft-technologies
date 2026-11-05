const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Converted History names a project. Opening it has to *be* the project.
 *
 * The tab could say a lead became `DBS-BK-DD-TUP-000008` and stop there: nine summary columns, and
 * then the trail ended. Reading what was actually sold meant leaving the lead, opening Sales
 * Manager, and finding that Event ID again by hand - with the lead popup closed behind you.
 *
 * A row opens the record now, drawn by the same `ProjectRecordPanel` the project tables use. Which
 * moves the risk here, to this read: the panel draws whatever fields it is handed and quietly omits
 * the ones that are missing, so a field left out of this `select` is not an error anywhere. It is a
 * section that silently does not appear - Deliverables with no details under it, an empty WhatsApp
 * Group Details, a record with no Enquiry ID at the top of it. This file is what makes that loud.
 */

const SERVICE = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "crmLeadService.js"),
  "utf8",
);

/** The `select` block of `listCrmLeadProjects`, which is the whole subject here. */
const SELECT = (() => {
  const fn = SERVICE.slice(SERVICE.indexOf("async function listCrmLeadProjects"));
  return fn.slice(fn.indexOf("select: {"), fn.indexOf("});"));
})();

test("the read carries every field the record view draws", () => {
  /*
   * Taken from `commonProjectInfoSections` in the frontend's `infoPanelConfig.js`, which is the
   * list the panel is given. The two files cannot import each other - one is the API and one is the
   * browser - so this is written out, and that is the point of writing it out: the copy is checked
   * on every run rather than being a comment that goes stale.
   */
  const drawn = [
    // Project Identity
    "eventId", "enquiryId", "projectStatus", "whatsappGroupName", "vertical",
    // Client & Branch
    "clientMainNumber", "sourceBranch", "crmName",
    // Event Planning
    "mainEventDateKnown", "mainEventDate", "initialConvertedValue",
    // Deliverables
    "deliverables", "deliverablesDetails",
    // WhatsApp Group Details - the branch, offer, client, place and the rest are unpacked from this
    // one column by `projectForInfo`, so the column is what has to be read.
    "groupNameGeneratorJson",
    // Remarks
    "salesPreProductionRemarks", "salesProductionRemarks", "salesPostProductionRemarks",
    // System Details
    "createdAt", "updatedAt",
  ];
  for (const field of drawn) {
    assert.match(SELECT, new RegExp(`\\b${field}: true`), `${field} is drawn by the record view and is not read`);
  }
  // And the row id, which is how the popup holds on to which project is open.
  assert.match(SELECT, /\bid: true/);
});

test("the workflow is deliberately not read here", () => {
  /*
   * Not an omission. Shoots, their service allocations and their post-production deliverables are
   * Project Management's reading of a project - a nested read several levels deep - and this
   * endpoint answers the CRM's permission, not Projects'. Somebody who holds Project Management
   * opens the fuller record on their own board.
   *
   * Pinned because the temptation on the next widening is to add `shoots: true` and be done: that
   * would hand every CRM viewer the production plan through a tab that is guarded as sales.
   */
  assert.doesNotMatch(SELECT, /\bshoots\b/);
  assert.doesNotMatch(SELECT, /\bproductionAssignment\b/);
  assert.doesNotMatch(SELECT, /\bpayments\b/);
});

/* ────────────────────────────────────────── and what the history is keyed on ── */

const LIST = SERVICE.slice(SERVICE.indexOf("async function listCrmLeadProjects"), SERVICE.indexOf("async function listCrmLeads"));

test("the history is pulled by contact number, not by enquiry id", () => {
  /*
   * The enquiry id answered a narrower question than the tab asks: not "what has this client
   * bought" but "what was booked through this particular enquiry row". Those come apart constantly -
   * a booking raised against another of the client's enquiries, a project whose `enquiry_id` was
   * imported or corrected, a lead whose id was reissued after a deletion - and every one of them
   * failed the same way, with the tab reading "No project has been created from this lead yet" for a
   * client who plainly has one. That is a sentence about the client, not about a join, and nothing
   * on screen said otherwise.
   */
  assert.match(LIST, /RIGHT\(REGEXP_REPLACE\(COALESCE\(`client_main_number`, ''\), '\[\^0-9\]', ''\), 10\) = \?/);
  // The enquiry id is read for one thing only now: finding the lead whose number this is.
  assert.match(LIST, /WHERE `enquiry_id` = \? AND `deleted_at` IS NULL LIMIT 1/);
  assert.doesNotMatch(LIST, /where: \{ enquiryId: id/, "the projects are being selected by enquiry id again");
});

test("the number is matched on its last ten digits, the way the whole CRM matches a client", () => {
  /*
   * Not the stored string. The same client is written "+91 4786958704" on the project and
   * "47869-58704" on the lead, so comparing text - or `endsWith` on the raw column - matches one of
   * those and misses the other. The last ten digits is what the Callyzer webhook routes a call on,
   * what the Contacts directory folds a person by, and what the duplicate check compares.
   */
  assert.match(LIST, /phoneMatchKey\(lead\?\.contactNumber\) \|\| phoneMatchKey\(lead\?\.phone\)/);
  // Both columns, because a lead's number lives in either depending on when it was written.
  assert.match(LIST, /SELECT `contact_number` AS `contactNumber`, `phone`/);
});

test("a lead with no number gets no history, rather than falling back", () => {
  /*
   * A fallback to the enquiry id would make the tab answer a different question on some rows than on
   * others, with nothing on screen saying which - which is worse than an empty tab, because an empty
   * tab is at least consistently wrong in a way somebody can notice.
   */
  assert.match(LIST, /if \(!digits\) return \[\];/);
  // An enquiry with no id asks for nothing rather than for everything.
  assert.match(LIST, /if \(!id\) return \[\];/);
});

test("a deleted project drops out, and one client cannot read the whole table", () => {
  // Both halves of the read exclude deleted rows - the id lookup is the one that has to, since the
  // select that follows it names ids rather than filtering.
  assert.match(LIST, /SELECT `id` FROM `sales_project`"\s*\n?\s*\+ " WHERE `deleted_at` IS NULL/);
  // And a cap, so one malformed number - an empty column matching an empty key - cannot pull the
  // whole table into a lead popup.
  assert.match(LIST, /LIMIT 100/);
});

test("project ids are kept as the strings they are", () => {
  /*
   * `SalesProject.id` is a `cuid`. Coercing it to a number would leave `NaN` for every row, the `in`
   * would be empty, and the tab would read "no project" for a client who has several - a fault with
   * no error anywhere in it.
   */
  assert.match(LIST, /matches\.map\(\(row\) => String\(row\.id\)\)/);
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const model = schema.slice(schema.indexOf("model SalesProject "), schema.indexOf("model SalesProject ") + 200);
  assert.match(model, /id\s+String\s+@id @default\(cuid\(\)\)/, "SalesProject.id is no longer a string");
});
