import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * One press of Update is one write.
 *
 * ── The bug this exists to stop coming back ──────────────────────────────────────────────────
 *
 * The lead popup will not let an update through without a remark, so the ordinary way to use it is
 * to type a note and press **Update and Close** with that note still sitting in the box. The button
 * committed the note and then saved, and the note's own commit posts itself - so two writes went to
 * `PUT /api/sales/crm-leads/:id` at once.
 *
 * They do not carry the same lead. A remark's write can only see the lead **as it was last saved** -
 * the popup's edits live in a draft it knows nothing about - so it sends the old status, the old
 * branch, the old estimated value, the old follow-up dates. Whichever request the server happened to
 * finish last won. When that was the remark's, the update was reverted a moment after a toast said
 * the lead had been updated, and nothing on screen said so.
 *
 * That is why it struck "sometimes": it was a race between two requests, decided by the network.
 *
 * The fix is that a note committed *by* an Update is not posted separately. It is committed for the
 * screen, handed back to the save, and written once - by the save, which is the only one of the two
 * that knows what was edited.
 *
 * Three paths commit a note this way and all three must stay fixed: the two Update buttons through
 * `attemptSave`, and the duplicate-number dialog's "go on with the save", which resumes an
 * interrupted press.
 */

const PAGE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"),
  "utf8",
);

/** The body of a named function in the page. */
function functionBody(opening) {
  const start = PAGE.indexOf(opening);
  assert.notEqual(start, -1, `${opening} was not found`);
  const end = PAGE.indexOf("\n  }\n", start);
  assert.notEqual(end, -1, `the end of ${opening} was not found`);
  return PAGE.slice(start, end);
}

test("committing a note as part of an update never posts it on its own", () => {
  /*
   * The guard has to wrap the commit itself. `submitDraft` calls `onEntriesChange` synchronously,
   * so the flag is read during the commit and cleared straight after - a `finally`, so a throw
   * inside the commit cannot leave every later remark silently unposted.
   */
  const body = functionBody("  function attemptSave(closeAfter, advanceAfter, forcedStatus)");
  assert.match(body, /skipRemarkPostRef\.current = true;/, "the update posts its note separately again");
  assert.match(body, /} finally \{\s*\n\s*skipRemarkPostRef\.current = false;/, "the guard is not cleared in a finally");
  assert.match(body, /committedEntries = commitRemarkRef\.current\?\.\(\) \|\| null;/);
  assert.match(body, /runUpdateLead\(\(\) => saveWithCommittedNote\(closeAfter, advanceAfter, forcedStatus, committedEntries\)\);/);
});

test("a note committed for a save that was refused is still written", () => {
  /*
   * The other side of suppressing the note's own write: it made the save the only thing writing it.
   * A refused save left the note on screen, in the list, with the box cleared - and nowhere else, so
   * it looked posted and vanished on the next reload. Suppression is conditional on the save
   * actually happening.
   */
  const body = PAGE.slice(PAGE.indexOf("async function saveWithCommittedNote("), PAGE.indexOf("\n  }\n", PAGE.indexOf("async function saveWithCommittedNote(")));
  assert.match(body, /const saved = await onSave\(closeAfter, advanceAfter, forcedStatus, committedEntries\);/);
  assert.match(body, /if \(saved === false && committedEntries\) onUpdateRemarks\?\.\(committedEntries, \{ post: true \}\);/);
  // And the hosts have to hand that answer back rather than discarding the promise.
  assert.doesNotMatch(PAGE, /onSave=\{\([^)]*\) => void save/, "a host discards whether its save succeeded");
});

test("the duplicate-number dialog resumes the press the same way", () => {
  /*
   * This path is easy to forget: the clash check runs *before* the note is committed, so when
   * somebody presses "go on with the save" the note is still in the box and gets committed there
   * instead. Left as it was, it raced the update exactly as the button used to.
   */
  const dialog = PAGE.slice(PAGE.indexOf("onContinue={clashAlert.saving"), PAGE.indexOf("} : undefined}"));
  assert.match(dialog, /skipRemarkPostRef\.current = true;/, "the clash dialog posts its note separately again");
  assert.match(dialog, /saveWithCommittedNote\(pending\.closeAfter, pending\.advanceAfter, pending\.forcedStatus, committedEntries\);/);
});

test("the composer is told which kind of write this is", () => {
  assert.match(
    PAGE,
    /onUpdateRemarks\?\.\(nextEntries, \{ post: !skipRemarkPostRef\.current \}\)/,
    "the popup no longer tells its host whether to post the note",
  );
});

/*
 * Both hosts, because the popup is rendered twice and each brings its own remark handler. A fix
 * applied to one of them is the shape of the original bug.
 */
test("both hosts honour post: false, and skip only the network write", () => {
  for (const opening of ["function updateRemarks(nextEntries, {", "function updateRemarksEntries(id, nextEntries, {"]) {
    const body = functionBody(opening);
    assert.match(body, /\{ post = true \} = \{\}/, `${opening} no longer accepts the option`);
    assert.match(body, /if \(!post\) return;/, `${opening} posts the note even when the save will carry it`);
    /*
     * The state write must come *before* the bail-out. The entries still have to reach the screen
     * and the details the save is about to read - it is only the request that is skipped.
     */
    const bail = body.indexOf("if (!post) return;");
    const request = body.indexOf("apiRequest(");
    assert.ok(request === -1 || bail < request, `${opening} bails out after sending the request`);
  }
});

test("both hosts pass the committed list through to their save", () => {
  // Handed in rather than read back out of state: the state that carries it lands a render later,
  // and the save runs on this one. The Contacts host has no ref to fall back on, so this is the
  // only thing that keeps a note committed by Update from being dropped.
  for (const opening of [
    'async function save(closeAfter = false, advanceAfter = false, forcedStatus = "", committedEntries = null)',
    'async function savePopupLead(closeAfter = false, advanceAfter = false, forcedStatus = "", committedEntries = null)',
  ]) {
    assert.match(
      functionBody(opening),
      /normalizeRemarkEntries\(committedEntries \|\|/,
      `${opening} ignores the note the button just committed`,
    );
  }
  // And the wiring actually forwards the fourth argument - the saves above would silently receive
  // undefined otherwise, which is exactly the note-dropping this guards.
  assert.equal(
    PAGE.match(/onSave=\{\(closeAfter, advanceAfter, forcedStatus, committedEntries\) =>/g)?.length,
    2,
    "a host is not forwarding the committed remark list to its save",
  );
});
