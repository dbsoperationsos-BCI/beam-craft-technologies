const test = require("node:test");
const assert = require("node:assert/strict");
const {
  verticalForCall, callFilterReason, loadRoutingConfig, parseEmployeeVerticals, parseNumberList,
  verticalFromText, phoneKey,
} = require("../src/modules/sales/crm-leads/callRouting");

/*
 * Which board a Callyzer call lands on, and which calls are not leads.
 *
 * The production fault this exists for: every call the webhook received became a lead with a blank
 * `branch`, and a blank branch is shown on the Dum Dum tab. Newborn enquiries, corporate enquiries,
 * staff ringing each other and employees ringing home all piled into the wedding board.
 *
 * Only the decision is tested here - no database, no HTTP. The two functions are pure by design so
 * the rules can be argued with directly, which is the part that has to be right: a wedding lead
 * misfiled into Qua Qua is invisible to the people who would have called it back.
 */

const CALL = {
  id: "XgnkwIIXrlKYMem",
  client_name: "My Contact Name",
  client_country_code: "91",
  client_number: "8090712345",
  duration: "310",
  call_type: "Incoming",
  call_date: "2026-08-13",
  call_time: "17:49:41",
};
const EMPLOYEE = { emp_name: "Priya S", emp_number: "9876500000" };
const NO_CONFIG = { staffNumbers: new Set(), personalNumbers: new Set() };

/* ---------------------------------------------------------------- the vertical */

test("a call that says nothing about the work is not assigned a vertical", () => {
  // Silence is not Dum Dum. It is left blank, which the tab query already reads as the wedding
  // board - the difference being that a call which does say something now goes elsewhere.
  assert.equal(verticalForCall(CALL, EMPLOYEE, NO_CONFIG), "");
});

test("the note routes the lead to the business it describes", () => {
  assert.equal(verticalForCall({ ...CALL, note: "Wedding shoot enquiry for December" }, EMPLOYEE, {}), "Dum Dum");
  assert.equal(verticalForCall({ ...CALL, note: "Newborn shoot, baby is 3 weeks old" }, EMPLOYEE, {}), "Qua Qua");
  assert.equal(verticalForCall({ ...CALL, note: "Corporate conference coverage, two days" }, EMPLOYEE, {}), "Corp");
});

test("the words the CRM staff actually type count too", () => {
  assert.equal(verticalForCall({ ...CALL, note: "Muhurtham on the 14th" }, EMPLOYEE, {}), "Dum Dum");
  assert.equal(verticalForCall({ ...CALL, note: "Seemantham next month" }, EMPLOYEE, {}), "Qua Qua");
  assert.equal(verticalForCall({ ...CALL, note: "Headshots for the whole team" }, EMPLOYEE, {}), "Corp");
});

/*
 * "wed" is a real shorthand in these notes, which is why it is a keyword at all - and why it must
 * not match the day of the week. Matching on substrings would have filed every Wednesday follow-up
 * as a wedding.
 */
test("a keyword only matches as a whole word", () => {
  assert.equal(verticalFromText("call back on wednesday"), "");
  assert.equal(verticalFromText("wed enquiry"), "Dum Dum");
});

test("a label on the call is read the same way as a note", () => {
  assert.equal(verticalForCall({ ...CALL, labels: ["Maternity"] }, EMPLOYEE, {}), "Qua Qua");
  assert.equal(verticalForCall({ ...CALL, tags: "Corporate" }, EMPLOYEE, {}), "Corp");
});

/*
 * A note that names two businesses has not decided anything. Answering the first keyword checked
 * would make the answer depend on the order of a list in this file.
 */
test("a note that names two businesses assigns neither", () => {
  assert.equal(verticalFromText("wedding album for the corporate client"), "");
});

test("a vertical named outright on the call wins over everything else", () => {
  const call = { ...CALL, branch: "Qua Qua", note: "wedding wedding wedding" };
  assert.equal(verticalForCall(call, EMPLOYEE, {}), "Qua Qua");
});

test("the employee decides when the call itself does not", () => {
  const config = loadRoutingConfig({ CALLYZER_EMPLOYEE_VERTICALS: "9876500000=Qua Qua, 9876500001=Corp" });
  assert.equal(verticalForCall(CALL, EMPLOYEE, config), "Qua Qua");
  assert.equal(verticalForCall(CALL, { emp_number: "+919876500001" }, config), "Corp");
  // Most calls carry no note at all, so this is the signal that fires in production - but a note
  // is about this call and a desk is a standing fact, so the note still wins.
  assert.equal(verticalForCall({ ...CALL, note: "Corporate product shoot" }, EMPLOYEE, config), "Corp");
});

