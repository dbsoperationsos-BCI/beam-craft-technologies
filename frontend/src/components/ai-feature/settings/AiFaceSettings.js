"use client";

import { aiDependencies } from "@/lib/aiEventDefaults.mjs";
import SettingRow from "./SettingRow";
import SettingsCard from "./SettingsCard";

/**
 * AI & Face Recognition: the four switches that decide what the worker does with a photo. Face
 * recognition is the parent of the other three - with it off the worker skips every photo
 * (`processing/service.js`), so they are dimmed rather than hidden, and keep their values for when
 * it is turned back on.
 */
const OFF_REASON = "Face recognition is off: these are kept but nothing reads them until it is turned on.";

export default function AiFaceSettings({ values, onChange, readOnly = false }) {
  const ai = values.ai || {};
  const deps = aiDependencies(values);
  const set = (key) => (value) => onChange("ai", key, value);
  const inert = !deps.faceOn;

  return <div className="space-y-4">
    <SettingsCard title="Face recognition engine" description="The first step: without it no faces are found, and none of the settings below or under Face Matching do anything.">
      <SettingRow label="Enable face recognition" description="Detect faces in every uploaded photo and prepare them for matching. Off, photos still upload and are marked Skipped." checked={ai.faceRecognition} onChange={set("faceRecognition")} disabled={readOnly} />
    </SettingsCard>
    <SettingsCard title="People discovery" inert={inert} inertReason={OFF_REASON}>
      <SettingRow label="Face clustering (People)" description="Automatically group photographs belonging to the same detected person, shown on the event's People tab." checked={ai.faceClustering} onChange={set("faceClustering")} disabled={readOnly || inert} />
    </SettingsCard>
    <SettingsCard title="Guest search" inert={inert} inertReason={OFF_REASON}>
      <SettingRow
        label="Selfie search (Find My Photos)"
        description="Allow a guest's selfie to be compared against the event's faces to find their photos."
        note={deps.selfieSearchOn && !deps.selfieSearchUsable ? "Guests can only use this once Enable guest selfie is on under Guest Access." : undefined}
        checked={ai.selfieSearch}
        onChange={set("selfieSearch")}
        disabled={readOnly || inert}
      />
    </SettingsCard>
    <SettingsCard title="Matching" inert={inert} inertReason={OFF_REASON}>
      <SettingRow label="Automatic face matching" description="Associate high-confidence face matches with registered guests as photos are processed. How each confidence band is handled is set under Face Matching." checked={ai.automaticMatching} onChange={set("automaticMatching")} disabled={readOnly || inert} />
    </SettingsCard>
  </div>;
}
