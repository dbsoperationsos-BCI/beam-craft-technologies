"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import ComboBoxField from "@/components/shared/ComboBoxField";
import DateField from "@/components/shared/DateField";
import HelpTip from "@/components/shared/HelpTip";
import PhoneField from "@/components/shared/PhoneField";
import { isCompletePhoneNumber } from "@/lib/phoneNumber";
import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import { getDuplicateCandidates } from "@/services/hrm/interview.service";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import CloseIcon from "@/components/ui/CloseIcon";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { createCandidate } from "@/services/hrm/interview.service";
import { DEFAULT_CANDIDATE_STATUS } from "@/constants/interviewConfig";

/**
 * Add Application: one candidate, written down as they arrive.
 *
 * This is **Add Lead's dialog**, asked of a candidate - the same grey card over the dimmed page,
 * the same white heading bar, the same white panel on it, and the same Cancel / Confirm bar at the
 * foot. A reader who adds leads should not have to work out where they are here.
 *
 * ── One panel, and no stage to choose ──
 *
 * An arriving application **is** at Yet to Connect: nobody has spoken to them, which is the whole
 * definition of that stage. So the form no longer asks. It offered five stages, and four of them
 * were things that cannot be true of an application being written down as it arrives - Form
 * Submission Pending means a form has gone out, Form Submitted means it has come back, and Selected
 * and On Hold are decisions about somebody nobody has met. A row filed under one of those by a
 * mis-click on the pills reads afterwards as a step somebody took, and sits in a tab being worked
 * for something that never happened. Every one of those stages is now reached by the act that makes
 * it true: sending the screening form, the candidate returning it, scheduling a round, or the
 * decision dialog, which asks the question this form cannot - why.
 *
 * The stage is still **sent**, as `DEFAULT_CANDIDATE_STATUS`, rather than left to the server's own
 * default: the register is filled by five different writers and a form that posts no stage is a
 * form whose rows depend on which of them last changed.
 *
 * With the pills gone there was nothing left to be a second panel. Follow-up Details held a stage,
 * a date and a note, and two headings said the dialog asked two kinds of question when it asks one:
 * this is an application being written down, and the day to chase them is part of writing it down.
 * So it is one panel the full width of the card, the same width it always was.
 *
 * ── Why it asks so little ──
 *
 * It was a four-section full-screen form asking thirty-odd questions, which is the wrong form for
 * this moment twice over. An application arrives as a name, a number and the job they are after;
 * everything else - what they earn, what they expect, what they have studied, when they can start -
 * is either not known yet or is the candidate's own to type. So this asks the six things that make
 * a candidate findable and filable, plus the two that say what happens next, and nothing else.
 *
 * There is no **Assign To**: the studio has one HR, so there is nobody to assign a candidate to and
 * a picker with one name in it is a question with one answer. A linked sheet's rules can still name
 * an interviewer, and that value is shown on the record and kept through an edit.
 *
 * The rest has two homes, both of which already existed:
 *
 *   * **The candidate fills it in.** Send Screening Form, on the row's ⋮, sends them a link to
 *     their own form - which is where the studio wanted that detail to come from anyway.
 *   * **HR edits the record.** Opening a candidate gives the full form
 *     (`InterviewCandidatePopup`), which is where an imported or submitted application is
 *     corrected - exactly as the CRM asks little on Add Lead and everything in the lead popup.
 *
 * ── Closing asks, once there is something to lose ──
 *
 * The same rule Add Lead applies: the form opens carrying a status and today's follow-up date, so
 * warning on those would put a prompt in front of somebody who opened the dialog and changed their
 * mind. It asks only once a person has typed something.
 */

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** A new application, as the dialog opens it. The first stage and today, which is what an application is. */
const emptyApplication = () => ({
  name: "",
  phone: "",
  position: "",
  email: "",
  experience: "",
  source: "",
  status: DEFAULT_CANDIDATE_STATUS,
  nextFollowUpDate: todayKey(),
  remarks: "",
});

/** The answers the dialog fills in for the person. None of them is evidence that anybody has typed. */
const AUTO_FILLED = new Set(["status", "nextFollowUpDate"]);
const hasEntries = (values) => Object.entries(values).some(([key, value]) => !AUTO_FILLED.has(key) && String(value ?? "").trim() !== "");

