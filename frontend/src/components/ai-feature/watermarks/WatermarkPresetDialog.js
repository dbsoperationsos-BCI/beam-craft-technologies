"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import ChoiceCards from "@/components/shared/ChoiceCards";
import ColorField from "@/components/shared/ColorField";
import Dropdown from "@/components/shared/Dropdown";
import ImageUploadField from "@/components/shared/ImageUploadField";
import SliderField from "@/components/shared/SliderField";
import TextField from "@/components/shared/TextField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { NEW_PRESET, RANGES, presetPayload, presetProblems } from "@/lib/watermarkGeometry.mjs";
import { createWatermarkPreset, updateWatermarkPreset } from "@/services/ai-feature/watermark-presets.service";
import WatermarkPositionGrid from "./WatermarkPositionGrid";
import WatermarkPreview from "./WatermarkPreview";

/**
 * Add Watermark / Edit Watermark: a logo or a line of text, where it sits, how big and how strong,
 * with a live preview that moves as every control does. Nothing is saved until Save, and the
 * dialog is closed only once the server has kept it - `onSaved(preset)` is handed what it kept.
 *
 * Editing a preset changes it for Event Default Settings and for events that choose it from now
 * on; an event that already uses it keeps its own copy (the note under the title says so).
 */
const TYPES = [
  { value: "LOGO", label: "Logo", description: "Your studio's logo file - PNG keeps its transparency." },
  { value: "TEXT", label: "Text", description: "Words set in Montserrat, in the colour you choose." },
];
const WEIGHTS = [{ label: "Bold", value: "BOLD" }, { label: "Regular", value: "REGULAR" }];

function startingForm(preset) {
  if (!preset) return { ...NEW_PRESET };
  return { ...NEW_PRESET, ...preset, logo: null, text: preset.text || "", textColor: preset.textColor || NEW_PRESET.textColor, fontWeight: preset.fontWeight || NEW_PRESET.fontWeight };
}

