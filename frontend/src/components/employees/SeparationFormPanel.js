"use client";

import { useCallback, useEffect, useState } from "react";
import { createSeparation, getSeparations, updateSeparation } from "@/services/hrm/separations.service";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import {
  separationFormSections,
  separationInitialValues,
  statusForSeparationType,
  typesWithEmployeeSubmission,
} from "@/constants/separationFormConfig";

const toDateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : "";
const toNumberInput = (value) => value === null || value === undefined ? "" : String(value);
const toNumber = (value) => String(value ?? "").trim() === "" ? null : Number(value);

function errorMessage(error, fallback) {
  if (error?.status === 401 || error?.status === 403) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

function toForm(separation) {
  if (!separation) return separationInitialValues;
  return {
    separationType: separation.separationType || "",
    separationReason: separation.separationReason || "",
    detailedReason: separation.detailedReason || "",
    resignationDate: toDateInput(separation.resignationDate),
    // The stored letter is shown as the one-file list the upload field works in.
    resignationLetter: separation.resignationLetterName ? [{ name: separation.resignationLetterName, url: separation.resignationLetterUrl }] : [],
    proposedLastWorkingDate: toDateInput(separation.proposedLastWorkingDate),
    noticePeriodRequired: toNumberInput(separation.noticePeriodRequired),
    noticePeriodServed: toNumberInput(separation.noticePeriodServed),
    noticePeriodWaived: toNumberInput(separation.noticePeriodWaived),
    waiverReason: separation.waiverReason || "",
    earlyReleaseRequested: Boolean(separation.earlyReleaseRequested),
    earlyReleaseReason: separation.earlyReleaseReason || "",
    hrRemarks: separation.hrRemarks || "",
  };
}

/**
 * Offboards an employee by recording how they left. The separation type decides both what the
 * form asks for and the status the employee is moved to, which the description spells out so the
 * consequence is never a surprise.
 */
export default function SeparationFormPanel({ employee, onClose, onSaved }) {
  const [form, setForm] = useState(separationInitialValues);
  const [separation, setSeparation] = useState(null);
  /*
   * An invite row has nothing to fetch - see `inviteId` below - so it does not start in a loading
   * state at all, rather than starting in one and being taken out of it by an effect.
   */
  const [loading, setLoading] = useState(employee.type !== "invite");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /*
   * An invite row has no employee record behind it, so it has no offboarding to load and no id to
   * ask for one with - `employee.id` on such a row is the synthetic `invite:<id>` the repository
   * builds. The panel opens straight on an empty form, and the save below records the withdrawal
   * against the invite instead.
   */
  const inviteId = employee.type === "invite" ? employee.inviteId : null;

  useEffect(() => {
    let live = true;
    if (inviteId) return () => { live = false; };
    getSeparations(employee.id)
      .then((result) => {
        if (!live) return;
        const existing = (result.data || [])[0] || null;
        setSeparation(existing);
        setForm(toForm(existing));
      })
      .catch((requestError) => { if (live) setError(errorMessage(requestError, "Unable to load this employee's offboarding.")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [employee.id, inviteId]);

  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  function validate() {
    if (!form.separationType) return "Choose a separation type.";
    if (!form.separationReason) return "Choose a separation reason.";
    if (!form.proposedLastWorkingDate) return "Enter the proposed last working date.";
    if (typesWithEmployeeSubmission.includes(form.separationType) && !form.resignationDate) return "Enter the resignation date.";
    if (form.resignationDate && new Date(form.proposedLastWorkingDate) < new Date(form.resignationDate)) {
      return "The proposed last working date cannot fall before the resignation date.";
    }
    if (Number(form.noticePeriodWaived) > 0 && !form.waiverReason.trim()) return "Give a reason for waiving the notice period.";
    if (form.earlyReleaseRequested && !form.earlyReleaseReason.trim()) return "Give a reason for the early release request.";
    return "";
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    try {
      const submitted = typesWithEmployeeSubmission.includes(form.separationType);
      const payload = {
        separationType: form.separationType,
        separationReason: form.separationReason,
        detailedReason: form.detailedReason.trim() || null,
        resignationDate: submitted ? form.resignationDate : null,
        resignationLetter: submitted ? form.resignationLetter[0] || null : null,
        proposedLastWorkingDate: form.proposedLastWorkingDate,
        noticePeriodRequired: toNumber(form.noticePeriodRequired),
        noticePeriodServed: toNumber(form.noticePeriodServed),
        noticePeriodWaived: toNumber(form.noticePeriodWaived),
        waiverReason: form.waiverReason.trim() || null,
        earlyReleaseRequested: Boolean(form.earlyReleaseRequested),
        earlyReleaseReason: form.earlyReleaseReason.trim() || null,
        hrRemarks: form.hrRemarks.trim() || null,
      };
      if (separation) await updateSeparation(separation.id, payload);
      // The endpoint takes one subject or the other: an invite becomes an employee record inside the
      // transaction that offboards it, so the row lands in InActive rather than leaving the list.
      else await createSeparation(inviteId ? { ...payload, inviteId } : { ...payload, employeeId: employee.id });
      onSaved(`${employee.employeeName} marked ${statusForSeparationType(form.separationType)}.`);
    } catch (requestError) {
      setError(errorMessage(requestError, "Unable to save this offboarding."));
    } finally {
      setSaving(false);
    }
  }

  const resultingStatus = statusForSeparationType(form.separationType);

  return <SchemaFormPanel
    title={separation ? "Edit Offboarding" : "Offboarding"}
    description={`${employee.employeeName}${employee.employeeId ? ` · ${employee.employeeId}` : ""}${resultingStatus ? ` — will be marked ${resultingStatus}` : ""}`}
    sections={separationFormSections}
    values={form}
    onChange={update}
    sidebarAriaLabel="Offboarding form sections"
    closeAriaLabel="Close offboarding form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    loading={loading}
    loadingLabel="Loading offboarding..."
    submitLabel={separation ? "Update Offboarding" : "Complete Offboarding"}
    savingLabel="Saving..."
  />;
}
