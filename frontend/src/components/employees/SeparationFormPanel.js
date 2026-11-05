"use client";

import { useCallback, useEffect, useState } from "react";
import { createSeparation, getPendingWork, getSeparations, updateSeparation } from "@/services/hrm/separations.service";
import { getOffboardingInvites } from "@/services/hrm/offboarding-invites.service";
import { servingNoticeMessage } from "@/lib/employmentStatus.mjs";
import HandOverDialog from "@/components/employees/HandOverDialog";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import useFormErrors from "@/components/shared/useFormErrors";
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

/*
 * The employee's own offboarding form, as this panel's starting answers: a resignation, with the
 * reason, comments, dates and letter the form carries and the notice HR set on it. Used only when
 * nothing is recorded yet, so a separation already on file is never overwritten by a form.
 *
 * The newest form that is still live or answered - Submitted first, since that is the one with the
 * employee's answers; a cancelled, rejected or expired one says nothing about this exit.
 */
const FORM_STATUSES = ["Submitted", "Approved", "Verified", "Sent"];
export function offboardingFormFor(invites, employeeId) {
  const mine = (invites || []).filter((invite) => String(invite.employeeId) === String(employeeId) && FORM_STATUSES.includes(invite.status));
  return mine.find((invite) => invite.status === "Submitted") || mine[0] || null;
}
export function formFromOffboardingForm(invite) {
  if (!invite) return separationInitialValues;
  return {
    ...separationInitialValues,
    separationType: "Resignation",
    separationReason: invite.reason || "",
    detailedReason: invite.detailedReason || "",
    resignationDate: toDateInput(invite.resignationDate),
    resignationLetter: invite.letterFileName && invite.letterUrl ? [{ name: invite.letterFileName, url: invite.letterUrl }] : [],
    proposedLastWorkingDate: toDateInput(invite.proposedLastWorkingDate),
    noticePeriodRequired: toNumberInput(invite.noticePeriodDays),
    hrRemarks: invite.hrNote || "",
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
  // The leaver's pending work and the form's payload, while HR chooses who takes it over.
  const [handOver, setHandOver] = useState(null);
  const [handOverSaving, setHandOverSaving] = useState(false);
  const [handOverError, setHandOverError] = useState("");
  const [error, setError] = useState("");
  const fields = useFormErrors();

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
      .then(async (result) => {
        if (!live) return;
        const existing = (result.data || [])[0] || null;
        setSeparation(existing);
        if (existing) { setForm(toForm(existing)); return; }
        // Nothing recorded yet: start from their offboarding form, where they have one. A reader
        // who cannot see the forms simply starts on a blank panel, as before.
        const invites = await getOffboardingInvites().then((response) => response?.data || []).catch(() => []);
        if (live) setForm(formFromOffboardingForm(offboardingFormFor(invites, employee.id)));
      })
      .catch((requestError) => { if (live) setError(errorMessage(requestError, "Unable to load this employee's offboarding.")); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [employee.id, inviteId]);

  const { clear } = fields;
  const update = useCallback((field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    clear(field);
  }, [clear]);

  // Each problem goes under its own box; the panel's banner says only how many.
  const separationProblems = () => ({
    separationType: form.separationType ? "" : "Choose a separation type.",
    separationReason: form.separationReason ? "" : "Choose a separation reason.",
    proposedLastWorkingDate: !form.proposedLastWorkingDate
      ? "Enter the proposed last working date."
      : form.resignationDate && new Date(form.proposedLastWorkingDate) < new Date(form.resignationDate)
        ? "The proposed last working date cannot fall before the resignation date."
        : "",
    resignationDate: typesWithEmployeeSubmission.includes(form.separationType) && !form.resignationDate ? "Enter the resignation date." : "",
    waiverReason: Number(form.noticePeriodWaived) > 0 && !form.waiverReason.trim() ? "Give a reason for waiving the notice period." : "",
    earlyReleaseReason: form.earlyReleaseRequested && !form.earlyReleaseReason.trim() ? "Give a reason for the early release request." : "",
  });

  // Saved with notice still to serve, the server leaves the status alone until the day after the
  // last working day - so the message says that, not "marked Relieved".
  const savedMessage = (saved) => (saved?.data && !saved.data.relievedAt
    ? servingNoticeMessage(employee.employeeName, form.proposedLastWorkingDate)
    : `${employee.employeeName} marked ${statusForSeparationType(form.separationType)}.`);

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!fields.check(separationProblems())) return;

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
      let saved;
      if (separation) saved = await updateSeparation(separation.id, payload);
      // The endpoint takes one subject or the other: an invite becomes an employee record inside the
      // transaction that offboards it, so the row lands in InActive rather than leaving the list.
      else if (inviteId) saved = await createSeparation({ ...payload, inviteId });
      else {
        // Work still under their name is handed on first: the pop-up names it and who takes it.
        const pending = (await getPendingWork(employee.id))?.data;
        if (pending?.total) {
          setHandOver({ pending, payload });
          return;
        }
        saved = await createSeparation({ ...payload, employeeId: employee.id });
      }
      onSaved(savedMessage(saved));
    } catch (requestError) {
      if (!fields.fromServer(requestError)) setError(errorMessage(requestError, "Unable to save this offboarding."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmHandOver(handOverToEmployeeId) {
    setHandOverSaving(true); setHandOverError("");
    try {
      const saved = await createSeparation({ ...handOver.payload, employeeId: employee.id, handOverToEmployeeId });
      onSaved(`${savedMessage(saved)} Their pending work was reassigned.`);
    } catch (requestError) {
      setHandOverError(errorMessage(requestError, "Unable to save this offboarding."));
    } finally {
      setHandOverSaving(false);
    }
  }

  const resultingStatus = statusForSeparationType(form.separationType);

  return <>{handOver && <HandOverDialog
    employee={employee}
    pending={handOver.pending}
    saving={handOverSaving}
    error={handOverError}
    onConfirm={confirmHandOver}
    onClose={() => { setHandOver(null); setHandOverError(""); }}
  />}
  <SchemaFormPanel
    title={separation ? "Edit Offboarding" : "Offboarding"}
    description={`${employee.employeeName}${employee.employeeId ? ` · ${employee.employeeId}` : ""}${resultingStatus ? ` — will be marked ${resultingStatus}` : ""}`}
    sections={separationFormSections}
    values={form}
    onChange={update}
    sidebarAriaLabel="Offboarding form sections"
    closeAriaLabel="Close offboarding form"
    onClose={onClose}
    onSubmit={submit}
    error={error || fields.summary}
    errors={fields.errors}
    saving={saving}
    loading={loading}
    loadingLabel="Loading offboarding..."
    submitLabel={separation ? "Update Offboarding" : "Complete Offboarding"}
    savingLabel="Saving..."
  /></>;
}
