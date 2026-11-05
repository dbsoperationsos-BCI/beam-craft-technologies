"use client";

import { useCallback, useEffect, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import Dropdown from "@/components/shared/Dropdown";
import EmailChipsField from "@/components/shared/EmailChipsField";
import SearchableMultiSelect from "@/components/shared/SearchableMultiSelect";
import MultiSelectField from "@/components/shared/MultiSelectField";
import useBranchRegistry from "@/components/shared/useBranchRegistry";
import useFormErrors from "@/components/shared/useFormErrors";
import { emptyValues, vendorFormSections } from "@/constants/formPanelConfig";
import { branchLabel } from "@/lib/branchName";
import { getMasterData } from "@/services/hrm/master-data.service";
import { searchPostOffices } from "@/services/location/india-post.service";

/** A PIN code fills in the rest of the address, so only the area is left to choose. */
function VendorAddressFields({ values, errors = {}, onChange }) {
  const [areas, setAreas] = useState([]);
  const [lookupError, setLookupError] = useState("");
  const [loading, setLoading] = useState(() => /^\d{6}$/.test(values.pincode));
  useEffect(() => {
    if (!/^\d{6}$/.test(values.pincode)) return undefined;
    const controller = new AbortController();
    searchPostOffices(values.pincode, controller.signal).then((offices) => {
      if (!offices.length) throw new Error("No postal address was found for this PIN code.");
      const first = offices[0];
      setAreas([...new Set(offices.map((office) => office.branchName))].map((value) => ({ value, label: value })));
      onChange("city", first.city); onChange("district", first.district); onChange("state", first.state); onChange("country", first.country);
    }).catch((error) => { if (error.name !== "AbortError") { setAreas([]); setLookupError(error.message || "Unable to look up this PIN code."); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [values.pincode, onChange]);
  function changePincode(event) {
    const value = event.target.value.replace(/\D/g, "").slice(0, 6);
    onChange("pincode", value); onChange("area", ""); onChange("city", ""); onChange("district", ""); onChange("state", ""); onChange("country", "");
    setAreas([]); setLoading(/^\d{6}$/.test(value)); setLookupError("");
  }
  return <div className="grid gap-4 md:grid-cols-2">
    <TextField required label="PIN Code" helperText="The six-digit PIN code; it fills in the city, district and state." inputMode="numeric" maxLength="6" value={values.pincode} onChange={changePincode} error={errors.pincode} />
    <Dropdown required disabled={loading || areas.length === 0} label="Area" helperText="The locality within the PIN code where the vendor is based." value={values.area} onChange={(value) => onChange("area", value)} options={areas} placeholder={loading ? "Loading areas..." : "Select area"} error={errors.area} />
    <TextField label="City / Block" helperText="Filled in from the PIN code; it cannot be typed." value={values.city} readOnly />
    <TextField label="District" helperText="Filled in from the PIN code; it cannot be typed." value={values.district} readOnly />
    <TextField label="State" helperText="Filled in from the PIN code; it cannot be typed." value={values.state} readOnly />
    <TextField label="Country" helperText="Filled in from the PIN code; it cannot be typed." value={values.country} readOnly />
    <TextAreaField className="md:col-span-2" label="Address / Landmark" helperText="Door number, street and a landmark that helps find the vendor." value={values.address} onChange={(event) => onChange("address", event.target.value)} />
    {lookupError && <p role="alert" className="md:col-span-2 text-sm text-red-600">{lookupError}</p>}
  </div>;
}

/*
 * Preferred Languages are typed, not picked: `EmailChipsField`'s chips-in-the-box control with its
 * email rule switched off. Any non-empty name is a language, and only a comma or a semicolon ends
 * one - not a space, or "Old English" would be two chips.
 */
const LANGUAGE_SEPARATORS = /[,;]+/;
const anyLanguage = (entry) => entry.trim().length > 0 && entry.trim().length <= 100;
const tooLong = (rejected) => `${rejected.join(", ")} is too long for a language.`;

/*
 * A yes / no answer between the record (true / false) and the radio ("Yes" / "No"). No unless the
 * record says Yes, so a new vendor's form opens with No already chosen - the column's own default.
 */
const toYesNo = (value) => (value === true ? "Yes" : "No");
const fromYesNo = (value) => value === "Yes";

/** "Photographer, Editor" as the list of its entries, blanks dropped. */
const splitTypes = (value) => (Array.isArray(value) ? value : String(value || "").split(","))
  .map((item) => String(item).trim())
  .filter(Boolean);

/**
 * Vendor Type, several at once. Held as one comma-joined string - "Photographer, Editor" - the shape
 * the column stores and the shape Employee's Department uses, so the form, the API and the record
 * all read the same thing. The portalled picker rather than an always-open list: it sits in a grid
 * of one-line fields, beside Vendor Name.
 */
function VendorTypeField({ value, options, error, onChange }) {
  const selected = splitTypes(value);
  const listed = Array.isArray(options) ? options.filter((option) => typeof option === "string") : [];
  // A type already on the record that has since left the list is still shown, so it can be removed.
  const all = [...listed, ...selected.filter((item) => !listed.includes(item))];
  return <MultiSelectField
    label="Vendor Type"
    helperText="The kinds of work this vendor does; pick as many as apply."
    required
    error={error}
    searchable
    options={all}
    values={selected}
    onChange={(next) => onChange(next.join(", "))}
    placeholder="Select vendor types"
  />;
}

/**
 * Capabilities → Supported Branches: the studio's branches this vendor works for, several at once.
 * The values are branch ids (as strings, the shape `MultiSelectField` holds), sent as numbers; the
 * server stores them as links to the branches, never as their names.
 */
function SupportedBranchesField({ value, branches, onChange }) {
  const selected = (Array.isArray(value) ? value : []).map(String);
  const options = branches.map((branch) => ({ value: String(branch.id), label: branchLabel(branch.name) || branch.name }));
  // A branch already on the vendor that has since been disabled is still shown, so it can be removed.
  for (const id of selected) if (!options.some((option) => option.value === id)) options.push({ value: id, label: "Branch no longer active" });
  return <MultiSelectField
    label="Supported Branches"
    helperText="The studio branches this vendor can work for."
    searchable
    options={options}
    values={selected}
    onChange={onChange}
    placeholder="Select branches"
  />;
}

/** The address, skills, languages, vendor type and branches have no plain input, so the panel draws them itself. */
const renderers = {
  supportedBranchIds: ({ values, context }) => <SupportedBranchesField value={values.supportedBranchIds} branches={context.branches || []} onChange={(value) => context.update("supportedBranchIds", value)} />,
  vendorType: ({ values, context }) => <VendorTypeField value={values.vendorType} options={context.options?.vendorTypes} error={context.errors?.vendorType} onChange={(value) => context.update("vendorType", value)} />,
  address: ({ values, onChange, context }) => <VendorAddressFields values={values} errors={context.errors} onChange={context.update} />,
  skills: ({ values, context }) => <SearchableMultiSelect chips label="Skills" helperText="Tick the work this vendor can do; it shows in the vendor list." placeholder="Search skills..." emptyText="No matching skills." summary={(count) => count ? `${count} skill(s) selected` : "No skills selected"} groups={context.options?.skillGroups || []} value={values.skills || []} onChange={(value) => context.update("skills", value)} />,
  preferredLanguages: ({ values, context }) => <EmailChipsField
    label="Preferred Languages"
    helperText="Type each language the vendor speaks and press Enter after it."
    placeholder="Type a language and press Enter"
    values={values.preferredLanguages || []}
    onChange={(value) => context.update("preferredLanguages", value)}
    isValid={anyLanguage}
    invalidMessage={tooLong}
    separators={LANGUAGE_SEPARATORS}
  />,
};

export default function VendorFormPanel({ vendor, options, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    ...emptyValues(vendorFormSections, vendor),
    vendorId: vendor?.vendorId || "",
    area: vendor?.area || "", city: vendor?.city || "", district: vendor?.district || "", state: vendor?.state || "",
    country: vendor?.country || "India", pincode: vendor?.pincode || "",
    preferredLanguages: vendor?.preferredLanguages || [],
    skills: vendor?.skills || [],
    supportedBranchIds: (vendor?.supportedBranchIds || []).map(String),
    // The radio holds "Yes" / "No"; the record holds true / false. A new vendor opens on No.
    canBeProductionTeamMember: toYesNo(vendor?.canBeProductionTeamMember),
  }));
  /*
   * The studio's active branches, for Supported Branches. Re-read when Settings → Organization →
   * Branches saves (`useBranchRegistry`), so a branch added while this form is open is offered
   * without closing it. A list that will not load leaves the field empty rather than failing the form.
   */
  const [branches, setBranches] = useState([]);
  const branchRegistryRevision = useBranchRegistry();
  useEffect(() => {
    let cancelled = false;
    getMasterData("branches", { active: true })
      .then((response) => { if (!cancelled) setBranches(Array.isArray(response?.data) ? response.data : []); })
      .catch(() => { if (!cancelled) setBranches([]); });
    return () => { cancelled = true; };
  }, [branchRegistryRevision]);
  // Said on the field rather than only by the server: a custom control has no browser `required`
  // to stop the save, so an empty Vendor Type, PIN code or Area would otherwise reach the API.
  const fields = useFormErrors();
  const { clear } = fields;
  const update = useCallback((field, value) => {
    clear(field);
    setForm((current) => ({ ...current, [field]: value }));
  }, [clear]);

  function submit(event) {
    event.preventDefault();
    const ok = fields.check({
      vendorType: splitTypes(form.vendorType).length ? "" : "Choose at least one vendor type.",
      pincode: /^\d{6}$/.test(form.pincode) ? "" : form.pincode ? "Enter the full 6-digit PIN code." : "Enter the PIN code.",
      area: form.area ? "" : "Choose the area.",
    });
    if (!ok) return;
    const { vendorId, ...payload } = form;
    onSave({
      ...payload,
      businessStartYear: payload.businessStartYear === "" ? null : Number(payload.businessStartYear),
      rating: payload.rating === "" ? null : Number(payload.rating),
      supportedBranchIds: (payload.supportedBranchIds || []).map(Number),
      canBeProductionTeamMember: fromYesNo(payload.canBeProductionTeamMember),
    });
  }

  return <SchemaFormPanel
    title={vendor ? "Edit Vendor" : "Add Vendor"}
    description="Create and maintain vendor business, payment, and capability details."
    sections={vendorFormSections}
    values={form}
    onChange={update}
    context={{ options, renderers, update, errors: fields.errors, branches }}
    sidebarAriaLabel="Vendor form sections"
    closeAriaLabel="Close vendor form"
    onClose={onClose}
    onSubmit={submit}
    error={error || fields.summary}
    errors={fields.errors}
    saving={saving}
    submitLabel={vendor ? "Update Vendor" : "Save Vendor"}
    savingLabel="Saving..."
  />;
}
