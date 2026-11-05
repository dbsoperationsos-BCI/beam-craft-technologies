"use client";

import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import CloseButton from "@/components/shared/CloseButton";
import DateField from "@/components/shared/DateField";
import HelpTip from "@/components/shared/HelpTip";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import useEscapeKey from "@/components/shared/useEscapeKey";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { isCompletePhoneNumber } from "@/lib/phoneNumber";
import { buildCandidateContext, candidatePayload, validateCandidate } from "@/components/hrm/candidateRecordForm";
import SchemaFormField, { visibleFields } from "@/components/schema-form/SchemaFormFields";
import InterviewTranscriptsTab from "@/components/hrm/InterviewTranscriptsTab";
import InterviewCallLogsTab from "@/components/hrm/InterviewCallLogsTab";
import InterviewRemarksTab from "@/components/hrm/InterviewRemarksTab";
import InterviewStatusPills from "@/components/hrm/InterviewStatusPills";
import InterviewWhatsAppTab from "@/components/hrm/InterviewWhatsAppTab";
import interviewInfoFormatters from "@/components/hrm/interviewInfoFormatters";
import { getDuplicateCandidates, updateCandidate } from "@/services/hrm/interview.service";
import {
  CANDIDATE_STATUSES,
  DEFAULT_CANDIDATE_STATUS,
  FOLLOW_UP_STATUS,
  FORM_PENDING_STATUS,
  FORM_SUBMITTED_STATUS,
  INTERVIEW_SCHEDULED_STATUS,
  ON_HOLD_STATUS,
  ONBOARDED_STATUS,
  candidateFormSections,
  candidateFormValues,
  candidateStatusStyles,
} from "@/constants/interviewConfig";

/**
 * The stages that have a **next** - so the date is asked for where it means something, and cleared
 * where it does not. Choosing Rejected on a candidate who was being chased should not leave a call
 * booked with somebody who has been turned down.
 */
/**
 * The card's three tabs, as data for `ui/Tabs` - the same tab bar every other table in this
 * application filters itself with, so the size, the selected colour and the tab semantics are decided
 * in one place rather than written out again here.
 */
const POPUP_TABS = [
  { id: "remarks", label: "Remarks" },
  { id: "activity", label: "Activity Logs" },
  { id: "calls", label: "Call Logs" },
  // Beside the calls, because it is the same calls one level deeper: what was actually said.
  { id: "transcripts", label: "Transcripts" },
  { id: "whatsapp", label: "WhatsApp" },
];

const STATUSES_WITH_FOLLOW_UP = [DEFAULT_CANDIDATE_STATUS, FOLLOW_UP_STATUS, ON_HOLD_STATUS];

/**
 * The stages that are **consequences of an act**, and the act each one is a consequence of.
 *
 * A candidate is at Form Submission Pending because a form went out, at Interview Scheduled because a
 * round is in the diary, at Onboarded because an invite was raised. Ticking one by hand puts them in
 * a tab whose entire meaning is that something exists which does not - and that tab is then worked by
 * somebody looking for an interview nobody booked. So choosing one of these offers the act instead:
 * the record is saved and the act's own form opens on it directly - see `forward` - and the act writes
 * the stage.
 *
 * **No question asked first.** It used to be: a small dialog asked "save this candidate and send
 * them one?" before the same form `forward` already opens, which meant confirming the same thing
 * twice for one press - the small dialog said what was about to happen, and then the form that
 * actually did it opened behind it anyway. Picking the pill *is* the confirmation; the form's own
 * Cancel is the way out, back to this popup exactly as it was, and its own success is what closes
 * both.
 *
 * `handler` picks the prop out of the popup's own props, so a stage whose act this viewer may not
 * perform - onboarding is `HRM / Employee Management`, which the page only passes when it is held -
 * comes back without one and the pill is refused rather than opening nothing.
 */
