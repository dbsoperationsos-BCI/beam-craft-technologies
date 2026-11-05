"use client";

import { useEffect, useMemo, useState } from "react";
import { getOnboardingInvite, submitOnboardingInvite, verifyOnboardingInvite } from "@/services/onboarding/onboarding.service";
import { bloodGroupOptions, emergencyContactRelationshipOptions, genderOptions, isMarried, languageOptions, maritalStatusOptions, skillOptions, workTypeOptions } from "@/constants/employeeOptions";
import { detailListErrors, employeeDetailLists, filledDetailRows } from "@/constants/employeeDetailFields";
import { dateOfBirthError, formatErrors } from "@/constants/fieldValidation";
import { fieldLabels, fieldNormalizers, missingOnboardingFields, onboardingFormSections, onboardingInitialValues } from "@/constants/onboardingFormConfig";
import SchemaFormField, { visibleFields } from "@/components/schema-form/SchemaFormFields";
import AppLogo from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import { brandNameInProse } from "@/lib/studioBranding.mjs";
import Button from "@/components/shared/Button";
import Checkbox from "@/components/shared/Checkbox";
import RepeatableDetailsField from "@/components/shared/RepeatableDetailsField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import SearchableMultiSelect from "@/components/shared/SearchableMultiSelect";
import TextField from "@/components/shared/TextField";
import { onboardingAgreementText } from "./agreementText";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function errorMessage(error, fallback) {
  return error?.data?.message || error?.message || fallback;
}

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
 * Too many skills and languages for a dropdown, so they are ticked off a searchable list instead.
 *
 * Each renderer is handed the `field` it is drawing for, so `required` and the message come from
 * the one description in `onboardingFormConfig` rather than being written a second time here - a
 * field marked required in the config is starred by that alone.
 */
const renderers = {
  skills: ({ values, onChange, field, error }) => <SearchableMultiSelect
    label="Skills"
    required={field.required}
    helperText={field.helperText}
    error={typeof error === "string" ? error : ""}
    placeholder="Search skills..."
    emptyText="No matching skills."
    summary={(count) => count ? `${count} skill(s) selected` : "No skills selected"}
    options={skillOptions}
    value={values.skills || []}
    onChange={onChange}
  />,
  // `context` rather than the imported array: the languages are the studio's list now, and the
  // invite carries them. The array stands in only when the server sends none.
  languagesKnown: ({ values, onChange, field, error, context }) => <SearchableMultiSelect
    label="Languages Known"
    required={field.required}
    helperText={field.helperText}
    error={typeof error === "string" ? error : ""}
    placeholder="Search languages..."
    emptyText="No matching languages."
    summary={(count) => count ? `${count} language(s) selected` : "No languages selected"}
    options={context?.options?.languages?.length ? context.options.languages : languageOptions}
    value={values.languagesKnown || []}
    onChange={onChange}
  />,
  // The three repeating lists, each drawn from its one shared description. Their `error` is the
  // row-keyed object `detailListErrors()` builds rather than a single message: a problem belongs on
  // the row it is about, and on the field within it.
  ...Object.fromEntries(Object.keys(employeeDetailLists).map((name) => [name, ({ values, onChange, field, error }) => <RepeatableDetailsField
    {...employeeDetailLists[name].props}
    required={field.required}
    value={values[name] || []}
    // The two kinds of problem a list can have, kept apart: a row-keyed object is a problem inside
    // a row, and a plain message is one about the list itself - which is what an empty required
    // list gets, since there is no row for it to be shown on.
    errors={error && typeof error === "object" ? error : {}}
    error={typeof error === "string" ? error : ""}
    onChange={onChange}
  />])),
};

/**
 * Which section a field is in, and the id of the one holding the agreement.
 *
 * Built from the same config the form is drawn from, so a field moved between sections is followed
 * here without anybody remembering to. The agreement is not in that config - it is a checkbox and a
 * wall of policy text rather than a field - so it carries its own id and is named here beside them.
 */
const AGREEMENT_SECTION = "agreement";
const sectionByField = Object.fromEntries(
  onboardingFormSections.flatMap((section) => section.fields.map((field) => [field.name, section.id])),
);

