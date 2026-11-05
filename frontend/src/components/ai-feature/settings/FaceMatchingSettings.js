"use client";

import { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Dropdown from "@/components/shared/Dropdown";
import HelpTip from "@/components/shared/HelpTip";
import { HANDLING_OPTIONS, aiDependencies, matchingProblems } from "@/lib/aiEventDefaults.mjs";
import NumberSetting from "./NumberSetting";
import SettingsCard from "./SettingsCard";

/**
 * Face Matching: what happens to a match at each confidence, then - under Advanced tuning, folded
 * away by default - the numbers that draw the bands. The same six stored values as before, with the
 * same ranges; only where they sit has changed, so the two handling choices a studio actually
 * reaches for are no longer mixed in with cosine cut-offs.
 *
 * All of it is inert while face recognition is off (see `aiDependencies`); the clustering threshold
 * is inert on its own while clustering is off, since clustering is the only reader of it.
 */
const FACE_OFF = "Face recognition is off: these are kept but nothing reads them until it is turned on.";

export default function FaceMatchingSettings({ values, onChange, readOnly = false }) {
  const ai = values.ai || {};
  const deps = aiDependencies(values);
  const problems = matchingProblems(ai);
  // Opened by hand, or on its own when one of the numbers inside it is refused - a problem the
  // reader cannot see is one they cannot fix.
  const [opened, setOpened] = useState(false);
  const advancedOpen = opened || Object.keys(problems).length > 0;
  const inert = !deps.faceOn;
  const set = (key) => (value) => onChange("ai", key, value);
  const numberProps = { readOnly, disabled: inert };

  return <div className="space-y-4">
    <SettingsCard title="Match handling" description="What the matcher does with a match that is not a strong one. A strong (high-confidence) match is always applied." inert={inert} inertReason={FACE_OFF}>
      <div className="grid gap-4 py-4 sm:grid-cols-2">
        <Dropdown label="Medium confidence" helperText="A likely match that is not certain. Sending it to the review queue lets the studio confirm or reject it on the Face Recognition tab." options={HANDLING_OPTIONS} value={ai.mediumConfidenceHandling || ""} readOnly={readOnly} disabled={inert && !readOnly} onChange={set("mediumConfidenceHandling")} sorted={false} />
        <Dropdown label="Low confidence" helperText="A weak resemblance. Do not show is the safe choice; review or automatic matching here will produce wrong matches." options={HANDLING_OPTIONS} value={ai.lowConfidenceHandling || ""} readOnly={readOnly} disabled={inert && !readOnly} onChange={set("lowConfidenceHandling")} sorted={false} />
      </div>
    </SettingsCard>

    <SettingsCard title="Advanced tuning" description="The numbers behind the confidence bands. The defaults suit the ArcFace model the engine runs; change them only with a reason." inert={inert} inertReason={FACE_OFF}>
      <button type="button" onClick={() => setOpened((current) => !current)} aria-expanded={advancedOpen} className="flex w-full items-center justify-between gap-2 py-3 text-left text-sm font-medium text-slate-700 hover:text-slate-900">
        <span>{advancedOpen ? "Hide advanced tuning" : "Show advanced tuning"}</span>
        <ExpandMoreIcon aria-hidden="true" fontSize="small" className={`shrink-0 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
      </button>
      {advancedOpen && <div className="space-y-6 border-t border-slate-100 py-4">
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Face quality</h4>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberSetting label="Minimum face quality" min={0} max={1} step={0.05} value={ai.minFaceQuality} onChange={set("minFaceQuality")} description="A detected face below this quality is stored but never clustered or matched. Raise it to ignore small or blurred faces; lower it to match more of them." {...numberProps} />
          </div>
        </div>
        <div>
          <h4 className="mb-3 flex items-center text-xs font-semibold uppercase tracking-wide text-slate-500">Match confidence<HelpTip text="Used by automatic matching and by Find My Photos alike." className="normal-case tracking-normal" /></h4>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberSetting label="High-confidence similarity" min={0} max={1} step={0.01} value={ai.similarityHigh} onChange={set("similarityHigh")} error={problems.similarityHigh} description="Cosine similarity at or above this is a strong match and is applied automatically. Must be at or above the medium cut-off." {...numberProps} />
            <NumberSetting label="Medium-confidence similarity" min={0} max={1} step={0.01} value={ai.similarityMedium} onChange={set("similarityMedium")} description="At or above this, below the high cut-off, is a medium match and follows the Medium confidence handling. Below it is low." {...numberProps} />
          </div>
        </div>
        <div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Clustering / same person</h4>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <NumberSetting label="Same-person threshold" min={0} max={1} step={0.01} value={ai.clusterThreshold} onChange={set("clusterThreshold")} description="Similarity at which two faces are taken to be the same person on the People tab. Higher splits people more readily; lower merges them." readOnly={readOnly} disabled={!deps.clusteringOn} />
          </div>
          {deps.faceOn && !deps.clusteringOn && <p className="mt-2 text-xs text-amber-700">Face clustering is off under AI & Face Recognition, so this threshold is kept but not read.</p>}
        </div>
      </div>}
    </SettingsCard>
  </div>;
}
