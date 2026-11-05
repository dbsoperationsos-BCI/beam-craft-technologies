"use client";

import { useRef, useState } from "react";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import HelpTip from "@/components/shared/HelpTip";
import SliderField from "@/components/shared/SliderField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { ADJUSTMENTS, BALANCE_CHANNELS, BALANCE_CHANNEL_LABELS, BALANCE_RANGES, BALANCE_RANGE_LABELS, CROP_ASPECTS, DETAIL_FIELDS, DETAIL_LABELS, HSL_BANDS, HSL_BAND_LABELS, HSL_CHANNELS, HSL_CHANNEL_LABELS, RETOUCH_TOOL_IDS, STYLES, TOOLS, advancedCount, defaultToolSettings } from "@/lib/aiEditingRecipe.mjs";
import { adjustmentSectionState, sectionToolIds, setAdjustmentSection, setToolSection, toolAvailability, toolSectionState } from "@/lib/imageSelectionEditing.mjs";

/**
 * The editing controls over one recipe, AI first: Auto Edit, the style, the AI tools, then the
 * basic sliders and - folded away - the advanced panels (HSL, colour balance, detail) and the
 * reference photo. Every change goes up through `onChange(nextRecipe)`; nothing here talks to the
 * server. A tool the server cannot run is shown switched off with its reason, never hidden.
 *
 * `autoValues`: what the last render chose for the sliders left to the AI, shown beside "Auto".
 * `onSuggestMarks`: asks the server what it would remove (background people); absent when the
 * engine cannot propose.
 */
const AUTO_TOOLS = ["autoExposure", "autoWhiteBalance", "colorEnhance"];
const SETTING_LABELS = { strength: "Strength", amount: "Amount" };
const AI_TOOL_IDS = TOOLS.filter((tool) => tool.group === "ai").map((tool) => tool.id);

/**
 * A fold per section. `toggle` puts the section's own switch in its header - `{ state: "on" | "off"
 * | "mixed", onChange(on), label, title }`, its state read off the recipe by the caller - beside the
 * fold's chevron; pressing it never opens or shuts the fold. `hint` explains the section and is its
 * ⓘ beside the title; `notice` is a status the reader must see, drawn above the contents.
 */
function Section({ title, count, open, children, hint, notice, toggle = null }) {
  return (
    <details open={open} className="group rounded-md border border-slate-200">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-600 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center">{title}<HelpTip text={hint} className="normal-case tracking-normal" />{count ? <span className="ml-1.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-blue-700">{count}</span> : null}</span>
        <span className="flex items-center gap-2">
          {toggle && (
            // The switch's own press, kept from the fold: it changes the recipe, never the fold.
            <span className="flex items-center normal-case tracking-normal" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <ToggleSwitch ariaLabel={toggle.label} checked={toggle.state === "on"} mixed={toggle.state === "mixed"} disabled={toggle.disabled} title={toggle.title} size="sm" onCheckedChange={(next) => toggle.onChange(next)} />
            </span>
          )}
          <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-180">▾</span>
        </span>
      </summary>
      <div className="border-t border-slate-200 px-3 py-3">
        {notice && <p className="mb-2 text-[11px] text-amber-700">{notice}</p>}
        {children}
      </div>
    </details>
  );
}

/**
 * One tool: its switch, the server's word on whether it can run here (switched off with the reason
 * when not; an amber line when the region is approximate), its sliders, and - for the tools that
 * take one - the crop aspect or the painted marks. Drawn for every AI tool and every retouching
 * region alike, so a new tool is a row in the contract and nothing else.
 */
