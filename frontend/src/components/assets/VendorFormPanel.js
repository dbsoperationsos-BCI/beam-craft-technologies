"use client";

import { useCallback, useEffect, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import Dropdown from "@/components/shared/Dropdown";
import Button from "@/components/shared/Button";
import SearchableMultiSelect from "@/components/shared/SearchableMultiSelect";
import { emptyValues, vendorFormSections } from "@/constants/formPanelConfig";
import { searchPostOffices } from "@/services/location/india-post.service";

/** A PIN code fills in the rest of the address, so only the area is left to choose. */
function VendorAddressFields({ values, onChange }) {
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
    <TextField required label="PIN Code" inputMode="numeric" maxLength="6" value={values.pincode} onChange={changePincode} />
    <Dropdown required disabled={loading || areas.length === 0} label="Area" value={values.area} onChange={(value) => onChange("area", value)} options={areas} placeholder={loading ? "Loading areas..." : "Select area"} />
    <TextField label="City / Block" value={values.city} readOnly />
    <TextField label="District" value={values.district} readOnly />
    <TextField label="State" value={values.state} readOnly />
    <TextField label="Country" value={values.country} readOnly />
    <TextAreaField className="md:col-span-2" label="Address / Landmark" value={values.address} onChange={(event) => onChange("address", event.target.value)} />
    {lookupError && <p role="alert" className="md:col-span-2 text-sm text-red-600">{lookupError}</p>}
  </div>;
}

function LanguageField({ value, onChange }) {
  const [language, setLanguage] = useState("");
  function add() { const next = language.trim(); if (next && !value.includes(next)) onChange([...value, next]); setLanguage(""); }
  return <div><div className="flex items-end gap-2"><TextField className="min-w-0 flex-1" label="Preferred Languages" value={language} onChange={(event) => setLanguage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="Type a language and press Enter" /><Button type="button" onClick={add}>Add</Button></div><div className="mt-2 flex flex-wrap gap-2">{value.map((item) => <button type="button" key={item} onClick={() => onChange(value.filter((entry) => entry !== item))} className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700 hover:bg-blue-100">{item} ×</button>)}</div></div>;
}

/** The address, skills and languages have no shared input, so the panel draws those three itself. */
const renderers = {
  address: ({ values, onChange, context }) => <VendorAddressFields values={values} onChange={context.update} />,
  skills: ({ values, context }) => <SearchableMultiSelect label="Skills" placeholder="Search skills..." emptyText="No matching skills." summary={(count) => count ? `${count} skill(s) selected` : "No skills selected"} groups={context.options?.skillGroups || []} value={values.skills || []} onChange={(value) => context.update("skills", value)} />,
  preferredLanguages: ({ values, context }) => <LanguageField value={values.preferredLanguages || []} onChange={(value) => context.update("preferredLanguages", value)} />,
};

export default function VendorFormPanel({ vendor, options, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    ...emptyValues(vendorFormSections, vendor),
    vendorId: vendor?.vendorId || "",
    area: vendor?.area || "", city: vendor?.city || "", district: vendor?.district || "", state: vendor?.state || "",
    country: vendor?.country || "India", pincode: vendor?.pincode || "",
    preferredLanguages: vendor?.preferredLanguages || [],
    skills: vendor?.skills || [],
  }));
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  function submit(event) {
    event.preventDefault();
    const { vendorId, ...payload } = form;
    onSave({ ...payload, businessStartYear: payload.businessStartYear === "" ? null : Number(payload.businessStartYear), rating: payload.rating === "" ? null : Number(payload.rating) });
  }

  return <SchemaFormPanel
    title={vendor ? "Edit Vendor" : "Add Vendor"}
    description="Create and maintain vendor business, payment, and capability details."
    sections={vendorFormSections}
    values={form}
    onChange={update}
    context={{ options, renderers, update }}
    sidebarAriaLabel="Vendor form sections"
    closeAriaLabel="Close vendor form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel={vendor ? "Update Vendor" : "Save Vendor"}
    savingLabel="Saving..."
  />;
}
