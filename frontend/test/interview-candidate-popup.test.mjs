import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { candidateFormSections } from "../src/constants/interviewConfig.js";

/*
 * The candidate popup: one screen where a candidate is worked.
 *
 * The register could be read and not worked. A double-click opened a read-only panel, and everything
 * a recruiter does to a candidate was scattered across the row's ⋮ - one dialog to correct the
 * record, another to decide, a third to schedule, a fourth to send the form. This is the CRM's own
 * answer to the same problem, asked of a candidate.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const POPUP = src("components", "hrm", "InterviewCandidatePopup.js");
const PAGE = src("components", "hrm", "InterviewPage.js");

test("it is reached both ways, and both open the same thing", () => {
  // A double-click and the ⋮'s Edit / Review are two gestures for one errand. Two components would
  // be two editors for one record, which is what this change removes.
  assert.match(PAGE, /onRowDoubleClick=\{openCandidatePopup\}/);
  assert.match(PAGE, /const editItem = \{ label: reviewing \? "Review" : "Edit", onSelect: \(\) => openCandidatePopup\(candidate\) \}/);
  assert.match(PAGE, /<InterviewCandidatePopup/);
});

test("the left pane is the record's own sections, so a field added there appears here", () => {
  assert.match(POPUP, /candidateFormSections\.map\(/);
  assert.match(POPUP, /visibleFields\(section\.fields, values, context\)/);
  assert.match(POPUP, /<SchemaFormField/);
  // Four sections, 39 fields. Pinned so a section quietly dropped from the popup is a failing test
  // rather than a field nobody can edit any more.
  assert.equal(candidateFormSections.length, 4);
  assert.equal(candidateFormSections.reduce((n, s) => n + s.fields.length, 0), 39);
});

test("the draft starts from the whole record, or a save blanks what the popup does not draw", () => {
  /*
   * `PUT /candidates/:id` is **not partial** - it writes every key it is handed - so a draft built
   * from the popup's own fields would blank `campaignName`, `sourceRowId`, `attachments` and the rest
   * on the first save. `candidateFormValues` is the whole record, which is why the draft starts there.
   */
  assert.match(POPUP, /candidateFormValues\(candidate\)/);
});

