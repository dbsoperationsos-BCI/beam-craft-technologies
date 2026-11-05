"use client";

import { useEffect, useMemo, useState } from "react";
import AppLogo from "@/components/shared/AppLogo";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import FileUploadField from "@/components/shared/FileUploadField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import HelpTip from "@/components/shared/HelpTip";
import Loader from "@/components/shared/Loader";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { PublicLayout, PublicNotice } from "@/components/shared/PublicPageShell";
import { dayLabel } from "@/lib/attendanceTime";
import { brandNameInProse } from "@/lib/studioBranding.mjs";
import { getOffboardingForm, submitOffboardingForm, verifyOffboardingForm } from "@/services/hrm/offboardingForm.service";
import { dayFromToday, lastWorkingDayFrom, noticePeriodLabel } from "@/lib/offboardingNotice.mjs";

/*
 * The form somebody leaving fills in, opened from the link HR sent them.
 *
 * The onboarding form's own shape at the other end of the employment, and deliberately far shorter:
 * the studio already holds this person's record, so the only thing being asked is **when their
 * notice starts**. Everything else on screen is there to make that date's consequence plain - the
 * notice period HR asked for, and the last working day the two produce.
 *
 * **The browser never sends that last day.** It is drawn here so nobody signs up to a date they
 * cannot see, and worked out again on the server, which is what stores it: a date posted from here
 * would be a second answer to the one question this form exists to settle.
 *
 * Two screens, as onboarding has: prove the email or phone on the record, then the form. Nothing of
 * the record is on the page until that is done.
 */

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

/** Today, as the studio's own day rather than a UTC one: what the notice start defaults to. */
function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** The ⓘ beside each fact of the leaver's own record, by its label - where it comes from. */
const RECORD_FACT_HELP = {
  Designation: "Your job title on your employee record at the studio.",
  "Department / Team": "The teams you work in, as your employee record holds them.",
  "Reporting manager": "The person you report to, as set on your employee record.",
  "Date of joining": "Your first working day at the studio, from your employee record.",
  "Official email": "Your work email on record, or your personal email where no work email is set.",
  "Notice period": "The days of notice HR asked you to serve; it sets the earliest last working day.",
};

