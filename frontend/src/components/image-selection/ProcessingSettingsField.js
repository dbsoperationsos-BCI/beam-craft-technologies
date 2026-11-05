"use client";

import { useEffect, useMemo, useState } from "react";
import Dropdown from "@/components/shared/Dropdown";
import {
  QUALITY_PRESETS,
  readProcessingSettings,
  storeProcessingSettings,
} from "@/lib/imageSelectionProcessingSettings.mjs";

/**
 * The Processing control in ⋮ → Settings: the preview quality this computer encodes for
 * the gallery. How many photos run at once is not shown here at all — the uploader sizes itself
 * to this machine's cores and memory silently. The quality belongs to this browser rather than to
 * the studio-wide record, so it saves itself as it changes and takes no part in the form's
 * submit, exactly like the Target Download Path above it. The desktop app works the same way.
 */
export default function ProcessingSettingsField() {
  // Read after mount rather than during render: the first render also happens on the server,
  // where there is no localStorage to read. Deferred by a zero timer for the same reason the
  // workspace's loaders are — setting state straight from an effect body is a cascading render.
  const [settings, setSettings] = useState({ quality: "standard" });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettings({ quality: readProcessingSettings().quality });
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (loaded) storeProcessingSettings(settings);
  }, [settings, loaded]);

  // The presets never change while the panel is open, so the list is built once rather than on
  // every keystroke elsewhere in the form.
  const qualityOptions = useMemo(
    () => Object.entries(QUALITY_PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
    [],
  );

  return (
    <div className="max-w-2xl space-y-4">
      {/*
        * The application's own Dropdown rather than the browser's `select`, so this reads and
        * behaves like every other picker in the app — one menu style, keyboard stepping, and a
        * list that is not drawn by the operating system.
        *
        * `sorted={false}` because the order is the meaning: Dropdown alphabetises by default, which
        * would shuffle a quality scale into Compact, High, Light, Smallest, Standard. The presets
        * are already heaviest-first where they are declared, and that is the order shown.
        */}
      <Dropdown
        label="Preview quality"
        ariaLabel="Preview quality"
        value={settings.quality}
        onChange={(quality) => setSettings({ quality })}
        options={qualityOptions}
        sorted={false}
      />
      <p className="text-[11px] text-slate-500">
        Applies to uploads from this computer: the preset sets the preview clients see in the
        gallery and is saved as it is changed. Processing speed is tuned automatically to this
        machine.
      </p>
    </div>
  );
}
