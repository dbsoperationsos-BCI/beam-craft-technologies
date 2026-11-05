"use client";

import { useEffect, useState } from "react";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { watermarkSwitches } from "@/lib/aiEventDefaults.mjs";
import { listWatermarkPresets } from "@/services/ai-feature/watermark-presets.service";
import WatermarkPresetManager from "./WatermarkPresetManager";
import WatermarkPreview from "./WatermarkPreview";

export const WATERMARK_PROBLEM = "Choose a watermark preset, or turn the watermark off.";

/**
 * The watermark part of a settings form: two switches - on what guests view, and on what they
 * download, each on its own - which saved preset both use, and the preset drawn on a
 * stand-in photo. Used by Create Event, an event's own Settings and Event Default Settings, so the
 * three describe one setting the same way.
 *
 * `gallery` is the form's gallery group; `onChange(key, value)` writes one of its keys
 * (`watermarkOnView`, `watermarkOnDownload`, `watermarkPresetId`, and `watermarkRefresh` - "copy the edited preset again" - in
 * an event's Settings). The presets are the server's own list, never a fixed one.
 *
 * - `defaultPresetId` marks the preset Event Default Settings names, so Create Event can say the
 *   choice is the default.
 * - `manage` (Event Default Settings only) opens the studio's presets right here - add, edit, delete -
 *   and the dropdown and preview follow each change at once: a first preset made while none is
 *   chosen is chosen, and a chosen one deleted is cleared. Create Event and an event's Settings point
 *   there instead of leaving their form.
 * - On an event, `gallery.watermarkSnapshot` is the copy the event took. The preview is drawn from
 *   it while it is still the choice, so the screen shows what guests get - even once the preset
 *   was edited or deleted - and an edited preset can be taken again on purpose.
 */
function usePresets() {
  const [state, setState] = useState({ loading: true, error: "", items: [], defaultPresetId: null });
  const [attempt, setAttempt] = useState(0);
  // A preset added elsewhere (another tab, another person) shows up here when this tab is looked at again.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") setAttempt((current) => current + 1); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);
  useEffect(() => {
    let cancelled = false;
    listWatermarkPresets()
      .then((response) => { if (!cancelled) setState({ loading: false, error: "", items: response?.data?.items || [], defaultPresetId: response?.data?.defaultPresetId || null }); })
      .catch((cause) => { if (!cancelled) setState({ loading: false, error: cause?.message || "Unable to load the watermark presets.", items: [], defaultPresetId: null }); });
    return () => { cancelled = true; };
  }, [attempt]);
  return { ...state, retry: () => { setState((current) => ({ ...current, loading: true, error: "" })); setAttempt((current) => current + 1); }, refresh: () => setAttempt((current) => current + 1) };
}

