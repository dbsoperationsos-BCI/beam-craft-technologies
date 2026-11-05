const test = require("node:test");
const assert = require("node:assert/strict");
const { flattenLeadColumns } = require("../src/modules/sales/crm-leads/crmLeadService");

/*
 * An update changes the fields it names and leaves the rest of the lead alone.
 *
 * The fault this exists for lost real leads. `upsertMysqlRecord` sets every column
 * `flattenLeadColumns` produces, and a field absent from the record flattens to `null` - so a
 * caller that sent only the field it was changing blanked every other one in the same write.
 *
 * What it looked like from the CRM: a Corp lead came back with an empty `vertical`, and a blank
 * vertical is read as Dum Dum by the tab rules, so the lead vanished from Corp without anybody
 * deleting anything. Its name, phone and status went in the same write, so the row left behind did
 * not look like the lead either - and nothing appeared in the Activity Log as a deletion, because
 * nothing was deleted. `PUT /api/sales/crm-leads/:id` takes a partial lead by design, so this was
 * one ordinary request away.
 *
 * `updateCrmLead` now merges onto what is stored. These pin down the two halves of that: what
 * flattening actually does to an absent field (the mechanism), and the rule the merge follows.
 */

/** The merge `updateCrmLead` performs, in the form the rules can be read in. */
function mergeUpdate(current, record) {
  const merged = {
    lead: { ...(current?.lead || {}), ...(record?.lead || {}), id: current?.lead?.id },
    details: { ...(current?.details || {}), ...(record?.details || {}) },
  };
  const setsStatus = record?.lead?.status !== undefined;
  const setsLeadStatus = record?.details?.leadStatus !== undefined;
  if (setsStatus && !setsLeadStatus) merged.details.leadStatus = record.lead.status;
  else if (setsLeadStatus && !setsStatus) merged.lead.status = record.details.leadStatus;
  return merged;
}

const STORED = {
  lead: {
    id: "DBS-DD-EID-4900",
    name: "Corp Client Ltd",
    phone: "9000077777",
    vertical: "Corp",
    status: "Interested",
    companyName: "Corp Client Ltd",
    assignedBranch: "Erode",
    estimatedValue: "",
  },
  details: { leadStatus: "Interested" },
};

/* ------------------------------------------------------- the mechanism that lost them */

test("a field absent from a record flattens to null, which is what a write stores", () => {
  // Not a quirk of the test - this is the object every INSERT and UPDATE takes its values from.
  const columns = flattenLeadColumns({ lead: { name: "Only a name" }, details: {} });
  assert.equal(columns.name, "Only a name");
  assert.equal(columns.vertical, null, "an absent vertical is written as null, not left alone");
  assert.equal(columns.phone, null);
});

/* -------------------------------------------------------------------- the merge rule */

test("an update keeps every field it does not name", () => {
  const merged = mergeUpdate(STORED, { lead: { estimatedValue: "50000" }, details: {} });
  assert.equal(merged.lead.vertical, "Corp", "the vertical is what made the lead disappear");
  assert.equal(merged.lead.name, "Corp Client Ltd");
  assert.equal(merged.lead.phone, "9000077777");
  assert.equal(merged.lead.status, "Interested");
  assert.equal(merged.lead.estimatedValue, "50000", "and the field it did name is written");
});

/*
 * Merging must not make clearing impossible. A key that is present but empty is somebody emptying
 * the field on purpose; only an absent key falls back to what is stored.
 */
test("a field can still be cleared on purpose", () => {
  const merged = mergeUpdate(STORED, { lead: { companyName: "" }, details: {} });
  assert.equal(merged.lead.companyName, "", "present-and-empty clears");
  assert.equal(merged.lead.vertical, "Corp", "and clearing one field does not touch another");
});

test("the id is never taken from the caller", () => {
  // A body naming a different lead must not move the row it is updating.
  const merged = mergeUpdate(STORED, { lead: { id: "DBS-DD-EID-1", name: "Someone else" }, details: {} });
  assert.equal(merged.lead.id, "DBS-DD-EID-4900");
});

/* ------------------------------------------------------------------- the two statuses */