const STATUS_ACTS = {
  [FORM_PENDING_STATUS]: { handler: (props) => (props.formSubmitted ? props.onResendApplicationForm : props.onSendApplicationForm) },
  [INTERVIEW_SCHEDULED_STATUS]: { handler: (props) => props.onScheduleInterview },
  [ONBOARDED_STATUS]: { handler: (props) => props.onOnboard },
};

/**
 * One screen where a candidate is worked.
 *
 * The register could be **read** and not worked. A double-click opened a panel with no boxes and no
 * save, and everything a recruiter actually does to a candidate was scattered across the row's ⋮: one
 * dialog to correct the record, another to take a decision, a third to schedule, a fourth to send the
 * screening form. The CRM solved the same problem years ago with `LeadPopupModal` — one screen where
 * a person is read, corrected, noted, moved and messaged, and nobody leaves it to do the next thing.
 * This is that screen, asked of a candidate.
 *
 * **Dumb, like the lead popup.** It takes the candidate and the handlers and holds no record state
 * beyond the draft it is editing; it fetches nothing. `InterviewPage` supplies everything, which is
 * what lets one component serve the double-click and the ⋮ without either of them being a second
 * editor for the same record.
 *
 * ── What the candidate answered, not every field there is ──
 *
 * The left pane opens on the fields the candidate **filled in**, grouped as the application's own
 * sections. Thirty-nine boxes in one scroll is not a record of a person, it is a search through one,
 * and an empty field says nothing about them. The empty ones are one press away, because a review of
 * a submitted application sometimes has to fill one in.
 *
 * ── The stage is chosen here, and what it needs is asked here ──
 *
 * The lead popup's Follow-up Details card, asked of a candidate. The stage is the words themselves,
 * and directly under the pills is whatever that stage needs: Follow Up asks when, and a decision is
 * answered by the remark the footer already requires. Nothing opens a second dialog to ask a question
 * that fits under the pill which raised it.
 *
 * The exception is the three stages that are consequences of an act — see `STATUS_ACTS`. Choosing one
 * of those saves the record and opens the act's own form directly, over this popup, which stays open
 * underneath: Cancel on that form returns here with nothing else to answer for, and the form's own
 * success is what closes both. Form Submitted is refused outright — that stage is the candidate
 * answering, and nobody here can answer for them.
 *
 * ── Why a remark is required before Update ──
 *
 * The CRM's rule, and the reason its remark log is worth reading: an update with no note is a record
 * that changed for reasons living in whoever pressed the button. An unsent note counts, because
 * refusing somebody for the words on screen in front of them is the wrong lesson to teach.
 */
