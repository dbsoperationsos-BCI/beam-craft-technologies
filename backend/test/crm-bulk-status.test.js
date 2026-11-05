const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Update Details applies a status, two follow-up dates and a CRM to a whole selection at once.
 *
 * The CRM half always sent one request for the whole selection. The status half sent a PUT
 * per selected lead, so the cost of the dialog grew with how many rows were ticked - and each
 * of those requests reads the lead, upserts it, queries information_schema, writes an
 * activity row and posts an outbound webhook. On a developer machine, against eight leads
 * and with no webhook configured, that is imperceptible. On the server, against real data
 * and with CRM_WEBHOOK_URL set, the burst was slow enough for the proxy to give up first -
 * and a proxy error page carries no CORS headers, so the browser could not read it as a
 * response at all and the app reported the API as unreachable instead of showing the error.
 *
 * These tests hold the shape that fixed it: one request for the selection, both fields
 * carried together, and no outbound call left able to hang a save open.
 */

function readSource(...segments) {
  return fs.readFileSync(path.join(__dirname, ...segments), "utf8");
}

function applyBulkUpdateDetailsSource() {
  const source = readSource("..", "..", "frontend", "src", "components", "sales", "CRMPage.js");
  const start = source.indexOf("async function applyBulkUpdateDetails()");
  assert.notEqual(start, -1, "applyBulkUpdateDetails was not found in CRMPage.js");
  const end = source.indexOf("\n  }\n", start);
  assert.notEqual(end, -1, "the end of applyBulkUpdateDetails was not found");
  return source.slice(start, end);
}

