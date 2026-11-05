const test = require("node:test");
const assert = require("node:assert/strict");
const { toRow, calledAt, resolveEmployeeId, employeeNameKey, employeeCodeKey } = require("../src/modules/sales/crm-leads/callLogService");

/*
 * Turning one Callyzer call into the row the Call Logs tab reads.
 *
 * Only the mapping is exercised here - the writes go through raw SQL against MySQL, which the rest
 * of this suite does not stand up either. What matters at this layer is that a redelivered call
 * keeps its identity, that the numbers and durations come out in the shape the tab renders, and
 * that a call sorts by when it happened rather than by when it was delivered.
 */

const CALL = {
  id: "XgnkwIIXrlKYMem",
  client_name: "My Contact Name",
  client_country_code: "91",
  client_number: "8090712345",
  duration: "310",
  call_type: "Incoming",
  call_method: "WhatsAppCall",
  call_mode: "Video",
  call_date: "2026-08-13",
  call_time: "17:49:41",
  note: "Confirmed the date",
  call_recording_url: "https://media1.callyzer.co/file/callyzer-audios/T1/a.mp3",
  crm_status: "Positive",
};

test("a call keeps Callyzer's own id, so a redelivery is the same row", () => {
  const first = toRow(CALL, { enquiryId: "DBS-DD-EID-1" });
  const again = toRow({ ...CALL }, { enquiryId: "DBS-DD-EID-1" });
  assert.equal(first.id, "XgnkwIIXrlKYMem");
  assert.equal(again.id, first.id);
});

test("a call with no id of its own is identified by number and moment", () => {
  const { id, ...rest } = CALL;
  const row = toRow(rest, { enquiryId: "DBS-DD-EID-1" });
  // Two deliveries of the same call agree; a different call at a different second does not.
  assert.equal(row.id, toRow({ ...rest }, { enquiryId: "DBS-DD-EID-1" }).id);
  assert.notEqual(row.id, toRow({ ...rest, call_time: "18:00:00" }, { enquiryId: "DBS-DD-EID-1" }).id);
});

test("the country code is joined to the number", () => {
  assert.equal(toRow(CALL, { enquiryId: "x" }).clientNumber, "+918090712345");
});

test("a number that already carries its code is left alone", () => {
  const row = toRow({ ...CALL, client_number: "+918090712345" }, { enquiryId: "x" });
  assert.equal(row.clientNumber, "+918090712345");
});

test("the employee who took the call is carried across", () => {
  const row = toRow(CALL, { enquiryId: "x", employee: { emp_name: "Priya S", emp_number: "9876500000" } });
  assert.equal(row.employeeName, "Priya S");
  assert.equal(row.employeeNumber, "9876500000");
});

test("duration is a number, and a missed call is zero rather than NaN", () => {
  assert.equal(toRow(CALL, { enquiryId: "x" }).durationSeconds, 310);
  assert.equal(toRow({ ...CALL, duration: "" }, { enquiryId: "x" }).durationSeconds, 0);
  assert.equal(toRow({ ...CALL, duration: "not a number" }, { enquiryId: "x" }).durationSeconds, 0);
});

test("the recording url and the note survive", () => {
  const row = toRow(CALL, { enquiryId: "x" });
  assert.equal(row.recordingUrl, "https://media1.callyzer.co/file/callyzer-audios/T1/a.mp3");
  assert.equal(row.note, "Confirmed the date");
  assert.equal(row.callMethod, "WhatsAppCall");
  assert.equal(row.callMode, "Video");
});

test("alternate Callyzer field names still land in the call-log columns", () => {
  const row = toRow({
    ...CALL,
    client_name: "",
    note: "",
    crm_status: "",
    call_recording_url: "",
    duration: "7s",
    remarks: "Spoke about the booking",
    call_status: "Positive",
    recording_url: "https://media1.callyzer.co/file/callyzer-audios/T1/b.mp3",
    employee_name: "Priya S",
    employee_number: "9876500000",
    customer_name: "My Client",
  }, { enquiryId: "x" });

  assert.equal(row.durationSeconds, 7);
  assert.equal(row.note, "Spoke about the booking");
  assert.equal(row.crmStatus, "Positive");
  assert.equal(row.recordingUrl, "https://media1.callyzer.co/file/callyzer-audios/T1/b.mp3");
  assert.equal(row.employeeName, "Priya S");
  assert.equal(row.employeeNumber, "9876500000");
  assert.equal(row.clientName, "My Client");
});