export default function PublicOffboardingForm({ token }) {
  const branding = useStudioBranding();
  const [invite, setInvite] = useState(null);
  // `{ state, message }` - why this link no longer opens. `state` says whether that is a failure at
  // all: a form already sent in is this link's ordinary end, not a red box.
  const [dead, setDead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [identifier, setIdentifier] = useState("");
  // Said on the field rather than in a toast that has gone by the time somebody re-reads the box.
  const [identifierError, setIdentifierError] = useState("");
  const [problems, setProblems] = useState({});
  const [verifying, setVerifying] = useState(false);
  const [details, setDetails] = useState(null);
  // `letter` is a list, because `FileUploadField` holds one; the payload takes the single document.
  /*
   * Prefilled with today, because the overwhelmingly common answer is "from today": somebody filling
   * this in has resigned, and the day they are telling the studio is the day it starts. They can
   * move it, and the last working day under it moves with it.
   */
  /*
   * The three answers and the letter. `resignationDate` is prefilled with today, because somebody
   * filling this in has resigned and the day they are telling the studio is today.
   */
  const [form, setForm] = useState({ resignationDate: todayKey(), reason: "", detailedReason: "", letter: [] });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const { notice, showError, clearNotice } = useNotice();

  useEffect(() => {
    let active = true;
    getOffboardingForm(token)
      .then((response) => { if (active) setInvite(response?.data || null); })
      .catch((error) => {
        if (!active) return;
        setDead({ state: error?.data?.state || "error", message: errorMessage(error, "Unable to open this offboarding form.") });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const noticeDays = details?.noticePeriodDays ?? invite?.noticePeriodDays ?? 0;
  // The last working day their notice comes to, drawn as they pick the date it counts from. The
  // same sum the server works out again, which is the one that is stored.
  const lastWorkingDay = useMemo(() => lastWorkingDayFrom(form.resignationDate, noticeDays), [form.resignationDate, noticeDays]);



  async function verify(event) {
    event.preventDefault();
    setIdentifierError("");
    setVerifying(true);
    try {
      const result = await verifyOffboardingForm(token, identifier);
      const verified = result?.data || null;
      setDetails(verified);
      /*
       * The form is filled in here rather than in an effect watching the notice period: this is the
       * moment both the notice period and their previous answers arrive - the verify step is what
       * carries them - so there is one obvious place to do it and no render that shows it empty.
       *
       * A form HR has **sent back** is an edit: their own answers come back with it, so the person
       * correcting one date is not made to retype the other three. Anything else starts with the
       * proposed last day counted from today.
       */
      const answers = verified?.answers;
      if (answers) {
        setForm((current) => ({
          ...current,
          resignationDate: String(answers.resignationDate || "").slice(0, 10) || current.resignationDate,
          reason: answers.reason || "",
          detailedReason: answers.detailedReason || "",
        }));
      }
    } catch (error) {
      // A link that has stopped working is the page's answer, not this field's: it says so in place
      // of the form rather than refusing a box nobody can now get right.
      if (error?.status === 410) { setDead({ state: error?.data?.state || "expired", message: errorMessage(error, "This form can no longer be opened.") }); return; }
      setIdentifierError(errorMessage(error, "Unable to verify this form."));
    } finally {
      setVerifying(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const found = {
      resignationDate: form.resignationDate ? "" : "Pick the day you are resigning.",
      reason: form.reason ? "" : "Pick the reason that fits best.",
    };
    setProblems(found);
    if (Object.values(found).some(Boolean)) return;
    setSubmitting(true);
    try {
      const result = await submitOffboardingForm(token, {
        resignationDate: form.resignationDate,
        reason: form.reason,
        detailedReason: form.detailedReason.trim() || null,
        // No last working day: it is the notice period counted from the date above, and the server
        // is the only thing that works it out.
        letter: form.letter[0] || null,
      });
      setSubmitted(result?.data || {});
    } catch (error) {
      if (error?.status === 410) { setDead({ state: error?.data?.state || "expired", message: errorMessage(error, "This form can no longer be opened.") }); return; }
      showError(errorMessage(error, "Unable to submit this form."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PublicLayout width="3xl"><Loader label="Opening your form…" className="py-20" /></PublicLayout>;
  if (dead) {
    /*
     * A link that no longer opens. Already sent in is the one state here that is not a failure - it
     * is this link's ordinary end - so it reads as a statement rather than a red refusal, and every
     * one of them says what to do next instead of leaving somebody holding a dead page.
     */
    const sentAlready = dead.state === "submitted";
    return <PublicLayout width="3xl">
      <PublicNotice title={sentAlready ? "Already sent to HR" : "This form can no longer be opened"} tone={sentAlready ? "slate" : "red"}>
        <p>{dead.message}</p>
        {!sentAlready && <p className="mt-2">Ask {brandNameInProse(branding)} HR for a new form if you still need to send one.</p>}
      </PublicNotice>
    </PublicLayout>;
  }
  if (submitted) {
    const startedOn = dayLabel(String(submitted.resignationDate || form.resignationDate).slice(0, 10));
    const lastDay = dayLabel(String(submitted.proposedLastWorkingDate || "").slice(0, 10) || lastWorkingDay);
    return <PublicLayout width="3xl">
      <PublicNotice title="Submitted to HR" tone="green">
        <p>You resigned on <strong>{startedOn}</strong>, and your proposed last working day is <strong>{lastDay}</strong>.</p>
        <p className="mt-2">HR will confirm these dates with you. Nothing about your employment changes until they do.</p>
        {/* Where to go if a date is wrong. This link is spent, so the only way back is a person -
            saying so is better than letting somebody press a dead page looking for an edit. */}
        <p className="mt-2">Told us the wrong day? Speak to {brandNameInProse(branding)} HR and they can correct it before they confirm.</p>
      </PublicNotice>
    </PublicLayout>;
  }

  return <PublicLayout width="3xl">
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <header className="flex flex-col items-center text-center">
        <AppLogo className="h-12 w-auto" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Your resignation details</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
          {brandNameInProse(branding)} HR has asked you to confirm when your notice period starts. They work out your last working day from it and confirm both with you; nothing about your employment changes until they do.
        </p>
        {invite?.expiresAt && <p className="mt-1 text-xs text-slate-500">Open until {dayLabel(String(invite.expiresAt).slice(0, 10))}.</p>}
        {/* A stranger's first question about an unexpected link. Said here rather than only at the
            end, because somebody who was not expecting this should not have to fill it in to ask. */}
        <p className="mt-1 text-xs text-slate-500">Not expecting this? Speak to HR before you fill anything in.</p>
      </header>

      {!details
        ? <form onSubmit={verify} className="mx-auto max-w-lg py-7">
          <p className="text-sm text-slate-600">
            To open your form, enter the email address or phone number on your employee record
            {invite?.maskedEmail ? <> — we hold <strong>{invite.maskedEmail}</strong>{invite?.maskedPhone ? <> and <strong>{invite.maskedPhone}</strong></> : null}</> : null}.
          </p>
          <TextField
            className="mt-5"
            required
            label="Email or phone number"
            helperText="The email or phone on your employee record, to confirm it is you."
            value={identifier}
            onChange={(event) => { setIdentifier(event.target.value); setIdentifierError(""); }}
            error={identifierError}
          />
          <Button className="mt-5 w-full" variant="primary" size="lg" disabled={verifying || !identifier.trim()}>{verifying ? "Verifying…" : "Continue"}</Button>
        </form>
        : <form onSubmit={submit} className="py-7">
          {/*
            * Their record, read back rather than asked for.
            *
            * Nobody resigning should be made to type their own employee ID, designation, team,
            * manager or joining date - the studio holds every one of them, and a form that asks is a
            * form that can be answered wrongly. They are here to be **checked**: the one question
            * worth somebody's attention before they resign is whether this is their own record. None
            * of it is editable, because a detail that is wrong is a conversation with HR rather than
            * a box on a resignation form.
            */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
            <p className="font-medium text-slate-800">{details.employeeName}{details.employeeCode ? ` · ${details.employeeCode}` : ""}</p>
            <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {[
                ["Designation", details.designation],
                ["Department / Team", details.department],
                ["Reporting manager", details.reportingManager && details.reportingManagerDesignation ? `${details.reportingManager} · ${details.reportingManagerDesignation}` : details.reportingManager],
                ["Date of joining", details.dateOfJoining ? dayLabel(String(details.dateOfJoining).slice(0, 10)) : ""],
                ["Official email", details.officialEmail],
                ["Notice period", noticePeriodLabel(noticeDays)],
              ].map(([label, value]) => <div key={label} className="min-w-0">
                <dt className="text-xs font-medium text-slate-500">{label}<HelpTip text={RECORD_FACT_HELP[label]} /></dt>
                <dd className="mt-0.5 break-words text-slate-800">{value || "Not on your record"}</dd>
              </div>)}
            </dl>
            {details.hrNote && <p className="mt-3 text-slate-600"><span className="font-medium text-slate-700">From HR:</span> {details.hrNote}</p>}
          </div>

          {/*
            * The remark that reopened the form, above the fields rather than beside them: it is the
            * only reason this person is on this page again, and the one thing they have to read.
            * Stated as a correction and not a refusal - their resignation still stands.
            */}
          {details.sendBackRemark && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-semibold text-amber-900">HR has asked you to correct something</p>
            <p className="mt-1 whitespace-pre-line text-amber-900">{details.sendBackRemark}</p>
            <p className="mt-2 text-xs text-amber-800">Your answers are still here. Change what needs changing and submit again - your resignation has not been refused.</p>
          </div>}

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {/*
              * Bounded rather than open: the calendar used to offer any day in history or 2074, and
              * a mistyped year set somebody's last working day decades out. A month back covers a
              * resignation dated before the form reached them, and three months forward covers one
              * planned ahead; anything outside that is a conversation with HR, not a date picker.
              */}
            {/* HR's date when HR set it: shown, not asked, and kept by the server whatever is sent. */}
            {details?.resignationDateFixed ? <TextField
              label="Resignation date"
              helperText="Set by HR; your notice period counts from this date. Speak to HR if it is wrong."
              readOnly
              value={form.resignationDate ? dayLabel(form.resignationDate) : "Not set"}
            /> : <DateField
              required
              label="Resignation date"
              helperText="The day you resign; your notice period counts from this date."
              minDate={dayFromToday(-30)}
              maxDate={dayFromToday(90)}
              value={form.resignationDate}
              onChange={(value) => { setForm((current) => ({ ...current, resignationDate: value })); setProblems((current) => ({ ...current, resignationDate: "" })); }}
              error={problems.resignationDate}
            />}
            {/*
              * Shown, not asked: it is the notice period counted from the date beside it, so a box
              * here would invite two answers to one question - and the browser does not send it at
              * all. Drawn because nobody should have to work their own last day out from a number of
              * days, and because a date somebody is held to is a date they should see before they
              * agree to it. Leaving earlier than this is a conversation with HR, who set the notice
              * period and can change the date on the separation itself.
              */}
            <TextField
              label="Proposed last working day"
              helperText="Worked out from your resignation date and notice period; HR can change it."
              readOnly
              value={lastWorkingDay ? dayLabel(lastWorkingDay) : "Not set"}
            />
          </div>

          {/* The list HR's own separation form offers for a resignation, sent with the form rather
              than written into this page - so the two sides cannot drift, and the studio can count
              why people leave. Anything that does not fit is "Others" plus the box below. */}
          <Dropdown
            className="mt-4"
            required
            label="Reason for resignation"
            helperText="The main reason you are leaving; choose Others if none fits."
            placeholder="Select a reason"
            options={details.reasons || []}
            value={form.reason}
            onChange={(value) => { setForm((current) => ({ ...current, reason: value })); setProblems((current) => ({ ...current, reason: "" })); }}
            error={problems.reason}
          />
          {/* `(event) => event.target.value`, because `TextAreaField` spreads its props onto the
              `<textarea>` and so hands over the **event**, as `TextField` does. Read as a value, the
              box filled with "[object Object]" and could not be typed in. */}
          <TextAreaField
            className="mt-4"
            label="Detailed reason / comments"
            helperText="Optional. Anything more about why you are leaving that HR should know."
            maxLength={5000}
            value={form.detailedReason}
            onChange={(event) => setForm((current) => ({ ...current, detailedReason: event.target.value }))}
          />
          <FileUploadField
            className="mt-4"
            label="Resignation letter"
            helperText="Optional. Your signed letter, as a PDF or a photo, up to 5 MB."
            accept=".pdf,image/jpeg,image/png,image/webp"
            maxFiles={1}
            value={form.letter}
            onChange={(value) => setForm((current) => ({ ...current, letter: value }))}
          />
          {details.answers?.letterFileName && <p className="mt-1.5 text-xs text-slate-500">You already attached {details.answers.letterFileName} - it stays on the form unless you pick another.</p>}

          <p className="mt-5 text-xs leading-5 text-slate-500">
            Submitting this puts it in front of HR. Nothing about your employment changes until they have read it and confirmed your dates.
          </p>
          <Button className="mt-4 w-full" variant="primary" size="lg" disabled={submitting}>{submitting ? "Submitting…" : "Submit"}</Button>
        </form>}
    </section>
  </PublicLayout>;
}
