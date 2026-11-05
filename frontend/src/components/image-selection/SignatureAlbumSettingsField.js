"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import HelpTip from "@/components/shared/HelpTip";
import TextAreaField from "@/components/shared/TextAreaField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { getSignatureAlbumSettings, saveSignatureAlbumSettings } from "@/services/image-selection/signature-album.service";
import { THEME_OPTIONS, LAYOUT_OPTIONS, COVER_STYLE_OPTIONS, SPACING_OPTIONS, BACKGROUND_OPTIONS, EXPIRY_OPTIONS } from "@/lib/signatureAlbum.mjs";

/**
 * Settings → Signature Album: the studio-wide defaults a new album is created from, drawn as one
 * entry on the Image Selection settings rail. Its own record and its own endpoint, saved by its
 * own button - the panel's Save Settings never reads or writes it, the way the Target Download
 * Path and Processing entries save themselves. Changing a default here changes what the *next*
 * album starts from; an album already made keeps every value it holds.
 */
const GROUPS = [
  { title: "General", rows: [
    ["defaultTheme", "Default Album Theme", "select", THEME_OPTIONS],
    ["defaultLayoutStyle", "Default Gallery Layout", "select", LAYOUT_OPTIONS],
    ["defaultCoverStyle", "Default Cover Style", "select", COVER_STYLE_OPTIONS],
    ["defaultExpiryMonths", "Default Expiry", "select", EXPIRY_OPTIONS],
  ] },
  { title: "Branding", rows: [
    ["useGlobalLogo", "Use Global Studio Logo", "toggle"],
    ["showStudioName", "Show Studio Name", "toggle"],
    ["showStudioLogo", "Show Studio Logo", "toggle"],
    ["showBrandingFooter", "Show Branding Footer", "toggle"],
    ["footerText", "Footer Text", "text", null, "Captured & preserved by {studioName}"],
  ] },
  { title: "Client Experience", rows: [
    ["allowDownloadDefault", "Allow Downloads by Default", "toggle"],
    ["allowShareDefault", "Allow Social Sharing", "toggle"],
    ["showImageNumbers", "Show Image Numbers", "toggle"],
  ] },
  { title: "Access & Security", rows: [
    ["pinLength", "PIN Length", "select", [{ value: 4, label: "4 Digits" }, { value: 5, label: "5 Digits" }, { value: 6, label: "6 Digits" }]],
    ["autoUnpublishAfterExpiry", "Auto Unpublish After Expiry", "toggle"],
  ] },
  { title: "Display", rows: [
    ["defaultBackground", "Default Background", "select", BACKGROUND_OPTIONS],
    ["imageSpacing", "Image Spacing", "select", SPACING_OPTIONS],
  ] },
  { title: "Performance", rows: [
    ["initialPhotosLoaded", "Initial Photos Loaded", "number"],
    ["lazyLoadBatch", "Lazy Load Batch", "number"],
    ["preloadNextImages", "Preload Next Images", "toggle"],
  ] },
  { title: "Ending", rows: [
    ["defaultEndingMessage", "Default Ending Message", "textarea", null, "Thank you for letting us capture your story."],
    ["endingShowLogo", "Show Studio Logo", "toggle"],
    ["endingShowWebsite", "Show Website", "toggle"],
    ["websiteUrl", "Website", "text", null, "https://"],
    ["endingShowInstagram", "Show Instagram", "toggle"],
    ["instagramUrl", "Instagram", "text", null, "https://instagram.com/"],
  ] },
];

// The server's own limits (`settingsSchema`), told under the field before Save rather than after it.
const BATCH_MIN = 10;
const BATCH_MAX = 120;
const TEXT_MAX = 255;
const ENDING_MAX = 2000;
const LINK_KEYS = ["websiteUrl", "instagramUrl"];
function fieldError(key, type, value) {
  if (type === "number") return Number.isInteger(value) && value >= BATCH_MIN && value <= BATCH_MAX ? "" : `Enter a whole number from ${BATCH_MIN} to ${BATCH_MAX}.`;
  if (LINK_KEYS.includes(key) && /\s/.test(String(value || "").trim())) return "Enter a web address without spaces.";
  return "";
}
// Enter in one of these fields would submit the Settings form around them - saving the other
// settings and closing the panel, with these defaults still unsaved.
// The ⓘ help beside the text boxes below, by row key.
const TEXT_HELP = {
  footerText: "The footer line on albums; {studioName} is replaced by the studio's name.",
  defaultEndingMessage: "The closing note new albums show on their last page.",
  websiteUrl: "The studio website linked on the album's last page.",
  instagramUrl: "The studio Instagram page linked on the album's last page.",
};
// The ⓘ help beside the switches, dropdowns and numbers, whose label is a plain line beside them.
const ROW_HELP = {
  defaultTheme: "The look a new album starts with; each album can change it.",
  defaultLayoutStyle: "How photos are arranged in a new album's gallery.",
  defaultCoverStyle: "How the cover photo is shown on a new album's first page.",
  defaultExpiryMonths: "How many months a new album's client link stays open.",
  useGlobalLogo: "Use the studio's gallery logo from Settings on every album.",
  showStudioName: "Show the studio's name on albums clients open.",
  showStudioLogo: "Show the studio's logo on albums clients open.",
  showBrandingFooter: "Show the footer line below at the bottom of albums.",
  allowDownloadDefault: "Lets clients download photos from new albums; each album can change it.",
  allowShareDefault: "Lets clients share new albums on social media; each album can change it.",
  showImageNumbers: "Shows a running number on each photo in the client's album.",
  pinLength: "How many digits the PIN made for an album's client link has.",
  autoUnpublishAfterExpiry: "Marks a published album Expired once its expiry date passes.",
  defaultBackground: "The page colour a new album starts with, in place of its theme's.",
  imageSpacing: "The gap between photos in a new album.",
  initialPhotosLoaded: "How many photos load first when a client opens an album.",
  lazyLoadBatch: "How many more photos load each time the client scrolls further.",
  preloadNextImages: "Loads the next photos early so scrolling feels smoother on slow internet.",
  endingShowLogo: "Show the studio logo on an album's last page.",
  endingShowWebsite: "Show the studio website link on an album's last page.",
  endingShowInstagram: "Show the studio Instagram link on an album's last page.",
};
const keepEnter = (event) => { if (event.key === "Enter") event.preventDefault(); };

