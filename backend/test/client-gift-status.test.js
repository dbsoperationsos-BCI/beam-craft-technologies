const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  GIFT_STATUSES,
  GIFT_STATUS_PENDING,
  LEGACY_PENDING,
  readStatus,
} = require("../src/modules/project-management/client-gifts/service");

/*
 * The first of a gift's three states, renamed.
 *
 * It was "Yet To Receive", which named the wrong end of the journey: a gift sitting in it has not
 * been *sent* yet, and "yet to receive" reads as the studio waiting on something rather than owing
 * something. It is "Yet To Sent" - the words the people chasing these use.
 *
 * The interesting part is not the string. `welcome_gift_status` is a plain text column on
 * `sales_project` holding whatever was last written to it, so the rows written before the rename
 * still hold the old word - and the tab, the status cell, the tab counts and the "which states may
 * this row move to" menu are all matched on it by equality. A rename that only changed the constant
 * would have left those rows in a state no tab lists and no menu can move them out of.
 */

const PAGE = fs.readFileSync(
  path.join(__dirname, "..", "..", "frontend", "src", "components", "project-management", "ClientGiftsPage.js"),
  "utf8",
);

test("the pending state is named for what has not happened yet", () => {
  assert.equal(GIFT_STATUS_PENDING, "Yet To Sent");
  assert.deepEqual(GIFT_STATUSES, ["Yet To Sent", "Sent", "Received by Client"]);
});

test("a row written before the rename still reads as pending", () => {
  /*
   * Folded on read rather than rewritten by a migration. It is the same answer, it needs no operator
   * step on the day this deploys, and the next write puts the new spelling on the row - a gift's
   * status is written by exactly one function, so there is no second place the old word can come
   * back from.
   */
  assert.equal(readStatus(LEGACY_PENDING), GIFT_STATUS_PENDING);
  // A gift marked Applicable but never given a status reads the same way, which is what the column
  // being nullable means.
  assert.equal(readStatus(null), GIFT_STATUS_PENDING);
  assert.equal(readStatus(""), GIFT_STATUS_PENDING);
  assert.equal(readStatus("   "), GIFT_STATUS_PENDING);
  // And the two states that have not been renamed are handed back untouched.
  assert.equal(readStatus("Sent"), "Sent");
  assert.equal(readStatus("Received by Client"), "Received by Client");
});

test("the screen's list of states is the server's", () => {
  /*
   * The page filters its tabs, counts them and builds its "Mark as ..." menu from its own copy of
   * this list, and the server refuses a status it does not hold. A copy that drifts is a menu item
   * that fails on press, which is exactly the kind of fault nobody finds until a user does.
   */
  const listed = PAGE.match(/const statuses = \[([^\]]*)\]/);
  assert.ok(listed, "the page no longer declares the gift statuses");
  const statuses = listed[1].split(",").map((entry) => entry.trim().replace(/^"|"$/g, "")).filter(Boolean);
  assert.deepEqual(statuses, GIFT_STATUSES);
  /*
   * And the old word survives only where it is being explained. Comments are stripped before the
   * check rather than the check being loosened: this file's job is to say the screen never *prints*
   * it, and the note in the page recording why it changed is the kind of thing that should be
   * allowed to keep saying it.
   */
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.equal(code.includes(LEGACY_PENDING), false, `the page still prints "${LEGACY_PENDING}"`);
  // Every state still has a colour, or its dot would fall back to the default grey and stop
  // distinguishing the three.
  for (const status of GIFT_STATUSES) {
    assert.ok(PAGE.includes(`"${status}": "bg-`) || PAGE.includes(`${status}: "bg-`), `${status} has no status colour`);
  }
});

test("a change re-reads the screen rather than correcting one cell of it", () => {
  /*
   * The row that comes back from the write is applied immediately, so the press lands at once. The
   * re-read behind it is what keeps everything else honest: a row carries fields this screen does
   * not write - the project's manager, the client's name and number, who the gift is assigned to -
   * and a status is very often changed because something else about the project has just moved. The
   * footer's "Last updated" was saying the time of the first page load however many changes had been
   * made since.
   *
   * Silent, so the table does not blank into its loading state under a press that has already
   * succeeded.
   */
  assert.match(PAGE, /await loadRows\(\{ silent: true \}\);/, "a gift change no longer re-reads the screen");
  assert.match(PAGE, /const loadRows = useCallback\(async \(\{ silent = false \} = \{\}\) => \{/);
  assert.match(PAGE, /if \(!silent\) setLoading\(true\);/, "a silent re-read still blanks the table");
});