function ToolRow({ spec, recipe, capabilities, disabled, onToggle, onSettings, onSuggestMarks = null, suggesting = false, quietUnavailable = false }) {
  const availability = toolAvailability(capabilities, spec.id);
  const on = Boolean(recipe.tools[spec.id]);
  const settings = recipe.tools[spec.id] || {};
  const off = disabled || !availability.available;
  const region = spec.group === "retouch";
  return (
    <div className={`rounded-md border px-3 py-2 ${on ? "border-blue-200 bg-blue-50/40" : "border-slate-200"}`}>
      <ToggleSwitch label={spec.label} helperText={availability.available ? availability.note || spec.hint : ""} checked={on && availability.available} onCheckedChange={(next) => onToggle(spec.id, next)} disabled={off} size="sm" title={availability.reason || spec.hint || undefined} />
      {!availability.available && !quietUnavailable && <p className="mt-1 text-[11px] text-amber-700">Not available on this server: {availability.reason || "the engine lacks it"}.</p>}
      {availability.available && availability.partial && on && <p className="mt-1 text-[11px] text-amber-700">{availability.reason}</p>}
      {on && availability.available && Object.keys(spec.settings).length > 0 && (
        <div className="mt-2 space-y-1">
          {Object.entries(spec.settings).map(([name, [min, max, fallback]]) => (
            <SliderField key={name} label={region && name === "amount" ? `${spec.label} intensity` : spec.labels?.[name] || SETTING_LABELS[name] || name} value={settings[name] ?? fallback} min={min} max={max} defaultValue={fallback} onChange={(value) => onSettings(spec.id, { ...settings, [name]: value })} disabled={disabled} />
          ))}
        </div>
      )}
      {on && availability.available && spec.aspect && (
        <div className="mt-2">
          <Dropdown ariaLabel="Crop aspect" mode="switch" sorted={false} disabled={disabled} options={CROP_ASPECTS.map((aspect) => ({ value: aspect.id, label: aspect.label }))} value={settings.aspect || "original"} onChange={(aspect) => onSettings(spec.id, { ...settings, aspect })} />
        </div>
      )}
      {on && availability.available && spec.masks && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-slate-500">{settings.masks?.length ? `${settings.masks.length} area${settings.masks.length === 1 ? "" : "s"} marked on the Before view.` : "Switch the preview to Before and drag over what to remove."}</p>
          {onSuggestMarks && availability.suggest !== false && <Button variant="ghost" size="sm" onClick={onSuggestMarks} disabled={disabled || suggesting} busy={suggesting} busyLabel="Looking...">Suggest background people</Button>}
        </div>
      )}
    </div>
  );
}

