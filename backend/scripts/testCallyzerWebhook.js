/*
 * Delivers a Callyzer batch to this machine's own backend.
 *
 * Callyzer's "Test" button cannot reach a local server. That panel fires from Callyzer's cloud, so
 * the URL it dials is resolved there - `localhost:5001` means Callyzer's own machine, which has
 * nothing listening, and the panel reports "Connection refused" as a 400. No setting on this side
 * changes that, which is why the test is run from here instead: this script is the sender Callyzer
 * would be, minus the internet in between.
 *
 * It posts the payload the way Callyzer does, header for header - no `Content-Type` at all - so a
 * pass here means a pass there.
 *
 *   npm run test:callyzer                      # the sample batch from Callyzer's docs
 *   npm run test:callyzer -- ./my-batch.json   # a batch captured from a real delivery
 *   npm run test:callyzer -- --test-leads      # the fixture that exercises every routing rule
 *   npm run test:callyzer -- --test-leads --today
 *                                              # the same, stamped with today so the New tab fills
 *   npm run test:callyzer -- --test-leads --url https://api.example.com --confirm
 *                                              # deliver it somewhere other than this machine
 *
 * `--test-leads` sends `callyzerTestBatch.js`: one call per decision the webhook makes, including
 * the two that end up on the Calls board, and it prints what each should do so the CRM can be read
 * against it. Those rows are removed again with `npm run remove:callyzer-test-leads`.
 */

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { TEST_BATCH, EXPECTED, EXPECTED_CALLS, EXPECTED_LEADS, EXPECTED_SKIPPED, TEST_NUMBER_PREFIX } = require("./callyzerTestBatch");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? "" : String(args[index + 1] || "").trim();
};

const PORT = process.env.PORT || 5001;
const target = valueOf("--url") || `http://127.0.0.1:${PORT}`;
const URL = `${target.replace(/\/+$/, "")}/api/sales/crm-leads/webhook/callyzer`;

/**
 * Whether this is going anywhere but this machine.
 *
 * A webhook delivery *creates leads*. Against a local database that is a test; against the studio's
 * own server it is seven fabricated enquiries in the CRM the sales team is working from - so
 * anything that is not loopback has to be asked for twice.
 */
