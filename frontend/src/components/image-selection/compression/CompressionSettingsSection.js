"use client";

import { useCallback, useEffect, useState } from "react";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import SettingRow from "@/components/ai-feature/settings/SettingRow";
import SettingsCard from "@/components/ai-feature/settings/SettingsCard";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import { COMPRESSION_MODULES, isRecommended, recommendedPresetsFor, studioPresetsFor } from "@/lib/visualCurationCompression.mjs";
import { previewPresetLabel, resolveModulePresets, thumbnailPresetLabel } from "@/lib/imagePresets.mjs";
import { getAiEventDefaults, saveAiEventDefaults } from "@/services/ai-feature/ai-feature.service";
import { getVisualCurationCompression, primeVisualCurationCompression, saveVisualCurationCompression } from "@/services/image-selection/compression.service";
import CompressionPresetFields from "./CompressionPresetFields";

/**
 * Settings → Processing / Compression: one card per Virtual Curation module, each with the two
 * presets its uploads are prepared to - Preview quality and Thumbnail quality - and a way back to
 * the recommended pair. Image Selection, Album Proofing and Signature Album are one studio record
 * (`/api/image-selection/compression`); the AI Feature card reads and writes the very same
 * `media` keys as AI Feature → Event Default Settings → Media Upload, so there is one answer
 * however it is reached, and an event still takes its own copy when it is created.
 *
 * Like the Target Download Path on this rail, every change saves itself the moment it is made and
 * the panel's Save Settings never reads or writes it; the intro says so once, and every save's
 * notice names what changed and offers Undo, which puts the previous value back through the same
 * save. A change applies to future uploads only: nothing already stored is recompressed.
 *
 * Who may change what: the three studio cards follow the panel's own permission
 * (SETTINGS / Organization); the AI Feature card follows IMAGE_SELECTION / AI Event Default
 * Settings, and is not drawn at all for somebody who may not read that record.
 */
const CARDS = [
  { module: "imageSelection", description: "Photo Selection galleries: the preview a client picks from, and the grid thumbnail." },
  { module: "albumProofing", description: "Album spreads and page previews. High keeps text and layout readable in review." },
  { module: "signatureAlbum", description: "The client album: its photos and the cover chosen from them. High keeps the detail a full-screen album wants." },
  { module: "aiFeature", description: "AI event photos: the preview face recognition reads and guests open, and the grid thumbnail. High is what the engine reads best; it is never made smaller to save space." },
];

