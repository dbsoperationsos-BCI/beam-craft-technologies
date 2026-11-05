const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * `POST /api/sales/crm-leads/bulk` — several leads written at once.
 *
 * It is what Bulk Import posts, and it had a hole that only shows up on the leads it writes: the
 * record schema makes `lead.id` optional, exactly as the single create does, because an enquiry id
 * counts within its own vertical and branch and only the counter knows where that pair has got to.
 * The single create mints one. This did not — so every caller that left the id out, which is every
 * caller not replaying an existing lead, wrote rows with a blank `enquiry_id`.
 *
 * That column is what the whole module is keyed by: the board's row key, the Call Logs join, the
 * activity log, the duplicate check, the link a notification opens. Blank, the leads land where
 * nobody can open them and nothing says so.
 */

const CONTROLLER = fs.readFileSync(
  path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "controller.js"),
  "utf8",
);

const BULK = CONTROLLER.slice(CONTROLLER.indexOf("async function createBulk("), CONTROLLER.indexOf("async function update("));

test("every record is minted the Enquiry ID it does not bring", () => {
  assert.match(BULK, /const id = record\.lead\.id \|\| await nextLeadId\(\{ vertical: record\.lead\.vertical, branch: record\.lead\.assignedBranch \}\);/);
  /*
   * From that record's *own* vertical and branch, one at a time rather than one reserved range for
   * the batch. Bulk Import lets each entry pick its own vertical - a day's names are rarely all
   * weddings - and a range is reserved per counter, so a batch spanning three verticals cannot be
   * one range. `reserveLeadIdRange` behind `nextLeadId` is what makes each of these atomic.
   */
  assert.match(BULK, /records\.push\(\{ \.\.\.record, lead: \{ \.\.\.record\.lead, id, source: LEAD_SOURCES\.MANUAL \} \}\);/);
  assert.match(BULK, /await createCrmLeads\(records\);/, "the batch is written from the records that were handed in, before the ids were added");
});

test("a lead added in a batch gets the history a lead added one at a time gets", () => {
  /*
   * Three things the single create does and this did not. Without them a lead added this way is a
   * lead with no creator, no history and a silent handover - which is the same lead, entered the
   * same day, behaving differently depending on which button was pressed.
   */
  // Whoever entered them, so a lead nobody is assigned yet is still visible to the person who typed
  // it - `created_by_user_id` is one of the columns the data scope reads.
  assert.match(BULK, /await stampCrmLeadCreator\(ids, req\.user\?\.id\);/);
  // A CREATED row each, in one insert rather than one per lead - see `recordBulkActivity`.
  assert.match(BULK, /await recordBulkActivity\(ids\.map\(\(id\) => \(\{ enquiryId: id, action: "CREATED", fieldLabel: "Lead" \}\)\), actorFrom\(req\)\);/);
  // And a lead entered against somebody else's name tells them so, exactly as it does on Add Lead.
  assert.match(BULK, /await notifyLeadAssigned\(/);
  assert.match(BULK, /crm: record\?\.lead\?\.crm \|\| "", actorId: req\.user\?\.id \?\? null/);
});

test("the ids acted on are the ones actually written", () => {
  /*
   * Read back off what `createCrmLeads` returned rather than off what was sent to it: the sheet
   * writer can hand back a different record, and stamping the creator on an id that was never
   * written would be a silent no-op. Blanks are filtered, so a record that failed to write cannot
   * put an empty id into an activity row or a notification link.
   */
  assert.match(BULK, /const ids = created\.map\(\(record\) => record\?\.lead\?\.id\)\.filter\(Boolean\);/);
});

test("the route is still guarded and still under the fixed segment", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "routes.js"), "utf8");
  // `/bulk` above `/:id`, or Express reads "bulk" as an enquiry id.
  assert.ok(routes.indexOf('router.post("/bulk", createBulk);') < routes.indexOf('router.put("/:id"'), "/bulk is below /:id and will be read as an id");
  // The router's own guard covers it: writing leads is `SALES / CRM Leads` at READ_WRITE, and a new
  // route added under this router is covered the moment it is written.
  assert.match(routes, /requireModule\("SALES", "CRM Leads"\)|checkPermission\("SALES", "CRM Leads"/);
});
