"use client";

import { useEffect, useMemo, useState } from "react";
import { getApplicationInvite, submitApplication, verifyApplicationInvite } from "@/services/interview/application.service";
import { employeeDetailLists, detailListErrors, filledDetailRows } from "@/constants/employeeDetailFields";
import { dateOfBirthError } from "@/constants/fieldValidation";
import {
  EXPERIENCE_LEVELS,
  EXPERIENCED,
  FRESHER,
  IMMEDIATE_JOIN,
  IMMEDIATE_JOINER_ANSWERS,
  JOINS_IMMEDIATELY,
  JOINS_LATER,
  MAX_PORTFOLIO_LINKS,
  NOTICE_PERIODS,
  totalExperienceFrom,
  applicationFieldLabels,
  applicationFieldNormalizers,
  applicationFormSections,
  applicationInitialValues,
  missingApplicationFields,
} from "@/constants/interviewApplicationConfig";
import { EMPLOYMENT_TYPES } from "@/constants/interviewConfig";
import { genderOptions } from "@/constants/employeeOptions";
import SchemaFormField, { visibleFields } from "@/components/schema-form/SchemaFormFields";
import AppLogo from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { brandNameInProse } from "@/lib/studioBranding.mjs";
import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import RepeatableDetailsField from "@/components/shared/RepeatableDetailsField";
import RepeatableTextList from "@/components/shared/RepeatableTextList";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";

/**
 * The application form a candidate fills in from the link the Interview screen sent them.
 *
 * The public onboarding form's own screen, asked of somebody the studio is considering rather than
 * somebody it has taken on: the same layout, the same verify-then-fill flow, the same shared schema
 * fields, the same refusal that marks the field and scrolls to the section holding it. It is built
 * from `interviewApplicationConfig`, which asks what a hiring form asks and deliberately asks none
 * of what the onboarding form asks - no identity proofs, no bank details, no family. That is
 * collected once an offer is made, on the form built for it.
 *
 * The two repeating lists are the employee record's own Qualification and Experience lists, reused
 * unchanged: what somebody studied and where they have worked are the same questions whether they
 * are applying or joining, and sharing the description means a submission becomes a record HR can
 * read without either screen learning about the other.
 */

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

function PublicLayout({ children }) {
  return <main className="min-h-[100dvh] bg-slate-100 px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto w-full max-w-5xl">{children}</div></main>;
}

function Notice({ title, children, tone = "slate" }) {
  const styles = tone === "red" ? "border-red-200 bg-red-50 text-red-800" : tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700";
  return <section className={`rounded-xl border p-6 shadow-sm ${styles}`}><h1 className="text-xl font-semibold">{title}</h1><div className="mt-2 text-sm leading-6">{children}</div></section>;
}

function ContextItem({ label, value }) {
  return <div><p className="font-medium text-slate-500">{label}</p><p className="mt-1 break-words text-slate-800">{value || "—"}</p></div>;
}

/*
 * The two repeating lists, each drawn from the one shared description the employee forms use. Their
 * `error` is the row-keyed object `detailListErrors()` builds rather than a single message: a
 * problem belongs on the row it is about, and on the field within it.
 */
const LISTS = ["qualifications", "experiences"];

/*
 * What this form says about a list where the employee record's own wording does not fit it.
 *
 * Experience Details tells the reader to "leave this empty if you are a fresher", which was the
 * right sentence while every candidate saw the list. A fresher is now never shown it - the question
 * above decides - so the sentence would only ever be read by somebody it does not describe. The
 * shared description is left alone, because the onboarding form still draws the list unconditionally.
 */
const LIST_PROPS = {
  experiences: { hint: "Add each company you have worked at, with the role and how long. Attach the experience or relieving letter where you have one." },
};

/* The ⓘ beside each custom control's label, where the section list does not give one of its own.
   The two lists need none here: their own hint is already their ⓘ. */
const CUSTOM_HELP = {
  portfolioLinks: "Links that show your work, such as a portfolio, Instagram or Drive folder.",
};
const helpFor = (field, name) => field?.helperText || CUSTOM_HELP[name] || "";

