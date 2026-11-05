/*
 * A Callyzer delivery built to exercise every decision the webhook makes.
 *
 * The batch in `testCallyzerWebhook.js` is Callyzer's own documented example: it proves the webhook
 * can be reached and that a body is parsed. It says nothing about whether a wedding enquiry reaches
 * the wedding board, whether a colleague's call is kept out of the CRM, or whether a call nothing
 * names a vertical for lands on the Calls board - which is the part somebody actually needs to see
 * working before trusting it.
 *
 * So every call here exists to prove one rule, and `expect` on each says which. Read against
 * callRouting.js:
 *
 *   1. a vertical named outright on the call         beats everything
 *   2. the labels and the note                       beat any standing fact about who took it
 *   3. the employee, via CALLYZER_EMPLOYEE_VERTICALS
 *   4. the saved contact name, last and on its own
 *   5. nothing answers                               -> no vertical, and the lead waits on Calls
 *
 * ── The numbers ───────────────────────────────────────────────────────────────────────────────
 *
 * Every number is `99000…`, which no Indian mobile is - real ones begin 6, 7, 8 or 9 followed by a
 * digit that is never a run of zeroes like this. That is deliberate on two counts: the batch can
 * never collide with a real client already in the CRM, and every row it creates can be found again
 * by that prefix, which is what `removeCallyzerTestLeads.js` deletes on.
 *
 * Two of them are employees. Note that the webhook learns its staff directory *from the call log* -
 * `knownEmployeeNumbers()` reads back the distinct `employee_number` - so once this batch has been
 * delivered these two numbers are staff for good, and a later call *to* one of them is filtered as
 * a colleague. That is the behaviour being demonstrated, not a side effect to be surprised by.
 */

const EMPLOYEE_PRIYA = "9900011101";
const EMPLOYEE_MEERA = "9900011102";

// What every row this batch creates has in common, and the only thing the cleanup script needs.
const TEST_NUMBER_PREFIX = "99000";

/*
 * A fixed day rather than today's.
 *
 * The lead's Enquiry Date is the day the call happened, so a fixed date keeps the rows identifiable
 * and keeps a redelivery idempotent. It does mean nothing lands in the "Today New Leads" tab - pass
 * `--today` to the sender to stamp the batch with the current date when that is what you want to
 * look at.
 */
const CALL_DATE = "2026-09-01";

const call = (id, fields) => ({
  id: `dbs-test-${id}`,
  client_country_code: "91",
  call_date: CALL_DATE,
  call_method: "PhoneCall",
  call_mode: "Voice",
  duration: "42",
  call_type: "Incoming",
  ...fields,
});