test("an employee can be named as well as numbered", () => {
  const config = loadRoutingConfig({ CALLYZER_EMPLOYEE_VERTICALS: "Priya S = Corp" });
  assert.equal(verticalForCall(CALL, EMPLOYEE, config), "Corp");
});

/*
 * The contact name is asked last and on its own, because "Baby" is a name people are actually
 * called. It is still worth asking: half the phonebook reads "Anitha wedding".
 */
test("the saved contact name is the last resort", () => {
  assert.equal(verticalForCall({ ...CALL, client_name: "Anitha wedding" }, {}, {}), "Dum Dum");
  const config = loadRoutingConfig({ CALLYZER_EMPLOYEE_VERTICALS: "9876500000=Corp" });
  assert.equal(verticalForCall({ ...CALL, client_name: "Anitha wedding" }, EMPLOYEE, config), "Corp");
});

test("an unreadable vertical setting is dropped rather than guessed at", () => {
  const { byNumber, byName } = parseEmployeeVerticals("9876500000=Wedding Studio, 9876500001=Corp");
  assert.equal(byNumber.get("9876500000"), undefined);
  assert.equal(byNumber.get("9876500001"), "Corp");
  assert.equal(byName.size, 0);
});

test("the spellings the sheets already use route a call the same way", () => {
  const { byNumber } = parseEmployeeVerticals("9876500000=WED; 9876500001=QQ; 9876500002=Crop");
  assert.deepEqual([...byNumber.values()], ["Dum Dum", "Qua Qua", "Corp"]);
});

/* ------------------------------------------------------------- what is not a lead */

test("a call between two members of staff is not a lead", () => {
  const staffNumbers = new Set(["9876500001"]);
  const call = { ...CALL, client_number: "+919876500001", client_name: "Karthik (Qua Qua)" };
  assert.equal(callFilterReason(call, EMPLOYEE, { staffNumbers }), "staff");
});

test("an employee ringing their own phone is not a lead either", () => {
  // Not covered by the directory when the delivery reports one employee and nobody else.
  const call = { ...CALL, client_number: "9876500000" };
  assert.equal(callFilterReason(call, EMPLOYEE, NO_CONFIG), "staff");
});

test("a client whose number happens to resemble nothing in the directory is a lead", () => {
  assert.equal(callFilterReason(CALL, EMPLOYEE, { staffNumbers: new Set(["9876500001"]) }), "");
});

test("a call an employee marked personal is not a lead", () => {
  assert.equal(callFilterReason({ ...CALL, labels: ["Personal"] }, EMPLOYEE, NO_CONFIG), "personal");
  assert.equal(callFilterReason({ ...CALL, note: "personal call" }, EMPLOYEE, NO_CONFIG), "personal");
  assert.equal(callFilterReason({ ...CALL, is_personal: true }, EMPLOYEE, NO_CONFIG), "personal");
});

/*
 * The mistake worth guarding: reading "personal" out of the middle of a sentence. A note is only a
 * marker when it is nothing but the marker; a label may contain it, because a label is deliberate.
 */
test("a note that merely contains the word is still a lead", () => {
  const call = { ...CALL, note: "He will come personally to the studio on Friday" };
  assert.equal(callFilterReason(call, EMPLOYEE, NO_CONFIG), "");
});

test("numbers the studio has said are never leads are skipped", () => {
  const config = loadRoutingConfig({ CALLYZER_IGNORE_NUMBERS: "+91 80907 12345, 9000000000" });
  assert.equal(callFilterReason(CALL, EMPLOYEE, config), "personal");
});

test("a call with no number on it is not a lead - there is nobody to ring back", () => {
  assert.equal(callFilterReason({ ...CALL, client_number: "" }, EMPLOYEE, NO_CONFIG), "unknown-number");
});

/* ------------------------------------------------------------------ number keys */

test("a number matches on its last ten digits, however it was written", () => {
  assert.equal(phoneKey("+91 98765 00000"), "9876500000");
  assert.equal(phoneKey("098765-00000"), "9876500000");
  assert.equal(phoneKey("919876500000"), "9876500000");
  assert.equal(phoneKey("123"), "", "too little of a number to be anyone in particular");
});

test("a configured number list accepts whatever separators it is written with", () => {
  assert.deepEqual([...parseNumberList("9876500000, +91 9876500001\n9876500002")].sort(), [
    "9876500000", "9876500001", "9876500002",
  ]);
});