/*
 * `onDirtyChange` tells the panel around it whether there are defaults not yet saved, so closing
 * the panel can ask first.
 */
export default function SignatureAlbumSettingsField({ readOnly = false, onDirtyChange }) {
  const [values, setValues] = useState(null);
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try { const settings = (await getSignatureAlbumSettings()).data; setValues(settings); setInitial(settings); setError(""); }
    catch (failure) { setError(failure.message || "Unable to load the Signature Album settings."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, [load]);

  const set = (key, value) => { setValues((current) => ({ ...current, [key]: value })); setSaved(false); };
  const changedKeys = values && initial ? Object.keys(values).filter((key) => values[key] !== initial[key]) : [];
  const errors = values ? Object.fromEntries(GROUPS.flatMap((group) => group.rows).map(([key, , type]) => [key, fieldError(key, type, values[key])]).filter(([, message]) => message)) : {};
  const invalid = Object.keys(errors).length > 0;
  const dirty = !readOnly && changedKeys.length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  async function save() {
    setSaving(true); setError("");
    try {
      const patch = Object.fromEntries(changedKeys.map((key) => [key, values[key]]));
      const response = await saveSignatureAlbumSettings(patch);
      setValues(response.data); setInitial(response.data); setSaved(true);
    } catch (failure) { setError(failure.message || "Unable to save the Signature Album settings."); }
    finally { setSaving(false); }
  }

  if (!values) return error ? <p role="alert" className="text-xs text-red-600">{error}</p> : <Loader label="Loading Signature Album settings..." size="sm" inline />;
  return <div className="space-y-5">
    <p className="text-xs text-slate-500">Defaults every new Signature Album starts from. An album already configured keeps its own values.</p>
    {GROUPS.map((group) => <fieldset key={group.title} disabled={readOnly} className="min-w-0">
      <legend className="mb-2 border-b border-slate-200 pb-1 text-xs font-semibold text-slate-700">{group.title}</legend>
      <div className="space-y-3">
        {group.rows.map(([key, label, type, options, placeholder]) => {
          if (type === "toggle") return <div key={key} className="flex items-center justify-between gap-3"><span className="text-xs text-slate-700">{label}<HelpTip text={ROW_HELP[key]} /></span><ToggleSwitch ariaLabel={label} checked={Boolean(values[key])} disabled={readOnly} onCheckedChange={(value) => set(key, value)} /></div>;
          if (type === "select") return <div key={key} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_220px]"><span className="text-xs text-slate-700">{label}<HelpTip text={ROW_HELP[key]} /></span><Dropdown ariaLabel={label} value={values[key]} onChange={(value) => set(key, value)} options={options} sorted={false} readOnly={readOnly} /></div>;
          if (type === "number") return <div key={key} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_220px]"><span className="text-xs text-slate-700">{label}<HelpTip text={ROW_HELP[key]} /></span><TextField label="" aria-label={label} type="number" min={BATCH_MIN} max={BATCH_MAX} step={1} value={values[key] ?? ""} error={errors[key]} onKeyDown={keepEnter} onChange={(event) => set(key, event.target.value === "" ? "" : Number(event.target.value))} /></div>;
          if (type === "textarea") return <TextAreaField key={key} label={label} helperText={TEXT_HELP[key]} value={values[key] || ""} onChange={(event) => set(key, event.target.value || null)} placeholder={placeholder} rows={2} maxLength={ENDING_MAX} />;
          return <TextField key={key} label={label} helperText={TEXT_HELP[key]} value={values[key] || ""} error={errors[key]} maxLength={TEXT_MAX} onKeyDown={keepEnter} onChange={(event) => set(key, event.target.value || null)} placeholder={placeholder} />;
        })}
      </div>
    </fieldset>)}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    {!readOnly && <div className="flex items-center gap-3"><Button type="button" variant="primary" busy={saving} onClick={save} disabled={!changedKeys.length || invalid}>Save Signature Album Defaults</Button>{saved && <span className="text-xs text-emerald-700">Saved.</span>}</div>}
  </div>;
}
