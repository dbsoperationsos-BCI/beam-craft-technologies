"use client";

import { useState } from "react";
import { clearDraft, useDraft } from "@/lib/stayOnRefresh";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import PhoneField from "@/components/shared/PhoneField";
import ShareableMessage from "@/components/shared/ShareableMessage";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import { createClientInvite, updateClientInvite } from "@/services/subscribe/client-onboarding.service";
import ImagePicker, { FAVICON, LOGO } from "./ImagePicker";
import { PRODUCTS } from "@/constants/subscriptionProducts.mjs";

const productOptions = Object.entries(PRODUCTS).map(([value, label]) => ({ value, label }));

const emptyCompany = () => ({
  companyName: "", address: "", gstNumber: "", panNumber: "", usersNeeded: "", logo: "", favicon: "",
  mainContactName: "", mainContactPhone: "", mainContactDesignation: "",
  secondaryContactName: "", secondaryContactPhone: "", secondaryContactDesignation: "",
});

const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const REQUIRED = [
  ["companyName", "Name Of The Company"], ["address", "Address"], ["mainContactName", "Main Contact Name"], ["mainContactPhone", "Main Contact Number"],
  ["mainContactDesignation", "Main Contact Designation"], ["secondaryContactName", "Secondary Contact Name"], ["secondaryContactPhone", "Secondary Contact Number"],
  ["secondaryContactDesignation", "Secondary Contact Designation"], ["gstNumber", "GST Number"], ["panNumber", "PAN Number"], ["logo", "Logo"], ["favicon", "Favicon"],
  ["usersNeeded", "Number Of Users Needed"],
];

/** A row's company as the form holds it: stored images stand in for uploads. */
function companyFromRow(row) {
  const source = row?.client || row?.company || {};
  const filled = Object.fromEntries(Object.keys(emptyCompany()).map((key) => [key, source[key] == null ? "" : String(source[key])]));
  return { ...filled, logo: source.logoUrl || "", favicon: source.faviconUrl || "" };
}

/**
 * What is wrong with what was typed, or "". On an invite only filled fields are checked - the client
 * completes the rest; a submitted company is the filed record, so every field is required.
 */
function companyProblem(company, allRequired = false) {
  const missing = allRequired && REQUIRED.find(([key]) => !String(company[key] ?? "").trim());
  if (missing) return `${missing[1]} is required.`;
  if (company.gstNumber && !GST_PATTERN.test(company.gstNumber)) return "Enter a valid GST number (e.g. 33ABCDE1234F1Z5).";
  if (company.panNumber && !PAN_PATTERN.test(company.panNumber)) return "Enter a valid PAN number (e.g. ABCDE1234F).";
  const users = Number(company.usersNeeded);
  if (String(company.usersNeeded).trim() && (!Number.isInteger(users) || users < 1)) return "Number Of Users Needed must be a whole number of at least 1.";
  return "";
}

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

/**
 * Create Onboarding Invite: the Company Details the client's link asks for. Whatever is filled in here
 * appears already filled on the client's form; the client completes the rest and submits, and the
 * company then appears in Client Details. Creating it shows the message with the link to send.
 *
 * Given a `row`, the same fields edit that client instead (the ⋮ menu's Edit).
 */
// A picked image is a file, which a draft cannot keep: it comes back empty, to be picked again.
const keptImage = (value) => (typeof value === "string" ? value : "");

