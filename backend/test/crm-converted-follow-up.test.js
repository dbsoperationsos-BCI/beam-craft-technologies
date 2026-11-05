const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * A converted Dum Dum or Corp lead has had its last follow-up and books no next one; a converted
 * Qua Qua lead keeps an optional one, because that client comes back for the next shoot.
 *
 * Plain Converted clears the Next Followup Date on every write off Qua Qua, and moving a lead to
 * Converted stamps the day as its Last Followup Date on every vertical - from Bulk Update and from a
 * project save alike. "Converted & Followup" is a client still being worked, so it keeps its
 * follow-ups. Read from source, the way the other CRM tests here are; `endsTheConversation` is
 * lifted out and run, since it depends on nothing else.
 */

const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crm-leads", "crmLeadService.js"), "utf8");

const lift = (opening, closing) => {
  const start = SERVICE.indexOf(opening);
  assert.notEqual(start, -1, `${opening} was not found`);
  return SERVICE.slice(start, SERVICE.indexOf(closing, start) + closing.length);
};
const { endsTheConversation } = new Function(`${[
  lift("const STATUSES_WITHOUT_FOLLOW_UP = [", "];"),
  lift("const sameStatus =", ";"),
  lift("const isQuaQuaVertical =", ";"),
  lift("const endsTheConversation =", ";"),
].join("\n")}\nreturn { endsTheConversation };`)();

test("Converted ends the follow-up on Dum Dum and Corp, and not on Qua Qua", () => {
  for (const vertical of ["Dum Dum", "Corp", "corporate", "", null]) {
    assert.equal(endsTheConversation("Converted", vertical), true, String(vertical));
  }
  for (const vertical of ["Qua Qua", "quaqua", " QUA QUA "]) {
    assert.equal(endsTheConversation("Converted", vertical), false, vertical);
  }
  // Invalid and Rejected end it everywhere; Converted & Followup nowhere.
  for (const vertical of ["Dum Dum", "Qua Qua"]) {
    assert.equal(endsTheConversation("Rejected", vertical), true);
    assert.equal(endsTheConversation("invalid", vertical), true);
    assert.equal(endsTheConversation("Converted & Followup", vertical), false);
    assert.equal(endsTheConversation("Followup", vertical), false);
  }
});

test("every write reads the lead's own vertical when it decides", () => {
  assert.match(SERVICE, /nextFollowUpDate: endsTheConversation\(details\.leadStatus \|\| lead\.status, lead\.vertical\)/);
  assert.match(SERVICE, /nextFollowUpTime: endsTheConversation\(details\.leadStatus \|\| lead\.status, lead\.vertical\)/);
});

test("Bulk Update decides Converted per row, by the board the lead sits on", () => {
  const bulk = SERVICE.slice(SERVICE.indexOf("async function setCrmLeadStatus"), SERVICE.indexOf("const passes = [];"));
  assert.match(bulk, /const clearsOffQuaQua = !clearsFollowUp && sameStatus\(status, "Converted"\);/);
  assert.match(bulk, /CASE WHEN `board_key` = 'quaqua' THEN COALESCE\(\?, `next_follow_up_date`\) ELSE NULL END/);
  assert.match(bulk, /CASE WHEN `board_key` = 'quaqua' THEN `next_follow_up_time` ELSE \? END/);
  // Occasions are Qua Qua's alone, so only Invalid and Rejected clear an occasion's date.
  assert.match(bulk, /if \(clearsFollowUp\) occasionChanges\.nextFollowUpDate = "";/);
});

test("Bulk Update to Converted stamps today as the last follow-up when no date was given", () => {
  const bulk = SERVICE.slice(SERVICE.indexOf("async function setCrmLeadStatus"), SERVICE.indexOf("const nextFollowUpDate = changes.nextFollowUpDate"));
  assert.match(bulk, /: \(isConvertedStatus\(status\) \? studioToday\(\) : ""\);/);
});

test("a project save that converts the lead stamps its last follow-up", () => {
  const mark = SERVICE.slice(SERVICE.indexOf("async function markCrmLeadConverted"), SERVICE.indexOf("async function deleteCrmLead"));
  assert.match(mark, /lastConvertedDate: studioToday\(\), lastFollowUpDate: studioToday\(\)/);
});
