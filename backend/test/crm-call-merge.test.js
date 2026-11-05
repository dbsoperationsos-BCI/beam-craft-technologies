const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeCallIntoLead, isPlaceholderName } = require("../src/modules/sales/crm-leads/callMerge");

/*
 * What a Callyzer call is allowed to write onto a lead that already exists.
 *
 * The production fault: the webhook spread the record it built from the call over the lead it
 * matched, so ringing a client already in the CRM overwrote their record with what a call log
 * happens to know. Every assertion here is a field that was being destroyed by a phone call.
 *
 * The lead below is deliberately a full one - a Qua Qua lead from a campaign in March, with notes,
 * a follow-up booked and a live link to the spreadsheet row it syncs with. The call is what an
 * ordinary inbound call looks like: a made-up name, today's date, a one-line summary, and nothing
 * else it actually knows.
 */

const LEAD = {
  lead: {
    id: "DBS-DD-EID-9",
    name: "Priya Sharma",
    phone: "9876512345",
    vertical: "Qua Qua",
    status: "Interested",
    crm: "Anitha",
    createdDate: "2026-03-04",
    addedTime: "11:20:00",
    source: "Meta Ads",
    referredFrom: "Instagram",
    contactRepeated: "Enquired 2 times",
  },
  details: {
    leadStatus: "Interested",
    remarks: "Wants a newborn shoot in July. Budget discussed.",
    nextFollowUpDate: "2026-09-02",
    nextFollowUpTime: "10:00",
    sourceEnquiryId: "sheet-114",
    sourceRowNumber: "114",
    spreadsheetId: "1AbCdEf",
  },
};

const CALL = {
  lead: {
    id: "",
    name: "Call 2345",
    phone: "9876512345",
    vertical: "Dum Dum",
    crm: "Priya S",
    createdDate: "2026-08-30",
    addedTime: "17:49:41",
    source: "Callyzer",
    referredFrom: "Callyzer Call Log",
    contactRepeated: "",
  },
  details: {
    importedFrom: "Callyzer",
    sourceEnquiryId: "XgnkwIIXrlKYMem",
    groupType: "callyzer",
    groupName: "Callyzer",
    leadStatus: "Followup",
    remarks: "Incoming call · 310s · 2026-08-30 by Priya S",
    nextFollowUpDate: "",
    nextFollowUpTime: "",
  },
};

test("the lead keeps its own identity when a call comes in", () => {
  const { lead } = mergeCallIntoLead(LEAD, CALL);
  assert.equal(lead.id, "DBS-DD-EID-9");
  assert.equal(lead.name, "Priya Sharma", "a real name is not replaced by Callyzer's invented one");
  assert.equal(lead.createdDate, "2026-03-04", "the enquiry date is when the enquiry came in, not when they rang");
  assert.equal(lead.addedTime, "11:20:00");
  assert.equal(lead.source, "Meta Ads", "a call is how this call arrived, not where the lead came from");
  assert.equal(lead.referredFrom, "Instagram");
  assert.equal(lead.vertical, "Qua Qua", "a vertical somebody set is not overruled by a keyword in a call");
  assert.equal(lead.crm, "Anitha", "an assigned lead is not reassigned to whoever happened to answer");
});

test("the lead keeps its notes, its follow-up and its link to the sheet", () => {
  const { details } = mergeCallIntoLead(LEAD, CALL);
  assert.equal(details.remarks, "Wants a newborn shoot in July. Budget discussed.");
  assert.equal(details.nextFollowUpDate, "2026-09-02", "an empty reminder is not an instruction to forget the follow-up");
  assert.equal(details.nextFollowUpTime, "10:00");
  assert.equal(details.sourceEnquiryId, "sheet-114", "overwriting this breaks the row's sheet sync");
  assert.equal(details.sourceRowNumber, "114");
  assert.equal(details.spreadsheetId, "1AbCdEf");
});

test("the call's outcome does move the lead's status", () => {
  // The one thing a call genuinely knows better than the lead: what happened on the phone.
  assert.equal(mergeCallIntoLead(LEAD, CALL).details.leadStatus, "Followup");
});

test("a converted lead is not moved back to an open status by a call", () => {
  // A client ringing about their album after the wedding has not un-converted.
  const converted = { ...LEAD, details: { ...LEAD.details, leadStatus: "Converted" } };
  assert.equal(mergeCallIntoLead(converted, CALL).details.leadStatus, "Converted");

  // Qua Qua runs the two together, and that status says both. It is not half-overwritten either.
  const both = { ...LEAD, details: { ...LEAD.details, leadStatus: "Converted & Followup" } };
  assert.equal(mergeCallIntoLead(both, CALL).details.leadStatus, "Converted & Followup");
});

test("a call fills in what the lead does not have", () => {
  const bare = {
    lead: { id: "DBS-DD-EID-9", name: "", phone: "", vertical: "", crm: "" },
    details: { remarks: "" },
  };
  const { lead, details } = mergeCallIntoLead(bare, {
    ...CALL,
    lead: { ...CALL.lead, name: "Ramesh Kumar" },
  });
  assert.equal(lead.name, "Ramesh Kumar");
  assert.equal(lead.phone, "9876512345");
  assert.equal(lead.vertical, "Dum Dum");
  assert.equal(lead.crm, "Priya S");
  assert.equal(details.remarks, CALL.details.remarks, "a lead with no notes takes the call's summary");
});

/*
 * "Call 2345" is what Callyzer sends when the number is not in the employee's contacts. It is worth
 * having on a lead that has nothing else and worth nothing beside a real name - and a lead already
 * carrying one should be improved by a call that does know the name.
 */
test("a placeholder name is recognised, and never displaces a real one", () => {
  assert.equal(isPlaceholderName("Call 2345"), true);
  assert.equal(isPlaceholderName("Call 3"), true);
  assert.equal(isPlaceholderName("call"), true);
  assert.equal(isPlaceholderName("Callie Menon"), false, "a real name that begins with the same letters");
  assert.equal(isPlaceholderName("Call Ramesh back"), false);

  const placeheld = { lead: { id: "x", name: "Call 2345" }, details: {} };
  assert.equal(mergeCallIntoLead(placeheld, { ...CALL, lead: { ...CALL.lead, name: "Ramesh Kumar" } }).lead.name, "Ramesh Kumar");
  assert.equal(mergeCallIntoLead(placeheld, { ...CALL, lead: { ...CALL.lead, name: "Call 9999" } }).lead.name, "Call 2345",
    "one placeholder does not replace another");

  // With nothing there at all a placeholder is still better than a blank: it says which number rang.
  assert.equal(mergeCallIntoLead({ lead: { id: "x", name: "" }, details: {} }, CALL).lead.name, "Call 2345");
});

test("neither side is modified", () => {
  const lead = JSON.parse(JSON.stringify(LEAD));
  const call = JSON.parse(JSON.stringify(CALL));
  mergeCallIntoLead(lead, call);
  assert.deepEqual(lead, LEAD);
  assert.deepEqual(call, CALL);
});

test("a lead with nothing on it at all does not throw", () => {
  // A delivery must never fail on the shape of a row. Missing halves are the shape a partly written
  // legacy lead actually has.
  assert.deepEqual(mergeCallIntoLead({}, {}), { lead: {}, details: {} });
  assert.equal(mergeCallIntoLead({ lead: { id: "x" } }, CALL).lead.name, "Call 2345");
});