const TEST_BATCH = [
  {
    emp_name: "Test CRM Priya",
    emp_code: "T-101",
    emp_country_code: "91",
    emp_number: EMPLOYEE_PRIYA,
    emp_tags: ["dbs-test"],
    call_logs: [
      call("unrouted", {
        client_name: "Test Unrouted Caller",
        client_number: "9900022001",
        call_time: "10:14:00",
        // Deliberately says nothing a vertical can be read out of. No keyword, no label, and the
        // employee is not in CALLYZER_EMPLOYEE_VERTICALS - so the router refuses to guess.
        note: "Asked for the price list. Will send details later.",
        crm_status: "Interested",
      }),
      call("wedding-note", {
        client_name: "Test Wedding Caller",
        client_number: "9900022002",
        call_time: "10:31:00",
        note: "Wedding candid enquiry for December. Wants an album quote.",
        crm_status: "Interested",
      }),
      call("newborn-note", {
        client_name: "Test Newborn Caller",
        client_number: "9900022003",
        call_time: "11:02:00",
        note: "Newborn baby session, mother due next month.",
        crm_status: "Follow Up",
        reminder_date: "2026-09-08",
        reminder_time: "11:00:00",
      }),
      call("corp-label", {
        client_name: "Test Corporate Caller",
        client_number: "9900022004",
        call_time: "11:40:00",
        /*
         * The labels and the note are read *together* - `verticalForCall` joins them and counts the
         * keywords across both, so this is two Corp hits rather than a label overruling a note.
         * Worth knowing which it is: had the label said Corporate and the note said wedding, that
         * would be one hit each, and a tie answers with no vertical at all.
         */
        labels: ["Corporate"],
        note: "Annual day coverage for around 400 people.",
        crm_status: "Positive",
      }),
      call("missed-unrouted", {
        client_name: "Test Missed Caller",
        client_number: "9900022010",
        call_time: "12:05:00",
        call_type: "Missed",
        duration: "0",
        note: "",
        // No disposition at all: a missed call is the one outcome the call itself states, so the
        // lead reads CNA. Still no vertical, so it waits on Calls with that status showing.
      }),
    ],
  },
  {
    emp_name: "Test CRM Meera",
    emp_code: "T-102",
    emp_country_code: "91",
    emp_number: EMPLOYEE_MEERA,
    emp_tags: ["dbs-test"],
    call_logs: [
      call("branch-field", {
        client_name: "Test Named Vertical Caller",
        client_number: "9900022005",
        call_time: "09:20:00",
        // A vertical stated on the call outright, which beats the note under it.
        branch: "Qua Qua",
        note: "Corporate headshots for the team.",
        crm_status: "Interested",
      }),
      call("repeat-1", {
        client_name: "Test Repeat Caller",
        client_number: "9900022006",
        call_time: "09:45:00",
        note: "Rang about a reception shoot, asked to be called back.",
        crm_status: "Call Back",
      }),
      call("repeat-2", {
        client_name: "Test Repeat Caller",
        client_number: "9900022006",
        call_time: "16:12:00",
        call_type: "Outgoing",
        duration: "310",
        // The same client twice in one delivery: one lead, two calls on its Call Logs tab, and the
        // Contact Repeated column reading "Enquired 2 times".
        note: "Called back with the package details.",
        crm_status: "Interested",
      }),
      call("staff-call", {
        client_name: "Test CRM Priya",
        // A colleague's own number, which arrives looking exactly like a client's. Set aside as
        // "staff" before a lead is built, so nothing at all is written for it.
        client_number: EMPLOYEE_PRIYA,
        call_time: "13:30:00",
        note: "Checking the afternoon schedule.",
      }),
      call("personal-call", {
        client_name: "Test Personal Contact",
        client_number: "9900022008",
        call_time: "18:50:00",
        // A whole label that is a personal marker. Set aside as "personal", again writing nothing.
        labels: ["Personal"],
        note: "",
      }),
      call("no-number", {
        client_name: "Test No Number",
        // Nobody to ring back, so this is not a lead either.
        client_number: "",
        call_time: "19:05:00",
        note: "Withheld number.",
      }),
    ],
  },
];

/*
 * What each call should do, in the order the batch delivers them.
 *
 * Printed by the sender so the CRM can be read against it rather than against a guess. Kept beside
 * the batch on purpose: a call added above without a line here is a call nobody knows the expected
 * outcome of.
 */
const EXPECTED = [
  ["9900022001", "Test Unrouted Caller", "Calls board — Incoming, Connected; nothing in the call names a vertical"],
  ["9900022002", "Test Wedding Caller", "Calls board — Outgoing, Connected; 'wedding' in the note, so Add Lead opens on Dum Dum"],
  ["9900022003", "Test Newborn Caller", "Calls board — Incoming, Connected; 'newborn' in the note, so Add Lead opens on Qua Qua"],
  ["9900022004", "Test Corporate Caller", "Calls board — the 'Corporate' label and 'annual day' in the note, counted together"],
  ["9900022010", "Test Missed Caller", "Calls board — Missed: Incoming, Not Connected and Never Attended at once"],
  ["9900022005", "Test Named Vertical Caller", "Calls board — a branch stated on the call still only decides which vertical Add Lead opens on"],
  ["9900022006", "Test Repeat Caller", "Calls board — two rows, two Call IDs; one caller, rung twice"],
  [EMPLOYEE_PRIYA, "Test CRM Priya", "nothing written — a call to a colleague is not a lead"],
  ["9900022008", "Test Personal Contact", "nothing written — the 'Personal' label"],
  ["(no number)", "Test No Number", "nothing written — nobody to ring back"],
];

/*
 * Eight calls are stored, none of them become a lead, and three more are set aside.
 *
 * `EXPECTED_LEADS` is zero on purpose, and it is the whole point of the change these numbers were
 * rewritten for. A call from a number the CRM does not hold no longer creates anything: it waits on
 * the Calls board under a Call ID of its own, and an enquiry id is minted only when somebody reads
 * the caller and adds them. Every number in this fixture is invented, so none of them matches an
 * existing lead - which is why the count that used to read seven now reads none.
 *
 * Eight calls rather than seven callers because the repeat caller rang twice, and each call is now a
 * row in its own right. Both numbers are named so the receipt can be checked against the right one.
 */
const EXPECTED_CALLS = 8;
const EXPECTED_LEADS = 0;
const EXPECTED_SKIPPED = 3;

module.exports = {
  TEST_BATCH,
  TEST_NUMBER_PREFIX,
  EXPECTED,
  EXPECTED_CALLS,
  EXPECTED_LEADS,
  EXPECTED_SKIPPED,
  CALL_DATE,
};
