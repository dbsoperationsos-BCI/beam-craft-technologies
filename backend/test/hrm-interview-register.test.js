const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The Interview register: how a candidate is deleted, and how the screen reads the table.
 *
 * Two faults, and the first caused the second. Deleting a candidate was a *soft* delete, so the row
 * stayed with `deleted_at` set - which meant the table grew a permanent shadow of every deletion
 * the studio had ever made, and a linked sheet went on recognising, by phone and email, people
 * nobody could see and refusing to re-import them. A register cleared of 5,880 candidates still had
 * 5,880 rows in it. A CRM lead has always been removed outright; a candidate now is too.
 *
 * And the screen asked for the **whole** register in one response and filtered it in the browser,
 * which is why it sat on "Loading candidates..." once there were thousands: every row had to arrive
 * before one could be drawn, and then all of them were held. It reads a page at a time now, on the
 * CRM lead board's own size.
 *
 * Read from source, as the other tests in this area are: these are a database apart from a unit
 * test, and what is pinned is which questions the code asks.
 */

const src = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "interview", ...parts), "utf8");
const SERVICE = src("service.js");
const CONTROLLER = src("controller.js");
const SYNC = src("sheetSyncService.js");

const fn = (source, start, end) => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `could not find ${start}`);
  const to = source.indexOf(end, from + 1);
  assert.ok(to > from, `could not find ${end} after ${start}`);
  return source.slice(from, to);
};

test("deleting a candidate removes the row, the way a CRM lead is removed", () => {
  const body = fn(SERVICE, "async function deleteCandidate(", "\n/**");
  assert.match(body, /hrmInterviewCandidate\.delete\(/, "a candidate is being hidden rather than removed again");
  assert.doesNotMatch(body, /data: \{ deletedAt: new Date\(\) \}/, "the soft delete is back");
  // The invites go too, or View All Invites lists forms against candidates that no longer exist.
  assert.match(body, /hrmInterviewApplicationInvite\.deleteMany\(/, "a deleted candidate leaves its screening forms orphaned");
  // One transaction, or a failure between the two leaves invites pointing at nothing.
  assert.match(body, /\$transaction\(\[/, "the candidate and its invites are no longer removed together");
});

test("deleting a sheet link removes the candidates it imported, rather than hiding them", () => {
  const body = fn(SYNC, "async function deleteCandidatesFromSheet(", "\nmodule.exports");
  assert.match(body, /hrmInterviewCandidate\.deleteMany\(/, "the link's candidates are being hidden again");
  assert.match(body, /hrmInterviewApplicationInvite\.deleteMany\(/, "their screening forms are left behind");
  assert.doesNotMatch(body, /data: \{ deletedAt: new Date\(\) \}/, "the soft delete is back on the link path");
});

test("the register is read a page at a time, newest first, with a stable order", () => {
  const body = fn(SERVICE, "async function listCandidates(", "\nasync function getCandidate(");
  assert.match(body, /skip: start, take: size/, "the whole table is being returned again");
  /*
   * `id` breaks the tie deliberately. Several thousand rows written by one sync share a `createdAt`
   * to the millisecond, and with only that to order by the database may return them differently per
   * page - which a reader sees as one row arriving twice while another never appears at all.
   */
  assert.match(body, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/, "the page order is no longer total, so rows can repeat or go missing between pages");
  assert.match(body, /withCounts \? prisma\.hrmInterviewCandidate\.count\(\{ where \}\) : null/,
    "the page either no longer says how many rows it is part of, or pays for a COUNT on every scroll that throws it away");
});

test("a page size is bounded, so one request cannot ask for the table", () => {
  assert.match(SERVICE, /const CANDIDATE_PAGE_SIZE = 100;/, "the page size is no longer the CRM board's");
  assert.match(SERVICE, /Math\.min\(Math\.max\(Number\(limit\)[^)]*\)[^)]*, CANDIDATE_PAGE_MAX\)/, "a caller can ask for an unbounded page again");
});

test("the tab counts describe the register, not the page in hand", () => {
  const body = fn(SERVICE, "async function listCandidates(", "\nasync function getCandidate(");
  // Grouped in one query rather than one per status, and over the whole register rather than the
  // page: counting the rows in hand would have every tab read "100" the moment paging arrived.
  assert.match(body, /groupBy\(\{ by: \["status"\], where: \{ deletedAt: null \}/, "the tab counts no longer come from the register");
  // And skipped on a scroll append, which is the same set and cannot have changed them.
  assert.match(body, /withCounts \?/, "the counts are computed even when the caller says it is appending");
  const list = fn(CONTROLLER, "async function list(", "\nasync function get(");
  assert.match(list, /appending \? \{\} : \{ total, counts \}/, "an append is answered with numbers it will throw away");
});

test("the forms are read for the candidates asked about, not for the whole register", () => {
  /*
   * The register holds a page of a hundred candidates and uses the forms only to decide what each
   * row's menu offers. Reading every form the studio has ever raised - and then every candidate
   * those forms name - was a second pass over the whole register, paid on opening the screen and
   * again after every write. View All Invites still asks for the lot, because that is what it is.
   */
  const INVITES = src("invites.js");
  const body = fn(INVITES, "async function listInvites(", "\n/**");
  assert.match(body, /req\.query\.candidateIds/, "the forms can no longer be asked for by candidate");
  assert.match(body, /where = asked\.length \? \{ candidateId: \{ in: asked/, "naming candidates no longer narrows the read");
  // Capped either way: an unbounded list is how this became the slowest thing on the screen.
  assert.match(body, /take: INVITE_LIST_LIMIT/, "the read is unbounded again");
});