export default function InterviewCandidatePopup({
  candidate,
  options = {},
  canWrite = true,
  formSubmitted = false,
  review = false,
  onClose,
  /** The finishing save: the page shows the notice, re-reads the register and closes this. */
  onSaved,
  /*
   * Something was written **without** finishing - a remark posted, a WhatsApp message sent. The page
   * shows the notice and catches the register up, and the popup stays: somebody noting what was said
   * on a call is not done with the record they are noting it on.
   */
  onRecordChanged,
  /*
   * A refusal that is not about any one field - there is no remark to say why this record changed - so
   * it is said in the application's own snackbar rather than as a banner above the form. A banner
   * pushed the record down the screen and stayed there to be re-read; on a phone it was the only thing
   * visible. See `FloatingNotice`.
   */
  onError,
  onResendApplicationForm,
  onSendApplicationForm,
  onScheduleInterview,
  onOnboard,
}) {
  /*
   * The draft starts from the **whole record**, not from the fields drawn below.
   *
   * `PUT /candidates/:id` is deliberately not partial: it validates the whole record and writes every
   * key it is handed. A draft built from this popup's own fields would therefore blank `campaignName`,
   * `sourceRowId`, `attachments` and every other column nothing here draws, on the very first save.
   */
  const [values, setValues] = useState(() => candidateFormValues(candidate));
  /*
   * The record as last **written**, which is not the prop once a save has happened and the popup has
   * stayed open - which is what scheduling and sending the screening form now both do.
   *
   * Against the prop, everything already saved still counted as unsaved: Discard asked "Close without
   * saving?" about changes written a moment earlier, and the Activity Logs tab showed the log as it was
   * before the remark that had just been posted. Seeded from the prop, replaced by whatever comes back.
   */
  const [record, setRecord] = useState(candidate);
  const [errors, setErrors] = useState({});
  const { busy: saving, run: runSave } = useSubmitOnce();

  /*
   * The pickers, the custom controls and the fallbacks - see `candidateRecordForm`. Not `{ options }`:
   * these sections draw four controls that are not boxes and eleven lists that have to carry whatever
   * this candidate already holds, or an edit blanks a source a sheet stamped.
   */
  const context = useMemo(() => buildCandidateContext({ options, candidate }), [options, candidate]);

  /*
   * ── Somebody the register already holds ──────────────────────────────────────────────────────
   *
   * Ported from the record panel this popup replaces, unchanged in behaviour, because the rule is
   * worth more here: this is now the only screen on which a candidate's number is corrected, so it is
   * the only place the warning can appear at all.
   *
   * Asked of a number only once it is whole - `isCompletePhoneNumber` is the same test the CRM's Add
   * Lead uses - so nothing is asked on the way to typing one and no warning appears against the first
   * four digits. Debounced, and the answer is held **with the value it was asked about**, so a reply
   * landing after the field has been edited is worth nothing rather than warning about a number nobody
   * is looking at. A check that will not answer is not a clash: the form stays usable and the save is
   * never held up by a network having a moment, because the server refuses a real duplicate anyway.
   */
  const [clash, setClash] = useState(null);
  const phone = String(values.phone || "").trim();
  const email = String(values.email || "").trim();
  useEffect(() => {
    const askPhone = isCompletePhoneNumber(phone) ? phone : "";
    const askEmail = email.includes("@") ? email : "";
    if (!askPhone && !askEmail) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getDuplicateCandidates({ phone: askPhone, email: askEmail, excludeId: candidate?.id || "" })
        .then((response) => {
          if (cancelled) return;
          const found = response?.data?.candidates || [];
          setClash(found.length ? { phone: askPhone, email: askEmail, candidates: found } : null);
        })
        .catch(() => {});
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [phone, email, candidate?.id]);

  /**
   * The warning under each field, or nothing - `{ phone?: "...", email?: "..." }`.
   *
   * Built from the answer only where it still describes what is in the field, and split by what
   * actually matched: a clash found on the email belongs under Email, not under Phone Number.
   */
  const clashNotes = useMemo(() => {
    if (!clash || clash.phone !== phone || clash.email !== email) return undefined;
    const notes = {};
    for (const key of ["phone", "email"]) {
      const matchedBy = key === "phone" ? "phone number" : "email";
      const found = clash.candidates.filter((entry) => entry.matchedBy === matchedBy);
      // Named, because "already on the register" with nothing else leaves somebody searching
      // thousands of rows for a record they cannot see.
      if (found.length) {
        notes[key] = `Already on the register: ${found.map((entry) => [entry.candidateCode, entry.name].filter(Boolean).join(" ")).join(", ")}`;
      }
    }
    return Object.keys(notes).length ? notes : undefined;
  }, [clash, phone, email]);

  /*
   * How many others share this number or address, for the header - the lead popup's "Enquired : N
   * times" asked of a candidate. Read off the same answer the field warnings use, so the count and the
   * warnings can never disagree.
   */
  const alsoApplied = clash?.candidates?.length || 0;

  const [tab, setTab] = useState("remarks");

  /*
   * ── Which fields the pane draws ───────────────────────────────────────────────────────────────
   *
   * The names this candidate has an answer for, read off the **record as it arrived** rather than off
   * the draft. Off the draft, a field cleared while typing would disappear from under the cursor;
   * off the record, the set is fixed for as long as the popup is open, which is what lets somebody
   * empty a box and put something else in it.
   */
  const answered = useMemo(() => {
    const arrived = candidateFormValues(candidate);
    const filled = (value) => (Array.isArray(value) ? value.length > 0 : String(value ?? "").trim() !== "");
    return new Set(Object.keys(arrived).filter((name) => filled(arrived[name])));
  }, [candidate]);
  const [showAll, setShowAll] = useState(false);

  /** The composer's own post, so an unsent draft that satisfied the gate is actually written. */
  const remarkCommit = useRef(null);

  /** The card's scrolling pane, so a refusal can put the box it is asking for back on screen. */
  const cardPane = useRef(null);
  // The Next Follow-up field, brought into view when the save is refused for it.
  const followUpField = useRef(null);

  /**
   * Bring the remark box into view to be written in.
   *
   * `setTab` alone is not enough and no longer was the moment the box stopped being pinned: Remarks is
   * the tab the card **opens** on, so asking for it again is usually a no-op, and the box is the first
   * thing in a pane the reader has very likely scrolled down through. Refusing a save for a box that is
   * off the top of the pane reads exactly like the button doing nothing - which is the thing these two
   * call sites were written to prevent.
   */
  function revealRemarkBox() {
    setTab("remarks");
    // After the tab has rendered, or the pane being scrolled is the one on the way out.
    requestAnimationFrame(() => {
      cardPane.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      cardPane.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /*
   * Two ways the gate is satisfied, and both count: a remark already posted during this sitting, and
   * one typed and not yet sent. The second is what stops the form refusing somebody for the note in
   * front of them.
   */
  const [remarkAdded, setRemarkAdded] = useState(false);
  const [remarkDraftFilled, setRemarkDraftFilled] = useState(false);

  function change(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  }

  /*
   * ── Closing asks, once there is something to lose ────────────────────────────────────────────
   *
   * This matters more here than on any other screen in the register, because of how the popup is
   * reached. A **double-click** opens it, and a double-click is easy to trigger by accident - a slow
   * second click on a row somebody meant to select. That is precisely why the double-click used to
   * open a read-only panel. Now that it opens a live form, the guard is what makes that safe: an
   * accidental open closes on one press, and one with typing in it asks first.
   *
   * Compared against the record as it arrived rather than against a flag, so a field typed into and
   * then typed back out of is not an unsaved change.
   */
  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(candidateFormValues(record)),
    [values, record],
  );
  const { guard: guardClose, confirmProps: closeConfirmProps } = useUnsavedGuard(dirty, {
    title: "Close without saving?",
    message: "The changes typed here are discarded. The candidate stays exactly as it was.",
    confirmLabel: "Discard changes",
    cancelLabel: "Keep editing",
  });
  const requestClose = () => { if (!saving) guardClose(() => onClose?.()); };

  // Through the shared arbiter, so a dropdown open inside the popup takes the press first rather than
  // one key closing both.
  useEscapeKey(requestClose);

  const hasRemark = remarkAdded || remarkDraftFilled;
  // Set by a refused save; gone the moment a remark is typed or posted.
  const [remarkAsked, setRemarkAsked] = useState(false);
  const remarkError = remarkAsked && !hasRemark ? "Add a remark saying why this changed." : "";

  /**
   * The write itself, shared by Update and by the three forward actions below.
   *
   * Returns the saved candidate, or `null` where it refused - the callers need to know, because each
   * of them opens a dialog against the record and must not open it against details that were not
   * written.
   */
  async function persist() {
    const found = validateCandidate(values);
    setErrors(found);
    if (Object.keys(found).length) return null;
    try {
      const response = await updateCandidate(candidate.id, candidatePayload({ values, candidate }));
      const saved = response?.data || null;
      // The new baseline, so what has been written stops counting as unsaved.
      if (saved) setRecord(saved);
      return saved;
    } catch (error) {
      setErrors({ form: error?.data?.message || error?.message || "Unable to update this candidate." });
      return null;
    }
  }

  async function save({ closeAfter = true } = {}) {
    if (!canWrite) return;
    /*
     * Every field the save would be refused for, asked before anything is sent - so a Follow Up with
     * neither a remark nor a date says both at once rather than one at a time. The remark is asked
     * the way it always was; a field error lands under its field.
     */
    const found = validateCandidate(values);
    if (!hasRemark || Object.keys(found).length) {
      setErrors(found);
      if (!hasRemark) {
        setRemarkAsked(true);
        onError?.(markedFieldsMessage(1 + Object.keys(found).length));
        // The box being asked for, brought into view: being refused for something you cannot see reads as
        // a button that does nothing.
        revealRemarkBox();
      } else if (found.nextFollowUpDate) {
        followUpField.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        followUpField.current?.querySelector("button, input")?.focus({ preventScroll: true });
      }
      return;
    }
    await runSave(async () => {
      const saved = await persist();
      if (!saved) return;
      /*
       * The record first, then the note - so the note is logged against the stage this save just
       * moved the candidate to rather than against the one they were leaving. A note that will not
       * post stops the close: the save stands, and the composer is showing why the note did not.
       */
      if (!(await remarkCommit.current?.())) { revealRemarkBox(); return; }
      onSaved?.(saved, `${saved.candidateCode || candidate.name || "The candidate"} updated.`);
      if (closeAfter) onClose?.();
    });
  }

  /*
   * ── The three forward actions save the record first ───────────────────────────────────────────
   *
   * Sending the screening form, resending it and scheduling a round all raise something **against**
   * this candidate's details, so the details have to be written before the dialog opens: a link
   * raised against what was last saved rather than what is on screen is a link carrying a number
   * somebody has just corrected. A refused save opens nothing - the error is already on the field.
   *
   * No remark is required for these, unlike Update. They are acts with their own record - an invite,
   * a calendar event - rather than an edit whose reason would otherwise be lost.
   */
  function forward(handler) {
    return () => void runSave(async () => {
      const saved = await persist();
      if (saved) handler?.(saved);
    });
  }

  /*
   * ── Choosing a stage ──────────────────────────────────────────────────────────────────────────
   *
   * Two kinds of answer. A stage the studio simply *decides* is drafted and written by Update, with
   * the remark as its reason. A stage that is a consequence of an act asks for the act, and the act
   * writes it - see `STATUS_ACTS`.
   */
  const actFor = (status) => {
    const act = STATUS_ACTS[status];
    if (!act) return null;
    const handler = act.handler({ formSubmitted, onResendApplicationForm, onSendApplicationForm, onScheduleInterview, onOnboard });
    return handler ? { ...act, status, handler } : null;
  };

  function chooseStatus(next) {
    if (!canWrite || next === values.status) return;
    const act = actFor(next);
    // Straight to the act's own form - no question first, see `STATUS_ACTS`. Picking the pill is
    // the confirmation; `forward` is the same save-then-open the popup's own action buttons use.
    if (act) { forward(act.handler)(); return; }
    change("status", next);
    // The date goes with the stage that had a next. A rejected candidate carrying a booked call is a
    // row somebody rings to say nothing to.
    if (!STATUSES_WITH_FOLLOW_UP.includes(next)) change("nextFollowUpDate", "");
    /*
     * ── Chosen here, written once there is a reason ────────────────────────────────────────────
     *
     * Pressing a pill moves nobody on its own. It records the choice, and the stage lands with the
     * save - which already refuses without a remark and posts the one in the box, so the stage and
     * the reason are written together or neither is.
     *
     * The Remarks tab is brought forward because the message under the pills is not where somebody
     * presses Update from: being refused for a box on a tab you cannot see reads as a button that does
     * nothing. Only when there is no remark yet, or a press on a pill would throw away the tab
     * somebody was deliberately reading.
     */
    if (!hasRemark) revealRemarkBox();
  }

  /*
   * The stages this screen may not choose, shown and refused rather than left out: a candidate can
   * *be* at any of them, and a list of stages with holes in it reads as a process with holes in it.
   *
   * Form Submitted always - that stage is the candidate answering the screening form. Then any act
   * whose handler this viewer was not given, which is how onboarding disappears for somebody without
   * `HRM / Employee Management`.
   */
  const refusedStatuses = canWrite
    ? [FORM_SUBMITTED_STATUS, ...Object.keys(STATUS_ACTS).filter((status) => !actFor(status))]
    : CANDIDATE_STATUSES;
  /** How many fields the pane is holding back, so the press that opens them says what it will cost. */
  const hiddenCount = useMemo(
    () => candidateFormSections.reduce(
      (count, section) => count + visibleFields(section.fields, values, context).filter((field) => !answered.has(field.name)).length,
      0,
    ),
    [values, context, answered],
  );
  /*
   * A stage has been chosen and there is no reason for it yet. Said as the thing standing in the way
   * rather than as a general rule, because at this point it is the one thing between the press and the
   * record - and compared against the candidate's own stage, so a popup merely opened on a candidate
   * at Follow Up is not nagging about a stage nobody touched.
   */
  const stageAwaitingRemark = canWrite && values.status !== record?.status && !hasRemark;
  const needsFollowUpDate = values.status === FOLLOW_UP_STATUS;
  const takesFollowUpDate = STATUSES_WITH_FOLLOW_UP.includes(values.status);

  return createPortal(
    /*
     * **The lead popup's own measurements**, to the pixel: full screen behind a small gutter rather
     * than a centred card. Not a style preference - this record is four sections and thirty-nine
     * fields beside a tab card, and a centred `max-w` card gives the left pane a scrollbar before the
     * first section is finished. `z-[120]` is the lead popup's layer too, above the `z-[100]` the
     * dialogs on this screen use, so the decision dialog and the schedule dialog draw over it rather
     * than under it.
     */
    /*
     * `event.currentTarget === event.target` is the whole of it, and it is the same test `Dialog`
     * applies to its own backdrop.
     *
     * Every dialog this popup opens - the stage question, the unsaved-changes guard - draws *inside*
     * this element rather than portalling out of it, and each is itself a `fixed inset-0` sheet over
     * the screen. Without the test, a mousedown on any control in any of them bubbled to here and was
     * read as a click on the dimmed area: pressing **Leave the stage as it is** answered the question
     * and then raised "Close without saving?" on top of its own answer. The test says a press on the
     * backdrop is a press whose target *is* the backdrop; anything inside it, at any depth and in any
     * tab, belongs to whatever it was pressed on.
     */
    <div
      className="fixed inset-0 z-[120] bg-black/40 p-2 sm:p-3"
      onMouseDown={(event) => { if (event.currentTarget === event.target) requestClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={candidate?.name || "Candidate"}
        className="themed-surface flex h-full w-full flex-col overflow-hidden rounded-[1.6rem] bg-[#f4f4f4] shadow-[0_30px_90px_rgba(15,23,42,0.35)]"
      >
        {/* Who, their code, their number, and the stage in the colour the table gives it - so the row
            and the popup cannot describe the same candidate two different ways. */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-medium text-slate-800">{candidate?.name || "Candidate"}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500 sm:text-sm">
              {candidate?.candidateCode && <span>{candidate.candidateCode}</span>}
              {candidate?.phone && <span>{candidate.phone}</span>}
              {candidate?.status && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${candidateStatusStyles[candidate.status] || "bg-slate-500"}`}>{candidate.status}</span>}
              {alsoApplied > 0 && <span className="font-semibold text-amber-700">Applied : {alsoApplied + 1} times</span>}
            </p>
          </div>
          <CloseButton onClick={requestClose} ariaLabel="Close candidate" />
        </div>

        {errors.form && <p role="alert" className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:mx-6 sm:text-sm">{errors.form}</p>}

        {/* Two panes from `lg`, one column below it - the record on the left, the card on the right. */}
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 sm:p-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:overflow-hidden">
          {/* `canWrite`, which is the prop this component actually takes - it does not spread what it
              does not recognise, so a call inventing a name for it is a fieldset that was handed
              nothing and defaults to editable. */}
          <div className="flex min-h-0 flex-col gap-3 lg:overflow-auto">
          <ReadOnlyFieldset canWrite={canWrite} reason="You can read this candidate but not change their record." className="space-y-4">
            {candidateFormSections.map((section) => {
              /*
               * What they answered, in the application's own order - and nothing else unless asked
               * for. A field carrying an error is always drawn, or a save could be refused for a box
               * that is not on screen.
               */
              const shown = visibleFields(section.fields, values, context)
                .filter((field) => showAll || answered.has(field.name) || errors[field.name]);
              // A section every one of whose fields is empty is not drawn as a heading over nothing.
              if (!shown.length) return null;
              return <section key={section.id || section.title} className="overflow-hidden rounded-2xl bg-white">
                <h3 className="border-b border-slate-200 px-5 py-3 text-base font-medium text-slate-700">{section.title}</h3>
                <div className="grid gap-4 p-5 md:grid-cols-2">
                  {shown.map((field) => (
                    <SchemaFormField key={field.name} field={field} values={values} onChange={change} errors={errors} notes={clashNotes} context={context} />
                  ))}
                </div>
              </section>;
            })}
          </ReadOnlyFieldset>
          {/*
            The rest of the form, one press away.

            Not a scrollbar's worth of empty boxes by default, and not hidden for good either: a
            review of a submitted application regularly has to write in something the candidate left
            out, and somebody correcting a record needs the box that is blank precisely because it is
            wrong. The count is in the word, so the press says what it will cost.
          */}
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((current) => !current)} className="self-start text-blue-700">
            {showAll ? "Show only what was filled in" : `Show all fields (${hiddenCount} more)`}
          </Button>
          </div>

          {/* Scrolls when the window is short, rather than squeezing the Remarks card to nothing. */}
          <div className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto">
            {/* The card. Remarks first, because a remark is what the footer will ask for. */}
            <div className="flex min-h-[20rem] flex-1 flex-col rounded-2xl bg-white lg:overflow-hidden">
              <div className="shrink-0 border-b border-slate-200 px-3 py-2">
                <Tabs tabs={POPUP_TABS} value={tab} onChange={setTab} ariaLabel="Candidate card" />
              </div>
              <div ref={cardPane} className="min-h-0 flex-1 overflow-auto p-3">
                {tab === "remarks" && <InterviewRemarksTab
                  candidate={candidate}
                  // From the record as last written, so a note just posted is in the thread under the box.
                  entries={record.statusNotes}
                  canWrite={canWrite}
                  commitRef={remarkCommit}
                  onAdded={(saved) => { setRemarkAdded(true); if (saved) setRecord(saved); onRecordChanged?.(saved, "Remark added."); }}
                  onDraftChange={setRemarkDraftFilled}
                  missingError={remarkError}
                />}
                {/* Read, never written - and read as **what happened** rather than as what was said,
                    which is Remarks' reading of the same log. See `activityLog`. */}
                {tab === "activity" && interviewInfoFormatters.activityLog(record.statusNotes)}
                {/* Reads itself when opened - see the tab. The popup hands it the candidate and nothing
                    else, because the number the log is keyed by is the server's to read. */}
                {tab === "calls" && <InterviewCallLogsTab candidate={candidate} />}
                {tab === "transcripts" && <InterviewTranscriptsTab candidate={candidate} />}
                {tab === "whatsapp" && <InterviewWhatsAppTab candidate={candidate} canWrite={canWrite} onSent={(saved, message) => { if (saved) setRecord(saved); onRecordChanged?.(saved, message); }} />}
              </div>
            </div>

            {/*
              The lead popup's Follow-up Details card, asked of a candidate: where they are, and
              directly under it whatever being there needs. `shrink-0` so the tabs above give up the
              space rather than this card - the stage is the thing somebody opened the popup to change.
            */}
            <section className="shrink-0 overflow-hidden rounded-2xl bg-white">
              <h3 className="border-b border-slate-200 px-5 py-3 text-base font-medium text-slate-700">Follow-up Details</h3>
              <div className="space-y-3 px-5 py-4">
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-600">Stage<HelpTip text="Where the candidate is in hiring; the change saves with your remark on Update." /></legend>
                  <InterviewStatusPills
                    value={values.status}
                    onChange={chooseStatus}
                    options={CANDIDATE_STATUSES}
                    disabledValues={refusedStatuses}
                    disabledTitle={canWrite
                      ? "This stage is set by the act that makes it true — the screening form coming back, a round being booked, an invite being raised."
                      : "You can read this candidate but not change their stage."}
                  />
                </fieldset>
                {takesFollowUpDate ? (
                  <ReadOnlyFieldset canWrite={canWrite} reason="You can read this candidate but not change their follow-up.">
                    {/* The lead popup's grid, so the date takes one column rather than the whole
                        card: full width on a phone, a half or a third of the card from `md` up. */}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <div ref={followUpField}>
                        <DateField
                          label="Next Follow-up"
                          helperText="The day to contact them next; it brings them back on the register."
                          required={needsFollowUpDate}
                          value={values.nextFollowUpDate || ""}
                          onChange={(next) => change("nextFollowUpDate", next)}
                          error={needsFollowUpDate ? errors.nextFollowUpDate || "" : ""}
                        />
                      </div>
                    </div>
                  </ReadOnlyFieldset>
                ) : (
                  /* Said rather than left as a gap, the way the lead popup says it: a field that was
                     there a moment ago and is now missing is worth one line. */
                  <p className="text-xs font-normal text-slate-500 sm:text-sm">
                    Follow-up dates are not set for {String(values.status || "").trim() || "this"} candidates.
                  </p>
                )}
                {/*
                  The reason is the remark, so it is said here rather than asked for twice - and once a
                  stage has actually been chosen it is said as the thing standing in the way, naming
                  the candidate and the stage. A stage chosen and left without a reason is the one
                  state this card can be in that Update will refuse.
                */}
                {stageAwaitingRemark ? (
                  <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 sm:text-sm">
                    Write a remark to move {candidate?.name || "this candidate"} to {values.status}.
                  </p>
                ) : (
                  <p className="text-[11px] font-normal leading-5 text-slate-500 sm:text-xs">
                    The remark is the reason this stage changed — Update asks for one.
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>

        {/*
          Two buttons, and no decisions among them.

          The decisions are pills in the card above now, which is the whole point of the card: one
          place where a stage is read and answered, with the remark that explains it in the tab beside
          it. A footer that also held **Selected**, **On Hold** and **Rejected** would be two ways to
          set one field on one screen, and the way that lost the reason would be the nearer one.

          Send Screening Form and Schedule Interview lived here too, once - the same `forward` call
          choosing **Form Submission Pending** or **Interview Scheduled** above now makes directly, so
          a footer button beside the pill was a second way to ask for the one thing.
        */}
        {canWrite ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <Button type="button" onClick={requestClose} disabled={saving}>Discard</Button>
            <Button type="button" variant="primary" busy={saving} busyLabel="Updating..." onClick={() => void save()}>
              {review ? "Save Review" : "Update and Close"}
            </Button>
          </div>
        ) : null}
      </div>
      {/* Above the popup, because a question drawn behind it dims the screen and shows nothing -
          which reads as a Discard that did not work. */}
      <ConfirmDialog {...closeConfirmProps} layer="dialogOverPanel" />
    </div>,
    document.body,
  );
}
