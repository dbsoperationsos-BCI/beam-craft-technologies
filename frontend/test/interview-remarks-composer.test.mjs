import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The candidate's Remarks tab is the **lead's** Remarks tab.
 *
 * Not a box that looks like it: the same component. A recruiter and a salesperson write down what was
 * said on a call in the same way, and two composers meant two answers to "how do I add a note" - one
 * with the blue bubbles, the collapsible entries, the bullet lists and Enter-to-post, and one with a
 * textarea and a button under it.
 *
 * So `NotesComposer` moved out of `CRMPage.js`, where it had been sitting unexported among ten thousand
 * lines of CRM, and into `components/shared/`. Nothing about it changed for the lead: the same props,
 * the same entries, the same attachments.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const COMPOSER = src("components", "shared", "NotesComposer.js");
const CRM = src("components", "sales", "CRMPage.js");
const TAB = src("components", "hrm", "InterviewRemarksTab.js");
const POPUP = src("components", "hrm", "InterviewCandidatePopup.js");

test("it is one component in a shared folder, not a copy in each module", () => {
  assert.match(COMPOSER, /export default function NotesComposer\(/);
  // The CRM uses the shared one now and holds no copy of its own.
  assert.match(CRM, /import NotesComposer from "@\/components\/shared\/NotesComposer"/);
  assert.equal(/^function NotesComposer\(/m.test(CRM), false, "the CRM must not keep its own copy");
  assert.equal(/^function RemarkFileChip\(/m.test(CRM), false, "the file chip went with it");
  assert.match(TAB, /import NotesComposer from "@\/components\/shared\/NotesComposer"/);
});

test("what the lead's version does, it still does", () => {
  // The behaviours worth naming, because losing any of them silently would be the cost of the move:
  // the collapsible bubbles, the formatting controls, Enter-to-post, the attachments, the draft report
  // and the caller's ability to post the draft itself.
  for (const rule of [
    /toggleEntry\(/,
    /insertFormatting\(/,
    /handleKeyDown/,
    /onPendingChange/,
    /commitRef/,
    /showSendButton/,
    /RemarkFileChip/,
  ]) assert.match(COMPOSER, rule);
});

test("a log that cannot be edited does not offer a pencil", () => {
  /*
   * A candidate's remarks are `statusNotes`: **append-only**, with no id per entry and no endpoint that
   * rewrites one. The lead's pencil edits a remark in place, which for a candidate would be a control
   * that cannot work - so it is opt-out rather than always drawn, and the same for the paperclip, there
   * being nowhere to put a candidate's attachment.
   */
  assert.match(COMPOSER, /canEdit = true/);
  assert.match(COMPOSER, /canAttach = true/);
  assert.match(COMPOSER, /\{canEdit && <button/);
  assert.match(TAB, /canEdit=\{false\}/);
  assert.match(TAB, /canAttach=\{false\}/);
});

test("the candidate's log is mapped to entries rather than stored as them", () => {
  /*
   * `statusNotes` is `{ status, note, at, by }` and the composer reads `{ id, createdAt, text }`, so the
   * tab maps between them. It does **not** hand the composer an `onEntriesChange` that writes the array
   * back: a candidate's remark is posted to its own endpoint and the log is the server's.
   */
  assert.match(TAB, /createdAt: entry\.at/);
  assert.match(TAB, /text: String\(entry\.note \|\| ""\)/);
  assert.match(TAB, /addCandidateRemark\(candidate\.id, /);
  assert.equal(/onEntriesChange=/.test(TAB), false, "the log is append-only and the server's");
});

test("a shared component owns no module's service", () => {
  /*
   * The point of `shared/` is that a second module can use the thing. Wired to
   * `services/sales/remark-attachments.service` it could not: a module wanting attachments of its own
   * would have to fork the component or repoint a sales-only import, which is the near-copy this move
   * existed to remove. No other file in `components/shared/` imports from `@/services/` either.
   *
   * So the two calls are the caller's to supply. Latent today - the Interview tab passes
   * `canAttach={false}`, so the path is dead there - and fixed now rather than left for whichever module
   * hits it next.
   */
  assert.equal(/from "@\/services\//.test(COMPOSER), false, "a shared component takes its calls as props");
  assert.match(COMPOSER, /onUploadAttachment/);
  assert.match(COMPOSER, /onFetchAttachment/);
  assert.match(CRM, /onUploadAttachment=\{uploadRemarkAttachment\}/);
  assert.match(CRM, /onFetchAttachment=\{fetchRemarkAttachment\}/);
});

test("the date format is written once", () => {
  /*
   * The move turned one local `formatDateTime` into two identical copies - the composer's and the one
   * CRMPage still uses for its sync footer. A date format is a rule about how this studio writes a date,
   * and two copies of it are two places for it to drift.
   */
  const LIB = src("lib", "formatDateTime.mjs");
  assert.match(LIB, /export function formatDateTime\(/);
  // The awkward bit worth keeping written down: en-GB's `hour12` uses an 0-11 cycle, so noon reads
  // "00:06 pm". `hourCycle: "h12"` is the fix, and it belongs in the one copy.
  assert.match(LIB, /hourCycle: "h12"/);
  for (const file of [COMPOSER, CRM]) {
    assert.match(file, /import \{ formatDateTime \} from "@\/lib\/formatDateTime\.mjs"/);
    assert.equal(/^function formatDateTime\(/m.test(file), false, "no local copy of it");
  }
});

test("the stage each remark was written at is still shown", () => {
  // The one thing a candidate's remark carries that a lead's does not, and the reason the log is worth
  // reading: "they asked to be called back" means something different at Follow Up and at Selected.
  assert.match(COMPOSER, /entryMeta/);
  assert.match(TAB, /entryMeta=/);
});

test("neither box is pinned, and nothing can pin one again", () => {
  /*
   * Both logs are read straight down and a box that holds the top of the pane spends that height on
   * an empty textarea. The composer was pinnable through `pinComposer`; with both callers having
   * dropped it the prop is gone rather than left as an option nobody passes.
   */
  assert.doesNotMatch(COMPOSER, /pinComposer/, "the dead prop is back on the composer");
  for (const [name, file] of [["the candidate's", TAB], ["the lead's", CRM]])
    assert.doesNotMatch(file, /^\s*pinComposer\s*$/m, `${name} box is pinned again`);
  assert.doesNotMatch(COMPOSER, /sticky top-0 z-10/, "the composer pins itself now");
});

test("a refusal puts the box it is asking for back on screen", () => {
  /*
   * The regression the unpinning would otherwise have shipped, and the reason this test exists.
   *
   * `setTab("remarks")` was enough only while the box was `sticky`. Remarks is the tab the card
   * **opens** on, so asking for it again is usually a no-op - and the box is the first thing in a pane
   * the reader has very likely scrolled down through. Refused for a box that is off the top of the
   * pane, somebody sees an error and no way to obey it, which reads as a button that does nothing.
   *
   * So every place that refuses for a missing remark scrolls the pane, and none of them may go back to
   * setting the tab alone.
   */
  assert.match(POPUP, /const cardPane = useRef\(null\);/);
  // The lead popup, the same way: its own pane, its own ref, one helper for its refusal.
  assert.match(CRM, /const remarksPane = useRef\(null\);/);
  assert.match(CRM, /<div ref=\{remarksPane\} className="flex min-h-0 h-full flex-1 flex-col overflow-y-auto/);
  assert.match(CRM, /remarksPane\.current\?\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  assert.equal((CRM.match(/revealRemarkBox\(\)/g) || []).length, 2,
    "the lead popup's refusal stopped revealing the box, or a new refusal skipped it");
  assert.doesNotMatch(CRM, /setLeadTab\?\.\("remarks"\);\s*\n\s*return;/,
    "a refusal switches tab without scrolling the box into view");
  assert.match(POPUP, /<div ref=\{cardPane\} className="min-h-0 flex-1 overflow-auto p-3">/,
    "the pane that scrolls is not the one the ref is on");
  assert.match(POPUP, /cardPane\.current\?\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  // After the tab has rendered, or it is the outgoing pane that gets scrolled.
  assert.match(POPUP, /requestAnimationFrame\(\(\) => \{\s*cardPane\.current/);

  // All three refusals - Update, a stage pill pressed without a remark, and a note the server would
  // not take - go through the one helper.
  assert.equal((POPUP.match(/revealRemarkBox\(\)/g) || []).length, 4,
    "a refusal path stopped revealing the box, or a new one was added without it");
  assert.doesNotMatch(POPUP, /setTab\("remarks"\);\s*\n\s*return;/,
    "a refusal switches tab without scrolling the box into view");
});
