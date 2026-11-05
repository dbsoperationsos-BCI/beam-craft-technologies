"use client";

import { useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import RepeatableDetailsField from "@/components/shared/RepeatableDetailsField";
import RepeatableTextList from "@/components/shared/RepeatableTextList";
import interviewInfoFormatters from "@/components/hrm/interviewInfoFormatters";
import { employeeDetailLists } from "@/constants/employeeDetailFields";
import TextField from "@/components/shared/TextField";
import { isCompletePhoneNumber } from "@/lib/phoneNumber";
import { EXPERIENCED, EXPERIENCE_LEVELS, FRESHER, IMMEDIATE_JOIN, MAX_PORTFOLIO_LINKS, NOTICE_PERIODS, totalExperienceFrom } from "@/constants/interviewApplicationConfig";
import { getDuplicateCandidates, updateCandidate } from "@/services/hrm/interview.service";
import {
  CANDIDATE_STATUSES,
  EMPLOYMENT_TYPES,
  INTERVIEW_MODES,
  DEFAULT_CANDIDATE_STATUS,
  candidateFormSections,
  candidateFormValues,
} from "@/constants/interviewConfig";

/*
 * The four fields this record holds that are not a box: the candidate's education, their work
 * history, their links, and what they attached.
 *
 * The first three are the **same controls the application form draws them with** - that is the
 * whole point of the record mirroring the form, and it is why the two entry lists are the employee
 * record's own shared descriptions rather than anything defined here. The fourth is read-only: HR
 * replaces a file by asking for a new form rather than uploading on the candidate's behalf, so the
 * list opens each one and offers no control to change it.
 */
/* `{ record key: the shared description it is drawn from }` - the register names these two columns
   for what they hold, the employee lists for what they ask. */
const ENTRY_LISTS = { educationEntries: "qualifications", experienceEntries: "experiences" };

const entryListRenderers = Object.fromEntries(Object.entries(ENTRY_LISTS).map(([name, list]) => [name, ({ values, onChange, field, error }) => <RepeatableDetailsField
  {...employeeDetailLists[list].props}
  required={field?.required}
  value={values[name] || []}
  errors={error && typeof error === "object" ? error : {}}
  error={typeof error === "string" ? error : ""}
  onChange={onChange}
/>]));

const candidateRenderers = {
  ...entryListRenderers,
  portfolioLinks: ({ values, onChange, field, error }) => <RepeatableTextList
    label={field?.label || "Portfolio / Links"}
    max={MAX_PORTFOLIO_LINKS}
    rowLabel={(index) => `Link ${index + 1}`}
    addAriaLabel="Add another link"
    placeholder="https://"
    value={values.portfolioLinks || []}
    errors={error && typeof error === "object" ? error : {}}
    error={typeof error === "string" ? error : ""}
    onChange={onChange}
  />,
  /*
   * Read, not edited - and drawn by the same formatter the info panel and the record view use, so
   * an attachment reads the same wherever a candidate is opened.
   */
  attachments: ({ values, field }) => <div>
    <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{field?.label || "Other Attachments"}</p>
    <div className="mt-1.5 text-xs font-normal text-slate-700 sm:text-sm">
      {interviewInfoFormatters.attachments(values.attachments)}
    </div>
  </div>,
  /*
   * The résumé: the document to open, and under it the address it lives at.
   *
   * Both, because this screen does both jobs - a résumé is read rather than proof-read, and this
   * record is also where a row imported with the link in the wrong column is put right. The link is
   * drawn by the same formatter the attachments use, so the two read alike.
   */
  resumeUrl: ({ values, onChange, field }) => <div>
    <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">{field?.label || "Resume"}</p>
    <div className="mt-1.5 text-xs font-normal text-slate-700 sm:text-sm">
      {interviewInfoFormatters.attachments(values.resumeUrl ? [{ name: "Open résumé", url: values.resumeUrl }] : [])}
    </div>
    <TextField
      label=""
      className="mt-2"
      placeholder="https://"
      value={values.resumeUrl || ""}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>,
  /*
   * What the register keeps as Experience, read back rather than typed - the application form's own
   * readout. A fresher reads "Fresher"; somebody experienced reads what their rows add up to, or
   * the column's own text where a sheet wrote something the rows do not account for.
   */
  experience: ({ values, field }) => <TextField
    label={field?.label || "Total Experience"}
    value={values.experienceLevel === EXPERIENCED
      ? (totalExperienceFrom(values.experienceEntries) || values.experience || "")
      : (values.experienceLevel || values.experience || "")}
    onChange={() => {}}
    readOnly
    placeholder="From the answer and the rows"
  />,
};

/**
 * One candidate's record, opened in full.
 *
 * **Editing only.** Adding is the compact dialog beside this
 * (`InterviewAddApplicationDialog`), which asks the six things an arriving application actually
 * carries - the same split the CRM has, where Add Lead asks little and the lead popup is where
 * everything is read and corrected. This is that second half: every column the register holds,
 * including the ones only a linked sheet, a CSV or the candidate's own submitted form ever fill in.
 *
 * It has to hold all of them, and that is the point of it being this shape rather than the dialog's:
 * a candidate who arrived from a recruiter's spreadsheet with an expected salary typed in the wrong
 * column is corrected here, and a form the candidate filled in is read here.
 *
 * **One button about the candidate's own form** sits in the footer rather than among the fields,
 * because it is a different act from saving: the rest of the application is the candidate's to type.
 * Which button it is depends on whether they have already typed it. Somebody who has not is asked,
 * with **Send Screening Form**; somebody who has gets **Resend Form**, which hands their own
 * submission back on their own link with every answer still in it. It is a replacement and not an
 * addition - offering a fresh link to a candidate who has answered reads to them as a form that
 * swallowed what they typed, which is exactly the thing this screen must not say. Either one saves
 * the record first, so what goes back to them is raised against the details on screen rather than
 * the ones last written.
 *
 * ── Reviewing is the same panel, asked a different question ──
 *
 * A candidate at **Form Submitted** is not a record somebody is correcting: they are an application
 * waiting to be *read*, and the row menu says **Review** rather than Edit for exactly that reason.
 * The fields are the same - a submission is read by reading it - but the footer is, because the
 * question at the end of a review is not "did you finish typing" but **what happens to this person**.
 * So `review` puts four answers there instead of three:
 *
 *   * **Discard** - close without keeping the corrections, which is what Cancel already was; it is
 *     named for what it does to the edits, since "cancel" in front of an application reads as
 *     cancelling the application.
 *   * **Resend** - hand the form back to the candidate on their own link, with every answer still in
 *     it, because the review found something only they can put right.
 *   * **Save** - keep the corrections and leave the candidate where they are, which is the answer
 *     for a review that is not finished.
 *   * **Schedule Meeting** - the forward answer, and the one a review exists to reach. It saves the
 *     record first and hands the saved candidate back, so the round is booked against what was just
 *     corrected rather than against what was last written.
 *
 * Opened by the row menu and by a double-click, so it takes `canWrite` as a prop rather than relying
 * on the control that opened it having been hidden; without it the fields are read-only and there is
 * no save to press.
 */
export default function InterviewCandidateFormPanel({ candidate, options = {}, canWrite = true, formSubmitted = false, review = false, onClose, onSaved, onResendApplicationForm, onSendApplicationForm, onScheduleInterview }) {
  const [values, setValues] = useState(() => candidateFormValues(candidate));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  /*
   * Who else the register already holds on this number or this address.
   *
   * Asked as it is typed, so the answer appears **under the field** rather than arriving as a
   * refusal once the whole record has been filled in. One person is one candidate, and being told
   * that at the top of a form somebody has just finished is being told it too late.
   *
   * The CRM's Add Lead asks its own board this in exactly this place, and this is the same warning:
   * amber rather than red, because a number the register already holds is worth stopping for and is
   * not an error - the save is refused by the server, which is the rule; this is the courtesy.
   */
  const [clash, setClash] = useState(null);

  /*
   * Asked of a number only once it is whole - `isCompletePhoneNumber` is the same test the CRM's
   * Add Lead uses - so nothing is asked on the way to typing one and the warning cannot appear
   * against the first four digits. An address is asked for as soon as it looks like one.
   *
   * Debounced, and the answer is held **with the value it was asked about**, so a reply that lands
   * after the field has been edited is worth nothing rather than warning about a number nobody is
   * looking at. Nothing is cleared here: `clashNotes` below compares the answer against the fields
   * as they stand, which is why a stale answer needs no throwing away.
   *
   * A check that will not answer is not a clash. The form stays usable, and the save is never held
   * up by a network having a moment - the server refuses a real duplicate regardless.
   */
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
   * What the pickers offer. The fixed lists fall back to the constants when the options endpoint has
   * not answered, and a stored value the lists do not carry is added back - which is what this panel
   * needs more than any other screen here: a sheet's own word for a stage, a position nobody has on
   * the designation list, a source since renamed. None of it may be silently dropped by an edit.
   */
  const context = useMemo(() => {
    const withCurrent = (list, current) => (current && !list.includes(current) ? [...list, current] : list);
    return {
      options: {
        statuses: withCurrent(options.statuses?.length ? options.statuses : CANDIDATE_STATUSES, candidate?.status),
        modes: withCurrent(options.modes?.length ? options.modes : INTERVIEW_MODES, candidate?.interviewMode),
        // The studio's own list, plus whatever this candidate already holds - which is how a
        // source an importer stamped, or one since renamed in Field Settings, survives an edit.
        sources: withCurrent(options.sources || [], candidate?.source),
        employmentTypes: withCurrent(options.employmentTypes?.length ? options.employmentTypes : EMPLOYMENT_TYPES, candidate?.employmentType),
        positions: withCurrent(options.positions || [], candidate?.position),
        departments: withCurrent(options.departments || [], candidate?.department),
        branches: withCurrent(options.branches || [], candidate?.branch),
        genders: withCurrent(options.genders || [], candidate?.gender),
        /*
         * The application form's own bands and its "Immediate", offered here as comboboxes so a
         * value neither list carries - a sheet's "45-60 days", a CSV's own wording - is shown back
         * and kept rather than blanked by the save.
         */
        noticePeriods: withCurrent(NOTICE_PERIODS, candidate?.noticePeriod),
        joiningAnswers: withCurrent([IMMEDIATE_JOIN], candidate?.availableFrom),
        experienceLevels: EXPERIENCE_LEVELS,
      },
      renderers: candidateRenderers,
    };
  }, [candidate, options]);

  function change(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
    // The message goes the moment the field it was about is touched.
    setErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  }

  /** What the server would refuse, asked here first so the answer lands on the field itself. */
  function validate() {
    const found = {};
    if (!String(values.name || "").trim()) found.name = "Enter the candidate's name.";
    if (!String(values.phone || "").trim()) found.phone = "Enter the candidate's phone number.";
    if (!String(values.position || "").trim()) found.position = "Enter the position applied for.";
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email).trim())) found.email = "Enter a valid email address.";
    if (!values.status) found.status = "Choose a status.";
    return found;
  }

  /*
   * What a save sends. `interviewer` is not a field any more - the studio has one HR, so there is
   * nobody to assign a candidate to - but a linked sheet's rules can still fill it in, so this
   * carries whatever the candidate already holds straight back.
   *
   * It has to be sent rather than left out: an update writes every column it is given a key for
   * (`prepareValues`, non-partial), so omitting these two would blank a sheet-assigned interviewer
   * on the first edit anybody made.
   */
  const payloadFrom = () => {
    /*
     * What the register keeps as Experience, written the way the application form writes it.
     *
     * Fresher is the word. Experienced is what the rows add up to - **unless there are no rows**,
     * where the column's own text is kept instead: a sheet's "2-3 yrs" is a real answer, and
     * replacing it with "" because nobody typed rows would be this screen destroying an import.
     */
    const experienced = values.experienceLevel === EXPERIENCED;
    const summed = totalExperienceFrom(values.experienceEntries);
    const experience = values.experienceLevel
      ? (experienced ? (summed || candidate?.experience || "") : FRESHER)
      : (candidate?.experience || "");

    return {
      ...values,
      experience,
      // The branch, not a column - the same key the application form takes out of its own payload.
      experienceLevel: undefined,
      // Read-only on this screen, and not a key the update endpoint takes - sent, it would simply
      // be dropped by the schema, and leaving it out says so here rather than at the server.
      attachments: undefined,
      name: String(values.name).trim(),
      interviewerEmployeeId: candidate?.interviewerEmployeeId ?? null,
      interviewer: candidate?.interviewer || null,
      /*
       * Screening moved to its own dialog, and these keys have to travel anyway.
       *
       * An update writes every column it is given a key for, so a form that simply stopped sending
       * them would blank a candidate's stage, their interview and HR's own remarks on the first
       * edit anybody made - the same reason `interviewer` above is carried. `values` still holds
       * them, because the record is opened from the whole candidate; this says so out loud rather
       * than leaving it to be noticed.
       */
      status: values.status || candidate?.status || DEFAULT_CANDIDATE_STATUS,
    };
  };

  async function save() {
    const response = await updateCandidate(candidate.id, payloadFrom());
    return response?.data;
  }

  async function submit(event) {
    event.preventDefault();
    if (!canWrite) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const saved = await save();
      onSaved?.(saved, `${saved?.candidateCode || "The candidate"} updated.`);
    } catch (error) {
      // The server's own message where it has one - it is the specific reason.
      setErrors({ form: error?.data?.message || error?.message || "Unable to update that candidate." });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Save what is on screen, then ask the candidate for the rest of it.
   *
   * It saves first rather than sending from an unsaved form, so the link is raised against the
   * details somebody has just corrected and not the ones last written.
   */
  async function saveThenSend(event) {
    event?.preventDefault?.();
    if (!canWrite) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!String(values.email || "").trim()) {
      setErrors({ email: "An email address is needed to send the screening form." });
      return;
    }

    setSaving(true);
    try {
      onSendApplicationForm?.(await save());
    } catch (error) {
      setErrors({ form: error?.data?.message || error?.message || "Unable to save this candidate before sending the screening form." });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Reopening the application the candidate has already sent, from the record.
   *
   * Saves first, exactly as `saveThenSend` above does and for the same reason: HR reads a submission,
   * corrects what they can see is wrong on this screen, and *then* asks the candidate to look at the
   * rest - so the record has to hold those corrections before the form goes back, or the next thing
   * anybody does is lose them by closing the panel.
   *
   * No email check, unlike sending a fresh form. This one goes to the address the **invite** carries,
   * which is the address the candidate proved to open the form in the first place; a record with the
   * email column empty is not a reason to refuse it.
   */
  async function saveThenResend(event) {
    event?.preventDefault?.();
    if (!canWrite) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      onResendApplicationForm?.(await save());
    } catch (error) {
      setErrors({ form: error?.data?.message || error?.message || "Unable to save this candidate before resending the form." });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Booking the conversation, from the review.
   *
   * Saves first, for the reason `saveThenSend` and `saveThenResend` above both save first: HR reads
   * a submission, corrects what they can see is wrong, and *then* decides. A schedule opened from an
   * unsaved form would book the round against the details last written and lose the corrections the
   * moment the panel closed behind it.
   *
   * The saved candidate is handed back rather than the one this panel opened on, because the page
   * opens the schedule dialog on it - and that dialog reads the rounds already recorded to decide
   * whether it is a first round or a next one.
   */
  async function saveThenSchedule(event) {
    event?.preventDefault?.();
    if (!canWrite) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      onScheduleInterview?.(await save());
    } catch (error) {
      setErrors({ form: error?.data?.message || error?.message || "Unable to save this candidate before scheduling." });
    } finally {
      setSaving(false);
    }
  }

  /*
   * Which of the two the footer offers, and it is never both.
   *
   * They answer opposite questions about the same candidate. **Send Screening Form** asks somebody
   * for their application; **Resend Form** hands back the one they have already given, reopened on
   * their own link with every answer still in it. Offering "Send Screening Form" to a candidate who
   * has answered is the one thing nobody wants - it reads to them as a form that swallowed what they
   * typed - which is why that button is replaced rather than joined.
   *
   * `formSubmitted` is the page's reading of their latest form, not this panel's: the record row
   * carries a stage, and a stage is not a form. A candidate moved on to Interview Scheduled has
   * still submitted, and a stage typed straight onto a row by a linked sheet has not.
   */
  const canResendForm = canWrite && formSubmitted && Boolean(onResendApplicationForm);
  const canSendForm = canWrite && !canResendForm && Boolean(onSendApplicationForm);
  const formAction = canResendForm
    ? { label: review ? "Resend" : "Resend Form", onClick: saveThenResend }
    : canSendForm ? { label: "Send Screening Form", onClick: saveThenSend } : null;
  /*
   * The review's forward answer, and only where there is a page listening for it. A panel opened
   * with no `onScheduleInterview` - a read-only viewer, or a caller that does not own the schedule
   * dialog - draws three buttons rather than one that leads nowhere.
   */
  const canSchedule = canWrite && review && Boolean(onScheduleInterview);

  return <SchemaFormPanel
    title={candidate.candidateCode || "Candidate"}
    description={`${candidate.name || "This candidate"} - their application in full, where they are in the process, and who is looking after them.`}
    sections={candidateFormSections}
    values={values}
    onChange={change}
    errors={errors}
    notes={clashNotes}
    context={context}
    saving={saving}
    readOnly={!canWrite}
    readOnlyReason={canWrite ? undefined : "You can read this candidate but not change them."}
    savingLabel="Saving..."
    sidebarAriaLabel="Candidate sections"
    closeAriaLabel="Close candidate"
    onClose={onClose}
    onSubmit={canWrite ? submit : undefined}
    error={errors.form}
    /*
     * The footer is passed rather than left to the panel's default pair, because there is more here
     * than a close and a save: the button about the candidate's own form, and - in a review - the
     * one that books the conversation. The panel draws its own pair only when `submitLabel` is
     * given, so that is deliberately left out; passing both would hide these. A reader without write
     * gets none of them, and no footer bar at all.
     *
     * The save is a plain submit, so it goes through the panel's own required-field check first,
     * exactly as the default button would. In a review it is **not** the primary: the answer a
     * review exists to reach is the meeting, and Save is what somebody presses when they have not
     * reached one yet.
     */
    footer={canWrite ? <>
      {/* Named for what it does to the edits. "Cancel" in front of an application somebody is
          reading reads as cancelling the application, which is the one thing it does not do. */}
      <Button className="max-sm:flex-1" type="button" onClick={onClose} disabled={saving}>{review ? "Discard" : "Cancel"}</Button>
      {formAction && <Button className="ml-auto max-sm:flex-1" type="button" onClick={formAction.onClick} busy={saving}>{formAction.label}</Button>}
      <Button className={`max-sm:flex-1 ${formAction ? "" : "ml-auto"}`} type="submit" variant={canSchedule ? "secondary" : "primary"} disabled={saving}>
        {saving ? "Saving..." : review ? "Save" : "Save Changes"}
      </Button>
      {canSchedule && <Button className="max-sm:flex-1" type="button" variant="primary" onClick={saveThenSchedule} disabled={saving}>
        {/* Four buttons share one row below `sm`, where "Schedule Meeting" would wrap to two lines
            inside its own button. The shorter word says the same thing in the space there is. */}
        <span className="sm:hidden">Schedule</span><span className="max-sm:hidden">Schedule Meeting</span>
      </Button>}
    </> : undefined}
  />;
}