/** What a change is called in the notice: the setting and, for a preset, the value it now holds. */
const SETTING_LABELS = { previewPreset: "Preview quality", thumbnailPreset: "Thumbnail quality", preserveMetadata: "Keep camera details" };
function describeChange(patch) {
  const parts = Object.entries(patch).map(([key, value]) => {
    if (key === "previewPreset") return `${SETTING_LABELS[key]} set to ${previewPresetLabel(value)}`;
    if (key === "thumbnailPreset") return `${SETTING_LABELS[key]} set to ${thumbnailPresetLabel(value)}`;
    return `${SETTING_LABELS[key] || key} turned ${value ? "on" : "off"}`;
  });
  return parts.join("; ");
}
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export default function CompressionSettingsSection() {
  const { canWrite } = useModuleAccess("SETTINGS", "Organization");
  const aiAccess = useModuleAccess("IMAGE_SELECTION", "AI Event Default Settings");
  const [studio, setStudio] = useState(null);
  const [aiMedia, setAiMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(null);
  const { notice, showError, showUndo, clearNotice } = useNotice();

  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      // Asked directly, not through the uploaders' cached read: that one answers the defaults when
      // the server cannot be reached, which on this screen would pass for "nothing stored". A
      // failure here is shown with Try again; the answer still primes the cache for the next batch.
      const [compression, ai] = await Promise.all([
        getVisualCurationCompression().then((response) => { const data = response?.data || null; primeVisualCurationCompression(data); return data; }),
        aiAccess.canRead ? getAiEventDefaults().then((response) => response?.data?.media || {}) : Promise.resolve(null),
      ]);
      setStudio(compression || {});
      setAiMedia(ai);
    } catch (caught) {
      setLoadError(caught?.message || "Unable to load the compression settings.");
    } finally {
      setLoading(false);
    }
  }, [aiAccess.canRead]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /**
   * One module's change, saved on its own. `previous` is what the same keys held before, so the
   * notice can offer Undo - which is this same save, the other way round. The three studio
   * modules write the studio record (and prime the cache, so the next batch follows the new
   * preset); the AI Feature writes its Event Default Settings.
   */
  async function save(module, patch, previous, { undo = false } = {}) {
    const isAi = module === "aiFeature";
    const label = COMPRESSION_MODULES[module].label;
    setBusy(module);
    try {
      if (isAi) {
        const response = await saveAiEventDefaults({ media: patch });
        setAiMedia(response?.data?.media || {});
      } else {
        const response = await saveVisualCurationCompression({ [module]: patch });
        primeVisualCurationCompression(response?.data || null);
        setStudio(response?.data || {});
      }
      const message = undo ? `${label}: put back.` : `${label}: ${describeChange(patch)}. Applies to future uploads${isAi ? "; new events start from it, an existing event keeps its own copy" : ""}.`;
      if (undo) showUndo(message, () => save(module, previous, patch));
      else showUndo(message, () => save(module, previous, patch, { undo: true }));
    } catch (caught) {
      const names = Object.keys(patch).map((key) => SETTING_LABELS[key] || key).join(", ");
      showError(`Couldn't save ${names} for ${label}. ${caught?.message || "Try again."}`);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !studio) return <Loader label="Loading compression settings..." />;
  if (loadError && !studio) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><p>{loadError}</p><Button type="button" size="sm" className="mt-3" onClick={load}>Retry</Button></div>;

  return <div className="space-y-4">
    <p className="text-sm text-slate-500">How each module optimizes a photo before it is uploaded. Photos are always optimized on the uploader&apos;s computer - the preview and the thumbnail are both cut from one reading of the original, and only those two files are sent; originals never leave the computer they are on. Changes save as you make them, and apply to future uploads only. The desktop app follows the same choices.</p>
    {CARDS.map(({ module, description }) => {
      const isAi = module === "aiFeature";
      if (isAi && !aiAccess.canRead) return null;
      const stored = isAi ? aiMedia : studioPresetsFor(studio, module);
      const presets = resolveModulePresets(module, stored);
      const readOnly = isAi ? !aiAccess.canWrite : !canWrite;
      const saving = busy === module;
      const recommended = recommendedPresetsFor(module);
      // What the same keys hold now, so Undo can put them back.
      const current = (keys) => Object.fromEntries(keys.map((key) => [key, key in presets ? presets[key] : aiMedia?.preserveMetadata === true]));
      const change = (patch) => save(module, patch, current(Object.keys(patch)));
      return <SettingsCard key={module} title={COMPRESSION_MODULES[module].label} description={description}>
        <CompressionPresetFields className="py-4" previewPreset={presets.previewPreset} thumbnailPreset={presets.thumbnailPreset} readOnly={readOnly || saving} onChange={(key, value) => change({ [key]: value })} />
        {isAi && <SettingRow label="Keep camera details" description="Camera make, model, lens and capture times on the stored preview; never location. Kept only when the server makes the preview: a format the browser cannot read." checked={aiMedia?.preserveMetadata === true} onChange={(next) => change({ preserveMetadata: next })} disabled={readOnly || saving} />}
        <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500" aria-live="polite">{saving ? "Saving..." : <>Recommended: {capital(recommended.previewPreset)} preview, {capital(recommended.thumbnailPreset)} thumbnail.{isAi ? " The advanced values are under AI Feature → Event Default Settings → Media Upload." : ""}</>}</p>
          {!readOnly && !isRecommended(module, stored) && <Button type="button" size="sm" className="shrink-0" disabled={saving} onClick={() => change(recommended)}>Restore recommended defaults</Button>}
        </div>
      </SettingsCard>;
    })}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </div>;
}