test("the missing remark is said in the floating notice, not as a banner in the form", () => {
  /*
   * It is not a fault in a field. Every other message the popup shows is about something typed into a
   * box - a bad email, a name left out - and belongs beside that box; this one is about the popup as a
   * whole having nothing to say why the record changed. As a banner above the form it pushed the record
   * down the screen and sat there being re-read, and on a phone it was the one thing visible.
   *
   * The snackbar is the application's own answer for "that press did not go through, and here is why":
   * it rises over everything at z-200, says it once, and goes. The Remarks tab comes forward with it,
   * so the box being asked for is the box on screen.
   */
  // The notice counts what is marked; the remark box itself says why, under it.
  assert.match(POPUP, /onError\?\.\(markedFieldsMessage\(/);
  assert.match(POPUP, /missingError=\{remarkError\}/);
  assert.equal(/setErrors\(\{ form: "Add a remark/.test(POPUP), false, "the refusal is a notice, not a form banner");
  assert.match(PAGE, /onError=\{showError\}/);
});

test("one press, one write, and a remark before any of it", () => {
  // The CRM's rule, and the reason `statusNotes` is worth reading: an update with no note is a stage
  // that moved for reasons living in whoever pressed it.
  assert.match(POPUP, /useSubmitOnce\(\)/);
  assert.match(POPUP, /busy=\{saving\}/);
  assert.match(POPUP, /remarkAdded \|\| remarkDraftFilled/);
});

test("the forms a forward action opens draw over the popup, and leave it open", () => {
  /*
   * Scheduling a round and sending the screening form both used to **close** the popup on the way to
   * their dialog, which is the one thing they must not do: the popup is where the candidate is being
   * worked, the dialog is one step of that work, and a step that throws away the screen it was
   * started from means coming back through the register and a double-click to carry on.
   *
   * So the record is saved, the dialog opens at `dialogOverPanel` (z-130, over the popup's z-120),
   * and the popup stays underneath. Closing the dialog closes **only** the dialog; the popup is still
   * there, which is what somebody who changed their mind about scheduling expects to find.
   */
  assert.equal(/onScheduleInterview=\{async \(saved\) => \{\s*setEditCandidate\(null\);/.test(PAGE), false, "scheduling must not close the popup");
  assert.equal(/onSendApplicationForm=\{async \(saved\) => \{\s*setEditCandidate\(null\);/.test(PAGE), false, "sending the form must not close the popup");
  // Over it, not under it: at the popup's own z-120 the dialog would be dimmed by the popup's
  // backdrop and unreachable.
  assert.match(PAGE, /layer=\{editCandidate \? "dialogOverPanel" : "dialog"\}/);
  // Three now: the schedule dialog, the screening-form resend, and the onboarding invite the
  // Onboarded pill opens from the same popup.
  assert.equal((PAGE.match(/layer=\{editCandidate \? "dialogOverPanel" : "dialog"\}/g) || []).length, 3);
});

test("a dialog that succeeded closes the popup with it", () => {
  /*
   * The other half. A round booked or a form sent is the errand finished, so leaving the popup open
   * behind it invites a second press on a record that has moved - and the popup would be showing the
   * stage as it was before the dialog wrote it. Only on **success**: a dialog closed without saving
   * leaves the popup exactly as it was.
   */
  assert.match(PAGE, /onSaved=\{\(saved, message\) => \{[\s\S]{0,300}?setScheduleCandidate\(null\);[\s\S]{0,300}?setEditCandidate\(null\);/);
  assert.match(PAGE, /onInviteSent=\{\(message\) => \{ setEditCandidate\(null\);/);
});

test("a stage asks for its remark before it is written", () => {
  /*
   * Pressing a pill does not move anybody on its own. It chooses, the card says a remark is needed to
   * move them, the Remarks tab comes forward, and Update - which refuses without a remark and posts
   * the one in the box - is what writes the stage and the reason together.
   *
   * The tab is brought forward because the message under the pills is not where somebody presses
   * Update from: being refused for a box on a tab you cannot see reads as a button that does nothing.
   */
  assert.match(POPUP, /setTab\("remarks"\)/);
  assert.match(POPUP, /stageAwaitingRemark/);
  assert.match(POPUP, /Write a remark to move/);
});

test("the left pane is what the candidate answered, openable to the rest", () => {
  /*
   * Thirty-nine fields in one scroll is not a record, it is a search. An empty field says nothing
   * about a candidate, so the pane opens on what they actually filled in - the lead popup's Client
   * Details card asked of an application - and the empty ones are one press away for the review that
   * needs to fill one in.
   *
   * The answered set is read off the **candidate**, not off the draft: computed from the draft, a
   * field emptied while typing would vanish from under the cursor.
   */
  assert.match(POPUP, /const answered = useMemo\(/);
  assert.match(POPUP, /candidateFormValues\(candidate\)/);
  assert.match(POPUP, /showAll \|\| answered\.has\(field\.name\)/);
  // A section whose every field is empty is not drawn as an empty heading.
  assert.match(POPUP, /if \(!shown\.length\) return null;/);
  assert.match(POPUP, /Show all fields|Show every field/);
});

test("the stage is chosen here, and what it needs is asked here", () => {
  /*
   * The lead popup's Follow-up Details card, asked of a candidate: the stage as the words themselves,
   * and directly under them whatever that stage needs. Choosing Follow Up asks when; choosing a
   * decision is answered by the remark the footer already requires. Nothing is sent anywhere to be
   * asked a question that fits under the pill that raised it.
   */
  assert.match(POPUP, /<InterviewStatusPills/);
  assert.match(POPUP, /value=\{values\.status\}/);
  assert.match(POPUP, /options=\{CANDIDATE_STATUSES\}/);
  // Follow Up is the one stage that needs a date, and it is required rather than optional - a
  // follow-up with no date is a row nobody is coming back to.
  assert.match(POPUP, /needsFollowUpDate/);
  assert.match(POPUP, /STATUSES_WITH_FOLLOW_UP/);
});

test("a stage made by an act opens the act's own form directly, and the act is what writes it", () => {
  /*
   * Form Submission Pending, Interview Scheduled and Onboarded are consequences: a form went out, a
   * round is in the diary, an invite was raised. Ticking one by hand puts a candidate in a tab whose
   * whole meaning is that something exists which does not. So choosing one saves the record and opens
   * the act's own form directly, through `forward` - and the act is what writes the stage.
   *
   * **No question first.** It used to ask "save this candidate and send them one?" before opening the
   * very form that then asked the same thing again in its own words - one confirmation doing the work
   * of two presses. Picking the pill is the confirmation now.
   */
  assert.match(POPUP, /const STATUS_ACTS/);
  assert.match(POPUP, /FORM_PENDING_STATUS\]: \{ handler: /);
  assert.match(POPUP, /INTERVIEW_SCHEDULED_STATUS\]: \{ handler: /);
  assert.match(POPUP, /ONBOARDED_STATUS\]: \{ handler: /);
  assert.equal(POPUP.includes("statusAct"), false, "the small question dialog is gone");
  assert.equal(POPUP.includes("question:"), false, "STATUS_ACTS carries only a handler now");
  assert.match(POPUP, /if \(act\) \{ forward\(act\.handler\)\(\); return; \}/);
  /*
   * `forward` saves first and opens the act's form over the popup, which stays open until that form
   * answers it: Cancel on that form returns here with nothing else to answer for, and the form's own
   * success is what closes both. The footer's own Send Screening Form and Schedule Interview buttons
   * are gone - the pill above them is now the only way to ask, not a second one beside it.
   */
  assert.match(POPUP, /function forward\(handler\) \{/);
  assert.equal(/canSchedule|canSendForm/.test(POPUP), false, "the footer no longer gates on these");
  const footer = POPUP.slice(POPUP.indexOf('justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3'));
  assert.equal(footer.includes("Send Screening Form"), false, "the footer button is gone; the pill is the one way to ask now");
  assert.equal(footer.includes("Schedule Interview"), false, "the footer button is gone; the pill is the one way to ask now");
  /*
   * Form Submitted is refused outright, whoever is looking: it is the candidate answering, and a
   * register that lets it be ticked is a register that says an application arrived when none did.
   * Refused rather than absent - see `InterviewStatusPills` - because a candidate can *be* at it.
   */
  assert.match(POPUP, /const refusedStatuses = canWrite\s*\?\s*\[FORM_SUBMITTED_STATUS,/);
  assert.match(POPUP, /disabledValues=\{refusedStatuses\}/);
  // And everything, for a viewer who may read this candidate but not move them.
  assert.match(POPUP, /: CANDIDATE_STATUSES;/);
});

test("writing something without finishing does not close the popup", () => {
  /*
   * `onSaved` is the page's `afterSave`, and that **closes** the popup - which is right for Update and
   * wrong for everything else. Adding a remark or sending a WhatsApp message wrote the thing and then
   * took the screen away: somebody noting what was said on a call lost the record they were noting it
   * on, and the note they were about to follow with a stage change.
   *
   * So there are two channels. `onSaved` finishes, `onRecordChanged` says something was written and
   * the register should catch up, and the popup stays.
   */
  assert.match(POPUP, /onRecordChanged/);
  assert.match(POPUP, /onAdded=\{\(saved\) => \{ setRemarkAdded\(true\); if \(saved\) setRecord\(saved\); onRecordChanged\?\.\(saved, "Remark added\."\); \}\}/);
  assert.match(POPUP, /onSent=\{\(saved, message\) => \{ if \(saved\) setRecord\(saved\); onRecordChanged\?\.\(saved, message\); \}\}/);
  // And the page keeps them apart: one closes, one only refreshes.
  assert.match(PAGE, /onRecordChanged=\{\(saved, message\) => \{/);
  assert.equal(/onRecordChanged=\{\(saved, message\) => \{[^}]*setEditCandidate\(null\)/.test(PAGE), false, "a remark must not close the popup");
});

test("a save the popup stays open after becomes the popup's new baseline", () => {
  /*
   * Scheduling and sending both save and then leave the popup open, so the record on screen is no
   * longer the record the popup was handed. Compared against the stale prop, everything already
   * written still counted as unsaved: pressing Discard asked "Close without saving?" about changes
   * that had been saved a moment earlier, and the Activity Logs tab showed the log as it was before
   * the remark that was just posted.
   *
   * So the popup holds its own `record`, seeded from the prop and replaced by whatever comes back from
   * a save. `dirty` and the log both read that.
   */
  assert.match(POPUP, /const \[record, setRecord\] = useState\(candidate\)/);
  assert.match(POPUP, /setRecord\(saved\)/);
  assert.match(POPUP, /JSON\.stringify\(values\) !== JSON\.stringify\(candidateFormValues\(record\)\)/);
  // Both readings of the log come off the written record, so a remark just posted is in the thread and
  // a stage just moved is in the activity list.
  assert.match(POPUP, /entries=\{record\.statusNotes\}/);
  assert.match(POPUP, /interviewInfoFormatters\.activityLog\(record\.statusNotes\)/);
});

test("the note that satisfied the gate is the note that gets written", () => {
  /*
   * The gate accepts an unsent draft, which without this is a reason accepted and then thrown away:
   * the composer unmounts with the popup and the note is gone. The save posts it.
   */
  assert.match(POPUP, /const remarkCommit = useRef/);
  assert.match(POPUP, /commitRef=\{remarkCommit\}/);
  assert.match(POPUP, /await remarkCommit\.current\?\.\(\)/);
});

test("the two panes share the width the way the lead popup's do", () => {
  /*
   * The left pane used to take everything past a 28rem right column - about two thirds of the screen for
   * a form that now draws only the fields the candidate answered. The lead popup's near-even split was
   * the other way wrong: the record is two columns of fields and wants the larger share, while the card
   * beside it is one column of text. Three fifths and two fifths, which is where both complaints stop.
   */
  assert.match(POPUP, /lg:grid-cols-\[minmax\(0,1\.55fr\)_minmax\(0,1fr\)\]/);
  assert.equal(POPUP.includes("minmax(0,28rem)"), false, "the right column is a share, not a fixed column");
});

test("Remarks is the lead's Remarks tab: write one, and read the ones before it", () => {
  /*
   * The box on its own was half a tab. On a lead, Remarks is where the conversation lives - you write
   * the note and you read what was said last time in the same place, which is the whole reason anybody
   * opens it before ringing somebody. The history was a tab away, so writing a note meant leaving the
   * thread you were answering.
   */
  const TAB = src("components", "hrm", "InterviewRemarksTab.js");
  /*
   * And it is the lead's composer itself, not a box that resembles it - see
   * `interview-remarks-composer.test.mjs` for the move that made that possible.
   */
  assert.match(TAB, /<NotesComposer/);
  assert.match(TAB, /entries=\{composerEntries\}/);
  // From the record as last written, so a note just posted appears in the thread under the box.
  assert.match(POPUP, /entries=\{record\.statusNotes\}/);
});

test("Activity Logs is what happened, not the notes again", () => {
  /*
   * Both readings come out of `statusNotes`, so they have to be different readings or the card holds
   * one list in two tabs. Remarks is the note text - the conversation. Activity Logs is the record: the
   * stage, when it moved, and who moved it, one line each, which is the question "what has been done
   * about this candidate" rather than "what was said".
   */
  const FORMATTERS = src("components", "hrm", "interviewInfoFormatters.js");
  assert.match(FORMATTERS, /activityLog/);
  assert.match(POPUP, /interviewInfoFormatters\.activityLog\(record\.statusNotes\)/);
  assert.equal(POPUP.includes("interviewInfoFormatters.statusNotes(record.statusNotes)"), false, "that reading belongs to Remarks now");
});

test("it is the lead popup's size, not Add Lead's", () => {
  /*
   * Asked for by name, and it is not cosmetic: the left pane is four sections and thirty-nine fields
   * beside a tab card, and the centred `max-w-[1540px]` card Add Lead uses gives that pane a scrollbar
   * before the first section is finished. The lead popup fills the screen behind a small gutter.
   */
  assert.match(POPUP, /fixed inset-0 z-\[120\] bg-black\/40 p-2 sm:p-3/);
  assert.match(POPUP, /flex h-full w-full flex-col overflow-hidden rounded-\[1\.6rem\] bg-\[#f4f4f4\]/);
  assert.equal(POPUP.includes("max-w-[1540px]"), false, "that is Add Lead's card, not the popup's");
  /*
   * `z-[120]`, the lead popup's own layer, above the layer this screen's dialogs use - so the decision
   * dialog and the schedule dialog draw over the popup rather than under it.
   *
   * Asserted against the **className** rather than as a bare substring: the layer is named in the
   * comment that explains the choice, and a test that reads prose as markup is a test that fails on a
   * comment.
   */
  const layers = [...POPUP.matchAll(/className="fixed inset-0 (z-\[\d+\])/g)].map((m) => m[1]);
  assert.deepEqual(layers, ["z-[120]"]);
});

test("a press inside a dialog the popup opened is not a press on the backdrop", () => {
  /*
   * `Dialog` draws **inside** this popup rather than portalling out of it, and its own backdrop is a
   * `fixed inset-0` over the whole screen. So a mousedown on any button in a dialog this popup opened -
   * the close confirmation's own buttons most of all - bubbled to the popup's backdrop, which read it
   * as a click on the dimmed area and started closing over an answer that had just been given.
   *
   * The fix is the test `Dialog` already applies to its own backdrop: only a press whose target *is*
   * the backdrop is a press on the backdrop. Anything inside it, at any depth and in any tab, belongs
   * to what it was pressed on.
   */
  assert.match(POPUP, /onMouseDown=\{\(event\) => \{ if \(event\.currentTarget === event\.target\) requestClose\(\); \}\}/);
  // And with that test in place the panel does not need to stop the press itself - two mechanisms for
  // one rule is how the first one gets forgotten.
  assert.equal(POPUP.includes("onMouseDown={(event) => event.stopPropagation()}"), false);
});

test("a viewer without write gets no way to write", () => {
  /*
   * A double-click reaches this, so it cannot rely on the control that opened it having been hidden.
   *
   * **By the prop's real name.** `ReadOnlyFieldset` takes `canWrite`, and it does not spread what it
   * does not recognise onto the fieldset - so a call that said `readOnly={!canWrite}` was silently
   * the default, `canWrite = true`, and a viewer with READ got a fully editable record: name, number,
   * position, stage, follow-up date. Nothing on screen said so and no test caught it, because a test
   * that matches the tag name matches a component that was handed nothing.
   */
  assert.equal(/<ReadOnlyFieldset[^>]*readOnly/.test(POPUP), false, "the prop is canWrite, and readOnly is silently ignored");
  for (const call of POPUP.match(/<ReadOnlyFieldset[^>]*/g) || []) {
    assert.match(call, /canWrite=\{canWrite\}/, `every fieldset takes the viewer's own access: ${call.slice(0, 60)}`);
  }
  // Both of them: the record's fields, and the follow-up date in the card beside it.
  assert.equal((POPUP.match(/<ReadOnlyFieldset/g) || []).length, 2);
  /*
   * And the press that opens the rest of the record is **outside** the fieldset. A disabled fieldset
   * disables every button in it, so a viewer with READ would have been shut out of the one thing they
   * are there to do - read the whole record - by the guard that exists to stop them writing to it.
   */
  const pane = POPUP.slice(POPUP.indexOf("<ReadOnlyFieldset"), POPUP.indexOf("</ReadOnlyFieldset>"));
  assert.equal(pane.includes("setShowAll"), false, "the show-all press must not be inside the disabled fieldset");
  assert.match(POPUP, /<\/ReadOnlyFieldset>\s*\{\/\*[\s\S]*?\*\/\}\s*<Button type="button" variant="ghost" size="sm" onClick=\{\(\) => setShowAll/);
  assert.match(POPUP, /canWrite \? /);
});

test("the tab strip is the module's own tab bar, not three buttons", () => {
  /*
   * `ui/Tabs` is what every other tab row in this application is - one place deciding the size, the
   * selected colour and the tab semantics, which is how the app stopped having three tab sizes. Three
   * `Button`s in a row look close enough and carry none of it: no `role="tablist"`, no `role="tab"`,
   * no `aria-selected`, so a screen reader is told about three buttons rather than where it is.
   */
  assert.match(POPUP, /<Tabs\s+tabs=\{POPUP_TABS\}/);
  assert.match(POPUP, /value=\{tab\} onChange=\{setTab\}/);
  assert.equal(/variant=\{tab === key \? "primary" : "ghost"\}/.test(POPUP), false, "the hand-built strip should be gone");
});

test("a remark can be written without moving the stage", () => {
  const TAB = src("components", "hrm", "InterviewRemarksTab.js");
  assert.match(TAB, /addCandidateRemark\(candidate\.id, /);
  // Its own guard: posting a remark twice writes the note twice, and the log is append-only.
  assert.match(TAB, /useSubmitOnce\(\)/);
  /*
   * The unsent draft is what satisfies the popup's mandatory-remark gate, so the popup has to be told
   * about it - otherwise somebody types a note, presses Update, and is refused for the note in front
   * of them. The composer reports it, and the tab passes it on.
   *
   * **Trimmed**, which the shared composer does in `reportPending`: a gate a pressed space satisfies is
   * not a gate - it would let an update through with a blank line where the reason should be.
   */
  assert.match(TAB, /onPendingChange=\{\(pending\) => onDraftChange\?\.\(pending\)\}/);
  const COMPOSER = src("components", "shared", "NotesComposer.js");
  assert.match(COMPOSER, /onPendingChange\?\.\(Boolean\(String\(text \?\? ""\)\.trim\(\)\)/);
  // And the words themselves, because this tab has to post the draft rather than hand back an array.
  assert.match(TAB, /onDraftTextChange=/);
});

test("the log is read, never written, in the two tabs that read it", () => {
  const POPUP_NOW = src("components", "hrm", "InterviewCandidatePopup.js");
  // The lead's own words for the two questions, because they are the same two questions.
  assert.match(POPUP_NOW, /Activity Logs/);
  assert.match(POPUP_NOW, /Remarks/);
  /*
   * Neither tab writes. Remarks has a composer, and the composer posts through its own endpoint - the
   * log itself is append-only and nothing here edits or removes an entry.
   */
  assert.equal(POPUP_NOW.includes("tabCard"), false, "the placeholder prop should be gone");
  assert.equal(/statusNotes:/.test(POPUP_NOW), false, "the popup must not write the log into its draft");
});

test("Call Logs answers whether anybody has actually rung this candidate", () => {
  /*
   * The question the **Follow Up** stage exists to ask, and the register could not answer it: a candidate
   * nobody has reached and one who has not answered are different rows, and the only difference was
   * whatever somebody had written in a remark. The studio's call log is one table keyed by the number
   * dialled, so a recruiter's call lands in it exactly as a salesperson's does - it had simply only ever
   * been read from the CRM's own lead popup, where this same tab answers this same question.
   */
  const TAB = src("components", "hrm", "InterviewCallLogsTab.js");
  assert.match(POPUP, /<InterviewCallLogsTab candidate=\{candidate\} \/>/);
  assert.match(POPUP, /\{ id: "calls", label: "Call Logs" \}/);
  // The candidate's id, never a number: a call asking about a number is a way to read the call history
  // of anybody the studio has ever rung.
  assert.match(TAB, /getCandidateCallLogs\(candidate\.id\)/);
  assert.equal(/phone:|number:/.test(TAB.slice(0, TAB.indexOf("const number"))), false, "the tab must not send a number");
  /*
   * Read when the tab is opened rather than with the candidate. Most candidates are never looked at this
   * way, and a record should not wait on the handset integration to be drawn.
   */
  assert.match(TAB, /useState\(null\)/);
  /*
   * Through the table's own loading and empty states rather than a paragraph standing in for the table,
   * so the headings stay put and the tab does not change shape as the answer arrives. `null` is "not read
   * yet", which is what lets the two states say different things.
   */
  assert.match(TAB, /loading=\{calls === null\}/);
  assert.match(TAB, /loadingMessage=\{`Reading the calls on \$\{number\}…`\}/);
  assert.match(TAB, /emptyMessage=\{`No calls recorded on \$\{number\}\.`\}/);
  // The module's own read-only table, not raw markup and not the module table with its import and
  // selection - the same component the CRM's Call Logs tab is drawn with.
  assert.match(TAB, /<SimpleTable/);
});

test("the WhatsApp tab sends to the record's number, and never names one", () => {
  const TAB = src("components", "hrm", "InterviewWhatsAppTab.js");
  assert.match(TAB, /sendCandidateWhatsApp\(candidate\.id, /);
  /*
   * The number is the server's to read. A frontend that sent one would be the route this application
   * deliberately does not have - there is no "send WhatsApp to this number" endpoint, because that is
   * a way to message anybody from a studio number that can be banned for it.
   */
  assert.equal(/phone:|to:/.test(TAB), false, "the tab must not send a number");
  assert.match(TAB, /useSubmitOnce\(\)/);
  // It says which number it will reach, so nobody sends a message to a number they did not mean.
  assert.match(TAB, /whatsappNumber \|\| candidate\?\.phone/);
});

test("a candidate with no number is told before they type, not after", () => {
  const TAB = src("components", "hrm", "InterviewWhatsAppTab.js");
  assert.match(TAB, /No WhatsApp number/);
  // And no compose box at all: a box that cannot send is a box somebody fills in for nothing.
  assert.match(TAB, /if \(!number\) return/);
});

test("Update and Close refuses a Follow Up with no next follow-up date, before anything is sent", () => {
  const popup = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "InterviewCandidatePopup.js"), "utf8");
  const form = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "candidateRecordForm.js"), "utf8");
  // The rule itself: required, and a real day, for Follow Up only.
  assert.match(form, /if \(values\.status === FOLLOW_UP_STATUS\) \{/);
  assert.match(form, /found\.nextFollowUpDate = "Next follow-up date is required for Follow Up stage\.";/);
  assert.match(form, /else if \(!parseDateKey\(date\)\) found\.nextFollowUpDate = "Enter a valid next follow-up date\.";/);
  // Asked inside the save handler, ahead of the remark gate's return and of the write.
  const save = popup.slice(popup.indexOf("async function save("), popup.indexOf("function forward("));
  assert.ok(save.indexOf("const found = validateCandidate(values);") < save.indexOf("await runSave("));
  assert.match(save, /if \(!hasRemark \|\| Object\.keys\(found\)\.length\) \{\s*setErrors\(found\);/);
  // The field is brought into view, and its error shown under it.
  assert.match(save, /followUpField\.current\?\.scrollIntoView\(/);
  assert.match(popup, /<div ref=\{followUpField\}>/);
  assert.match(popup, /error=\{needsFollowUpDate \? errors\.nextFollowUpDate \|\| "" : ""\}/);
});
