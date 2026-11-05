import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { lastWorkingDayFrom, noticePeriodLabel } from "../src/lib/offboardingNotice.mjs";

/*
 * The offboarding form, from HR raising it to the employee agreeing a last working day.
 *
 * Two kinds of check here, as the suite's other dialog tests do it. The arithmetic is imported and
 * run, because the date the employee is shown is the one thing on the screen they will be held to:
 * it is drawn in the browser while the server works it out again, and the two sums have to agree.
 * The wiring is read out of the source, since there is no DOM in this suite.
 *
 * What it is guarding:
 *
 *   - the last working day counts the first day of notice as served, so 30 days from 5 Nov is 4 Dec
 *     and not 5 Dec - the off-by-one that would hand every leaver an extra day;
 *   - the sum never moves with a timezone, because a date-only value put through a local `new Date()`
 *     is the day before west of Greenwich;
 *   - the browser shows the date but never posts it: the server stores its own answer, so a clock
 *     the studio does not control cannot set somebody's last working day;
 *   - the Employee Repository can reach both screens, and hands the dialog `canWrite`;
 *   - the public page is not indexed, and the form reaches the API through a service.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const FORM = read("components", "offboarding", "PublicOffboardingForm.js");
const DIALOG = read("components", "employees", "OffboardingInviteDialog.js");
const REPOSITORY = read("components", "employees", "EmployeeVerificationPage.js");
const PAGE = read("app", "offboarding", "apply", "[token]", "page.js");

test("the last working day counts the first day of notice as served", () => {
  assert.equal(lastWorkingDayFrom("2026-11-05", 30), "2026-12-04");
  assert.equal(lastWorkingDayFrom("2026-11-05", 1), "2026-11-05");
  assert.equal(lastWorkingDayFrom("2026-11-05", 0), "2026-11-05");
});

test("it crosses a month, a year and a leap day without arithmetic of its own", () => {
  assert.equal(lastWorkingDayFrom("2026-01-31", 2), "2026-02-01");
  assert.equal(lastWorkingDayFrom("2026-12-20", 30), "2027-01-18");
  assert.equal(lastWorkingDayFrom("2028-02-28", 3), "2028-03-01");
});

test("a date-only value does not move with the reader's timezone", () => {
  const before = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"]) {
      process.env.TZ = zone;
      assert.equal(lastWorkingDayFrom("2026-11-05", 30), "2026-12-04", zone);
    }
  } finally {
    process.env.TZ = before;
  }
});

test("nothing is answered for an unanswerable question", () => {
  for (const bad of ["", null, undefined, "not a date", "05/11/2026"]) assert.equal(lastWorkingDayFrom(bad, 30), "");
  for (const bad of ["", null, -1, 1.5, "thirty"]) assert.equal(lastWorkingDayFrom("2026-11-05", bad), "");
});

test("the notice period reads as a sentence, singular included", () => {
  assert.equal(noticePeriodLabel(30), "30 days of notice");
  assert.equal(noticePeriodLabel(1), "1 day of notice");
  assert.equal(noticePeriodLabel(0), "0 days of notice");
  assert.equal(noticePeriodLabel("x"), "no notice");
});

test("the form shows the last working day and never sends it", () => {
  /*
   * One answer, one consequence. The employee gives the day they are resigning; the last working day
   * is the notice period counted from it, drawn here so nobody agrees to a date they cannot see and
   * **not editable** - a box would invite two answers to one question, and the browser does not post
   * it at all. Leaving earlier than the notice allows is a conversation with HR, who set the notice
   * period and can change the date on the separation itself.
   */
  assert.match(FORM, /import \{ dayFromToday, lastWorkingDayFrom, noticePeriodLabel \} from "@\/lib\/offboardingNotice\.mjs";/);
  assert.match(FORM, /lastWorkingDayFrom\(form\.resignationDate, noticeDays\)/);
  assert.match(FORM, /label="Resignation date"/);
  // Read-only, and a `TextField` rather than a `DateField`: there is no calendar to open on a value
  // nobody may change.
  assert.match(FORM, /label="Proposed last working day"\s*\n\s*(?:helperText="[^"]*"\s*\n\s*)?readOnly/);
  const payload = FORM.slice(FORM.indexOf("submitOffboardingForm(token, {"), FORM.indexOf("setSubmitted("));
  assert.match(payload, /resignationDate: form\.resignationDate,/);
  assert.doesNotMatch(payload, /proposedLastWorkingDate|lastWorkingDay/);
  // Only one date picker on the whole form, which is the one date it asks for.
  assert.equal((FORM.match(/<DateField/g) || []).length, 1);
});