export default function ClientInviteDialog({ row = null, onClose: close, onInviteCreated, onSaved }) {
  const editing = Boolean(row);
  const submittedRow = Boolean(row?.client);
  // What is typed survives a refresh until it is saved or the form is closed.
  const draftName = row ? `client:${row.id}` : "client:new";
  const onClose = () => { clearDraft(draftName); clearDraft(`${draftName}:product`); close?.(); };
  const [company, setCompany] = useDraft(draftName, () => (row ? companyFromRow(row) : emptyCompany()), (saved) => ({ ...saved, logo: keptImage(saved.logo), favicon: keptImage(saved.favicon) }));
  // Which product page the client is listed on - chosen here, in Edit, rather than on the invite.
  const [product, setProduct] = useDraft(`${draftName}:product`, row?.product || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);

  const setField = (field, value) => setCompany((current) => ({ ...current, [field]: value }));
  const updateField = (event) => setField(event.target.name, event.target.value);

  async function createInvite(event) {
    event?.preventDefault?.();
    const problem = companyProblem(company, submittedRow);
    if (problem) return setError(problem);
    setSubmitting(true);
    setError("");
    const payload = { ...company, usersNeeded: company.usersNeeded === "" ? "" : Number(company.usersNeeded) };
    try {
      if (editing) {
        await updateClientInvite(row.id, payload, product);
        clearDraft(draftName);
        clearDraft(`${draftName}:product`);
        onSaved?.();
        return;
      }
      const result = await createClientInvite({ company: payload });
      clearDraft(draftName);
      clearDraft(`${draftName}:product`);
      setCreated(result?.data || null);
      onInviteCreated?.(result?.data?.invite);
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to create the invite."));
    } finally {
      setSubmitting(false);
    }
  }

  if (created) return <Dialog title="Onboarding Invite Created" size="md" onClose={onClose} footer={<Button className="max-sm:flex-1" type="button" onClick={onClose}>Close</Button>}>
    <ShareableMessage label="Message to send them" rows={9} message={created.message} />
  </Dialog>;

  // On a submitted client every field is the filed record, so each is required; on an invite, none is.
  const req = submittedRow;
  const sections = [
    ...(editing ? [["product", "Product"]] : []),
    ["company", "Company Details"], ["main-contact", "Main Contact"], ["secondary-contact", "Secondary Contact"], ["branding", "Logo & Favicon"],
  ];

  return <SchemaFormPanel
    title={editing ? "Edit Client Details" : "Create Onboarding Invite"}
    description={editing ? (submittedRow ? "Correct this client's details. Every field is required." : "Change what the client's form opens with.") : "Fill in what you already know. The client completes the rest on their link."}
    sections={sections}
    values={{}}
    onChange={() => {}}
    validateRequired={false}
    sidebarAriaLabel="Client sections"
    closeAriaLabel="Close"
    onClose={onClose}
    onSubmit={createInvite}
    error={error}
    saving={submitting}
    submitLabel={editing ? "Save changes" : "Create invite"}
    savingLabel={editing ? "Saving..." : "Creating..."}
  >
    {editing && <SchemaFormSection id="product" title="Product">
      <div className="grid gap-4 md:grid-cols-2">
        {/* A set-up account's product carries its modules, so it is changed in Edit subscription, not here. */}
        {row?.client?.activatedAt
          ? <TextField label="Product" value={productOptions.find((option) => option.value === product)?.label || "Not assigned"} readOnly disabled note="Change it in Edit subscription, where its modules are chosen again." />
          : <Dropdown label="Product" placeholder="Not assigned" value={product} onChange={setProduct} options={productOptions} />}
      </div>
    </SchemaFormSection>}
    <SchemaFormSection id="company" title="Company Details">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField required={req} label="Name Of The Company" name="companyName" value={company.companyName} onChange={updateField} />
        <TextAreaField required={req} rows={1} inputClassName="min-h-10!" label="Address" name="address" value={company.address} onChange={updateField} />
        <TextField required={req} label="GST Number" name="gstNumber" maxLength={15} value={company.gstNumber} onChange={(event) => setField("gstNumber", event.target.value.trim().toUpperCase())} />
        <TextField required={req} label="PAN Number" name="panNumber" maxLength={10} value={company.panNumber} onChange={(event) => setField("panNumber", event.target.value.trim().toUpperCase())} />
        <TextField required={req} type="number" min={1} step={1} label="Number Of Users Needed" name="usersNeeded" value={company.usersNeeded} onChange={updateField} />
      </div>
    </SchemaFormSection>
    <SchemaFormSection id="main-contact" title="Main Contact">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField required={req} label="Name" name="mainContactName" value={company.mainContactName} onChange={updateField} />
        <PhoneField required={req} label="Contact Number" field="mainContactPhone" value={company.mainContactPhone} onChange={setField} />
        <TextField required={req} label="Designation" name="mainContactDesignation" value={company.mainContactDesignation} onChange={updateField} />
      </div>
    </SchemaFormSection>
    <SchemaFormSection id="secondary-contact" title="Secondary Contact">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField required={req} label="Name" name="secondaryContactName" value={company.secondaryContactName} onChange={updateField} />
        <PhoneField required={req} label="Contact Number" field="secondaryContactPhone" value={company.secondaryContactPhone} onChange={setField} />
        <TextField required={req} label="Designation" name="secondaryContactDesignation" value={company.secondaryContactDesignation} onChange={updateField} />
      </div>
    </SchemaFormSection>
    <SchemaFormSection id="branding" title="Logo & Favicon">
      <div className="grid gap-4 md:grid-cols-2">
        <ImagePicker required={req} label="Logo" rule={LOGO} value={company.logo} onPick={(value) => setField("logo", value)} />
        <ImagePicker required={req} label="Favicon" rule={FAVICON} value={company.favicon} onPick={(value) => setField("favicon", value)} />
      </div>
    </SchemaFormSection>
  </SchemaFormPanel>;
}
