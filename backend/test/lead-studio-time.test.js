const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { studioClockTime, studioDateKey } = require("../src/services/studioTime");
const { stampStudioTime } = require("../src/modules/sales/crm-leads/crmLeadService");

/*
 * A lead's Added Time and Enquiry Date are the studio's clock, in India, whatever zone the machine is on.
 *
 * The Add Lead form stamped both from the computer's own clock when the form was opened, so a laptop
 * set to UTC wrote every manual lead 5:30 behind, and a lead saved with neither fell back to a row
 * timestamp written in the database's zone. Now the form stamps at save in India time, and the server
 * fills a missing one in India time.
 */

test("the studio clock is India time, not the machine's", () => {
  // 13:16 UTC is 18:46 in India; 20:00 UTC is already the next day there.
  assert.equal(studioClockTime(new Date("2026-09-24T13:16:00Z")), "06:46 pm");
  assert.equal(studioDateKey(new Date("2026-09-24T13:16:00Z")), "2026-09-24");
  assert.equal(studioDateKey(new Date("2026-09-24T20:00:00Z")), "2026-09-25");
});

test("a lead saved with no time or date gets the studio's", () => {
  const record = stampStudioTime({ lead: { addedTime: "", createdDate: "" }, details: {} }, new Date("2026-09-24T13:16:00Z"));
  assert.equal(record.lead.addedTime, "06:46 pm");
  assert.equal(record.lead.createdDate, "2026-09-24");
});

test("a time the record brought - from a sheet, a file or a call - is kept", () => {
  const record = stampStudioTime({ lead: { addedTime: "09:15 am", createdDate: "2026-09-01" } }, new Date("2026-09-24T13:16:00Z"));
  assert.equal(record.lead.addedTime, "09:15 am");
  assert.equal(record.lead.createdDate, "2026-09-01");
});

test("every create path stamps it, and the form stamps at save in India time", () => {
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "crmLeadService.js"), "utf8");
  assert.match(service, /async function createCrmLead\(record\) \{\n  stampStudioTime\(record\);/);
  assert.match(service, /for \(const record of records \|\| \[\]\) stampStudioTime\(record, now\);/);
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "sales", "CRMPage.js"), "utf8");
  /*
   * Skipped for the two jobs that are **not** a lead arriving: placing a call, which keeps the time
   * the call came in, and assigning an unassigned lead, which keeps its own - a lead arrived when it
   * arrived, and being given an owner later is not its arrival.
   */
  assert.match(page, /\.\.\.\(placing \|\| assigning \? \{\} : \{ addedTime: studioClockTime\(\), createdDate: studioDateKey\(\) \}\)/);
  assert.doesNotMatch(page, /addedTime: new Date\(\)\.toLocaleTimeString\(/, "the form is stamping from the computer's own clock again");
});