function isLoopback(url) {
  try {
    const { hostname } = new global.URL(url);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

// Callyzer's own documented example, masked numbers and all. Two employees, three calls between
// them, one of each call type - which is the spread that exercises the status mapping.
const SAMPLE = [
  {
    emp_name: "Employee Name",
    emp_code: "102",
    emp_country_code: "91",
    emp_number: "9876500000",
    emp_tags: ["emp1", "ABC"],
    call_logs: [
      {
        id: "sample-incoming-1",
        client_name: "My Contact Name",
        client_country_code: "91",
        client_number: "8090700000",
        duration: "30",
        call_type: "Incoming",
        call_date: "2023-09-13",
        call_time: "17:49:41",
        note: "all about the call",
        crm_status: "Not Interested",
        reminder_date: "2023-09-15",
        reminder_time: "16:50:34",
        synced_at: "2023-09-13 17:50:00",
        modified_at: "2023-09-13 17:52:00",
      },
      {
        id: "sample-outgoing-1",
        client_name: "Contact Name 2",
        client_country_code: "91",
        client_number: "5348700000",
        duration: "87",
        call_type: "Outgoing",
        call_date: "2023-09-13",
        call_time: "17:49:41",
        call_method: "PhoneCall",
        call_mode: "Voice",
        note: "The contact is not available for the deal",
        crm_status: "Positive",
        synced_at: "2023-09-13 17:49:41",
        modified_at: "2023-09-13 17:50:48",
      },
    ],
  },
  {
    emp_name: "Another Employee",
    emp_country_code: "91",
    emp_number: "9907800000",
    emp_tags: ["emp2", "DEF"],
    call_logs: [
      {
        id: "sample-missed-1",
        client_name: "Contact Name",
        client_country_code: "91",
        client_number: "8970900000",
        duration: "0",
        call_type: "Missed",
        call_date: "2023-09-13",
        call_time: "17:49:41",
        call_method: "WhatsAppCall",
        call_mode: "Video",
        note: "",
        crm_status: "Negative",
        synced_at: "2023-09-13 17:53:49",
        modified_at: "2023-09-13 17:57:49",
      },
    ],
  },
];

/** The fixture, optionally re-dated to today so its leads land in the New and Yet to connect tabs. */
function testBatchBody() {
  if (!has("--today")) return TEST_BATCH;
  const today = new Date().toISOString().slice(0, 10);
  return TEST_BATCH.map((employee) => ({
    ...employee,
    call_logs: employee.call_logs.map((callLog) => ({ ...callLog, call_date: today })),
  }));
}

async function main() {
  // The first argument only names a file when it is not one of the flags.
  const file = args[0] && !args[0].startsWith("--") ? args[0] : "";
  const testLeads = has("--test-leads");

  if (!isLoopback(URL) && !has("--confirm")) {
    console.error(`Refusing to deliver to ${URL}`);
    console.error("");
    console.error("  A webhook delivery creates leads. Against a real server these become rows the");
    console.error("  sales team will see and work. Add --confirm if that is genuinely what you want.");
    console.error("");
    console.error("  Removing them again is a database job, not an HTTP one, so it has to be run on");
    console.error("  that server:  npm run remove:callyzer-test-leads -- --apply");
    process.exitCode = 1;
    return;
  }

  const body = file
    ? fs.readFileSync(path.resolve(file), "utf8")
    : JSON.stringify(testLeads ? testBatchBody() : SAMPLE);

  const secret = String(process.env.CALLYZER_WEBHOOK_SECRET || "").trim();
  const headers = {};
  // Sent only when one is configured - the route accepts an unsecured delivery when the variable
  // is empty, and sending a blank header would fail that check rather than skip it.
  if (secret) headers["x-callyzer-secret"] = secret;

  const label = file || (testLeads ? `routing fixture${has("--today") ? ", dated today" : ""}` : "built-in sample");
  console.log(`POST ${URL}`);
  console.log(`  secret: ${secret ? "sent" : "not configured - route is open"}`);
  console.log(`  body:   ${label} (${body.length} bytes, no Content-Type)`);

  if (testLeads) {
    console.log(`\nWhat this batch should do (every number begins ${TEST_NUMBER_PREFIX}):`);
    for (const [number, name, outcome] of EXPECTED) {
      console.log(`  ${number.padEnd(12)} ${name.padEnd(28)} ${outcome}`);
    }
    console.log(`\n  ${EXPECTED_CALLS} calls stored on ${EXPECTED_LEADS} leads, ${EXPECTED_SKIPPED} calls set aside.`);
    console.log("  None become a lead: every number here is invented, so none matches a client the CRM already holds.");
    console.log("  They wait on the Calls board under their own Call IDs until somebody adds the caller.");
  }

  let response;
  try {
    response = await fetch(URL, { method: "POST", headers, body });
  } catch (error) {
    // The one failure worth explaining, because it looks like the error Callyzer reports and is
    // not the same thing at all: there, nothing was listening on Callyzer's machine; here, nothing
    // is listening on yours.
    console.error(`\nCould not reach ${URL}`);
    console.error(`  ${error.message}`);
    console.error(`\nStart the backend first:  npm run dev`);
    process.exitCode = 1;
    return;
  }

  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }

  console.log(`\nHTTP ${response.status}`);
  if (parsed?.message) console.log(`  ${parsed.message}`);
  if (parsed?.errors) console.log(`  ${JSON.stringify(parsed.errors)}`);

  if (response.ok) {
    // The reply is a receipt now - a count, not the leads themselves - so a batch is checked by
    // what it says it imported. Open the CRM to see the rows.
    if (typeof parsed?.count === "number") console.log(`  imported: ${parsed.count}`);
    if (typeof parsed?.skipped === "number") console.log(`  set aside: ${parsed.skipped}`);
    if (testLeads) {
      // The counts are the first half of the check and the cheap half. What the batch is actually
      // for is the board: two of these leads should be on Calls and nowhere else.
      // `count` is the calls it imported, not the leads it wrote - see callyzerTestBatch.js.
      const asExpected = parsed?.count === EXPECTED_CALLS && parsed?.skipped === EXPECTED_SKIPPED;
      console.log(`\nExpected ${EXPECTED_CALLS} calls imported and ${EXPECTED_SKIPPED} set aside${asExpected ? " - matches." : " - does not match; read the list above."}`);
      console.log("\nNow read it in the CRM, Leads & Followups:");
      console.log("  Calls     Test Unrouted Caller and Test Missed Caller, and nothing else new");
      console.log("  Dum Dum   Test Wedding Caller, Test Repeat Caller (Enquired 2 times)");
      console.log("  Qua Qua   Test Newborn Caller, Test Named Vertical Caller");
      console.log("  Corp      Test Corporate Caller");
      console.log("\nThen double-click a row on Calls: Add Lead opens filled in on that caller.");
      console.log("Pick the vertical on the radio, Confirm, and the row leaves Calls for it.");
      console.log("\nRemove all of this again with:  npm run remove:callyzer-test-leads");
    } else {
      console.log(`\nThe webhook works. Point Callyzer at the production URL, never at localhost.`);
    }
  } else if (response.status === 401) {
    console.log(`\nCALLYZER_WEBHOOK_SECRET in .env does not match what the server was started with.`);
    console.log(`Restart the backend so it reloads .env, then run this again.`);
  }
  process.exitCode = response.ok ? 0 : 1;
}

main();