const renderers = {
  ...Object.fromEntries(LISTS.map((name) => [name, ({ values, onChange, field, error }) => <RepeatableDetailsField
    {...employeeDetailLists[name].props}
    {...(LIST_PROPS[name] || {})}
    helperText={helpFor(field, name)}
    required={field?.required}
    value={values[name] || []}
    errors={error && typeof error === "object" ? error : {}}
    error={typeof error === "string" ? error : ""}
    onChange={onChange}
  />])),
  /*
   * The Experience Details rows, added up and shown back.
   *
   * It reads the rows out of `values` rather than closing over a computed total, which is what lets
   * it live here at module scope beside the lists: the sum is a function of the answers, so the
   * renderer that draws it can be one too. Read-only for the reason the field is declared at all -
   * a box somebody could type into would be a second answer to a question the rows already answer.
   */
  /*
   * The candidate's links: one box to begin with, a plus to add the next, up to three. The cap is
   * said in the label's ⓘ rather than drawn as a disabled plus, because a control that exists only to
   * refuse is not one this application puts on screen.
   */
  portfolioLinks: ({ values, onChange, field, error }) => <RepeatableTextList
    label={<>{field?.label || "Portfolio / Links"}<HelpTip text={`${helpFor(field, "portfolioLinks")} Up to ${MAX_PORTFOLIO_LINKS}.`} /></>}
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
   * What the register will record as this candidate's Experience, shown back as they answer.
   *
   * Drawn for **everybody**, not only somebody experienced. It is the same value either way - the
   * rows' own sum, or the word "Fresher" - so for a fresher it is a readout of their answer rather
   * than a box asking it again, and it keeps the question above it company: a lone select in the
   * left column pushed every pair after it out of step, which is what put Expected Joining Date
   * under the wrong question and split the two salaries across two rows.
   */
  totalExperience: ({ values, field }) => <TextField
    label={field?.label || "Total Experience"}
    helperText={field?.helperText || "Added up from your experience rows, or Fresher; it cannot be typed."}
    value={values.experienceLevel === EXPERIENCED ? (totalExperienceFrom(values.experiences) || "") : (values.experienceLevel || "")}
    onChange={() => {}}
    readOnly
    placeholder={values.experienceLevel === EXPERIENCED ? "Added up from the rows below" : "Answer above"}
  />,
};

/*
 * Which section to scroll to for a given field - including the two repeating lists, which are
 * ordinary `custom` fields of the sections they belong to now rather than a section of their own.
 * That is what lets a row problem scroll to About You or to Experience & Expectations by the same
 * rule every other field uses, with no separate anchor to keep in step.
 */
const sectionByField = Object.fromEntries(
  applicationFormSections.flatMap((section) => section.fields.map((field) => [field.name, section.id])),
);

