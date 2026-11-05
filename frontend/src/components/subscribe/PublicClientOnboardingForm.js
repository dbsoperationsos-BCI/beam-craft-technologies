"use client";

import { useEffect, useState } from "react";
import AppLogo from "@/components/shared/AppLogo";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import PhoneField from "@/components/shared/PhoneField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import { getClientOnboardingInvite, submitClientOnboarding } from "@/services/subscribe/public-client-onboarding.service";
import ImagePicker, { FAVICON, LOGO } from "./ImagePicker";

const emptyForm = {
  companyName: "", address: "", gstNumber: "", panNumber: "", usersNeeded: "", logo: "", favicon: "",
  mainContactName: "", mainContactPhone: "", mainContactDesignation: "",
  secondaryContactName: "", secondaryContactPhone: "", secondaryContactDesignation: "",
};

// Every field is required; this is the order they are checked and named in.
const REQUIRED = [
  ["companyName", "Name Of The Company"], ["address", "Address"],
  ["mainContactName", "Main Contact Name"], ["mainContactPhone", "Main Contact Number"], ["mainContactDesignation", "Main Contact Designation"],
  ["secondaryContactName", "Secondary Contact Name"], ["secondaryContactPhone", "Secondary Contact Number"], ["secondaryContactDesignation", "Secondary Contact Designation"],
  ["gstNumber", "GST Number"], ["panNumber", "PAN Number"], ["logo", "Logo"], ["favicon", "Favicon"], ["usersNeeded", "Number Of Users Needed"],
];

const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;
const formatDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

/** The form as the team left it on the invite: its stored logo and favicon stand in for uploads. */
function formFromInvite(company) {
  if (!company) return emptyForm;
  const { logoUrl, faviconUrl, ...fields } = company;
  const filled = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value ?? "")]));
  return { ...emptyForm, ...filled, logo: logoUrl || "", favicon: faviconUrl || "" };
}

function PublicLayout({ children }) {
  return <main className="min-h-[100dvh] bg-slate-100 px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto w-full max-w-5xl">{children}</div></main>;
}

function Notice({ title, children, tone = "slate" }) {
  const styles = tone === "red" ? "border-red-200 bg-red-50 text-red-800" : tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700";
  return <section className={`rounded-xl border p-6 shadow-sm ${styles}`}><h1 className="text-xl font-semibold">{title}</h1><div className="mt-2 text-sm leading-6">{children}</div></section>;
}

function Section({ title, children }) {
  return <section className="border-t border-slate-200 py-6 first:border-t-0 first:pt-0">
    <h2 className="mb-5 text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>
    <div className="grid gap-4 md:grid-cols-2">{children}</div>
  </section>;
}

/**
 * The page a company's onboarding link opens: the Company Details, with whatever the Beam Craft team
 * already filled in, every field required. Submitting is what puts the company in Client Details.
 */
