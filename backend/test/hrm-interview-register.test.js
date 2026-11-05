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

test("deleting a sheet link removes no candidate at all", () => {
  /*
   * It used to delete everything the link had imported, on the argument that deleting a source deletes
   * what it produced. The studio's rule is the opposite and it is absolute: once a row is in the
   * register it is the studio's record, and the only thing that removes it is somebody pressing Delete
   * on it. Not unlinking, not a row vanishing from the spreadsheet, not a sync that fails halfway.
   *
   * What that was costing is the reason: a candidate with rounds booked, a remark history and a
   * screening form out with them, gone because somebody tidied up an integration.
   */
  const LINKS = src("sheetLinksController.js");
  assert.equal(SYNC.includes("deleteCandidatesFromSheet"), false, "the helper should not exist at all");
  assert.equal(LINKS.includes("deleteCandidatesFromSheet"), false, "unlinking must not reach the register");
  assert.equal(/hrmInterviewCandidate\.deleteMany/.test(SYNC), false, "nothing in the sync path deletes a candidate");
  // The link itself still goes, because stopping the sync is the whole point of unlinking.
  assert.match(LINKS, /data: \{ deletedAt: new Date\(\) \}/, "unlinking should still stop the sync");
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

test("a whole selection is deleted in batches, not one candidate per round trip", () => {
  /*
   * The request was capped at 2,000 because `removeBulk` called `deleteCandidate` in a loop: each
   * candidate cost its own two statements and its own transaction, so a large selection was
   * thousands of round trips and long enough to risk a gateway timeout - which leaves somebody with
   * no idea how much of it happened. The CRM lead board has never had that problem; it slices.
   */
  const body = fn(SERVICE, "async function deleteCandidates(", "\n/**");
  assert.match(body, /BULK_DELETE_SLICE/, "the selection is no longer sliced");
  assert.match(body, /hrmInterviewCandidate\.deleteMany\(\{ where: \{ id: \{ in: liveIds \} \} \}\)/, "candidates are not removed in one statement per slice");
  // The invites go in the same transaction, or a failure between the two leaves forms naming a
  // candidate that no longer exists - the orphans this whole area was cleaned up for.
  assert.match(body, /\$transaction\(\[/);
  assert.match(body, /hrmInterviewApplicationInvite\.deleteMany\(\{ where: \{ candidateId: \{ in: liveIds \} \} \}\)/);
  /*
   * Read before the delete: afterwards there is no way to tell which of the ids asked for were
   * real, and the screen reports how many were found as well as how many went.
   */
  const read = body.indexOf("findMany({");
  const wrote = body.indexOf("$transaction([");
  assert.ok(read !== -1 && wrote !== -1 && read < wrote, "the ids are deleted before it is known which were live");

  /*
   * A failing slice must not take the rest with it. The loop this replaced caught per candidate and
   * carried on, so one bad row cost one row; letting a slice throw would make the whole call a 500
   * that the screen reads as "nothing happened" - while the slices before it have already
   * committed, leaving somebody to guess how much of their selection went.
   */
  assert.match(body, /\} catch \(error\) \{/, "a failing slice now blanks the whole reply");
  assert.ok(body.indexOf("try {") < body.indexOf("$transaction(["), "the batch is not guarded");
});

test("the delete route takes a selection the size the board can actually make", () => {
  /*
   * Select-all answers up to 20,000 ids, and the delete used to refuse anything over 2,000 - so the
   * one path that produces a large selection could not be acted on. The cap now bounds the request
   * rather than the loop, at the CRM lead board's own number.
   */
  assert.match(CONTROLLER, /const bulkDeleteIds = .*\.max\(200000\);/, "the delete cap is not the CRM board's");
  const body = fn(CONTROLLER, "async function removeBulk(", "\n/**");
  assert.match(body, /z\.object\(\{ ids: bulkDeleteIds \}\)/, "the delete route still uses the row-at-a-time cap");
  assert.match(body, /service\.deleteCandidates\(parsed\.data\.ids\)/, "the route still deletes one candidate at a time");
  assert.doesNotMatch(body, /for \(const id of ids\)/, "the per-candidate loop is back");
  // The reply is unchanged, so the screen reports what it always did.
  assert.match(body, /data: \{ deletedIds, missedIds \}/);
  // And select-all still stops well inside it, rather than the two caps disagreeing.
  assert.match(SERVICE, /const SELECT_ALL_MAX = 20000;/);
});

test("a lapsed form is listed as Expired without the list writing it", () => {
  /*
   * "Expired" is only written when somebody next touches the link - opens it, sends it, submits it -
   * so a form nobody touched after its deadline still held Created or Verified, and sat under that
   * column on the board and in the table. The serializer reports it by the same rule those writes
   * use, and the GET still only reads.
   */
  const { reportedInviteStatus } = require("../src/modules/hrm/interview/invites");
  const now = new Date("2026-11-04T12:00:00Z");
  const past = new Date("2026-11-01T00:00:00Z");
  const future = new Date("2026-11-10T00:00:00Z");
  assert.equal(reportedInviteStatus({ status: "Created", expiresAt: past }, now), "Expired");
  assert.equal(reportedInviteStatus({ status: "Verified", expiresAt: past.toISOString() }, now), "Expired");
  assert.equal(reportedInviteStatus({ status: "Verified", expiresAt: now }, now), "Expired", "the lazy writes expire at the deadline itself (<=)");
  assert.equal(reportedInviteStatus({ status: "Created", expiresAt: future }, now), "Created");
  assert.equal(reportedInviteStatus({ status: "Verified", expiresAt: future }, now), "Verified");
  // A finished form keeps what it finished as, however long ago its link lapsed.
  assert.equal(reportedInviteStatus({ status: "Submitted", expiresAt: past }, now), "Submitted");
  assert.equal(reportedInviteStatus({ status: "Cancelled", expiresAt: past }, now), "Cancelled");
  assert.equal(reportedInviteStatus({ status: "Expired", expiresAt: future }, now), "Expired");

  const INVITES = src("invites.js");
  assert.match(fn(INVITES, "function serializeInvite(", "\n}"), /status: reportedInviteStatus\(invite\)/, "the list reports the stored status again");
  const list = fn(INVITES, "async function listInvites(", "\n/**");
  assert.doesNotMatch(list, /\.update(Many)?\(/, "listing the forms writes to them");
});
