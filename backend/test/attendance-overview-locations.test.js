const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The Dashboard's Employees rows carry where the latest login and logout in the range were captured,
 * read from the sessions' own coordinates - the day itself over one day.
 */
const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");
const tally = SERVICE.slice(SERVICE.indexOf("async function tallyRange("), SERVICE.indexOf("async function tallyRange(") + 12000);

test("the overview reads each session's login and logout coordinates", () => {
  assert.match(tally, /loginLatitude: true, loginLongitude: true, logoutLatitude: true, logoutLongitude: true/);
});

test("each person keeps the latest captured login and logout position, not a missing one over an earlier", () => {
  assert.match(tally, /loginLocation = coordinatesOf\(session\.loginLatitude, session\.loginLongitude\) \|\| loginLocation;/);
  assert.match(tally, /logoutLocation = coordinatesOf\(session\.logoutLatitude, session\.logoutLongitude\) \|\| logoutLocation;/);
  assert.match(tally, /person\.loginLocation = loginLocation;\s+person\.logoutLocation = logoutLocation;/);
});