export default function PublicClientOnboardingForm({ token }) {
  const [invite, setInvite] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { notice, showError, clearNotice } = useNotice();

  useEffect(() => {
    let active = true;
    getClientOnboardingInvite(token)
      .then((data) => { if (!active) return; setInvite(data); setForm(formFromInvite(data?.company)); })
      .catch((error) => { if (active) setLoadError(errorMessage(error, "Unable to load this onboarding link.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => { const next = { ...current }; delete next[field]; return next; });
  }
  const onText = (event) => update(event.target.name, event.target.value);

  function problems() {
    const found = {};
    for (const [key, label] of REQUIRED) if (!String(form[key] ?? "").trim()) found[key] = `${label} is required.`;
    if (form.gstNumber && !GST_PATTERN.test(form.gstNumber)) found.gstNumber = "Enter a valid GST number (e.g. 33ABCDE1234F1Z5).";
    if (form.panNumber && !PAN_PATTERN.test(form.panNumber)) found.panNumber = "Enter a valid PAN number (e.g. ABCDE1234F).";
    const users = Number(form.usersNeeded);
    if (String(form.usersNeeded).trim() && (!Number.isInteger(users) || users < 1)) found.usersNeeded = "Enter a whole number of at least 1.";
    return found;
  }

  async function submit(event) {
    event.preventDefault();
    const found = problems();
    if (Object.keys(found).length) {
      setErrors(found);
      showError("Please complete the highlighted fields.");
      return;
    }
    setSubmitting(true);
    try {
      await submitClientOnboarding(token, { ...form, usersNeeded: Number(form.usersNeeded) });
      setSubmitted(true);
    } catch (error) {
      if (error?.status === 409) setSubmitted(true);
      // The link closed while they were filling it in: show the same screen opening it now would.
      else if (error?.status === 410) setInvite((current) => ({ ...current, state: /cancel/i.test(errorMessage(error, "")) ? "Cancelled" : "Expired" }));
      else showError(errorMessage(error, "Unable to submit your details. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PublicLayout><Notice title="Client Onboarding"><Loader label="Checking your onboarding link…" inline /></Notice></PublicLayout>;
  if (loadError) return <PublicLayout><Notice title="This onboarding link is unavailable" tone="red">{loadError}</Notice></PublicLayout>;
  if (submitted || invite.state === "Submitted") return <PublicLayout><Notice title="Your company's details have been submitted." tone="green">Thank you. The Beam Craft team will contact you.</Notice></PublicLayout>;
  if (invite.state === "Expired") return <PublicLayout><Notice title="This onboarding link has expired" tone="red">Please ask the Beam Craft team for a new link.</Notice></PublicLayout>;
  if (invite.state === "Cancelled") return <PublicLayout><Notice title="This onboarding link has been cancelled" tone="red">Please contact the Beam Craft team if you think this is a mistake.</Notice></PublicLayout>;

  return <PublicLayout>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <header className="mb-6 text-center sm:mb-8">
      <div className="flex justify-center"><AppLogo variant="onboarding" priority /></div>
      <h1 className="mt-3 text-2xl font-semibold text-slate-900 sm:text-3xl">Client Onboarding</h1>
      <p className="mt-2 text-sm text-slate-600 sm:text-base">Complete your company&apos;s onboarding details. This link is open until {formatDate(invite.expiresAt)}.</p>
    </header>
    <form onSubmit={submit} noValidate className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <Section title="Company Details">
        <TextField required label="Name Of The Company" name="companyName" value={form.companyName} onChange={onText} error={errors.companyName} />
        <TextAreaField required rows={1} inputClassName="min-h-10!" label="Address" name="address" value={form.address} onChange={onText} error={errors.address} />
        <TextField required label="GST Number" name="gstNumber" maxLength={15} value={form.gstNumber} onChange={(event) => update("gstNumber", event.target.value.trim().toUpperCase())} error={errors.gstNumber} />
        <TextField required label="PAN Number" name="panNumber" maxLength={10} value={form.panNumber} onChange={(event) => update("panNumber", event.target.value.trim().toUpperCase())} error={errors.panNumber} />
        <ImagePicker label="Logo" rule={LOGO} value={form.logo} error={errors.logo} onPick={(value) => update("logo", value)} />
        <ImagePicker label="Favicon" rule={FAVICON} value={form.favicon} error={errors.favicon} onPick={(value) => update("favicon", value)} />
        <TextField required type="number" min={1} step={1} label="Number Of Users Needed" name="usersNeeded" value={form.usersNeeded} onChange={onText} error={errors.usersNeeded} note="How many of your employees will use the application." />
      </Section>
      <Section title="Main Contact Person">
        <TextField required label="Name" name="mainContactName" value={form.mainContactName} onChange={onText} error={errors.mainContactName} />
        <PhoneField required label="Contact Number" field="mainContactPhone" value={form.mainContactPhone} onChange={update} error={errors.mainContactPhone} />
        <TextField required label="Designation" name="mainContactDesignation" value={form.mainContactDesignation} onChange={onText} error={errors.mainContactDesignation} />
      </Section>
      <Section title="Secondary Contact Person">
        <TextField required label="Name" name="secondaryContactName" value={form.secondaryContactName} onChange={onText} error={errors.secondaryContactName} />
        <PhoneField required label="Contact Number" field="secondaryContactPhone" value={form.secondaryContactPhone} onChange={update} error={errors.secondaryContactPhone} />
        <TextField required label="Designation" name="secondaryContactDesignation" value={form.secondaryContactDesignation} onChange={onText} error={errors.secondaryContactDesignation} />
      </Section>
      <div className="flex justify-end border-t border-slate-200 pt-6">
        <Button variant="primary" size="lg" disabled={submitting}>{submitting ? "Submitting…" : "Submit"}</Button>
      </div>
    </form>
  </PublicLayout>;
}
