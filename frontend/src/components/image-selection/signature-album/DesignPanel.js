"use client";

import { useEffect, useRef, useState } from "react";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { updateSignatureAlbumDesign } from "@/services/image-selection/signature-album.service";
import { THEME_OPTIONS, COVER_STYLE_OPTIONS, LAYOUT_OPTIONS, SPACING_OPTIONS, HEADING_FONTS, BODY_FONTS, FONT_PAIRINGS, LOGO_VARIANT_OPTIONS, pairingFor, contrastRatio, LOW_CONTRAST } from "@/lib/signatureAlbum.mjs";
import AlbumPreview from "./AlbumPreview";

/**
 * Design: theme, cover style, gallery layout, typography, colours, spacing. Every change moves the
 * live preview at once and is saved a moment later, so the studio can try things without a Save
 * button between each one.
 *
 * A theme is a preset, never a lock. Choosing one writes its five values - background, text,
 * accent, heading font, body font - which the studio may then change one at a time; choosing a
 * different theme while any of them has been changed asks whether to apply the new defaults or
 * keep the custom styling, and Reset to Theme Defaults puts all five back. The presets come with
 * the album from the server (`themePresets`), the same ones the page draws with.
 */
const COLOR_FIELDS = [["backgroundColor", "Background"], ["textColor", "Text"], ["accentColor", "Accent"]];
const EDITABLE = ["backgroundColor", "textColor", "accentColor", "headingFont", "bodyFont"];
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