test("the form asks who it is before it asks anything else, through the service layer", () => {
  assert.match(FORM, /from "@\/services\/hrm\/offboardingForm\.service"/);
  assert.doesNotMatch(FORM, /apiRequest|fetch\(/);
  assert.match(FORM, /onSubmit=\{verify\}/);
  // Bounded either side of today: an open calendar let a mistyped year put a last working day
  // decades out.
  assert.match(FORM, /minDate=\{dayFromToday\(-30\)\}\s*\n\s*maxDate=\{dayFromToday\(90\)\}/);
  // And the seven things the studio already holds are read back rather than asked for.
  for (const label of ["Designation", "Department / Team", "Reporting manager", "Date of joining", "Official email", "Notice period"]) {
    assert.ok(FORM.includes(`["${label}"`), `the form does not show ${label}`);
  }
  assert.match(FORM, /details\.employeeCode/);
  // The reason is picked from HR's own list, which arrives with the form rather than living here.
  assert.match(FORM, /options=\{details\.reasons \|\| \[\]\}/);
});

test("the public page is kept out of the search engines", () => {
  assert.match(PAGE, /robots: \{ index: false, follow: false \}/);
});

test("the Employee Repository can raise one and read the register", () => {
  assert.match(REPOSITORY, /import OffboardingInviteDialog from "\.\/OffboardingInviteDialog";/);
  // The header opens the register, whose Raise a form picks the employee; a row's Resignation Form
  // chooses its own.
  assert.doesNotMatch(REPOSITORY, /Resignation Request/);
  assert.match(REPOSITORY, /onViewOffboarding=\{\(\) => \{ setOffboardingEmployee\(null\); setOffboarding\("list"\); \}\}/);
  assert.match(REPOSITORY, /<OffboardingInviteDialog[\s\S]{0,200}canWrite=\{canWrite\}/);
  assert.doesNotMatch(REPOSITORY, /onResignationRequest/);
  assert.match(REPOSITORY, /className=\{itemClassName\}>HR Offboarding<\/button>/);
  // Approving one puts somebody on the Serving Notice tab of this very table.
  assert.match(REPOSITORY, /onChanged=\{\(\) => void loadEmployees\(\)\}/);
});

test("the dialog composes the shared components rather than typing its own markup", () => {
  assert.match(DIALOG, /from "@\/components\/ui\/Dialog"/);
  assert.match(DIALOG, /<Dropdown/);
  assert.doesNotMatch(DIALOG.replace(/\/\*[\s\S]*?\*\//g, ""), /<(button|input|select|textarea|table)[\s>]/);
});

test("the public form prevents the mistake rather than reporting it", () => {
  // The date is prefilled with today, which is the overwhelmingly common answer, and both required
  // answers say what is wrong **on the field** - a toast is gone by the time somebody re-reads the
  // box, and the button it would have come from was disabled.
  assert.match(FORM, /resignationDate: todayKey\(\)/);
  assert.match(FORM, /error=\{problems\.resignationDate\}/);

  assert.match(FORM, /error=\{problems\.reason\}/);
  assert.match(FORM, /error=\{identifierError\}/);
});

test("a spent link is an ending, not a red failure", () => {
  // A form already sent in is this link's ordinary end. The page reads the server's `state` rather
  // than the wording of its message, and every one of them says what to do next.
  assert.match(FORM, /const sentAlready = dead\.state === "submitted";/);
  assert.match(FORM, /tone=\{sentAlready \? "slate" : "red"\}/);
  assert.match(FORM, /Ask \{brandNameInProse\(branding\)\} HR for a new form/);
  // A 410 arriving mid-form ends the page the same way rather than toasting an unusable box.
  assert.equal((FORM.match(/error\?\.status === 410/g) || []).length, 2);
});

test("the public pages share one frame instead of each drawing its own", () => {
  // The fourth copy of the same centred card and the same notice box, which had already drifted on
  // width and tone. It is a house style rather than any one form's layout.
  assert.match(FORM, /import \{ PublicLayout, PublicNotice \} from "@\/components\/shared\/PublicPageShell";/);
  assert.doesNotMatch(FORM, /function PublicLayout|function Notice\(/);
  const shell = read("components", "shared", "PublicPageShell.js");
  assert.match(shell, /export function PublicLayout\(\{ children, width = "5xl" \}\)/);
  assert.match(shell, /export function PublicNotice\(\{ title, children, tone = "slate" \}\)/);
});

test("HR confirms what cannot be taken back, and sees what it is deciding on", () => {
  // Approving records a resignation and starts a notice period; rejecting is read by the person who
  // sent the form; cancelling kills the link they hold. None of the three fired on one press.
  assert.match(DIALOG, /import ConfirmDialog from "@\/components\/ui\/ConfirmDialog";/);
  assert.match(DIALOG, /setConfirming\(\{ kind: "approve", invite: reviewing \}\)/);
  assert.match(DIALOG, /setConfirming\(\{ kind: "reject", invite: reviewing \}\)/);
  assert.match(DIALOG, /setConfirming\(\{ kind: "cancel", invite \}\)/);
  // A rejection has to say why, and an approval cannot be sent with the hand-over unanswered.
  assert.match(DIALOG, /disabled=\{saving \|\| rejectionNeedsReason\}/);
  assert.match(DIALOG, /disabled=\{saving \|\| handOverMissing\}/);
  // The letter they attached is shown, which was approving a resignation unseen - and it is part of
  // the one description of a form that both View and Review draw.
  assert.match(DIALOG, /function OffboardingFormFacts\(\{ invite \}\)/);
  assert.match(DIALOG, /invite\.letterUrl/);
  assert.match(DIALOG, /<OffboardingFormFacts invite=\{reviewing\} \/>/);
  // What is pending is named, not only counted.
  assert.match(DIALOG, /const pendingKinds = useMemo/);
  // The clipboard goes through the helper that works on plain http, and says so when it cannot.
  assert.match(DIALOG, /import \{ copyToClipboard \} from "@\/lib\/clipboard";/);
  assert.match(DIALOG, /Select the link and copy it yourself/);
  // The register holds its size, and the create screen is the dialog's own form.
  assert.match(DIALOG, /size=\{isList \? "full" : "md"\}/);
  assert.match(DIALOG, /height=\{isList \? "tall" : "auto"\}/);
  assert.match(DIALOG, /onSubmit=\{screen === "create" \? raise : undefined\}/);
});

test("every message the flow sends is the studio's words, written in Settings", () => {
  /*
   * Four messages, and all four used to be sentences in a component - or, in the sent screen's
   * case, no sentences at all: a bare link in a read-only box, leaving whoever sent it to write
   * what the link was, how long the notice ran, and that nothing changed until HR confirmed, every
   * single time. A resignation is the correspondence a studio most wants in its own voice, and two
   * of these are what somebody is told about their own exit.
   *
   * Each falls back to the wording here through `renderMessageOr`, so a studio that has not written
   * one - or a reader whose permissions do not reach the template - still gets a usable message
   * rather than an empty box.
   */
  assert.match(DIALOG, /import useMessageTemplate from "@\/components\/shared\/useMessageTemplate";/);
  assert.match(DIALOG, /import \{ renderMessageOr \} from "@\/lib\/messageTemplate\.mjs";/);
  /*
   * All four are read here. The **reminder** came back as Send reminder on WhatsApp on an open form's
   * row (the studio's choice, with every offboarding message now sendable); Copy reminder message
   * and Email the form stay off the row menu.
   */
  for (const key of ["EMPLOYEE_OFFBOARDING_FORM", "EMPLOYEE_OFFBOARDING_REMINDER", "EMPLOYEE_OFFBOARDING_APPROVED", "EMPLOYEE_OFFBOARDING_NOT_ACCEPTED"]) {
    assert.match(DIALOG, new RegExp(`useMessageTemplate\\("${key}"\\)`), key);
  }
  // The sent screen is the message, through the control the onboarding invite hands its own over
  // with - not a link in a box.
  assert.match(DIALOG, /import ShareableMessage from "@\/components\/shared\/ShareableMessage";/);
  assert.match(DIALOG, /<ShareableMessage label="Message to send them" rows=\{10\} message=\{formMessage\} onTextChange=\{setFormText\} \/>/);
  /*
   * And the sent screen is **only** that, as the onboarding invite's success screen is: the message
   * with its own Copy, and Close. The form was raised the moment the screen appeared, so there is
   * nothing further to do to it here - emailing it and copying the bare link belong to the
   * register's row menu, where they are there for every form rather than only the one just raised.
   */
  const sent = DIALOG.slice(DIALOG.indexOf('{screen === "sent" && raised && <div'), DIALOG.indexOf("{isList && register}"));
  assert.ok(sent.includes("ShareableMessage"), "the slice is the sent screen");
  assert.doesNotMatch(sent, /<Button/);
  // Its Send WhatsApp sits in the footer beside Close, as the onboarding invite's does.
  assert.match(DIALOG, /\{screen === "sent" && raised && canSendMessage\("EMPLOYEE_OFFBOARDING_FORM"\) && <SendWhatsAppButton/);
  assert.doesNotMatch(DIALOG, /Back to forms|Copy the link alone|Email it to them/);
  // And the other three are offered from the row whose state is owed them.
  assert.match(DIALOG, /label: "Copy confirmation message"/);
  assert.match(DIALOG, /label: "Copy the refusal message"/);
});

test("the four templates are in Settings, with their placeholders described", () => {
  const panel = read("components", "settings", "MessageTemplatePanel.js");
  const overlay = read("components", "settings", "SettingsOverlay.js");
  const PLACEHOLDERS = {
    EMPLOYEE_OFFBOARDING_FORM: ["employee name", "offboarding link", "notice period", "expiry date"],
    EMPLOYEE_OFFBOARDING_REMINDER: ["employee name", "offboarding link", "notice period", "expiry date"],
    EMPLOYEE_OFFBOARDING_APPROVED: ["employee name", "notice start date", "last working day", "notice period"],
    EMPLOYEE_OFFBOARDING_NOT_ACCEPTED: ["employee name", "hr remark"],
  };
  for (const [key, names] of Object.entries(PLACEHOLDERS)) {
    // Described in the panel, because a placeholder nobody explains is one nobody uses.
    const at = panel.indexOf(`${key}: {`);
    assert.ok(at > 0, `${key} has no placeholder list in the Settings panel`);
    const block = panel.slice(at, panel.indexOf("\n  },", at));
    for (const name of names) assert.ok(block.includes(name), `${key} does not describe {${name}}`);
    // And reachable: a section of its own in Settings → Message Template.
    assert.match(overlay, new RegExp(`templateKey="${key}"`), key);
  }
  // Each section's unsaved edits answer from the shared ref, like the message panels beside them.
  for (const id of ["form", "reminder", "approved", "not-accepted"]) {
    assert.match(overlay, new RegExp(`"message-employee-offboarding-${id}": messageTemplateUnsavedRef`), id);
  }
});

test("every field is read the way its own component hands the answer over", () => {
  /*
   * `TextAreaField` spreads its props straight onto the `<textarea>`, so its `onChange` carries the
   * **event** - the same contract as `TextField`. All three of these boxes were written as if it
   * passed a value, so each one stored the event object: the field showed "[object Object]" and
   * could not be typed in, because every keystroke wrote the same object back.
   *
   * `Dropdown`, `DateField` and `FileUploadField` do hand over a value (a list, for the last one).
   * Nothing checked the difference, so this does: a mixed-up handler is a dead field, which no
   * amount of reading the diff reliably catches.
   */
  for (const [name, source] of [["the public form", FORM], ["the HR dialog", DIALOG]]) {
    // Every text box in these two screens reads `event.target.value`.
    for (const tag of source.match(/<(TextField|TextAreaField)\b[\s\S]*?\/>/g) || []) {
      if (!tag.includes("onChange")) continue;
      assert.match(tag, /onChange=\{\(event\)/, `${name} reads a text box's answer as a value: ${tag.slice(0, 80)}`);
      assert.match(tag, /event\.target\.value/, `${name}: ${tag.slice(0, 80)}`);
    }
  }
  // And the value-passing controls are read as values.
  assert.match(FORM, /<DateField[\s\S]{0,400}onChange=\{\(value\)/);
  assert.match(FORM, /value=\{form\.letter\}\s*\n\s*onChange=\{\(value\) => setForm/);
  assert.match(DIALOG, /options=\{employeeOptions\}\s*\n\s*value=\{draft\.employeeId\}\s*\n\s*onChange=\{\(value\)/);
  // `TextAreaField` has no `note` prop, so a note goes beside it rather than onto the element.
  const areas = DIALOG.match(/<TextAreaField[\s\S]*?\/>/g) || [];
  for (const area of areas) assert.doesNotMatch(area, /\bnote=/);
});

test("a form that is nearly right goes back for a correction, not into a refusal", () => {
  /*
   * The onboarding invite's Send Back, at the other end of the employment. Rejecting tells somebody
   * their resignation was not accepted; this tells them which answer to change, on the same link,
   * with everything they filled in still on it.
   */
  assert.match(DIALOG, /sendBackOffboardingInvite,/);
  assert.match(DIALOG, />Send back<\/Button>/);
  // The same required remark a rejection needs, because the employee is being asked to change
  // something and has to be told what.
  assert.match(DIALOG, /disabled=\{saving \|\| rejectionNeedsReason\}[\s\S]{0,200}kind: "sendBack"/);
  // It confirms first, and says plainly that it is not a refusal.
  assert.match(DIALOG, /Send this form back\?/);
  assert.match(DIALOG, /Their resignation is not refused/);
  // A refused email is a warning beside a success: the form is already open again.
  assert.match(DIALOG, /if \(response\?\.warning\)/);
  // The reopened state is its own status, so the register says which forms have been round once.
  assert.match(DIALOG, /"Sent Back": "bg-violet-500"/);
  assert.match(DIALOG, /invite\.sentBackAt \? \[\["Sent back on"/);

  // And the employee's form comes back as an **edit**: their answers prefilled, HR's remark at the
  // top, and the letter they already attached named rather than silently required again.
  assert.match(FORM, /const answers = verified\?\.answers;/);
  assert.match(FORM, /reason: answers\.reason \|\| "",/);
  assert.match(FORM, /HR has asked you to correct something/);
  assert.match(FORM, /your resignation has not been refused/);
  assert.match(FORM, /details\.answers\?\.letterFileName/);
});

test("the form carries no advice it does not need", () => {
  /*
   * Two things the studio asked to lose, and neither was earning its place.
   *
   * The read-only last working day explained its own arithmetic underneath ("30 days of notice
   * counted from the day you are resigning") - a sentence under a figure nobody can change, on the
   * one screen where the reader already knows why they are leaving.
   *
   * And "Not <name>? Start again" put a way back on a page reached by a personal link, for a case
   * that barely happens; with it goes the unsaved-edits guard that existed only to ask before it
   * cleared the boxes.
   */
  const dateField = FORM.slice(FORM.indexOf('label="Proposed last working day"'));
  assert.doesNotMatch(dateField.slice(0, 300), /note=/);
  assert.doesNotMatch(FORM, /Start again|useUnsavedGuard|confirmProps|ConfirmDialog/);
});

test("every one of a row's actions is in its own ⋮, and nowhere else", () => {
  /*
   * One home for what can be done to a form. A banner over the table announcing the queue, and a
   * row that opened its review when pressed, were two more answers to "where do I do this" than the
   * screen needs - and neither is where somebody who has used the register beside this one looks.
   */
  assert.doesNotMatch(DIALOG, /waitingForReview|waiting for your review|onRowClick/);
  // View on every row, because a decided form is history and still worth reading; Edit while it is
  // still open. No Review here: a submitted form is reviewed from Pending → HR Offboarding Pending.
  assert.match(DIALOG, /items\.push\(\{ label: "View", onSelect: \(\) => setViewing\(invite\) \}\);/);
  assert.doesNotMatch(DIALOG, /items\.push\(\{ label: "Review"/);
  assert.match(DIALOG, /\["Sent", "Verified", "Sent Back"\]\.includes\(invite\.status\)\) \{\s*\n\s*items\.push\(\{ label: "Edit form"/);
  // All three decisions live in the review, each behind its own confirm.
  for (const label of [">Approve<", ">Send back<", ">Reject<"]) assert.ok(DIALOG.includes(label), label);
  // And nothing compares the proposed day with a notice end any more: they are one date.
  assert.doesNotMatch(DIALOG, /earlyBy|noticeEndsOn|Notice period ends/);
});

test("the row menu offers only what the studio asked it to", () => {
  /*
   * Pruned on purpose. **Copy reminder message** and **Email the form** are gone: the studio hands
   * the form over itself, from the message Settings words and the link beside it, so a second way to
   * send the same thing was two answers to one question. What is left is look at it, decide it,
   * correct it, copy its link, tell somebody the decision, and call it off.
   */
  assert.doesNotMatch(DIALOG, /Copy reminder message|Email the form|Emailing\.\.\./);
  // And nothing is left behind that only those two used. The reminder's wording is read again for
  // Send reminder on WhatsApp, which the studio asked for afterwards.
  assert.doesNotMatch(DIALOG, /emailForm|sendOffboardingInviteEmail/);
  assert.match(DIALOG, /label: "Send reminder on WhatsApp"/);
  const service = read("services", "hrm", "offboarding-invites.service.js");
  assert.doesNotMatch(service, /export function sendOffboardingInviteEmail/);
  // The two messages a decided form is owed stay, since telling somebody is a separate act from
  // deciding.
  assert.match(DIALOG, /label: "Copy confirmation message"/);
  assert.match(DIALOG, /label: "Copy the refusal message"/);
  assert.match(DIALOG, /label: "Copy link"/);
});

test("a row's menu opens above the dialog it belongs to", () => {
  /*
   * The ⋮ was there and did nothing: `OptionsMenu` portals its menu to the body, so it is a sibling
   * of the dialog rather than a child, and its default `z-[60]` painted every row's actions behind
   * the dialog's own `z-[100]` card. The menu was open and underneath it the whole time.
   *
   * `menuOverPanel` is the scale's answer for a menu inside a dialog, and it is what the onboarding
   * invite table passes for exactly this reason - which is why this is pinned rather than left to be
   * noticed again.
   */
  assert.match(DIALOG, /import \{ layers \} from "@\/constants\/layers";/);
  assert.match(DIALOG, /<OptionsMenu[^>]*menuZIndexClassName=\{layers\.menuOverPanel\}/);
  // The table's own menus - Manage Columns, the filter lists - are portalled too.
  assert.match(DIALOG, /ariaLabel="Resignation forms"[\s\S]{0,300}menuZIndexClassName=\{layers\.menuOverPanel\}/);
  // And all four dialogs those entries open - View, Edit, Review and the confirm step - sit above
  // the menu that opened them.
  assert.equal((DIALOG.match(/layer="dialogOverPanel"/g) || []).length, 4);
});

test("editing a form changes the two answers HR gave, and never its link or its subject", () => {
  /*
   * A notice period typed wrongly is worth correcting on the form rather than cancelling it.
   *
   * Not who it is for: a form raised against the wrong person is cancelled and raised again, or the
   * employee already emailed the link ends up holding one that names somebody else. And not after it
   * has been filled in - changing the notice period then would move a last working day they have
   * already been shown, which is what Send back is for.
   */
  assert.match(DIALOG, /updateOffboardingInvite,/);
  assert.match(DIALOG, /updateOffboardingInvite\(editing\.id, \{ noticePeriodDays: days, hrNote: editDraft\.hrNote\.trim\(\) \|\| null \}\)/);
  assert.match(DIALOG, /The link does not change, so the one they already have keeps working\./);
  const edit = DIALOG.slice(DIALOG.indexOf("{editing && <Dialog"), DIALOG.indexOf("The step in front of the three writes"));
  assert.doesNotMatch(edit, /employeeId|<Dropdown/);
  assert.match(edit, /changing it changes the date they will be shown/);
});

test("a leaver's work is handed over from their InActive row, not when they resign", () => {
  /*
   * The other half of the deferral. Somebody serving notice keeps their work - they are in tomorrow
   * to do it - so the hand-over is an action on the row of somebody who has **gone**, beside Move to
   * Active, and it reuses the pop-up the immediate offboardings already ask through.
   */
  const table = read("components", "employees", "EmployeeTable.js");
  assert.match(table, /onHandOverWork && !isWorking\(employee\) && !isOnboarding\(employee\)/);
  assert.match(table, /label: "Hand Over Pending Work"/);
  // Beside Move to Active, which is the other thing that row offers.
  assert.ok(table.indexOf('label: "Move to Active"') < table.indexOf('label: "Hand Over Pending Work"'));

  const page = read("components", "employees", "EmployeeVerificationPage.js");
  assert.match(page, /import HandOverDialog from "\.\/HandOverDialog";/);
  assert.match(page, /onHandOverWork: canWrite \? openHandOver : undefined/);
  // What they hold is read first, so the pop-up names the work - and a leaver holding nothing says
  // so instead of opening a dialog with an empty list.
  assert.match(page, /if \(!pending\?\.total\) \{ showSuccess\(/);
  assert.match(page, /handOverPendingWork\(handOverTarget\.employee\.id, \{ toEmployeeId: Number\(toEmployeeId\) \}\)/);
  // The repository is reloaded, since the work that moved is on rows this table draws.
  assert.match(page, /showSuccess\(`\$\{handOverTarget\.employee\.employeeName\}'s pending work was reassigned\.`\);\s*\n\s*await loadEmployees\(\);/);
});


test("the register's Status is the leaver's stage, and its two days read as days", () => {
  assert.match(DIALOG, /\["stage", "Status", "status", 150, 130\],/);
  assert.match(DIALOG, /\["resignationDay", "Resignation date", "date", 170, 150\],/);
  assert.match(DIALOG, /\["lastWorkingDay", "Proposed last day", "date", 180, 150\],/);
  assert.match(DIALOG, /"Serving Notice": "bg-amber-600",/);
  assert.match(DIALOG, /Withdrawn: "bg-slate-400",/);
  assert.match(DIALOG, /stage: invite\.stage \|\| invite\.status,/);
  assert.match(DIALOG, /statusOf=\{\(invite\) => invite\.stage\}/);
});

test("the register can be ticked and Select All'd, to export, and deleted - a row or the ticked rows - by a writer", () => {
  assert.match(DIALOG, /const bulk = useTableSelection\(\{\n\s+prefix: "\/api\/hrm\/offboarding-invites",\n\s+rows: registerRows,\n\s+noun: "resignation form",\n\s+canDelete: canWrite,/);
  assert.match(DIALOG, /items\.push\(\{ label: "Delete", tone: "danger", disabled: busyId === invite\.id, onSelect: \(\) => setConfirming\(\{ kind: "delete", invite \}\) \}\);/);
  assert.match(DIALOG, /if \(confirming\.kind === "delete"\) \{ const invite = confirming\.invite; setConfirming\(null\); void remove\(invite\); return; \}/);
  assert.match(DIALOG, /infiniteScroll: \{ pageSize: 50 \}, selection: bulk\.selection \}\}/);
});

test("a submitted resignation is reviewed from Pending → HR Offboarding Pending, straight into its Review", () => {
  // The employee's row ⋮ Review Resignation opens that employee's submitted form's Review alone.
  assert.match(REPOSITORY, /const reviewResignation = useCallback\(\(employee\) => \{ setOffboardingEmployee\(employee\); setOffboarding\("review"\); \}, \[\]\);/);
  assert.match(DIALOG, /const reviewOnly = mode === "review";/);
  assert.match(DIALOG, /invite\.status === "Submitted"\);\n\s+if \(submitted\) \{ [^\n]*setReviewing\(submitted\); return; \}/);
  assert.match(DIALOG, /const endReview = useCallback\(\(\) => \{ setReviewing\(null\); if \(reviewOnly\) onClose\?\.\(\); \}/);
  // The Board decides nothing by a drop either: only an open form dropped on Cancelled.
  assert.match(DIALOG, /const canDropAt = \(invite, to\) => canWrite && OPEN_STATUSES\.includes\(invite\.status\) && to === "Cancelled"/);
});


test("HR Offboarding is the ⋮ menu's popup, not a tab of User Management", () => {
  assert.doesNotMatch(REPOSITORY, /label: "HR Offboarding List"/);
  assert.match(REPOSITORY, /className=\{itemClassName\}>HR Offboarding<\/button>/);
  assert.doesNotMatch(DIALOG, /\binline\b = false|onCount/);
});