test("a bulk status change is one request rather than one per lead", () => {
  const body = applyBulkUpdateDetailsSource();

  assert.ok(
    body.includes("/api/sales/crm-leads/bulk-status"),
    "the status half of Update Details must go through the bulk-status endpoint",
  );
  assert.ok(
    !/method:\s*"PUT"/.test(body),
    "a PUT per lead makes the request count grow with the size of the selection",
  );
  assert.ok(
    !/ids\.map\(\s*\(id\)\s*=>[\s\S]*apiRequest/.test(body),
    "Update Details must not fan a request out over the selected ids",
  );
});

test("all three fields are sent together so a selection is never half updated", () => {
  const body = applyBulkUpdateDetailsSource();
  const call = body.slice(body.indexOf("bulk-status"));

  assert.ok(call.includes("status: bulkUpdateLeadStatus"), "the chosen status must be sent");
  assert.ok(call.includes("lastFollowUpDate: bulkUpdateLastUpdatedDate"), "the chosen last follow-up date must be sent");
  assert.ok(call.includes("nextFollowUpDate: bulkUpdateNextFollowUpDate"), "the chosen next follow-up date must be sent");
  // Each is conditional: Update Details treats a blank field as "leave this as it is", so
  // sending an empty one would overwrite that column across the whole selection.
  assert.ok(
    call.includes("bulkUpdateLeadStatus ? { status")
      && call.includes("bulkUpdateLastUpdatedDate ? { lastFollowUpDate")
      && call.includes("bulkUpdateNextFollowUpDate ? { nextFollowUpDate"),
    "a field left blank must be omitted rather than sent empty",
  );
});

/*
 * The two dates are not the same kind of fact, and a bulk edit has to keep them apart.
 *
 * Last Follow-up Date is the lead's own history of when it was last worked, which is true of the
 * lead whatever the call was about. Next Follow-up Date is when the thing being worked is to be
 * called back about - and on Qua Qua, inside a newborn or birthday window, that thing is the
 * occasion rather than the lead. Writing it onto the lead there would leave the follow-up tabs
 * reading the occurrence's empty copy and the lead chased on a date nothing shows.
 */
test("the next follow-up date follows the status onto the occasion being worked", () => {
  const source = readSource("..", "src", "modules", "sales", "crm-leads", "crmLeadService.js");
  const start = source.indexOf("async function setCrmLeadStatus(");
  assert.notEqual(start, -1, "setCrmLeadStatus was not found");
  const body = source.slice(start, source.indexOf("\n}\n", start));

  assert.ok(
    /occasionChanges\.nextFollowUpDate\s*=/.test(body),
    "a next follow-up date must be written against the occurrence of a lead inside an occasion window",
  );
  // The pass that occasion leads take carries the last follow-up date alone: the status and the
  // next follow-up date have already gone to the occurrence, and writing them here would undo it.
  assert.ok(
    body.includes("if (onOccasion.length && dateAssignment) passes.push({ ids: onOccasion, set: [dateAssignment] });"),
    "an occasion lead must take Last Follow-up Date only on the lead's own row",
  );
  assert.ok(
    body.includes("`next_follow_up_date` = ?"),
    "leads with no occasion open must take the next follow-up date on their own row",
  );
});

test("the occurrence's follow-up day is written, since only the lead's is generated", () => {
  const source = readSource("..", "src", "modules", "sales", "crm-leads", "occasionLeadService.js");
  const start = source.indexOf("async function writeOccurrences(");
  assert.notEqual(start, -1, "writeOccurrences was not found");
  const body = source.slice(start, source.indexOf("\n}\n", start));

  assert.ok(body.includes("next_follow_up_date"), "the occurrence must take the next follow-up date");
  assert.ok(
    body.includes("follow_up_day"),
    "the occurrence's follow_up_day is written rather than generated - the follow-up tabs compare it",
  );
  // A field the caller did not name means "leave this as it is", so it must not reach the
  // statement at all: an UPDATE naming it would clear it across every occurrence in the selection.
  assert.ok(
    body.includes("changes.nextFollowUpDate !== undefined") && body.includes("changes.status !== undefined"),
    "only the fields the caller named may be written",
  );
});

test("the bulk-status request accepts a next follow-up date on its own", () => {
  const source = readSource("..", "src", "modules", "sales", "crm-leads", "controller.js");
  const start = source.indexOf("const bulkStatusSchema = z.object({");
  assert.notEqual(start, -1, "bulkStatusSchema was not found");
  const body = source.slice(start, source.indexOf("});", source.indexOf(".refine(", start)) + 3);

  assert.ok(body.includes("nextFollowUpDate: z.string()"), "the schema must accept a next follow-up date");
  assert.ok(
    body.includes("value.status || value.lastFollowUpDate || value.nextFollowUpDate"),
    "any one of the three fields must be enough - the dialog can send one and leave the rest alone",
  );
});

test("the status and date are written in one statement per slice", () => {
  const source = readSource("..", "src", "modules", "sales", "crm-leads", "crmLeadService.js");
  const start = source.indexOf("async function setCrmLeadStatus(");
  assert.notEqual(start, -1, "setCrmLeadStatus was not found");
  const body = source.slice(start, source.indexOf("\n}\n", start));

  assert.ok(body.includes("STATUS_UPDATE_SLICE"), "the selection must be written in slices");
  assert.ok(
    body.includes("recordBulkActivity"),
    "activity must be written in bulk - recordLeadActivity resolves its actor with a SELECT per lead",
  );
  assert.ok(
    !/ids\.map\([\s\S]{0,80}recordLeadActivity/.test(body),
    "a per-lead activity write reintroduces the round trip this endpoint exists to avoid",
  );
});

test("the outbound webhook cannot hold a save open", () => {
  const source = readSource("..", "src", "modules", "sales", "crm-leads", "crmLeadService.js");
  const start = source.indexOf("async function sendCrmWebhook(");
  assert.notEqual(start, -1, "sendCrmWebhook was not found");
  const body = source.slice(start, source.indexOf("\n}\n", start));

  // A fetch with no deadline does not fail when the receiver hangs - it waits, and the save
  // waits with it. This is set on the server and usually not locally, so an unbounded wait
  // is invisible in development and decides the outcome in production.
  assert.ok(
    body.includes("AbortSignal.timeout"),
    "the CRM webhook must have a timeout so a hung receiver cannot stall the request",
  );
  assert.ok(body.includes("catch"), "a failed webhook must not fail the edit it describes");
});


/*
 * A lead nobody is chasing carries no next call, whichever way its status was written.
 *
 * The form has cleared the two fields on Rejected and Invalid for a while, but a status reaches
 * these columns several ways - the bulk dialog, the record panel, the sheet import, the CSV import -
 * and a rule kept in the form is one each of those has to remember separately. The Pending Followups
 * tabs read `follow_up_day`, so a date left behind puts a lead back on somebody's worklist under a
 * status saying the conversation is over.
 *
 * Against the database rather than the source, because the point is that every write path obeys it.
 */
const prisma = require("../src/config/db");
const { createCrmLead, updateCrmLead, setCrmLeadStatus } = require("../src/modules/sales/crm-leads/crmLeadService");

const REJ_ID = `TES-REJ-${String(Date.now()).slice(-6)}`;
const TODAY = new Date().toISOString().slice(0, 10);
const bookingOf = async () => (await prisma.$queryRawUnsafe(
  "SELECT `status`, `next_follow_up_date` AS `date`, `next_follow_up_time` AS `time`, `follow_up_day` AS `day`"
  + " FROM `sales_crm_lead` WHERE `enquiry_id` = ?", REJ_ID))[0];

test("a status that ends the conversation clears the call booked against it", async (t) => {
  t.after(async () => {
    await prisma.$executeRawUnsafe("DELETE FROM `sales_crm_lead` WHERE `enquiry_id` = ?", REJ_ID);
    await prisma.$disconnect();
  });

  await createCrmLead({
    lead: { id: REJ_ID, name: "Rejected Booking", phone: "9000000123", vertical: "Dum Dum", status: "Followup", createdDate: TODAY },
    details: { leadStatus: "Followup", nextFollowUpDate: TODAY, nextFollowUpTime: "10:00" },
  });
  const booked = await bookingOf();
  assert.equal(booked.date, TODAY, "the lead was not created carrying the call this test is about");

  // The bulk dialog can set a status without touching the date, so "leave this as it is" used to
  // leave the booking standing.
  await setCrmLeadStatus([REJ_ID], { status: "Rejected" }, {});
  const rejected = await bookingOf();
  assert.equal(rejected.status, "Rejected");
  assert.equal(rejected.date, null, "a Rejected lead still carries the call it was booked for");
  assert.equal(rejected.time, null, "half a booking is not a booking");
  /*
   * NULL and not "". `follow_up_day` is the generated fold of the date column, and Overall Pending
   * counts `follow_up_day IS NULL` as work owed on a day the board cannot name - right for a lead
   * still being chased, wrong for one nobody is chasing. An empty string reads as the former.
   */
  assert.equal(rejected.day, null);

  // And the rule wins over what the caller sends: an edit naming a date on a Rejected lead is a
  // call nobody is going to make.
  await updateCrmLead(REJ_ID, {
    lead: { status: "Rejected" },
    details: { leadStatus: "Rejected", nextFollowUpDate: TODAY, nextFollowUpTime: "10:00" },
  });
  const afterEdit = await bookingOf();
  assert.equal(afterEdit.date, null, "a date sent alongside Rejected is written anyway");
  assert.equal(afterEdit.time, null);
});