export default function InterviewAddApplicationDialog({ options = {}, onClose, onAdded }) {
  const [form, setForm] = useState(emptyApplication);
  // Only after Confirm has been pressed: marking a field red before somebody has tried to save is
  // scolding them for not having finished yet. The same rule Add Lead applies.
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);
  /*
   * Who the register already holds on this number or this address, asked **as it is typed**.
   *
   * One person is one candidate, and the server refuses a second - but being told that only after
   * somebody has filled in the whole form is being told it too late. So the warning appears under
   * the field the moment the number is whole, which is exactly where and when Add Lead says the
   * same thing about a number the CRM already holds.
   */
  const [clash, setClash] = useState(null);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };

  /*
   * Asked only of a number that is whole - the same test the CRM's Add Lead uses - so nothing is
   * asked on the way to typing one and no warning can appear against the first four digits.
   *
   * Debounced, and every answer is held with the values it was asked about, so a reply landing
   * after the field has been edited counts for nothing rather than warning about a number nobody is
   * looking at. A check that will not answer is not a clash: Confirm is never held up by a network
   * having a moment, and the server refuses a real duplicate regardless.
   */
  const phone = String(form.phone || "").trim();
  const email = String(form.email || "").trim();
  useEffect(() => {
    const askPhone = isCompletePhoneNumber(phone) ? phone : "";
    const askEmail = email.includes("@") ? email : "";
    if (!askPhone && !askEmail) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getDuplicateCandidates({ phone: askPhone, email: askEmail })
        .then((response) => {
          if (cancelled) return;
          const found = response?.data?.candidates || [];
          setClash(found.length ? { phone: askPhone, email: askEmail, candidates: found } : null);
        })
        .catch(() => {});
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [phone, email]);

  /**
   * The warning under each field, split by what actually matched - a clash found on the address
   * belongs under Email and not under Contact. Built only where the answer still describes what is
   * in the field, which is what makes a stale reply worth nothing without having to be discarded.
   */
  // A plain function rather than a memo: it reads two strings off an answer already in hand, and
  // wrapping it cost more than it saved - the compiler could not preserve the memo anyway.
  const clashNote = (key) => {
    if (!clash || clash.phone !== phone || clash.email !== email) return "";
    const matchedBy = key === "phone" ? "phone number" : "email";
    const found = clash.candidates.filter((entry) => entry.matchedBy === matchedBy);
    // Named, because "already on the register" with nothing else leaves somebody searching a
    // register of thousands for a record they cannot see.
    return found.length
      ? `Already on the register: ${found.map((entry) => [entry.candidateCode, entry.name].filter(Boolean).join(" ")).join(", ")}`
      : "";
  };

  /**
   * What the server would refuse, and the two answers that make a candidate worth filing.
   *
   * **Position Applied For is not one of them.** It is asked, and it is what the register files a
   * candidate under, but it is regularly not known at the moment an application is written down - a
   * walk-in, a number passed on by a friend of the studio, a CV in the inbox with no covering note.
   * Refusing the row for it bought a guess typed into the field, or the candidate not being written
   * down at all. Their own screening form still asks them, which is where the real answer comes from.
   */
  const REQUIRED = [["name", "Candidate Name"], ["phone", "Contact"]];
  const missing = REQUIRED.filter(([key]) => !String(form[key] ?? "").trim()).map(([, label]) => label);
  const emailProblem = form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form.email).trim())
    ? "Enter a valid email address."
    : "";

  // The line above the marked boxes - how many, since each says its own.
  const summary = showErrors ? markedFieldsMessage(missing.length + (emailProblem ? 1 : 0)) : "";

  /** A field's own message, shown under it once Confirm has been pressed. */
  const problem = (key, label) => {
    if (!showErrors) return "";
    if (key === "email") return emailProblem;
    return REQUIRED.some(([name]) => name === key) && !String(form[key] ?? "").trim() ? `${label} is required.` : "";
  };

  function requestClose() {
    if (saving) return;
    if (hasEntries(form)) { setConfirmingClose(true); return; }
    onClose?.();
  }

  // Escape closes it, through the shared arbiter, so a dropdown open inside the dialog takes the
  // press first rather than one key closing both.
  useEscapeKey(requestClose, !confirmingClose);

  async function confirm() {
    if (missing.length || emailProblem) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await createCandidate({ ...form, name: String(form.name).trim() });
      const saved = response?.data;
      onAdded?.(saved, `${saved?.candidateCode || "The application"} added to the register.`);
    } catch (requestError) {
      // The server's own message where it has one - it is the specific reason.
      setError(requestError?.data?.message || requestError?.message || "Unable to add that application.");
    } finally {
      setSaving(false);
    }
  }

  // The studio's own list, from Settings → Fields → Interview → Sources. Empty is a usable
  // answer here: the control is a combobox, so it becomes a box somebody types into.
  const sourceOptions = options.sources || [];

  return <>
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={requestClose}>
      <div className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-[2rem] bg-[#f3f3f3] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 className="text-lg font-medium text-slate-800">Add Application</h2>
          <button type="button" onClick={requestClose} aria-label="Close add application" className="text-slate-700"><CloseIcon className="h-6 w-6" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          {/* No Applied On field. The register stamps today, which is what an application written
              down as it arrives is; one that needs a different date is corrected by opening it. */}
          <div className="space-y-4">
            <section className="overflow-hidden rounded-2xl bg-white">
              <h3 className="border-b border-slate-200 px-5 py-3 text-lg font-medium text-slate-700">Application Details</h3>
              <div className="space-y-5 p-5">
                {/* Six fields, two rows of three - Add Lead's own measures. The three marked are
                    what make a candidate findable and filable; the other three are what somebody
                    taking the call almost always has in front of them. */}
                <div className="grid gap-5 md:grid-cols-3">
                  <TextField
                    label="Candidate Name"
                    helperText="Their full name, as it should appear on the interview register."
                    required
                    error={problem("name", "Candidate Name")}
                    value={form.name}
                    onChange={(event) => update("name", event.target.value)}
                  />
                  <PhoneField
                    label="Contact"
                    helperText="The number HR calls or messages them on; it must be new to the register."
                    field="phone"
                    required
                    error={problem("phone", "Contact")}
                    note={clashNote("phone")}
                    value={form.phone}
                    onChange={(_field, phone) => update("phone", phone)}
                  />
                  {/* A combobox rather than a closed list: the studio's designations are what it
                      hires for most of the time and not all of it, and the position a candidate
                      applied for is their words. */}
                  <ComboBoxField
                    label="Position Applied For"
                    helperText="Pick a studio designation, or type the role they asked for."
                    error={problem("position", "Position Applied For")}
                    value={form.position}
                    onChange={(value) => update("position", value)}
                    options={options.positions || []}
                    placeholder="Select or type"
                  />
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                  {/* Asked, not required. It is what the application form is sent to, so a
                      candidate without one can be added and emailed later - and a walk-in very
                      often has no address to give. */}
                  <TextField
                    label="Email"
                    helperText="Where the application form is sent; can be added later if unknown."
                    error={problem("email", "Email")}
                    note={clashNote("email")}
                    value={form.email}
                    onChange={(event) => update("email", event.target.value)}
                    placeholder="name@example.com"
                  />
                  <TextField
                    label="Experience"
                    helperText="How much work experience they have, in your own words."
                    value={form.experience}
                    onChange={(event) => update("experience", event.target.value)}
                    placeholder="e.g. 3 years, or Fresher"
                  />
                  <ComboBoxField
                    label="Source"
                    helperText="Where the candidate heard about us, such as a job portal or referral."
                    value={form.source}
                    onChange={(value) => update("source", value)}
                    options={sourceOptions}
                    placeholder="Select or type"
                  />
                </div>
                {/* The follow-up and the note, **in the same panel** rather than in a second one
                    below it. Two headings said the dialog asked two kinds of question, and it does
                    not: this is one application being written down, and the day to chase them is
                    part of writing it down. The second panel existed to hold the status pills, and
                    they are gone - see the note at the top of this file. */}
                <div className="grid gap-5 md:grid-cols-3">
                  <DateField
                    label="Next Follow-up Date"
                    helperText="The day to contact them next; it brings them back on the register."
                    value={form.nextFollowUpDate}
                    onChange={(value) => update("nextFollowUpDate", value)}
                  />
                </div>
                <div className="space-y-2">
                  {/* No placeholder: the heading says what the box is for, and a sentence of
                      example text inside an empty box is one more thing to read past. */}
                  <h4 className="text-sm font-semibold text-slate-600">Remarks<HelpTip text="HR's own notes on this candidate, kept on their record." /></h4>
                  <TextAreaField
                    label=""
                    rows={5}
                    value={form.remarks}
                    onChange={(event) => update("remarks", event.target.value)}
                  />
                </div>
              </div>
            </section>

          </div>

          {/* The server's refusal, said where the fields are rather than only in a snackbar that
              may have gone by the time somebody looks up. */}
          {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:text-sm">{error}</p>}
          {summary && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-normal text-red-700 sm:text-sm">{summary}</p>}
        </div>

        {/* Confirm stays live and marks the empty boxes when pressed, the same as Add Lead: a list
            of names beside a dead button leaves the user to work out which field each name meant. */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => void confirm()} disabled={saving}>{saving ? "Adding..." : "Confirm"}</Button>
        </div>
      </div>
    </div>

    {/* Above the dialog at `dialogOverPanel`, because that card covers the page on a dialog's own
        layer and a question drawn behind it dims the screen and shows nothing - which reads as a
        Cancel that did not work. The same arrangement Add Lead's own save-or-discard uses. */}
    <ConfirmDialog
      open={confirmingClose}
      title="Discard this application?"
      message="It has not been saved. Go back and press Confirm to keep it."
      cancelLabel="Go Back"
      confirmLabel="Discard"
      primaryAction="cancel"
      layer="dialogOverPanel"
      onCancel={() => setConfirmingClose(false)}
      onConfirm={() => { setConfirmingClose(false); onClose?.(); }}
    />
  </>;
}
