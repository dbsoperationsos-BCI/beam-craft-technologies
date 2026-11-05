"use client";

import Button from "@/components/shared/Button";
import CompressionPresetFields from "@/components/image-selection/compression/CompressionPresetFields";
import { AI_MEDIA_COMPRESSION_DEFAULTS } from "@/lib/aiMediaUpload/config.mjs";
import CompressionAdvancedFields from "./CompressionAdvancedFields";
import SettingRow from "./SettingRow";
import SettingsCard from "./SettingsCard";

/**
 * Media Upload → Compression: how a photo is optimized before it is stored - a preview preset and
 * a thumbnail preset from the table every Virtual Curation module shares - and whether the camera
 * details ride along. These are the stored `media` group's compression keys; the preview they
 * describe is both what the gallery shows and what the face engine reads, so the recommended pair
 * (High, Standard) is the recipe the AI Feature has always used. The concurrency pair and the
 * thumbnail format sit under Show advanced. Every value applies to future uploads only: nothing
 * already stored is recompressed, and no link, face or index changes.
 *
 * The same pair is drawn, and saved to this same record, by Visual Curation Settings →
 * Processing / Compression → AI Feature: one source of truth, two doors.
 */
export default function MediaUploadSettings({ values, onChange, readOnly = false }) {
  const media = values.media || {};
  const set = (key) => (value) => onChange("media", key, value);
  const restore = () => { for (const [key, value] of Object.entries(AI_MEDIA_COMPRESSION_DEFAULTS)) onChange("media", key, value); };
  // Offered only while something differs from the recommended values - the advanced ones included,
  // since the button resets those too and says so.
  const onDefaults = Object.entries(AI_MEDIA_COMPRESSION_DEFAULTS).every(([key, value]) => (media[key] === undefined ? true : media[key] === value));

  return <div className="space-y-4">
    <SettingsCard title="Compression" description="Photos are optimized on the uploader's computer - the preview the gallery shows and the face engine reads, and the thumbnail the grid shows, both cut from one reading of the original - and only those two files are sent. Originals stay where they were picked.">
      <CompressionPresetFields className="py-4" previewPreset={media.previewPreset} thumbnailPreset={media.thumbnailPreset} readOnly={readOnly} onChange={(key, value) => onChange("media", key, value)}
        previewDescription="The stored preview: what guests open and what face recognition reads. High keeps every face the engine could find at the original; the AI Feature never trades a face's detail for a smaller file."
        thumbnailDescription="The grid thumbnail. Face recognition never reads it." />
      <SettingRow label="Keep camera details" description="Keep the camera make, model, lens and capture times on the stored preview. Location and every other embedded detail are never kept: previews are public. Off, only the capture time is kept, as its own field." note="A photo optimized on the uploader's computer carries no camera details - only its capture time. Details are kept when the server makes the preview: a format the browser cannot read." checked={media.preserveMetadata === true} onChange={set("preserveMetadata")} disabled={readOnly} />
      <CompressionAdvancedFields media={media} set={set} readOnly={readOnly} />
    </SettingsCard>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-slate-500">Applies to future uploads only. Photos already uploaded keep their previews, thumbnails, faces and links; nothing is recompressed.</p>
      {!readOnly && !onDefaults && <Button type="button" size="sm" className="shrink-0" title="Also puts the advanced settings back" onClick={restore}>Restore recommended defaults (and advanced)</Button>}
    </div>
  </div>;
}