export default function DesignPanel({ album, canWrite, onSaved, onError }) {
  const timer = useRef(null);
  // What has changed since the last save: a ref the timer reads when it fires, and the same thing
  // as state so the render below may read it without touching the ref.
  const pending = useRef({});
  const [unsaved, setUnsaved] = useState({});
  const [draft, setDraft] = useState(() => album.design);
  // The album's saved design replaces the draft when it changes under us - adjusted during render
  // rather than in an effect, so the controls never flash a stale value. A change still waiting
  // to be saved is laid back over it, so a colour being dragged does not jump back while the
  // previous save's answer lands.
  const [seen, setSeen] = useState(album.design);
  if (album.design !== seen) { setSeen(album.design); setDraft({ ...album.design, ...unsaved, overrides: { ...album.design.overrides, ...Object.fromEntries(Object.entries(unsaved).filter(([key]) => key in album.design.overrides)) } }); }
  // A theme chosen while custom colours or fonts exist waits here for the studio's answer.
  const [pendingTheme, setPendingTheme] = useState(null);
  const presets = album.themePresets || {};
  const preset = presets[draft.theme] || {};
  const customized = EDITABLE.some((key) => draft[key] && preset[key] && !same(draft[key], preset[key]));
  const contrast = contrastRatio(draft.textColor, draft.backgroundColor);
  const lowContrast = contrast !== null && contrast < LOW_CONTRAST;

  // The preview refetches after every save answers - the panel saves half a second after a change,
  // so the client's page follows each choice without a reload and shows only what is stored.
  const [saves, setSaves] = useState(0);

  function change(patch) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      // Overrides travel as the album stores them: null means "the theme's answer".
      next.overrides = { ...current.overrides, ...Object.fromEntries(Object.entries(patch).filter(([key]) => ["backgroundColor", "textColor", "accentColor", "headingFont", "bodyFont"].includes(key))) };
      return next;
    });
    pending.current = { ...pending.current, ...patch };
    setUnsaved(pending.current);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = pending.current; pending.current = {}; setUnsaved({});
      try { onSaved?.(await updateSignatureAlbumDesign(album.id, body)); setSaves((count) => count + 1); }
      catch (failure) {
        // Laid back under anything newer, so it goes with the next change or when the panel
        // closes, rather than the screen holding a choice the album no longer has on its way.
        pending.current = { ...body, ...pending.current };
        setUnsaved(pending.current);
        onError?.(failure.message || "Unable to save the design.");
      }
    }, 500);
  }
  // Read by the closing save below, which outlives the render that scheduled it.
  const latest = useRef({});
  useEffect(() => { latest.current = { albumId: album.id, onSaved, onError }; });
  // Leaving Design (or the project) inside the half-second wait used to drop the last change: it
  // is sent on the way out instead.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    const body = pending.current;
    if (!Object.keys(body).length) return;
    pending.current = {};
    const { albumId, onSaved: saved, onError: failed } = latest.current;
    updateSignatureAlbumDesign(albumId, body).then((response) => saved?.(response), (failure) => failed?.(failure.message || "Unable to save the design."));
  }, []);

  // The theme's five values, laid onto the draft at once so the swatches and the preview move
  // together, and sent as one save with `applyThemeDefaults`.
  function applyTheme(theme) {
    const values = Object.fromEntries(EDITABLE.map((key) => [key, presets[theme]?.[key] ?? draft[key]]));
    change({ theme, ...values, applyThemeDefaults: true });
  }
  function chooseTheme(theme) {
    if (theme === draft.theme) return;
    if (customized) { setPendingTheme(theme); return; }
    applyTheme(theme);
  }
  const isThemeValue = (key) => same(draft[key], preset[key]);

  return <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
    <ReadOnlyFieldset canWrite={canWrite} reason="You have read-only access to the Signature Album." className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Theme</p>
        <div className="grid grid-cols-2 gap-2">
          {THEME_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => chooseTheme(option.value)} aria-pressed={draft.theme === option.value} className={`rounded-lg border p-3 text-left transition ${draft.theme === option.value ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
            <span className="block text-xs font-semibold text-slate-800">{option.label}</span>
            <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{option.description}</span>
          </button>)}
        </div>
      </section>
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <RadioGroupField label="Cover Style" helperText="How the album's cover page looks to the client." value={draft.coverStyle} onChange={(value) => change({ coverStyle: value })} options={COVER_STYLE_OPTIONS} controlClassName="px-0 py-0" />
        <RadioGroupField label="Gallery Layout" helperText="How the photos are arranged inside the album." value={draft.layoutStyle} onChange={(value) => change({ layoutStyle: value })} options={LAYOUT_OPTIONS} controlClassName="px-0 py-0" />
        <RadioGroupField label="Image Spacing" helperText="How much gap is left between photos in the album." value={draft.imageSpacing} onChange={(value) => change({ imageSpacing: value })} options={SPACING_OPTIONS} controlClassName="px-0 py-0" />
      </section>
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 sm:col-span-2 xl:col-span-1">Typography</p>
        {/* A preset sets both fonts at once; the two pickers below still choose each by hand, and
            read "Custom" the moment the pair is not one of the presets. */}
        <Dropdown label="Font Pairing" helperText="Sets the heading and body fonts together as a matched pair." ariaLabel="Font pairing" value={pairingFor(draft.headingFont, draft.bodyFont)} onChange={(value) => { const pair = FONT_PAIRINGS.find((option) => option.value === value); if (pair) change({ headingFont: pair.headingFont, bodyFont: pair.bodyFont }); }} options={[{ value: "", label: "Custom" }, ...FONT_PAIRINGS.map(({ value, label, headingFont, bodyFont }) => ({ value, label: `${label} · ${headingFont} + ${bodyFont}` }))]} sorted={false} className="sm:col-span-2 xl:col-span-1" />
        <Dropdown label="Heading Font" helperText="The typeface for the album's titles and chapter names." ariaLabel="Heading font" value={draft.headingFont} onChange={(value) => change({ headingFont: value })} options={HEADING_FONTS} sorted={false} />
        <Dropdown label="Body Font" helperText="The typeface for the album's smaller text." ariaLabel="Body font" value={draft.bodyFont} onChange={(value) => change({ bodyFont: value })} options={BODY_FONTS} sorted={false} />
        {(!isThemeValue("headingFont") || !isThemeValue("bodyFont")) && preset.headingFont && <button type="button" onClick={() => change({ headingFont: preset.headingFont, bodyFont: preset.bodyFont })} className="text-left text-[11px] text-blue-600 sm:col-span-2 xl:col-span-1">Reset fonts to the theme</button>}
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Album Colours</p>
        <div className="grid grid-cols-3 gap-2">
          {COLOR_FIELDS.map(([key, label]) => <label key={key} className="block text-[11px] font-semibold text-slate-600">
            {label}
            <span className="mt-1 flex items-center gap-2 rounded-lg border border-slate-300 px-2 py-1">
              <input type="color" aria-label={`${label} colour`} value={draft[key]} onChange={(event) => change({ [key]: event.target.value })} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" />
              <span className="font-mono text-[10px] font-normal text-slate-600">{draft[key]}</span>
            </span>
            {isThemeValue(key) ? <span className="mt-0.5 block text-[10px] font-normal text-slate-400">Theme</span> : <button type="button" onClick={() => change({ [key]: preset[key] })} className="mt-0.5 block text-[10px] font-normal text-blue-600">Reset</button>}
          </label>)}
        </div>
        {/* A warning, never a correction: the studio's choice stands. */}
        {lowContrast && <p role="status" className="mt-2 text-[11px] text-amber-700">Low contrast: the text may be hard to read on this background.</p>}
        <button type="button" onClick={() => applyTheme(draft.theme)} disabled={!customized} className="mt-3 text-[11px] text-blue-600 disabled:text-slate-400">Reset to Theme Defaults</button>
      </section>
      {/* Which Global Logo the album wears. Auto follows the background above - the dark-mode mark
          on a dark album, the light-mode one on a light album - and the two others pin it. Absent
          when the studio-wide settings show no logo at all: there is nothing to choose for. */}
      {album.branding?.showLogo && <section className="rounded-xl border border-slate-200 bg-white p-4">
        <RadioGroupField label="Studio Logo" helperText="Auto shows the dark-mode Global Logo on a dark background and the light-mode one on a light background. Both are uploaded in Settings → Organization → Branding Logo." value={draft.logoVariant || "AUTO"} onChange={(value) => change({ logoVariant: value })} options={LOGO_VARIANT_OPTIONS} controlClassName="px-0 py-0" />
      </section>}
    </ReadOnlyFieldset>
    {/* Edit Album Preview: with write access the cover and every photo can be dragged into place here. */}
    <AlbumPreview album={album} refreshKey={saves} editable={canWrite} onCoverSaved={onSaved} onCoverError={onError} className="h-[70vh] min-h-[420px] xl:sticky xl:top-0" />
    {/* Two answers, each a press of its own; closing the dialog any other way changes nothing. */}
    {pendingTheme && <Dialog
      title="Apply the new theme defaults?"
      description="Your custom colours and fonts will be replaced by the theme's. Keep My Custom Styling changes only the theme's tone and leaves them as they are."
      onClose={() => setPendingTheme(null)}
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={() => { change({ theme: pendingTheme }); setPendingTheme(null); }}>Keep My Custom Styling</Button>
        <Button type="button" className="max-sm:flex-1" variant="primary" onClick={() => { applyTheme(pendingTheme); setPendingTheme(null); }}>Apply Theme Defaults</Button>
      </>}
    />}
  </div>;
}