test("calls sort by when they happened, across days", () => {
  // The bug this guards: "09:05" sorts before "16:42" as text, so an older call on a later day
  // would climb above a newer one if the clock time were sorted on its own.
  const older = calledAt({ call_date: "2026-08-12", call_time: "16:42:00" });
  const newer = calledAt({ call_date: "2026-08-18", call_time: "09:05:00" });
  assert.ok(newer > older, "a call on a later day must sort as newer");
});

/*
 * The clock the call is read on.
 *
 * Callyzer sends no offset, and its wall clock is the handset's - Asia/Kolkata. This was read as
 * UTC, which does not mark the instant but moves it: a call taken at 11:36 was stored as 11:36 UTC,
 * and the Call Logs tab renders in Asia/Kolkata, so it appeared at 5:06 pm - five and a half hours
 * into its own future, disagreeing with the `call_time` printed in the row beside it.
 *
 * Asserted as an absolute instant rather than as an ordering, because the ordering was never wrong:
 * every call was shifted by the same 5h30, so the tests that sorted them passed throughout.
 */
test("a call is read on the studio's clock, not as UTC", () => {
  assert.equal(calledAt({ call_date: "2026-09-22", call_time: "11:36:00" }).toISOString(), "2026-09-22T06:06:00.000Z");
  // A clock time with no seconds is the same call, not an unparseable one.
  assert.equal(calledAt({ call_date: "2026-09-22", call_time: "11:36" }).toISOString(), "2026-09-22T06:06:00.000Z");
  // Early enough in the day that the offset carries it back over midnight - the case a fixed shift
  // gets right and a naive "subtract from the time" does not.
  assert.equal(calledAt({ call_date: "2026-09-22", call_time: "04:00:00" }).toISOString(), "2026-09-21T22:30:00.000Z");
});

test("a call whose date will not parse still gets a usable moment", () => {
  const when = calledAt({ call_date: "", call_time: "", synced_at: "2026-08-13 17:50:00" });
  assert.ok(when instanceof Date && !Number.isNaN(when.getTime()));
  assert.equal(when.toISOString().slice(0, 10), "2026-08-13");
  // The fallback is Callyzer's clock too, so a delivery stamp is not shifted either.
  assert.equal(when.toISOString(), "2026-08-13T12:20:00.000Z");
});

test("the raw call is kept, so nothing Callyzer sends is lost", () => {
  assert.deepEqual(JSON.parse(toRow(CALL, { enquiryId: "x" }).raw), CALL);
});

test("a call is only stored against a lead", () => {
  // `recordCallLogs` drops rows with no lead; this is the shape that check reads.
  assert.equal(toRow(CALL, { enquiryId: "" }).enquiryId, "");
});

/* --------------------------------------------------- everything Callyzer actually sends */

/*
 * The three fields the Call Logs tab was showing as em dashes while Callyzer's own screen had them.
 *
 * Their published payload names them `note`, `call_recording_url` and `crm_status`, and those are
 * read directly. These cover the deliveries that do not: an account whose keys differ, and one that
 * nests them a level down. A field Callyzer holds and this CRM drops is the whole of the complaint.
 */
test("the note, the recording and the outcome are read under Callyzer's own names", () => {
  const row = toRow({
    id: "c1",
    note: "Asked for the wedding package",
    call_recording_url: "https://rec.callyzer.co/c1.mp3",
    crm_status: "Interested",
  }, { enquiryId: "L1" });
  assert.equal(row.note, "Asked for the wedding package");
  assert.equal(row.recordingUrl, "https://rec.callyzer.co/c1.mp3");
  assert.equal(row.crmStatus, "Interested");
});

test("they are still read when the account names them something else", () => {
  const row = toRow({
    id: "c2",
    call_remarks: "Call back after Diwali",
    recording_link: "https://rec.callyzer.co/c2.mp3",
    call_disposition: "Follow Up",
  }, { enquiryId: "L1" });
  assert.equal(row.note, "Call back after Diwali");
  assert.equal(row.recordingUrl, "https://rec.callyzer.co/c2.mp3");
  assert.equal(row.crmStatus, "Follow Up");
});

test("they are still read when they arrive one level down", () => {
  const row = toRow({
    id: "c3",
    crm: { status: "Converted", note: "Booked the 12th" },
    recording: { file_url: "https://rec.callyzer.co/c3.mp3" },
  }, { enquiryId: "L1" });
  assert.equal(row.crmStatus, "Converted");
  assert.equal(row.note, "Booked the 12th");
  assert.equal(row.recordingUrl, "https://rec.callyzer.co/c3.mp3");
});