/**
 * Put the section holding the first problem at the top of the candidate's view.
 *
 * The form is eight sections long on a phone, and a refusal used to mark the field and say "Please
 * fill in all required fields" from a notice at the top - which is the whole complaint restated:
 * somebody who cannot see the marked field is being told to go and find it. This is the same move
 * `EmployeeFormPanel` makes when it refuses, against the page itself rather than an inner pane,
 * because this form scrolls the window.
 *
 * Nothing happens for a problem with no section - there is none at present, and a refusal that
 * cannot find where to go should still refuse rather than throw.
 */
function scrollToSection(sectionId) {
  if (!sectionId || typeof document === "undefined") return;
  document.querySelector(`[data-schema-section="${sectionId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function PublicOnboardingForm({ token }) {
  // The same branding the mark above the title is drawn from, for the sentence under it.
  const branding = useStudioBranding();
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [identifier, setIdentifier] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [form, setForm] = useState(onboardingInitialValues);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  useEffect(() => {
    let active = true;
    getOnboardingInvite(token)
      .then((data) => { if (active) setInvite(data); })
      .catch((error) => { if (active) setLoadError(errorMessage(error, "Unable to load this onboarding invite.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  /*
   * What the form draws its pickers from, and the one rule that depends on a list rather than a
   * value: which marital statuses ask for a spouse.
   *
   * The studio maintains gender, work type, marital status, the emergency contact relationship,
   * blood group and the languages in
   * Settings → Field Settings, and a candidate has no session to read that master data with - so the
   * invite carries the lists, and this is where they reach the fields. Each falls back to the array
   * the browser has always held, which is what an unseeded database or an older server answers with.
   */
  const context = useMemo(() => ({
    renderers,
    options: {
      genders: invite?.options?.genders?.length ? invite.options.genders : genderOptions,
      workTypes: invite?.options?.workTypes?.length ? invite.options.workTypes : workTypeOptions,
      maritalStatuses: invite?.options?.maritalStatuses?.length ? invite.options.maritalStatuses : maritalStatusOptions,
      bloodGroups: invite?.options?.bloodGroups?.length ? invite.options.bloodGroups : bloodGroupOptions,
      languages: invite?.options?.languages?.length ? invite.options.languages : languageOptions,
      emergencyContactRelationships: invite?.options?.emergencyContactRelationships?.length
        ? invite.options.emergencyContactRelationships
        : emergencyContactRelationshipOptions,
    },
    spouseRequiringMaritalStatuses: invite?.options?.spouseRequiringMaritalStatuses,
  }), [invite]);

  // An image that was rejected before it could be read reports why, and that reason is the only
  // thing worth saying about it — the field is left as it was.
  function update(field, value, inputError) {
    if (typeof inputError === "string" && inputError) {
      showError(inputError);
      return;
    }
    const normalize = fieldNormalizers[field];
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
      const result = await verifyOnboardingInvite(token, identifier);
      // HR has already typed the candidate's name, phone and email into the invite, so the form
      // starts from those rather than asking for them again. They stay editable, since this is the
      // candidate's chance to correct anything that was mistyped.
      const candidate = result?.candidate;
      if (candidate) {
        setForm((current) => ({
          ...current,
          firstName: candidate.firstName || current.firstName,
          lastName: candidate.lastName || current.lastName,
          contactNumber: candidate.phone || current.contactNumber,
          emailId: candidate.email || current.emailId,
        }));
      }
      /*
       * A submission HR sent back for edits arrives whole: the server hands back every field of
       * it (images as their stored links, which the submission accepts back unchanged), so the
       * candidate corrects what was queried instead of retyping a finished form.
       */
      const prefill = result?.prefill;
      if (prefill) setForm((current) => ({ ...current, ...prefill }));
      setVerified(true);
      showSuccess(prefill
        ? "Invite verified. Your submitted details are filled in below - edit what is needed and resubmit."
        : "Invite verified. Complete the details below to submit them to HR.");
    } catch (error) {
      showError(errorMessage(error, "The entered email or phone does not match this invite."));
    } finally {
      setVerifying(false);
    }
  }

  /**
   * Refuse the submission: mark the fields, say why, and go to the first of them.
   *
   * One helper for all five refusals below, which each used to mark and shout and leave the reader
   * wherever they pressed. The scroll is the half that was missing - the marks are only useful to
   * somebody already looking at the right heading, and this form is eight sections long.
   *
   * The errors are keyed by field name in the form's own order, so the first key is the first
   * problem going down the page, which is the one to go to.
   */
  function refuse(errors, message, sectionId) {
    setFieldErrors(errors);
    showError(message);
    scrollToSection(sectionId || sectionByField[Object.keys(errors)[0]]);
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.policyAgreementAccepted) {
      /*
       * Not through `refuse`, and deliberately: the agreement is a checkbox under the policy text
       * rather than one of the config's fields, and `refuse` *replaces* the marks on the form. This
       * check runs before the required-field one, so a candidate who has left fields blank and not
       * ticked the box would watch their marks disappear. The box's mark is added beside them, and
       * said beside the box rather than in a toast.
       */
      setFieldErrors((current) => ({ ...current, policyAgreementAccepted: "Tick the box to accept the agreement." }));
      scrollToSection(AGREEMENT_SECTION);
      return;
    }

    const missing = missingOnboardingFields(form, context);
    if (missing.length) {
      refuse(Object.fromEntries(
        onboardingFormSections
          .flatMap((section) => section.fields)
          .filter((field) => missing.includes(field.label))
          .map((field) => [field.name, "Required"])
      ), "Please fill in all required fields.");
      return;
    }

    const [badField] = formatErrors(form, fieldLabels);
    if (badField) {
      refuse({ [Object.keys(fieldLabels).find((key) => fieldLabels[key] === badField[0])]: badField[1] }, "Please fix the errors in the form.");
      return;
    }

    /*
     * Nobody under eighteen can be taken on. The calendar already refuses those days, so this
     * catches a date that arrived another way — a submission HR sent back, filled in before the
     * rule existed — and says what is wrong rather than letting the server answer with a 400.
     */
    const ageProblem = dateOfBirthError(form.dateOfBirth);
    if (ageProblem) {
      refuse({ dateOfBirth: ageProblem }, ageProblem);
      return;
    }

    /*
     * The three repeating lists. A row nobody filled in is dropped rather than complained about,
     * so what is left is a row somebody started and did not finish — which is worth stopping for.
     * Children are only checked for a married candidate, since nobody else is shown the list.
     */
    const listProblems = Object.fromEntries(
      Object.keys(employeeDetailLists)
        .filter((name) => name !== "children" || isMarried(form, context))
        .map((name) => [name, detailListErrors(name, form[name])])
        .filter(([, problems]) => Object.keys(problems).length),
    );
    if (Object.keys(listProblems).length) {
      refuse(listProblems, "Please complete the highlighted rows, or remove the ones you did not mean to add.");
      return;
    }

    setFieldErrors({});

    setSubmitting(true);
    try {
      const { sameAsCurrentAddress, languagesKnown, skills, children, qualifications, experiences, ...values } = form;
      // The record keeps the tick-lists as one comma-separated string each. Anything left blank is
      // dropped rather than sent as an empty string, which is neither a date nor an email address as
      // far as the server is concerned.
      const payload = Object.fromEntries(
        Object.entries({ ...values, skills: skills.join(", "), languagesKnown: languagesKnown.join(", ") })
          .filter(([, value]) => value !== "" && value !== null && value !== undefined),
      );
      // The three lists are sent apart from the rest because each is rows rather than a value, and
      // without the keys the field uses to tell one row from another. The blank rows an "Add"
      // click leaves behind are dropped here, and children only apply to somebody who was asked.
      payload.children = isMarried(form, context) ? filledDetailRows("children", children) : [];
      payload.qualifications = filledDetailRows("qualifications", qualifications);
      payload.experiences = filledDetailRows("experiences", experiences);
      await submitOnboardingInvite(token, payload);
      setSubmitted(true);
    } catch (error) {
      showError(errorMessage(error, "Unable to submit onboarding details. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PublicLayout><Notice title="Employee Onboarding"><Loader label="Checking your onboarding invite…" inline /></Notice></PublicLayout>;
  if (loadError) return <PublicLayout><Notice title="This onboarding invite is unavailable" tone="red">{loadError}</Notice></PublicLayout>;
  if (submitted) return <PublicLayout><Notice title="Your onboarding details have been submitted successfully." tone="green">Our HR team will review your details and contact you.</Notice></PublicLayout>;

  return <PublicLayout>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <header className="mb-6 text-center sm:mb-8">
      {/* The studio's own mark rather than the product's name in words. `AppLogo` carries the one
          rule the whole application shares — the Global Logo from Settings where one is configured,
          the bundled mark where none is — so a candidate opening this link sees the studio that
          invited them, and a logo saved in Settings reaches this page with everything else. */}
      <div className="flex justify-center"><AppLogo variant="onboarding" priority /></div>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900 sm:text-3xl">Employee Onboarding</h1>
      {/* The studio that invited them, named from Settings → Global Name rather than written into
          the page. Left blank there, the sentence names the bundled brand instead of trailing off. */}
      <p className="mt-2 text-sm text-slate-600 sm:text-base">Complete your onboarding details for {brandNameInProse(branding)}.</p>
    </header>
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="grid gap-4 border-b border-slate-200 pb-5 text-sm sm:grid-cols-2">
        <ContextItem label="Candidate Name" value={invite.candidateName} />
        <ContextItem label="Candidate Email" value={invite.candidateEmailMasked} />
        <ContextItem label="Candidate Phone" value={invite.candidatePhoneMasked} />
        <ContextItem label="Expiry Date" value={formatDate(invite.expiresAt)} />
      </div>

      {!verified ? <form onSubmit={verify} className="mx-auto max-w-lg py-7">
        <h2 className="text-lg font-semibold text-slate-900">Verify your invite</h2>
        <p className="mt-1 text-sm text-slate-600">Enter the email address or phone number used for this invite.</p>
        <TextField className="mt-5" required label="Email or Phone Number" helperText="The email or phone the studio sent this invite to, to confirm it is you." value={identifier} onChange={(event) => { setIdentifier(event.target.value); setFieldErrors({}); }} error={fieldErrors.identifier} />
        <Button className="mt-5 w-full" variant="primary" size="lg" disabled={verifying}>{verifying ? "Verifying…" : "Continue"}</Button>
      </form> : <form onSubmit={submit} className="pt-7">
        {/* `data-schema-section` is the anchor `scrollToSection` above finds a heading by - the same
            attribute `SchemaFormSection` puts on the signed-in forms, so both refuse the same way. */}
        {onboardingFormSections.map((section) => <section key={section.id} id={section.id} data-schema-section={section.id} className="border-t border-slate-200 py-6 first:border-t-0 first:pt-0">
          <h2 className="mb-5 text-base font-semibold text-slate-900 sm:text-lg">{section.title}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Through the same filter the schema form panel applies, so a field that only applies
                to some answers — a spouse, an anniversary — stays hidden until it does. */}
            {visibleFields(section.fields, form, context).map((field) => <SchemaFormField key={field.name} field={field} values={form} onChange={update} errors={fieldErrors} context={context} />)}
          </div>
        </section>)}

        <section id={AGREEMENT_SECTION} data-schema-section={AGREEMENT_SECTION} className="border-t border-slate-200 py-6">
          <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Agreement</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">Please review the policy agreement before confirming your acceptance.</p>
          <div className="mt-4 h-60 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 shadow-inner sm:h-72 sm:p-5"><p className="whitespace-pre-line">{onboardingAgreementText}</p></div>
          <label className="mt-4 flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-700">
            <Checkbox className="mt-0.5 shrink-0" checked={form.policyAgreementAccepted} invalid={Boolean(fieldErrors.policyAgreementAccepted)} onChange={(checked) => update("policyAgreementAccepted", checked)} />
            I have read and agree to the Non-Disclosure and Employment Policy Agreement.
          </label>
          {fieldErrors.policyAgreementAccepted && <p role="alert" className="mt-1.5 text-xs font-normal text-red-600">{fieldErrors.policyAgreementAccepted}</p>}
        </section>

        <div className="flex justify-end border-t border-slate-200 pt-6">
          <Button className="max-sm:w-full" variant="primary" size="lg" disabled={submitting}>{submitting ? "Submitting…" : "Submit onboarding details"}</Button>
        </div>
      </form>}
    </section>
  </PublicLayout>;
}