export default function WatermarkField({ gallery = {}, onChange, readOnly = false, defaultPresetId, showProblem = true, manage = false }) {
  const presets = usePresets();
  const { canRead: canOpenPresets, canWrite: canManagePresets } = useModuleAccess("IMAGE_SELECTION", "AI Event Default Settings");
  const [managing, setManaging] = useState(false);
  const { view: onView, download: onDownload } = watermarkSwitches(gallery);
  const on = onView || onDownload;
  const chosenId = gallery.watermarkPresetId || null;
  const snapshot = gallery.watermarkSnapshot || null;
  const chosen = presets.items.find((preset) => preset.id === chosenId) || null;
  const takenCopy = snapshot && snapshot.presetId === chosenId ? snapshot : null;
  const edited = Boolean(takenCopy && chosen && Date.parse(chosen.updatedAt) > Date.parse(takenCopy.takenAt));
  const refreshing = Boolean(gallery.watermarkRefresh);
  // What guests will get once this form is saved.
  const look = takenCopy && !refreshing ? takenCopy : chosen;
  const markedDefault = defaultPresetId !== undefined ? defaultPresetId : presets.defaultPresetId;
  const options = presets.items.map((preset) => ({ value: preset.id, label: preset.id === markedDefault && defaultPresetId !== undefined ? `${preset.name} (default)` : preset.name }));
  // A preset deleted since the event took it is still this event's watermark; it stays offered by name.
  if (takenCopy && !chosen) options.push({ value: takenCopy.presetId, label: `${takenCopy.name} (deleted preset - this event keeps its copy)` });
  const problem = on && !chosenId && showProblem ? WATERMARK_PROBLEM : "";

  if (readOnly) {
    return <div className="space-y-2">
      <p className="text-sm text-slate-700">Watermark: <span className="font-medium">{on ? `${look?.name || takenCopy?.name || "No preset chosen"} (${[onView && "on view", onDownload && "on download"].filter(Boolean).join(" and ")})` : "Off"}</span>{on && chosenId && chosenId === markedDefault && defaultPresetId !== undefined ? <span className="text-slate-500"> · default</span> : null}</p>
      {on && look && <div className="max-w-xs"><WatermarkPreview look={look} label={`Preview of ${look.name}`} /></div>}
    </div>;
  }

  return <div className="space-y-3 rounded-lg border border-slate-200 p-3">
    {/* Two switches, each on its own: turning one never moves the other, and turning both off keeps the preset. */}
    <div className="grid gap-3 sm:grid-cols-2">
      <ToggleSwitch label="Show watermark on view" helperText="Puts the watermark on photos while guests look at them." checked={onView} onCheckedChange={(checked) => onChange("watermarkOnView", checked)} className="w-full justify-between sm:w-auto sm:justify-start" />
      <ToggleSwitch label="Show watermark on download" helperText="Puts the watermark on photos guests download." checked={onDownload} onCheckedChange={(checked) => onChange("watermarkOnDownload", checked)} className="w-full justify-between sm:w-auto sm:justify-start" />
    </div>
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)]">
      <div className="space-y-2">
        {presets.loading
          ? <p className="text-xs text-slate-500">Loading watermark presets...</p>
          : presets.error
            ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-700"><span>{presets.error}</span><Button type="button" size="sm" onClick={presets.retry}>Try again</Button></div>
            : options.length === 0
              ? <p className="text-xs text-slate-600">No watermark presets are saved yet.{manage ? (canManagePresets ? " Add one below." : "") : canOpenPresets ? " Add one in Event Default Settings → Privacy & Access → Watermark." : " Ask whoever manages Event Default Settings to add one."}</p>
              : <Dropdown label="Watermark preset" helperText="The saved watermark design placed on the photos." options={options} value={chosenId || ""} placeholder="Choose a preset" onChange={(value) => { onChange("watermarkPresetId", value || null); if (gallery.watermarkRefresh) onChange("watermarkRefresh", false); }} error={problem} sorted={false} />}
        {(presets.loading || presets.error || options.length === 0) && problem && <p role="alert" className="text-xs text-red-600">{problem}</p>}
        {defaultPresetId !== undefined && chosenId && chosenId === defaultPresetId && <p className="text-xs text-slate-500">The default from Event Default Settings. Choose another preset to use a different one for this event only.</p>}
        {takenCopy && !chosen && !presets.loading && <p className="text-xs text-slate-500">That preset has since been deleted. This event keeps the copy it took, shown here.</p>}
        {edited && !refreshing && <div className="flex flex-col gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>&quot;{chosen.name}&quot; has been edited since this event took it. Guests still see the version shown here.</span>
          <Button type="button" size="sm" onClick={() => onChange("watermarkRefresh", true)} className="shrink-0">Use the latest version</Button>
        </div>}
        {refreshing && <p role="status" className="text-xs text-blue-800">The latest version of &quot;{chosen?.name}&quot; is shown. Save to use it for this event.</p>}
        {manage && <Button type="button" size="sm" variant="secondary" aria-expanded={managing} onClick={() => setManaging((current) => !current)}>{managing ? "Hide watermark presets" : canManagePresets ? "Manage watermark presets" : "Show watermark presets"}</Button>}
      </div>
      {look && <WatermarkPreview look={look} label={`Preview of ${look.name}`} />}
    </div>
    {manage && managing && <div className="border-t border-slate-200 pt-3">
      <WatermarkPresetManager
        canWrite={canManagePresets && !readOnly}
        layer="dialogOverPanel"
        onChanged={({ type, preset }) => {
          presets.refresh();
          if (type === "created" && !chosenId) onChange("watermarkPresetId", preset.id);
          if (type === "deleted" && preset.id === chosenId) onChange("watermarkPresetId", null);
        }}
      />
    </div>}
  </div>;
}