/*
 * The status is stored under two names and `flattenLeadColumns` writes `details.leadStatus ||
 * lead.status`, so the detail wins. Merging each half independently meant a caller changing
 * `lead.status` alone had its new status overruled by the old detail underneath it: the write
 * succeeded and the status did not move.
 */
test("changing the status by either name moves both", () => {
  const byLead = mergeUpdate(STORED, { lead: { status: "Converted" }, details: {} });
  assert.equal(byLead.lead.status, "Converted");
  assert.equal(byLead.details.leadStatus, "Converted", "or the stored detail would overrule it");

  const byDetail = mergeUpdate(STORED, { lead: {}, details: { leadStatus: "Followup" } });
  assert.equal(byDetail.details.leadStatus, "Followup");
  assert.equal(byDetail.lead.status, "Followup");
});

test("an update that says nothing about the status leaves it alone", () => {
  const merged = mergeUpdate(STORED, { lead: { estimatedValue: "1" }, details: {} });
  assert.equal(merged.lead.status, "Interested");
  assert.equal(merged.details.leadStatus, "Interested");
});

test("a caller that sends both is taken at its word", () => {
  const merged = mergeUpdate(STORED, { lead: { status: "Converted" }, details: { leadStatus: "Converted & Followup" } });
  // Neither half is rewritten from the other when the caller has set them both; the detail wins on
  // the way to the column, which is the existing rule and not this merge's business.
  assert.equal(merged.lead.status, "Converted");
  assert.equal(merged.details.leadStatus, "Converted & Followup");
});

/* --------------------------------------------------------------- what the CRM then sees */

test("a blanked vertical is why a Corp lead showed up as a Dum Dum one", () => {
  /*
   * Not a rule this file owns - it is `leadQueryService`'s, restated here because it is the second
   * half of the disappearance. Losing the vertical does not hide a lead; it moves it, which is
   * worse, because the lead is neither where it was nor obviously anywhere.
   */
  const blankIsDumDum = (vertical) => {
    const key = String(vertical || "").trim().toLowerCase().replace(/\s+/g, "");
    return key === "" || !["quaqua", "corp", "corporate", "corporation"].includes(key);
  };
  assert.equal(blankIsDumDum(""), true);
  assert.equal(blankIsDumDum("Corp"), false);
});

/* ------------------------------------------------- two people editing one lead at once */

/**
 * The columns a record names, which is what an update is allowed to write.
 *
 * Mirrors `namedColumns` in the service. An update that writes every column instead loses a
 * colleague's simultaneous edit: both read the same row, both merge their own field into it, and
 * whichever finishes last restores the other's field to what it was. Both requests succeed and one
 * person's work is silently gone - which is what a studio with several people on one board does all
 * day.
 */
function namedColumns(record) {
  const named = new Set(Object.keys(record?.lead || {}).filter((key) => key !== "id"));
  for (const key of Object.keys(record?.details || {})) named.add(key);
  if (record?.details?.leadStatus !== undefined) named.add("status");
  return named;
}

test("an update writes only the fields it named", () => {
  const named = namedColumns({ lead: { estimatedValue: "50000" }, details: {} });
  assert.deepEqual([...named], ["estimatedValue"]);
  // The id is not a column an update sets - it is the row being updated.
  assert.equal(namedColumns({ lead: { id: "DBS-DD-EID-1", name: "X" }, details: {} }).has("id"), false);
});

test("two edits to different fields name different columns, so neither can undo the other", () => {
  const a = namedColumns({ lead: { companyName: "Acme Two" }, details: {} });
  const b = namedColumns({ lead: { designation: "Director" }, details: {} });
  const overlap = [...a].filter((column) => b.has(column));
  assert.deepEqual(overlap, [], "disjoint writes are what makes concurrent edits safe");
});

test("naming the status by either name counts as naming the status column", () => {
  // `flattenLeadColumns` writes `status` from `details.leadStatus || lead.status`, so a caller that
  // only set the detail still has to have the column written.
  assert.equal(namedColumns({ lead: {}, details: { leadStatus: "Converted" } }).has("status"), true);
  assert.equal(namedColumns({ lead: { status: "Converted" }, details: {} }).has("status"), true);
});
