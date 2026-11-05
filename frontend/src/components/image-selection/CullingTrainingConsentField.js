"use client";

import { useCallback, useEffect, useState } from "react";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import Loader from "@/components/shared/Loader";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import { getCullingTrainingConsent, listCullingModels, setCullingTrainingConsent } from "@/services/image-selection/culling-learning.service";
import formatDateTime from "@/lib/formatDateTime.mjs";

const STATUS_WORDS = { CANDIDATE: "Trained, not in use", SHADOW: "Testing quietly", CANARY: "Testing on some shoots", PRODUCTION: "In use", RETIRED: "No longer used" };
const versionOf = (model) => `Version ${model.version}`;

/**
 * ⋮ → Settings → AI Culling Training: the studio's opt-in to its finalized culling runs being used
 * to train the culling AI, and the trained models it has. Its own record and endpoint
 * (/api/image-selection/culling-learning), saved the moment the switch moves - the panel's Save
 * never touches it, like the sections beside it. Settings / Organization decides: Read shows the
 * state, Read-Write also shows the switch; turning training on is confirmed, turning it off is not.
 */
export default function CullingTrainingConsentField() {
  const { canRead, canWrite, loading: accessLoading } = useModuleAccess("SETTINGS", "Organization");
  const [consent, setConsent] = useState(null);
  const [models, setModels] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const load = useCallback(() => (
    Promise.all([getCullingTrainingConsent(), listCullingModels()])
      .then(([consentResponse, modelResponse]) => { setConsent(consentResponse.data); setModels(modelResponse.data || []); })
      .catch((failure) => setError(failure.message || "The training settings could not be loaded."))
  ), []);
  const retry = () => { setError(""); load(); };
  useEffect(() => { if (canRead) load(); }, [canRead, load]);

  async function save(next) {
    setBusy(true);
    try {
      setConsent((await setCullingTrainingConsent(next)).data);
      showSuccess(next ? "Training is on. Culls finalized from now on can teach the culling AI." : "Training is off. No more culls will be used.");
    } catch (failure) {
      showError(failure.message || "The training setting could not be saved.");
    } finally { setBusy(false); setConfirming(false); }
  }
  function toggle(next) {
    if (next) { setConfirming(true); return; }
    save(false);
  }

  if (accessLoading) return <Loader label="Loading training settings..." size="sm" inline />;
  if (!canRead) return <p className="text-xs text-slate-600">The studio&apos;s administrators manage AI training.</p>;
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span>{error}</span>
        <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (!consent) return <Loader label="Loading training settings..." size="sm" inline />;
  const inUse = models.find((model) => model.status === "PRODUCTION");
  return (
    <div className="space-y-3">
      <FloatingNotice notice={notice} onClose={clearNotice} />
      <p className="text-sm text-slate-700">
        {consent.consent ? "Training is on." : "Training is off."}
        {consent.consentAt ? ` Turned ${consent.consent ? "on" : "off"} by ${consent.consentBy || "a former user"} on ${formatDateTime(consent.consentAt)}.` : ""}
      </p>
      {canWrite && (
        <ToggleSwitch className="min-h-10" label="Let finalized culls train the culling AI" helperText="Lets your team's Keep and Reject choices improve the culling AI." checked={consent.consent} disabled={busy} onCheckedChange={toggle} />
      )}
      <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-500">
        <li>Photos never leave the server. Only the AI&apos;s scores and your team&apos;s Keep and Reject choices are used.</li>
        {canWrite && <li>Saved as soon as you switch. Switching off keeps every later cull out.</li>}
      </ul>
      <p className="text-xs text-slate-600">
        {inUse ? `Culling uses the model trained on your studio's choices (${versionOf(inUse).toLowerCase()}).` : "Culling uses its built-in scoring."}
      </p>
      {models.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-xs">
          {models.map((model) => (
            <li key={model.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="font-medium text-slate-700">{versionOf(model)}</span>
              <span className="text-slate-500">{STATUS_WORDS[model.status] || model.status}{model.headline?.agreement != null ? ` · matched your team's choices on ${Math.round(model.headline.agreement * 100)}% of test photos` : ""}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-500">No trained model yet. One is trained only once training is on and enough culls are finalized, and it is tested quietly before culling ever uses it.</p>
      )}
      <ConfirmDialog
        open={confirming}
        title="Turn on AI training?"
        message="Culls finalized from now on will teach the culling AI your team's taste. Photos never leave the server: only the AI's scores and your team's Keep and Reject choices are used. Your name is recorded with this change, and you can turn it off at any time."
        confirmLabel="Turn on training"
        busyLabel="Turning on..."
        tone="primary"
        loading={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => save(true)}
      />
    </div>
  );
}
