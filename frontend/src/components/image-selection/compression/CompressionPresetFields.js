"use client";

import Dropdown from "@/components/shared/Dropdown";
import { PREVIEW_PRESET_OPTIONS, THUMBNAIL_PRESET_OPTIONS } from "@/lib/imagePresets.mjs";

/**
 * The two pickers every Virtual Curation module's compression is set with - Preview quality and
 * Thumbnail quality, each one of the five shared presets (`lib/imagePresets.mjs`) read as
 * "High (2048px, ~300 KB)". One component, so the Visual Curation settings screen, the AI
 * Feature's Event Default Settings and an event's own settings dialog cannot describe the same
 * choice three ways. The lists are handed to `Dropdown` with `sorted={false}`: the order is the
 * scale, heaviest first, and the alphabet would shuffle it.
 *
 * `onChange(key, value)` with `key` "previewPreset" | "thumbnailPreset". `readOnly` draws the
 * values as a record being read back.
 */
export default function CompressionPresetFields({ previewPreset, thumbnailPreset, onChange, readOnly = false, previewDescription, thumbnailDescription, className = "" }) {
  return <div className={`grid gap-4 sm:grid-cols-2 ${className}`}>
    <Dropdown label="Preview quality" ariaLabel="Preview quality" helperText={previewDescription} options={PREVIEW_PRESET_OPTIONS} value={previewPreset} readOnly={readOnly} onChange={(value) => onChange?.("previewPreset", value)} sorted={false} searchable={false} />
    <Dropdown label="Thumbnail quality" ariaLabel="Thumbnail quality" helperText={thumbnailDescription} options={THUMBNAIL_PRESET_OPTIONS} value={thumbnailPreset} readOnly={readOnly} onChange={(value) => onChange?.("thumbnailPreset", value)} sorted={false} searchable={false} />
  </div>;
}
