"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { getCullingPreferences, resetCullingPreferences, setCullingPreferencesEnabled } from "@/services/image-selection/image-selection.service";
import { CULLING_PREFERENCE_BURST_POLICY, CULLING_PREFERENCE_PRIVACY, cullingGroupTasteLabel, cullingPreferenceFeatureLabel, cullingPreferenceHasLearning, cullingPreferenceSummary } from "@/lib/imageSelectionCulling.mjs";

/**
 * What culling has learned from the signed-in photographer (Phase 8): the kinds of photo they keep
 * or reject more often than the AI suggested, learned from their own overrides and used — a few
 * points at most, badged on the photo — in the runs they start. They can switch it off for their
 * runs, or make culling forget what it learned (their decisions stay; only the learning restarts).
 *
 * Only for someone who decides (write access): a read-only viewer has no overrides to learn from.
 * Absent while it loads or when the read fails — it is a side panel, never a blocker.
 */
export default function CullingPreferencePanel({ projectId, canWrite = true, scenes = [], refreshKey = 0, onNotice }) {
  const [preferences, setPreferences] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    if (!canWrite) return;
    try { setPreferences((await getCullingPreferences(projectId)).data); } catch { setPreferences(null); }
  }, [projectId, canWrite]);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);

  async function toggle(enabled) {
    setBusy(true);
    try {
      setPreferences((await setCullingPreferencesEnabled(projectId, enabled)).data);
      onNotice?.(enabled ? "Your runs use what culling has learned from you." : "Your runs no longer use what culling has learned from you.", "success");
    } catch (error) { onNotice?.(error.message || "Unable to change the setting.", "error"); } finally { setBusy(false); }
  }

  async function forget() {
    setBusy(true);
    try {
      setPreferences((await resetCullingPreferences(projectId)).data);
      setConfirming(false);
      onNotice?.("Culling has forgotten what it learned from you; it starts learning again from your next decisions.", "success");
    } catch (error) { onNotice?.(error.message || "Unable to reset what culling learned.", "error"); } finally { setBusy(false); }
  }

  if (!canWrite || !preferences) return null;
  const learned = preferences.decisions >= preferences.minimum;
  return (
    // Compact and below the review: it is about future runs, never the main content.
    <section className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3" aria-labelledby="culling-preferences-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="culling-preferences-heading" className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI preferences</h3>
        {cullingPreferenceHasLearning(preferences) && <ToggleSwitch size="sm" className="min-h-10" label="Use it in my runs" helperText="Applies what was learned from your past culls to your new runs." checked={preferences.enabled} disabled={busy} onCheckedChange={toggle} />}
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-600">{cullingPreferenceSummary(preferences)}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{CULLING_PREFERENCE_PRIVACY}</p>
      {learned && preferences.features.length > 0 && (
        <p className="mt-2 text-[11px] font-medium text-slate-600">What your corrections show</p>
      )}
      {learned && preferences.features.length > 0 && (
        <ul className="mt-1 grid list-disc gap-1 pl-4 text-xs text-slate-600 sm:grid-cols-2">
          {preferences.features.map((feature) => <li key={feature.feature} className="break-words">{cullingPreferenceFeatureLabel(feature, scenes)}</li>)}
        </ul>
      )}
      {cullingGroupTasteLabel(preferences.groupTaste) && (
        <p className="mt-1 break-words text-xs text-slate-600">{cullingGroupTasteLabel(preferences.groupTaste)}</p>
      )}
      {cullingPreferenceHasLearning(preferences) && <p className="mt-1 text-[11px] leading-4 text-slate-500">{CULLING_PREFERENCE_BURST_POLICY}</p>}
      {preferences.decisions > 0 && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>Forget what it learned</Button>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          title="Forget what culling learned from you?"
          message="Culling stops using your past Keep and Reject changes and starts learning again from your next ones. Your decisions are not touched, and a run you already started keeps its numbers. This cannot be undone."
          confirmLabel="Forget what it learned"
          busyLabel="Forgetting…"
          tone="primary"
          loading={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={forget}
        />
      )}
    </section>
  );
}