export default function EditingControls({ recipe, onChange, capabilities, autoValues = {}, disabled = false, reference, onReferenceUpload, onReferenceRemove, referenceBusy = false, onSuggestMarks = null, suggesting = false }) {
  const fileRef = useRef(null);
  const [hslBand, setHslBand] = useState("orange");
  const setAdjustment = (id, value) => onChange({ ...recipe, adjustments: { ...recipe.adjustments, [id]: value } });
  const setTool = (id, settings) => onChange({ ...recipe, tools: { ...recipe.tools, [id]: settings } });
  const setAdvanced = (panel, key, field, value) => onChange({ ...recipe, advanced: { ...recipe.advanced, [panel]: { ...recipe.advanced[panel], [key]: { ...recipe.advanced[panel][key], [field]: value } } } });
  const setDetail = (field, value) => onChange({ ...recipe, advanced: { ...recipe.advanced, detail: { ...recipe.advanced.detail, [field]: value } } });
  const toggleTool = (id, on) => {
    const tools = { ...recipe.tools };
    if (on) tools[id] = recipe.tools[id] || defaultToolSettings(id); else delete tools[id];
    onChange({ ...recipe, tools });
  };
  // Auto Edit: the three auto tools on and every auto-able slider handed to the AI; pressed again,
  // the three off and the sliders back to their defaults.
  const autoOn = AUTO_TOOLS.every((id) => recipe.tools[id]);
  function autoEdit() {
    const tools = { ...recipe.tools };
    const adjustments = { ...recipe.adjustments };
    if (autoOn) {
      for (const id of AUTO_TOOLS) delete tools[id];
      for (const entry of ADJUSTMENTS) if (entry.auto && adjustments[entry.id] === null) adjustments[entry.id] = 0;
    } else {
      for (const id of AUTO_TOOLS) tools[id] = recipe.tools[id] || defaultToolSettings(id);
      for (const entry of ADJUSTMENTS) if (entry.auto) adjustments[entry.id] = null;
    }
    onChange({ ...recipe, tools, adjustments });
  }
  const sliderCount = ADJUSTMENTS.filter((entry) => recipe.adjustments[entry.id] !== 0).length;
  const aiCount = AI_TOOL_IDS.filter((id) => recipe.tools[id]).length;
  // Counted only where this server can run the region: a saved recipe carrying one it cannot
  // would otherwise read "1 on" over ten switches all showing off.
  const retouchCount = RETOUCH_TOOL_IDS.filter((id) => recipe.tools[id] && toolAvailability(capabilities, id).available).length;
  const retouchUnavailable = RETOUCH_TOOL_IDS.every((id) => !toolAvailability(capabilities, id).available);
  // The fold opens on its own only when the photo arrives with a region on; after that it is
  // the photographer's, and switching the last region off does not snap it shut under them.
  const [retouchOpen] = useState(() => RETOUCH_TOOL_IDS.some((id) => recipe.tools[id]));
  const advanced = advancedCount(recipe);
  const profile = recipe.referenceProfile;
  // The three section switches: state read off the recipe, each writing only its own part of it.
  const aiSectionIds = sectionToolIds("ai", capabilities);
  const retouchSectionIds = sectionToolIds("retouch", capabilities);
  const toolToggle = (ids, label, what) => ({ state: toolSectionState(recipe, ids), onChange: (on) => onChange(setToolSection(recipe, ids, on)), disabled: disabled || ids.length === 0, label, title: `${what} - each keeps its own switch and sliders` });

  return (
    // Auto Edit and the style stay put at the top; the sections scroll beneath them (the aside
    // bounds the height from lg up, where the controls sit beside the photo).
    <div className="flex min-h-0 flex-col gap-3 lg:flex-1">
      <div className="shrink-0 space-y-3 border-b border-slate-200 pb-3">
      <Button variant="secondary" size="sm" aria-pressed={autoOn} onClick={autoEdit} disabled={disabled} className={`w-full ${autoOn ? "border-blue-300 bg-blue-50 text-blue-800" : ""}`} title={autoOn ? "Switch Auto Edit off" : "A restrained professional base: exposure aimed at the faces, dress and suit recovered, white balance from the neutrals, gentle colour"}>
        <AutoAwesome style={{ fontSize: 16 }} aria-hidden="true" className="mr-1.5" />{autoOn ? "Auto Edit on - switch off" : "Auto Edit"}
      </Button>

      <div>
        <p className="mb-1 flex items-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">Style<HelpTip text={STYLES.find((style) => style.id === recipe.style)?.description} className="normal-case tracking-normal" /></p>
        <Dropdown ariaLabel="Style" mode="switch" sorted={false} disabled={disabled} options={STYLES.map((style) => ({ value: style.id, label: style.label }))} value={recipe.style} onChange={(style) => onChange({ ...recipe, style })} />
      </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 lg:overflow-y-auto lg:pr-1">

      <Section title="AI tools" count={aiCount ? `${aiCount} on` : ""} open toggle={toolToggle(aiSectionIds, "All AI tools", "Switches every AI tool this server can run on or off (Remove Object waits for areas you mark)")}>
        <div className="space-y-2">
          {TOOLS.filter((spec) => spec.group === "ai").map((spec) => <ToolRow key={spec.id} spec={spec} recipe={recipe} capabilities={capabilities} disabled={disabled} onToggle={toggleTool} onSettings={setTool} onSuggestMarks={onSuggestMarks} suggesting={suggesting} />)}
        </div>
      </Section>

      {/* Retouching by region: the same row as an AI tool - a switch, the reason when the region is
          only approximate on this server, one intensity - so the ten read as one family. */}
      <Section title="Retouching" count={retouchCount ? `${retouchCount} on` : ""} open={retouchOpen} toggle={toolToggle(retouchSectionIds, "All retouching regions", "Switches every retouching region this server can run on or off")} notice={retouchUnavailable ? `Not available right now: ${toolAvailability(capabilities, RETOUCH_TOOL_IDS[0]).reason || "the face engine is not running"}.` : ""} hint="Each works only inside the region it finds - skin, eyes, lips, teeth, hair, clothes - and leaves everything else as shot. Natural by default; raise an intensity only where a photo asks for it.">
        <div className="space-y-2">
          {TOOLS.filter((spec) => spec.group === "retouch").map((spec) => <ToolRow key={spec.id} spec={spec} recipe={recipe} capabilities={capabilities} disabled={disabled} onToggle={toggleTool} onSettings={setTool} quietUnavailable={retouchUnavailable} />)}
        </div>
      </Section>

      <Section title="Basic adjustments" count={sliderCount ? `${sliderCount} set` : ""} open toggle={{ state: adjustmentSectionState(recipe), onChange: (on) => onChange(setAdjustmentSection(recipe, on)), disabled, label: "Let the AI set the basic sliders", title: "On: every exposure and white-balance slider at 0 is handed to the AI (Auto). Off: every Auto slider back to 0. Numbers you set are kept." }}>
        <div className="space-y-1.5">
          {ADJUSTMENTS.map((entry) => (
            <SliderField key={entry.id} label={entry.label} value={recipe.adjustments[entry.id]} onChange={(value) => setAdjustment(entry.id, value)} auto={entry.auto} autoValue={autoValues[entry.id] ?? null} disabled={disabled} />
          ))}
        </div>
      </Section>

      <Section title="Advanced" count={advanced ? `${advanced} set` : ""} open={advanced > 0} hint="Colour grading by hue, by tonal range, and detail. Skin is protected throughout.">
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-700">HSL<HelpTip text="Pick a colour; the sliders below change only that colour's hue, saturation and brightness." /></p>
            <Dropdown ariaLabel="Hue band" mode="switch" sorted={false} disabled={disabled} options={HSL_BANDS.map((band) => ({ value: band, label: HSL_BAND_LABELS[band] }))} value={hslBand} onChange={setHslBand} />
            <div className="mt-2 space-y-1">
              {HSL_CHANNELS.map((channel) => (
                <SliderField key={channel} label={HSL_CHANNEL_LABELS[channel]} value={recipe.advanced.hsl[hslBand][channel]} onChange={(value) => setAdvanced("hsl", hslBand, channel, value)} disabled={disabled} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-700">Colour balance</p>
            {BALANCE_RANGES.map((range) => (
              <div key={range} className="mt-1">
                <p className="text-[11px] text-slate-500">{BALANCE_RANGE_LABELS[range]}</p>
                {BALANCE_CHANNELS.map((channel) => (
                  <SliderField key={channel} label={BALANCE_CHANNEL_LABELS[channel]} value={recipe.advanced.colorBalance[range][channel]} onChange={(value) => setAdvanced("colorBalance", range, channel, value)} disabled={disabled} />
                ))}
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-700">Detail</p>
            {DETAIL_FIELDS.map((field) => (
              <SliderField key={field} label={DETAIL_LABELS[field]} value={recipe.advanced.detail[field]} onChange={(value) => setDetail(field, value)} disabled={disabled} />
            ))}
          </div>
        </div>
      </Section>

      <Section title="Reference style" count={reference?.hasReference || profile ? "set" : ""} open={Boolean(reference?.hasReference || profile)} hint="Upload an edited photo you like. Its light and colour are measured into an editing profile this photo - and any batch - is moved towards.">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onReferenceUpload(file); event.target.value = ""; }} />
        {reference?.hasReference ? (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={reference.referenceUrl} alt="Reference" className="h-16 w-16 shrink-0 rounded object-cover" />
            <div className="min-w-0 flex-1">
              {profile?.summary && <p className="mb-1 text-[11px] text-slate-600">{profile.summary}</p>}
              <SliderField label="Strength" value={recipe.reference?.strength ?? 70} min={0} max={100} defaultValue={70} onChange={(strength) => onChange({ ...recipe, reference: { strength } })} disabled={disabled} />
              <div className="mt-1 flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={disabled || referenceBusy} busy={referenceBusy} busyLabel="Uploading...">Replace</Button>
                <Button variant="ghost" size="sm" onClick={onReferenceRemove} disabled={disabled || referenceBusy}>Remove</Button>
              </div>
            </div>
          </div>
        ) : profile ? (
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-slate-600">Carrying a reference profile{profile.summary ? `: ${profile.summary}` : "."}</p>
            <SliderField label="Strength" value={recipe.reference?.strength ?? 70} min={0} max={100} defaultValue={70} onChange={(strength) => onChange({ ...recipe, reference: { strength } })} disabled={disabled} />
            <div className="mt-1 flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => onChange({ ...recipe, referenceProfile: null, reference: null })} disabled={disabled}>Drop the profile</Button>
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={disabled || referenceBusy} busy={referenceBusy} busyLabel="Uploading...">Upload a reference</Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={disabled || referenceBusy} busy={referenceBusy} busyLabel="Uploading...">Upload reference</Button>
        )}
      </Section>
      </div>
    </div>
  );
}
