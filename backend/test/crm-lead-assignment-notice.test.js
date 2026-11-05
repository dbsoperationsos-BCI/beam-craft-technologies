const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const notifications = require("../src/services/notifications");

/*
 * Telling somebody a lead is theirs.
 *
 * A lead is put in a person's name in three ways from inside the application - the Add Lead form
 * with a CRM chosen, an edit that changes the CRM, and the bulk Update Details over a selection -
 * and none of them told the person. The lead appeared on their board and whether they noticed
 * depended on whether they happened to look, which for a handover at five o'clock means the next
 * morning and for a busy board means never.
 *
 * What is worth pinning: that all three paths raise it, that a save which does not move the CRM
 * raises nothing, and that raising it can never be what breaks the write it reports on.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "sales", "crm-leads");
const read = (name) => fs.readFileSync(path.join(MODULE, name), "utf8");
const NOTICES = read("leadNotifications.js");
const SERVICE = read("crmLeadService.js");
const CONTROLLER = read("controller.js");

test("the notice is a kind of its own, and it answers for the CRM's permission", () => {
  /*
   * Not `HRM / Task Management`, which every stored notice used to answer for. A row that names a
   * lead and links to it must only reach somebody who holds the board it links into, or the bell
   * becomes a way of reading a client's name past the guard on the screen that holds it.
   */
  assert.equal(notifications.TYPES.LEAD_ASSIGNED, "LEAD_ASSIGNED");
  assert.deepEqual(notifications.TYPE_PERMISSIONS.LEAD_ASSIGNED, { module: "SALES", feature: "CRM Leads" });
});

test("all three ways of assigning a lead raise it", () => {
  // One lead, edited. `before` is the row as it stood, read at the top of `updateCrmLead`.
  assert.match(SERVICE, /await notifyLeadAssigned\(\s*\n\s*\{ enquiryId: id, name: nextRecord\?\.lead\?\.name \|\| before\?\.name \|\| "" \},/);
  assert.match(SERVICE, /previousCrm: before\?\.crm \|\| ""/);
  // A selection, shared out. `buckets` and not `perCrm`: the latter is the count per CRM, and a
  // notice cannot be built from a count.
  assert.match(SERVICE, /await notifyLeadsAssigned\(Object\.fromEntries\(buckets\), \{ actorId: actor\?\.actorUserId \?\? null \}\);/);
  /*
   * And a lead entered against somebody else's name. In the controller rather than in
   * `createCrmLead`, which is also the sheet poller's and the Callyzer webhook's way in and has no
   * signed-in person to name as the actor.
   */
  assert.match(CONTROLLER, /await notifyLeadAssigned\(/);
  assert.match(CONTROLLER, /crm: created\?\.lead\?\.crm \|\| record\.lead\.crm \|\| ""/);
});

test("a save that does not move the CRM says nothing", () => {
  /*
   * The board's Update sends the whole lead back, so without this every remark, status change and
   * follow-up date would re-announce an assignment that has not changed - and a bell that repeats
   * itself is a bell people stop opening. Compared trimmed and case-folded, because the name on a
   * lead is text a person typed or a sheet supplied.
   */
  assert.match(NOTICES, /if \(!next \|\| next\.toLowerCase\(\) === String\(previousCrm \|\| ""\)\.trim\(\)\.toLowerCase\(\)\) return null;/);
  // And nobody is told about their own action, which `notify` itself refuses - so a salesperson
  // taking a lead for themselves is not told they have done so.
  assert.match(
    fs.readFileSync(path.join(__dirname, "..", "src", "services", "notifications.js"), "utf8"),
    /if \(!userId \|\| \(actorId && userId === actorId\)\) return null;/,
  );
});

test("raising it can never be what breaks the assignment", () => {
  /*
   * A lead is assigned whether or not anybody can be told about it. Every entry point swallows its
   * own failure and logs where it happened; the alternative is a 500 on a request that has already
   * moved a hundred leads, which loses the reader any way of knowing that it worked.
   */
  for (const entry of ["notifyLeadAssigned", "notifyLeadsAssigned", "userIdsForCrmNames"]) {
    const start = NOTICES.indexOf(`async function ${entry}(`);
    assert.notEqual(start, -1, `${entry} was not found`);
    const body = NOTICES.slice(start, NOTICES.indexOf("\n}\n", start));
    assert.match(body, /catch \(error\) \{[\s\S]*?console\.warn/, `${entry} lets its own failure escape`);
  }
});

test("the name on a lead is matched the way every other reader of that column matches it", () => {
  /*
   * `sales_crm_lead` records who is working a lead as a name rather than as a user id. The bell's own
   * follow-up source makes the same match, and so does the Reports module wherever it groups by a
   * person - so this makes it too rather than inventing a second rule. Trimmed and case-folded in the
   * database, and against active logins only: a notice written to an account nobody signs into is a
   * row that will never be read.
   */
  assert.match(NOTICES, /LOWER\(TRIM\(`name`\)\) = LOWER\(TRIM\(\?\)\) AND `status` = 'ACTIVE'/);
  assert.match(NOTICES, /LOWER\(TRIM\(\\`name\\`\)\) IN \(\$\{wanted\.map\(\(\) => "LOWER\(TRIM\(\?\)\)"\)/);
  // One query for a bulk assign, not one per name.
  assert.match(NOTICES, /\/\*\* The same lookup for several names at once, as a `name -> user id` map\. One query, not N\. \*\//);
});

test("the notice says which lead, and opens it", () => {
  /*
   * A notice that says something is waiting and not where is one somebody has to go and find, which
   * is most of the work it was meant to save. The link is the one the Contacts directory and the
   * bell's follow-up notices already use, so all three open a lead the same way.
   */
  assert.match(NOTICES, /link: enquiryId \? `\/sales\/crm\?lead=\$\{encodeURIComponent\(enquiryId\)\}` : "\/sales\/crm",/);
  // The client's name rather than the enquiry id, because "DBS-EID-DD-ERD-000412" is a title the
  // reader has to go and look up. The id is in the body, and on the lead when they open it.
  assert.match(NOTICES, /title: `Lead assigned: \$\{client\}`/);
});