// `layer` is where it stacks (constants/layers): over Event Default Settings it is `dialogOverPanel`.
export default function WatermarkPresetDialog({ preset = null, onClose, onSaved, layer = "dialog" }) {
  const editing = Boolean(preset?.id);
  const [form, setForm] = useState(() => startingForm(preset));
  const [fileName, setFileName] = useState("");
  const [orientation, setOrientation] = useState("landscape");
  const [showProblems, setShowProblems] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const { busy, run } = useSubmitOnce();
  const { guard, confirmProps } = useUnsavedGuard(dirty && !busy, { title: "Discard this watermark?", message: "The changes made here will be lost.", confirmLabel: "Discard", cancelLabel: "Keep editing" });
  const problems = presetProblems(form);
  const shown = showProblems ? problems : {};

  const set = (key) => (value) => { setDirty(true); setError(""); setForm((current) => ({ ...current, [key]: value })); };

  async function submit(event) {
    event?.preventDefault();
    if (Object.keys(problems).length) { setShowProblems(true); return; }
    await run(async () => {
      try {
        const payload = presetPayload(form);
        const saved = (editing ? await updateWatermarkPreset(preset.id, payload) : await createWatermarkPreset(payload))?.data;
        setDirty(false);
        onSaved(saved, { created: !editing });
      } catch (cause) {
        const fields = cause?.data?.errors?.fieldErrors;
        const first = fields ? Object.values(fields).flat()[0] : "";
        setError([cause?.message || "Unable to save the watermark.", first].filter(Boolean).join(" "));
      }
    });
  }

  const close = () => guard(onClose);

  return <>
    <Dialog
      title={editing ? "Edit Watermark" : "Add Watermark"}
      description={editing ? "Events that already use this watermark keep the version they took; new choices get this one." : "Save it once and pick it for any event."}
      size="xl"
      height="tall"
      layer={layer}
      busy={busy}
      onClose={close}
      onSubmit={submit}
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={close} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" className="max-sm:flex-1" busy={busy} busyLabel="Saving...">{editing ? "Save changes" : "Save watermark"}</Button>
      </>}
    >
      {/* A refused save is said at the top, where it is seen without scrolling, on a phone too. */}
      {error && <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* The preview leads on a phone, so a change is seen without scrolling back up to it. */}
        <section aria-label="Live preview" className="md:order-2">
          <div className="md:sticky md:top-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live preview</h3>
              <div role="group" aria-label="Preview frame" className="flex gap-1">
                {[["landscape", "Landscape"], ["portrait", "Portrait"]].map(([value, label]) => <Button key={value} type="button" size="sm" variant="secondary" aria-pressed={orientation === value} onClick={() => setOrientation(value)} className={orientation === value ? "border-blue-600 bg-blue-50 text-blue-700 hover:bg-blue-50" : ""}>{label}</Button>)}
              </div>
            </div>
            <div className={orientation === "portrait" ? "mx-auto max-w-[260px]" : ""}>
              <WatermarkPreview look={form} orientation={orientation} label={`Preview of ${form.name || "the watermark"}`} />
            </div>
          </div>
        </section>

        <div className="space-y-5 md:order-1">
          <TextField label="Preset name" helperText="The name this watermark is picked by in event settings." required value={form.name} maxLength={80} onChange={(event) => set("name")(event.target.value)} error={shown.name} placeholder="e.g. Studio logo" />
          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-600 sm:text-xs">Type</p>
            <ChoiceCards ariaLabel="Watermark type" options={TYPES} value={form.type} onChange={set("type")} columns={2} />
          </div>

          {form.type === "LOGO"
            ? <div>
              <ImageUploadField
                label="Logo"
                helperText="The logo image placed on the photos as the watermark."
                required
                value={form.logo || form.logoUrl}
                removable={false}
                previewFit="contain"
                compress={{ maxBytes: 600 * 1024, maxDimension: 2000 }}
                acceptLabel="PNG, JPG, WEBP or SVG up to 5 MB. A PNG with a transparent background looks best."
                accept=".png,.jpg,.jpeg,.webp,.svg"
                onChange={(value) => { if (value) set("logo")(value); }}
                onFileChosen={(file) => setFileName(file.name)}
                error={shown.logo}
              />
              <p className="mt-1 truncate text-xs text-slate-500">{fileName ? `Selected: ${fileName}` : form.logoUrl ? "Using the saved logo." : ""}</p>
            </div>
            : <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Watermark text" helperText="The words printed on the photos as the watermark." required value={form.text} maxLength={120} onChange={(event) => set("text")(event.target.value)} error={shown.text} placeholder="e.g. BeamCraft" className="sm:col-span-2" />
              <ColorField label="Text colour" helperText="The colour of the watermark words on the photos." value={form.textColor} onChange={set("textColor")} error={shown.textColor} />
              <Dropdown label="Weight" helperText="How thick the watermark text is drawn." options={WEIGHTS} value={form.fontWeight} onChange={set("fontWeight")} sorted={false} searchable={false} />
              <p className="text-xs text-slate-500 sm:col-span-2">Set in Montserrat, the studio&apos;s typeface. Size is set below.</p>
            </div>}

          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold text-slate-600 sm:text-xs">Position</p>
              <WatermarkPositionGrid value={form.position} onChange={set("position")} />
            </div>
            <div className="space-y-3">
              <SliderField label="Size" value={form.size} min={RANGES.size[0]} max={RANGES.size[1]} defaultValue={NEW_PRESET.size} unit="%" onChange={set("size")} />
              <SliderField label="Opacity" value={form.opacity} min={RANGES.opacity[0]} max={RANGES.opacity[1]} defaultValue={NEW_PRESET.opacity} unit="%" onChange={set("opacity")} />
              <SliderField label="Horizontal offset" value={form.offsetX} min={RANGES.offset[0]} max={RANGES.offset[1]} defaultValue={0} unit="%" onChange={set("offsetX")} />
              <SliderField label="Vertical offset" value={form.offsetY} min={RANGES.offset[0]} max={RANGES.offset[1]} defaultValue={0} unit="%" onChange={set("offsetY")} />
            </div>
          </div>
          <p className="text-xs text-slate-500">Size is the mark&apos;s width as a share of the photo&apos;s shorter side, so it reads the same on portrait and landscape photos. The mark always stays inside the photo.</p>
        </div>
      </div>
    </Dialog>
    <ConfirmDialog {...confirmProps} layer="confirmOverDialog" />
  </>;
}