test("a flat field beats the same name buried deeper", () => {
  const row = toRow({
    id: "c4",
    crm_status: "Interested",
    meta: { status: "Rejected" },
  }, { enquiryId: "L1" });
  assert.equal(row.crmStatus, "Interested");
});

test("the delivery's own bookkeeping is never mistaken for the call's outcome", () => {
  /*
   * `sync_status`, `is_deleted` and the transcription's own state say something about the delivery,
   * not about how the call went. Reading one into Call Status would put "uploaded" in front of
   * somebody as the outcome of a conversation.
   */
  const row = toRow({
    id: "c5",
    sync_status: "synced",
    upload_status: "uploaded",
    is_deleted: false,
    transcription_status: "pending",
    recording_status: "available",
  }, { enquiryId: "L1" });
  assert.equal(row.crmStatus, "");
  assert.equal(row.recordingUrl, "", "a recording's state is not a recording");
});

test("nothing recorded stays nothing, rather than becoming a word", () => {
  const row = toRow({ id: "c6", note: "", crm_status: null, call_recording_url: false }, { enquiryId: "L1" });
  assert.equal(row.note, "");
  assert.equal(row.crmStatus, "");
  assert.equal(row.recordingUrl, "");
});

/*
 * Whose handset a call came from.
 *
 * Matched on Callyzer's `emp_code` first and the handset label second. The code is filled in per
 * handset in their dashboard, so setting it to the employee's own code makes the match exact - it
 * survives the handset being relabelled and the SIM being swapped, neither of which a name does. It
 * is optional in their payload, which is why the name remains the fallback rather than being dropped.
 *
 * The handset *number* is deliberately no part of this: Callyzer reports the company SIM and the
 * repository holds the employee's own number, so the two never meet.
 */
const TABLE = { byCode: new Map([["DBS-1", 11]]), byName: new Map([["priya s", 22]]) };

test("the employee code decides the match, and beats the handset label", () => {
  assert.equal(resolveEmployeeId(TABLE, { employeeCode: "DBS-1", employeeName: "anything at all" }), 11);
  // The case that makes the code worth filling in: the label names somebody else entirely, and the
  // code is still obeyed - a relabelled handset does not re-file its calls onto another person.
  assert.equal(resolveEmployeeId(TABLE, { employeeCode: "DBS-1", employeeName: "Priya S" }), 11);
  assert.equal(resolveEmployeeId(TABLE, { employeeCode: " dbs-1 ", employeeName: "" }), 11, "a code is read past its case and spacing");
});

test("the handset label carries the match where Callyzer sends no code", () => {
  // Their own sample carries `emp_code` for one employee and omits it for the next, so this is the
  // ordinary case rather than the exception.
  assert.equal(resolveEmployeeId(TABLE, { employeeName: "Priya S" }), 22);
  assert.equal(resolveEmployeeId(TABLE, { employeeCode: "", employeeName: "  priya   s  " }), 22, "a label is read past its case and spacing");
  // A code that names nobody falls through to the label rather than failing the match outright.
  assert.equal(resolveEmployeeId(TABLE, { employeeCode: "NOT-A-CODE", employeeName: "Priya S" }), 22);
});

test("a handset matching neither is left to Callyzer's own name", () => {
  assert.equal(resolveEmployeeId(TABLE, { employeeCode: "NOPE", employeeName: "Reception Desk" }), null);
  assert.equal(resolveEmployeeId(TABLE, {}), null);
  // Never fuzzy: a near-miss is nobody, because the wrong id files one person's calls under another.
  assert.equal(resolveEmployeeId(TABLE, { employeeName: "Priya" }), null);
  assert.equal(resolveEmployeeId(TABLE, { employeeName: "Priya SS" }), null);
});

test("the two comparisons are the ones both ends of the match use", () => {
  assert.equal(employeeNameKey("  Priya   S  "), "priya s");
  assert.equal(employeeCodeKey("  dbs-1 "), "DBS-1");
});

test("the code Callyzer sends is kept, so a handset can be matched later", () => {
  // `raw` holds the call and not the employee it arrived under, so the column is the only copy -
  // and without it a handset coded for somebody not yet in the repository could never be caught up.
  assert.equal(toRow(CALL, { enquiryId: "x", employee: { emp_code: "DBS-7" } }).employeeCode, "DBS-7");
  assert.equal(toRow(CALL, { enquiryId: "x", employee: {} }).employeeCode, "");
});
