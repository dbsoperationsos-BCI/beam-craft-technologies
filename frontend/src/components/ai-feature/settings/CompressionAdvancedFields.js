"use client";

import { useId, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import { AI_MEDIA_COMPRESSION_BOUNDS } from "@/lib/aiMediaUpload/config.mjs";
import NumberSetting from "./NumberSetting";

const THUMBNAIL_FORMATS = [{ label: "WebP (smaller)", value: "webp" }, { label: "JPEG", value: "jpeg" }];

/**
 * The AI Feature's advanced compression values - how many photos the uploader's computer works on
 * at once, and the thumbnail's file format - folded away under one button so the normal settings
 * screen shows the two presets and the two switches and nothing that reads like developer
 * configuration. Drawn by Event Default Settings → Media Upload and by an event's own settings,
 * read-only for a viewer who may only read.
 *
 * `media` is the `media` group; `set(key)` answers a setter for one key.
 */
export default function CompressionAdvancedFields({ media, set, readOnly = false }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const bounds = AI_MEDIA_COMPRESSION_BOUNDS;
  return <div className="py-3">
    <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((current) => !current)}>{open ? "Hide advanced settings" : "Show advanced settings"}</Button>
    {open && <div id={panelId} className="mt-3 grid gap-4 sm:grid-cols-2">
      <NumberSetting label="Photos uploaded at once" min={bounds.uploadConcurrency[0]} max={bounds.uploadConcurrency[1]} unit="at once" readOnly={readOnly} value={media.uploadConcurrency} onChange={set("uploadConcurrency")} description="How many optimized photos the uploader's computer sends at the same time. 4 suits most connections." />
      <NumberSetting label="Photos compressed at once" min={bounds.compressionConcurrency[0]} max={bounds.compressionConcurrency[1]} unit="at once" readOnly={readOnly} value={media.compressionConcurrency} onChange={set("compressionConcurrency")} description="How many photos the uploader's computer optimizes at the same time. More is faster on a powerful machine." />
      <Dropdown label="Thumbnail format" helperText="WebP is about a third smaller at the same look." options={THUMBNAIL_FORMATS} value={media.thumbnailFormat || "webp"} readOnly={readOnly} onChange={set("thumbnailFormat")} sorted={false} searchable={false} />
    </div>}
  </div>;
}
