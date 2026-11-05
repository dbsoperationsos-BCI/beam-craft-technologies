"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { fetchProtectedImage } from "@/services/image-selection/image-selection.service";
import { FOCAL_PRESETS, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, orientationOf, roundTransform, isDefaultTransform } from "@/lib/signatureAlbumTransform.mjs";
import AlbumImage from "./client/AlbumImage";
import useImageTransform from "./useImageTransform";

/**
 * Adjust Photo / Adjust Cover: the photo inside the frame the album will draw it in, dragged to
 * choose what stays visible, zoomed in a little, shown whole (Fit) or filling the frame (Fill).
 * Nothing is written until Apply, and what is written is four values on the album item (or the
 * album's cover) - never the photo, its previews, or anything Photo Selection reads.
 *
 * `frames` are the frame shapes the layout draws this photo in; the studio picks which to look at.
 * The focal point and zoom apply to all of them, the way a cover's focal point does.
 */
export default function ImagePositionEditor({ title = "Adjust Photo", image, transform, frames, defaultFrame, onApply, onClose, busy = false, layer = "dialog" }) {
  const [frame, setFrame] = useState(defaultFrame || frames?.[0]?.value || "3 / 2");
  const frameAspect = frame === "own" ? (image?.width && image?.height ? `${image.width} / ${image.height}` : "3 / 2") : frame;
  const { draft, frameRef, dragging, canDrag, onPointerDown, onPointerMove, endDrag, setZoom, setMode, patch, reset } = useImageTransform({ image, initial: transform, frameAspect });
  const orientation = orientationOf(image);
  const hint = draft.displayMode === "FIT"
    ? (draft.zoom > 1 ? "Drag to move the zoomed photo." : "The whole photograph is shown; the frame's background fills the rest.")
    : canDrag ? "Drag the photo to choose what stays in the frame." : "The photo fits this frame exactly.";

  return <Dialog
    title={title}
    description={`${image?.fileName || ""}${orientation ? ` · ${orientation.toLowerCase()}${image?.width ? ` ${image.width}×${image.height}` : ""}` : ""}`}
    size="lg"
    layer={layer}
    onClose={onClose}
    busy={busy}
    footer={<>
      <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="button" variant="primary" busy={busy} busyLabel="Applying..." onClick={() => onApply(roundTransform(draft))}>Apply</Button>
    </>}
  >
    {frames?.length > 1 && <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-semibold text-slate-600">Frame</span>
      {frames.map((option) => <button key={option.value} type="button" onClick={() => setFrame(option.value)} aria-pressed={frame === option.value} className={`rounded-full border px-2.5 py-1 text-[11px] ${frame === option.value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-600 hover:border-slate-400"}`}>{option.label}</button>)}
    </div>}
    <div className="mx-auto w-full max-w-xl">
      {/* The frame the client will see, at the chosen shape. The photo inside is the same component
          the client page draws, under the same transform, so the two cannot differ. */}
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`relative w-full select-none overflow-hidden rounded-lg bg-slate-200 ring-1 ring-slate-300 ${canDrag ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"}`}
        style={{ aspectRatio: frameAspect, touchAction: "none" }}
        aria-label="Photo position"
      >
        <AlbumImage key={frameAspect} item={image} eager loader={fetchProtectedImage} alt={image?.fileName || "Photo"} className="!bg-slate-200 h-full" style={{ aspectRatio: "auto" }} transform={draft} />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">{Array.from({ length: 9 }, (_, index) => <span key={index} className="border border-white/50" />)}</span>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">{hint}</p>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => setZoom(draft.zoom - ZOOM_STEP)} aria-label="Zoom out" className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-lg leading-none text-slate-600 hover:bg-slate-50">−</button>
        <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP} value={draft.zoom} onChange={(event) => setZoom(event.target.value)} aria-label="Zoom" className="min-w-0 flex-1 accent-blue-600" />
        <button type="button" onClick={() => setZoom(draft.zoom + ZOOM_STEP)} aria-label="Zoom in" className="grid h-8 w-8 place-items-center rounded-full border border-slate-300 text-lg leading-none text-slate-600 hover:bg-slate-50">+</button>
        <span className="w-12 text-right font-mono text-[11px] text-slate-600">{draft.zoom.toFixed(2)}×</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-slate-300">
          <button type="button" onClick={() => setMode("FIT")} aria-pressed={draft.displayMode === "FIT"} className={`px-3 py-1.5 text-xs ${draft.displayMode === "FIT" ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>Fit</button>
          <button type="button" onClick={() => setMode("FILL")} aria-pressed={draft.displayMode === "FILL"} className={`px-3 py-1.5 text-xs ${draft.displayMode === "FILL" ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>Fill</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {FOCAL_PRESETS.map((preset) => <button key={preset.value} type="button" onClick={() => patch(preset.patch)} className="rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">{preset.label}</button>)}
        </div>
        <button type="button" onClick={reset} disabled={isDefaultTransform(draft)} className="ml-auto text-[11px] text-blue-600 disabled:text-slate-400">Reset</button>
      </div>
      <p className="mt-3 text-[10px] text-slate-400">Position, zoom and fit are saved for this album only. The photo file, its previews and Photo Selection are never changed.</p>
    </div>
  </Dialog>;
}
