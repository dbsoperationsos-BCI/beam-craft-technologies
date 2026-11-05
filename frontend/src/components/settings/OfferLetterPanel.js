"use client";

import { useCallback, useEffect, useState } from "react";
import CertificateTemplatePanel from "@/components/settings/CertificateTemplatePanel";
import OfferLetterSectionsEditor from "@/components/settings/OfferLetterSectionsEditor";
import Button from "@/components/shared/Button";
import { CardState } from "@/components/shared/DashboardCard";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import TextField from "@/components/shared/TextField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { getOfferLetterTiming, saveOfferLetterTiming } from "@/services/settings/certificates.service";

/**
 * Settings → Employee → Certificate → Offer Letter: when every employee's offer letter is generated -
 * a number of days after their date of joining - then its own sections after Employment Details and
 * Compensation (`OfferLetterSectionsEditor`), then the letter's sign-off as the certificates have
 * theirs, without the note (e-signature, signatory, designation; `CertificateTemplatePanel` as the
 * `offer` kind) above the letter on an A4 sheet: its heading laid out as the payslip's, From
 * the studio, To and Employment Details left as blanks - each letter is filled from its own employee
 * when it is generated. An administrator's, like the rest of the Certificate group.
 */
export default function OfferLetterPanel({ unsavedRef, onNotice: onSectionNotice, onError }) {
  const [savedDays, setSavedDays] = useState(null);
  const [days, setDays] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const { busy, run } = useSubmitOnce();
  const { notice, showSuccess, clearNotice } = useNotice();
  // Moves each time a section is saved, so the A4 sheet below prints the letter again.
  const [sectionsVersion, setSectionsVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = (await getOfferLetterTiming())?.data || {};
      setSavedDays(data.generateAfterDays ?? null);
      setDays(data.generateAfterDays === null || data.generateAfterDays === undefined ? "" : String(data.generateAfterDays));
    } catch (requestError) {
      setLoadError(requestError?.data?.message || requestError?.message || "Unable to load the offer letter.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function save() {
    const value = days.trim();
    if (!/^\d+$/.test(value)) { setError("Enter a whole number of days, such as 45."); return; }
    if (Number(value) > 365) { setError("Keep it within a year - 365 days at most."); return; }
    void run(async () => {
      try {
        const saved = (await saveOfferLetterTiming({ generateAfterDays: Number(value) }))?.data?.generateAfterDays ?? null;
        setSavedDays(saved);
        setDays(saved === null ? "" : String(saved));
        showSuccess("Saved. Offer letters follow the new timing.");
      } catch (requestError) {
        setError(requestError?.data?.message || requestError?.message || "Unable to save when the offer letter is generated.");
      }
    });
  }

  const changed = days.trim() !== (savedDays === null ? "" : String(savedDays));
  // What the saved setting means, in the studio's words.
  const summary = savedDays === null
    ? "Not set yet - no offer letter is generated until it is."
    : savedDays === 0
      ? "Each employee's offer letter is generated on their date of joining."
      : `Each employee's offer letter is generated ${savedDays} ${savedDays === 1 ? "day" : "days"} after their date of joining.`;

  return <div className="flex flex-col gap-4">
    <CardState loading={loading} error={loadError} onRetry={load} rows={2}>
      {/* Not a <form>: Settings is one already, and a form may not sit in another. Save is pressed. */}
      <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
        <p className="text-sm font-semibold text-slate-800">When to generate offer letter</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <TextField
            className="w-full sm:max-w-xs"
            label="After joining"
            required
            inputMode="numeric"
            suffix="days"
            placeholder="e.g. 45"
            value={days}
            error={error}
            helperText={savedDays === null ? "0 is the day of joining." : `${summary} 0 is the day of joining.`}
            onChange={(event) => { setDays(event.target.value.replace(/[^\d]/g, "")); setError(""); }}
          />
          <Button type="button" variant="primary" busy={busy} disabled={!changed} onClick={save}>Save</Button>
        </div>
        {/* Not set is a warning to act on, so it stays on screen; a saved timing is only explained, in the ⓘ. */}
        {savedDays === null && <p className="text-xs text-slate-500">{summary}</p>}
      </section>
    </CardState>
    <OfferLetterSectionsEditor onSaved={() => setSectionsVersion((version) => version + 1)} onNotice={onSectionNotice} onError={onError} />
    <CertificateTemplatePanel kind="offer" label="Offer Letter" documentName="offer letter" withNote={false} framed previewToken={sectionsVersion} unsavedRef={unsavedRef} onNotice={onSectionNotice} onError={onError} />
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </div>;
}
