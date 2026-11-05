"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import { CardState } from "@/components/shared/DashboardCard";
import A4DocumentPreview from "@/components/shared/A4DocumentPreview";
import ImageUploadField from "@/components/shared/ImageUploadField";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import {
  getCertificateSettings,
  previewCertificateSettings,
  saveCertificateSettings,
} from "@/services/settings/certificates.service";

const NOTE_LIMIT = 2000;
const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;
// The settings as the server answers them, in the shape this form compares against.
const savedOf = (data) => ({
  signature: data.signatureUrl || null,
  note: data.note || "",
  signatoryName: data.signatoryName || "",
  signatoryDesignation: data.signatoryDesignation || "",
  closing: data.closing || "",
  html: data.html || "",
});

/**
 * Settings → Employee → Certificate → Experience or Employment (`kind`, named `label`) - and the Offer
 * Letter (`offer`, its `documentName` "offer letter", `withNote` false - it has none): the document's
 * e-signature, signatory and closing note, then the document on an A4 sheet - the
 * Payslip's preview (`A4DocumentPreview`), with the same
 * logo, company name and head-office address the payslip prints.
 *
 * The sheet is the server's document, so it is what will be printed. It follows the signature and
 * the note as they are edited - read back from the server, never drawn here - and Save keeps them.
 */
export default function CertificateTemplatePanel({ kind, label, documentName, withNote = true, framed = false, previewToken = 0, unsavedRef, onNotice, onError }) {
  const name = documentName || `${String(label || kind).toLowerCase()} certificate`;
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  const [saved, setSaved] = useState(null);
  const [signature, setSignature] = useState(null);
  const [note, setNote] = useState("");
  // The authorised signatory printed under the e-signature.
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryDesignation, setSignatoryDesignation] = useState("");
  // The line the document closes with, above the signature - "Sincerely," while empty.
  const [closing, setClosing] = useState("");
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  // The sheet's state while it follows an edit: "updating", "failed", or "" when it shows what is on screen.
  const [previewState, setPreviewState] = useState("");
  const previewTicket = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await getCertificateSettings(kind);
      const data = response?.data || {};
      const next = savedOf(data);
      setSaved(next);
      setSignature(next.signature);
      setNote(next.note);
      setSignatoryName(next.signatoryName);
      setSignatoryDesignation(next.signatoryDesignation);
      setClosing(next.closing);
      setHtml(next.html);
    } catch (error) {
      setLoadError(errorMessage(error, `Unable to load the ${name}.`));
    } finally {
      setLoading(false);
    }
  }, [kind, name]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changed = Boolean(saved) && (signature !== saved.signature || note.trim() !== saved.note.trim()
    || signatoryName.trim() !== saved.signatoryName || signatoryDesignation.trim() !== saved.signatoryDesignation
    || closing.trim() !== saved.closing);

  // Leaving with unsaved edits is caught by Settings' own guard.
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = changed;
    return () => { unsavedRef.current = false; };
  }, [changed, unsavedRef]);

  /*
   * The sheet follows the edit: a moment after the last keystroke, the server prints the draft. Back
   * at the saved values, the saved sheet is shown again. While it is on its way, and if it fails,
   * that is said - the sheet is never left looking current when it is not.
   */
  useEffect(() => {
    if (!saved) return undefined;
    const ticket = ++previewTicket.current;
    // `previewToken` moves when something else the document prints has changed (the offer letter's
    // sections): the saved sheet is stale then, so the server prints it again.
    if (!changed && !previewToken) {
      const timer = window.setTimeout(() => { setHtml(saved.html); setPreviewState(""); }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setPreviewState("updating");
      previewCertificateSettings(kind, { signature, note, closing, signatoryName, signatoryDesignation })
        .then((response) => {
          if (ticket !== previewTicket.current) return;
          setHtml(response?.data?.html || "");
          setPreviewState("");
        })
        .catch(() => { if (ticket === previewTicket.current) setPreviewState("failed"); });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [kind, signature, note, closing, signatoryName, signatoryDesignation, saved, changed, previewToken]);

  async function save() {
    if (!changed || saving) return;
    setSaving(true);
    try {
      const response = await saveCertificateSettings(kind, { signature, note: note.trim(), closing: closing.trim(), signatoryName: signatoryName.trim(), signatoryDesignation: signatoryDesignation.trim() });
      const next = savedOf(response?.data || {});
      previewTicket.current += 1;
      setSaved(next);
      setSignature(next.signature);
      setNote(next.note);
      setSignatoryName(next.signatoryName);
      setSignatoryDesignation(next.signatoryDesignation);
      setClosing(next.closing);
      setHtml(next.html);
      onNotice?.(`${Name} saved.`);
    } catch (error) {
      onError?.(errorMessage(error, `Unable to save the ${name}.`));
    } finally {
      setSaving(false);
    }
  }

  // Back to what is saved - the sheet follows on its own (the preview effect above).
  function discard() {
    if (!saved) return;
    setSignature(saved.signature);
    setNote(saved.note);
    setSignatoryName(saved.signatoryName);
    setSignatoryDesignation(saved.signatoryDesignation);
    setClosing(saved.closing);
  }

  return <CardState loading={loading} error={loadError} onRetry={load} rows={4}>
    <div className="space-y-4">
      {/* `framed`: the fields and their Save in a bordered box with a heading, as the Offer Letter's other
          sections are drawn; the sheet stays outside it. */}
      <div className={framed ? "space-y-4 rounded-lg border border-slate-200 bg-white p-3 sm:p-4" : "space-y-4"}>
      {framed && <p className="text-sm font-semibold text-slate-800">Signature</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* The signature, then who signs it - printed in that order on the certificate. */}
        <div className="space-y-4">
          <TextField label="Closing" value={closing} maxLength={100} disabled={saving} placeholder="Sincerely," onChange={(event) => setClosing(event.target.value)} helperText="The sign-off line printed just above the e-signature." />
          <ImageUploadField
            label="E-Signature"
            helperText="The signature printed above the signatory's name."
            value={signature || ""}
            disabled={saving}
            onChange={(value) => setSignature(value || null)}
          />
          <TextField label="Authorized Signatory Name" value={signatoryName} maxLength={191} disabled={saving} placeholder="e.g. Priya Raman" onChange={(event) => setSignatoryName(event.target.value)} helperText="The person signing, printed under the e-signature." />
          <TextField label="Designation" value={signatoryDesignation} maxLength={191} disabled={saving} placeholder="e.g. HR Manager" onChange={(event) => setSignatoryDesignation(event.target.value)} helperText="Their job title, printed under the signatory's name." />
        </div>
        {withNote && <TextAreaField
          label="Note"
          value={note}
          rows={5}
          maxLength={NOTE_LIMIT}
          disabled={saving}
          placeholder="Optional"
          helperText={`Extra wording printed on every ${name}; leave it blank for none.`}
          onChange={(event) => setNote(event.target.value)}
        />}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-slate-500" aria-live="polite">{changed ? "Unsaved changes" : "All changes saved"}</span>
        {changed && <Button type="button" disabled={saving} onClick={discard}>Discard changes</Button>}
        <Button type="button" variant="primary" disabled={!changed} busy={saving} busyLabel="Saving..." onClick={() => void save()}>Save</Button>
      </div>
      </div>
      {previewState === "updating" && <p className="text-xs text-slate-500" aria-live="polite">Updating preview...</p>}
      {previewState === "failed" && <p className="text-xs text-red-700" role="alert">The preview could not be updated, so it may not show your latest changes. Saving still works.</p>}
      <A4DocumentPreview html={html} title={`${Name} preview`} />
    </div>
  </CardState>;
}