/** Put the section holding the first problem at the top of the candidate's view. */
function scrollToSection(sectionId) {
  if (!sectionId || typeof document === "undefined") return;
  document.querySelector(`[data-schema-section="${sectionId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function PublicApplicationForm({ token }) {
  const branding = useStudioBranding();
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [form, setForm] = useState(applicationInitialValues);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  useEffect(() => {
    let active = true;
    getApplicationInvite(token)
      .then((data) => { if (active) setInvite(data); })
      .catch((error) => { if (active) setLoadError(errorMessage(error, "Unable to load this application link.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  /*
   * What the form's pickers draw from. The genders are the studio's own list, maintained in
   * Settings → Field Settings, and a candidate has no session to read that master data with - so
   * the invite carries them. Each falls back to what the browser has always held.
   */
  const context = useMemo(() => ({
    renderers,
    options: {
      genders: invite?.options?.genders?.length ? invite.options.genders : genderOptions,
      employmentTypes: invite?.options?.employmentTypes?.length ? invite.options.employmentTypes : EMPLOYMENT_TYPES,
      // Two fixed answers rather than master data: they are a branch in this form, not a list the
      // studio maintains, and a studio renaming "Fresher" would change what the branch tests.
      experienceLevels: EXPERIENCE_LEVELS,
      // Fixed for the same reason: bands the studio reads a decision off, not master data. `sorted:
      // false` on the field keeps them in ladder order rather than alphabetical, where "Under 15
      // days" would sort below "Under 45 days".
      noticePeriods: NOTICE_PERIODS,
      // Yes and No, as the radio draws them. Fixed for the same reason the two above are.
      immediateJoinerAnswers: IMMEDIATE_JOINER_ANSWERS,
    },
  }), [invite]);

  /*
   * Whether the work history applies, and what the rows come to.
   *
   * Both are read at render rather than kept in state: a total held in state would have to be
   * written by an effect every time a row changed, which is the one thing this codebase keeps out
   * of components, and a second copy of a number that is already on screen is a second thing that
   * can be wrong.
   */
  const experienced = form.experienceLevel === EXPERIENCED;
  const totalExperience = totalExperienceFrom(form.experiences);

  // A file that was rejected before it could be read reports why, and that reason is the only thing
  // worth saying about it - the field is left as it was.
  function update(field, value, inputError) {
    if (typeof inputError === "string" && inputError) {
      showError(inputError);
      return;
    }
    const normalize = applicationFieldNormalizers[field];
    setForm((current) => ({ ...current, [field]: normalize ? normalize(value) : value }));
    setFieldErrors((current) => {
      const updated = { ...current };
      delete updated[field];
      return updated;
    });
  }

  async function verify(event) {
    event.preventDefault();
    // Checked here rather than sent blank for the server to refuse.
    if (!identifier.trim()) {
      setFieldErrors({ identifier: "Enter your email or phone number." });
      return;
    }
    setVerifying(true);
    try {
      const result = await verifyApplicationInvite(token, identifier);
      // HR has already typed the candidate's name, phone, email and the position into the invite,
      // so the form starts from those rather than asking for them again. They stay editable, since
      // this is the candidate's chance to correct anything that was mistyped.
      const candidate = result?.candidate;
      if (candidate) {
        setForm((current) => ({
          ...current,
          firstName: candidate.firstName || current.firstName,
          lastName: candidate.lastName || current.lastName,
          contactNumber: candidate.phone || current.contactNumber,
          emailId: candidate.email || current.emailId,
          position: candidate.position || current.position,
        }));
      }
      /*
       * Anything already on the register for this candidate arrives whole, so a link opened a
       * second time - or after HR filled some of it in - is corrected rather than retyped.
       */
      const prefill = result?.prefill;
      if (prefill) {
        setForm((current) => ({
          ...current,
          /*
           * Only the keys this form still asks about.
           *
           * The prefill is the register's own row, which holds columns the form has stopped asking
           * for - Available From is one, Department another. Spread whole, those landed in the form
           * state unseen and were posted straight back on submit, so a question nobody is asked was
           * still being answered on the candidate's behalf. `applicationInitialValues` is built
           * from the sections themselves, which makes the schema the single authority on what this
           * form may send, and keeps it that way for whatever is removed next.
           */
          ...Object.fromEntries(Object.entries(prefill)
            .filter(([key]) => key in applicationInitialValues)
            .filter(([, value]) => value !== null && value !== undefined && value !== "")),
          qualifications: prefill.qualifications?.length ? prefill.qualifications : current.qualifications,
          experiences: prefill.experiences?.length ? prefill.experiences : current.experiences,
          /*
           * Fresher or experienced, answered from what the register already holds rather than asked
           * again: a link opened a second time, or after HR filled some of it in, should come back
           * as it was left. Rows on the record mean experienced; the word "fresher" in the
           * Experience column means fresher; anything else leaves the question unanswered, which is
           * the honest reading of a column that says "2 years" and nothing about rows.
           */
          experienceLevel: prefill.experiences?.length
            ? EXPERIENCED
            : /fresher/i.test(String(prefill.experience || "")) ? FRESHER : current.experienceLevel,
          /*
           * The joining answer, read back off `availableFrom` the same way: the word "immediate"
           * in it is a Yes, a day in it is a No with that day already filled in, and anything else
           * - a blank, or an imported "15 days" - leaves the question unanswered rather than
           * guessing, which is the honest reading of a column that can hold any of the three.
           */
          immediateJoiner: /immediate/i.test(String(prefill.availableFrom || ""))
            ? JOINS_IMMEDIATELY
            : /^\d{4}-\d{2}-\d{2}/.test(String(prefill.availableFrom || "")) ? JOINS_LATER : current.immediateJoiner,
          // A word in that column is not a date the picker can show, so only a real day is kept.
          availableFrom: /^\d{4}-\d{2}-\d{2}/.test(String(prefill.availableFrom || ""))
            ? String(prefill.availableFrom).slice(0, 10)
            : "",
          // The résumé is a file the form uploads, not a link it shows back: an application carrying
          // one already keeps it unless a new file is chosen, and the server leaves it alone.
          resume: current.resume,
          attachments: prefill.attachments?.length ? prefill.attachments : current.attachments,
        }));
      }
      setVerified(true);
      showSuccess("Verified. Complete your application below and submit it.");
    } catch (error) {
      showError(errorMessage(error, "The entered email or phone does not match this application link."));
    } finally {
      setVerifying(false);
    }
  }

  /** Refuse the submission: mark the fields, say why, and go to the first of them. */
  function refuse(errors, message, sectionId) {
    setFieldErrors(errors);
    showError(message);
    scrollToSection(sectionId || sectionByField[Object.keys(errors)[0]]);
  }

  async function submit(event) {
    event.preventDefault();

    const missing = missingApplicationFields(form, context);
    if (missing.length) {
      refuse(Object.fromEntries(
        applicationFormSections
          .flatMap((section) => section.fields)
          .filter((field) => missing.includes(field.label))
          .map((field) => [field.name, "Required"])
      ), "Please fill in all required fields.");
      return;
    }

    if (form.emailId && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(String(form.emailId).trim())) {
      refuse({ emailId: "Enter a valid email address, for example name@example.com." }, "Please fix the errors in the form.");
      return;
    }
    if (form.contactNumber && !/^(\d{1,3})?[6-9]\d{9}$/.test(String(form.contactNumber).replace(/\D/g, ""))) {
      refuse({ contactNumber: "Enter a 10-digit mobile number, optionally with a country code." }, "Please fix the errors in the form.");
      return;
    }

    /*
     * Nobody under eighteen can be taken on. The calendar already refuses those days, so this
     * catches a date that arrived another way and says what is wrong rather than letting the
     * server answer with a 400. A blank date of birth is fine: it is not required here.
     */
    if (form.dateOfBirth) {
      const ageProblem = dateOfBirthError(form.dateOfBirth);
      if (ageProblem) {
        refuse({ dateOfBirth: ageProblem }, ageProblem);
        return;
      }
    }

    /*
     * The two lists. A row nobody filled in is dropped rather than complained about, so what is
     * left is a row somebody started and did not finish - which is worth stopping for.
     */
    const listProblems = Object.fromEntries(
      // A fresher's rows are not read at all: the list is not on their screen, and a row left
      // behind by somebody who answered Experienced and then changed their mind is not a problem
      // to solve - it is simply not sent.
      LISTS.filter((name) => name !== "experiences" || experienced)
        .map((name) => [name, detailListErrors(name, form[name])])
        .filter(([, problems]) => Object.keys(problems).length),
    );
    if (Object.keys(listProblems).length) {
      refuse(listProblems, "Please complete the highlighted rows, or remove the ones you did not mean to add.");
      return;
    }

    /*
     * Somebody who says they are experienced has to say where.
     *
     * The alternative is a candidate who chose Experienced, scrolled past an empty list and
     * submitted - arriving on the register as experienced with nothing to show for it, which reads
     * as a form that lost their answers rather than one they left empty.
     */
    if (experienced && !filledDetailRows("experiences", form.experiences).length) {
      refuse({ experiences: "Add the company you worked at, or answer Fresher above." }, "Add at least one company to your work experience, or answer Fresher above.");
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      // `experienceLevel` is this form's own branch rather than a column on the register, so it is
      // taken out here; what the register keeps is the Experience it decides - "Fresher", or what
      // the rows add up to.
      const { qualifications, experiences, resume, attachments, experienceLevel, immediateJoiner, portfolioLinks: _links, ...values } = form;
      /*
       * When they can join, as the one free-text column that has always held it.
       *
       * Yes is the word "Immediate"; No is the date they gave. An unanswered question sends
       * nothing, which the filter below drops - the register keeps whatever HR or a sheet put
       * there rather than having it blanked by a question nobody answered.
       */
      if (immediateJoiner === JOINS_IMMEDIATELY) values.availableFrom = IMMEDIATE_JOIN;
      else if (immediateJoiner !== JOINS_LATER) values.availableFrom = "";
      // The total is the rows' own sum, drawn back for the candidate to read rather than answered
      // by them. What the register keeps is `experience`, set on the next line.
      delete values.totalExperience;
      values.experience = experienced ? totalExperience : FRESHER;
      // Anything left blank is dropped rather than sent as an empty string, which is neither a date
      // nor an email address as far as the server is concerned.
      const payload = Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== "" && value !== null && value !== undefined),
      );
      // The two lists are sent apart from the rest because each is rows rather than a value, and
      // without the keys the field uses to tell one row from another.
      /*
       * The links somebody actually typed. The empty boxes are dropped here rather than as they are
       * typed, so a candidate who opens a third box and fills the second first does not have the
       * third taken away underneath them; what is left is trimmed to the cap the server also holds.
       */
      payload.portfolioLinks = (Array.isArray(form.portfolioLinks) ? form.portfolioLinks : [])
        .map((link) => String(link || "").trim())
        .filter(Boolean)
        .slice(0, MAX_PORTFOLIO_LINKS);
      payload.qualifications = filledDetailRows("qualifications", qualifications);
      // A fresher sends no rows, whatever was typed before they answered Fresher.
      payload.experiences = experienced ? filledDetailRows("experiences", experiences) : [];
      if (Array.isArray(resume) && resume.length) payload.resume = resume;
      // Sent only when something is attached, so a re-submission that adds none leaves the files
      // already on the record alone rather than clearing them.
      if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;
      await submitApplication(token, payload);
      setSubmitted(true);
    } catch (error) {
      showError(errorMessage(error, "Unable to submit your application. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PublicLayout><Notice title="Job Application"><Loader label="Checking your application link…" inline /></Notice></PublicLayout>;
  if (loadError) return <PublicLayout><Notice title="This application link is unavailable" tone="red">{loadError}</Notice></PublicLayout>;
  if (submitted) return <PublicLayout><Notice title="Your application has been submitted successfully." tone="green">Our HR team will review it and contact you.</Notice></PublicLayout>;

  return <PublicLayout>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <header className="mb-6 text-center sm:mb-8">
      {/* The studio's own mark rather than the product's name in words: a candidate opening this
          link sees the studio that asked them for it. */}
      <div className="flex justify-center"><AppLogo variant="onboarding" priority /></div>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900 sm:text-3xl">Job Application</h1>
      <p className="mt-2 text-sm text-slate-600 sm:text-base">Complete your application for {brandNameInProse(branding)}.</p>
    </header>
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="grid gap-4 border-b border-slate-200 pb-5 text-sm sm:grid-cols-2">
        <ContextItem label="Candidate Name" value={invite.candidateName} />
        <ContextItem label="Position" value={invite.position} />
        <ContextItem label="Email" value={invite.candidateEmailMasked} />
        <ContextItem label="Phone" value={invite.candidatePhoneMasked} />
        <ContextItem label="Open Until" value={formatDate(invite.expiresAt)} />
      </div>

      {!verified ? <form onSubmit={verify} className="mx-auto max-w-lg py-7">
        <h2 className="text-lg font-semibold text-slate-900">Verify your link</h2>
        <p className="mt-1 text-sm text-slate-600">Enter the email address or phone number this link was sent to.</p>
        <TextField className="mt-5" required label="Email or Phone Number" helperText="Must match the email or phone this link was sent to." value={identifier} onChange={(event) => { setIdentifier(event.target.value); setFieldErrors({}); }} error={fieldErrors.identifier} />
        <Button className="mt-5 w-full" variant="primary" size="lg" disabled={verifying}>{verifying ? "Verifying…" : "Continue"}</Button>
      </form> : <form onSubmit={submit} className="pt-7">
        {/* `data-schema-section` is the anchor `scrollToSection` finds a heading by - the same
            attribute `SchemaFormSection` puts on the signed-in forms, so both refuse the same way. */}
        {applicationFormSections.map((section) => <section key={section.id} id={section.id} data-schema-section={section.id} className="border-t border-slate-200 py-6 first:border-t-0 first:pt-0">
          <h2 className="mb-5 text-base font-semibold text-slate-900 sm:text-lg">{section.title}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Through the same filter the schema form panel applies, so a field that only applies
                to some answers stays hidden until it does. The section's order is what keeps the
                grid tidy as they come and go - see the note on it in `interviewApplicationConfig`. */}
            {visibleFields(section.fields, form, context).map((field) => <SchemaFormField key={field.name} field={field} values={form} onChange={update} errors={fieldErrors} context={context} />)}
          </div>
        </section>)}

        <div className="flex justify-end border-t border-slate-200 pt-6">
          <Button className="max-sm:w-full" variant="primary" size="lg" disabled={submitting}>{submitting ? "Submitting…" : "Submit application"}</Button>
        </div>
      </form>}
    </section>
  </PublicLayout>;
}
