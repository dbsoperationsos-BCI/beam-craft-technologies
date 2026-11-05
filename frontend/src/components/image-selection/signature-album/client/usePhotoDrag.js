"use client";

import { useEffect, useRef, useState } from "react";
import { dragTransform, normalizeTransform, overflowOf, ratioOf, roundTransform } from "@/lib/signatureAlbumTransform.mjs";

/**
 * Drag a photo inside its frame - the studio's Edit Album Preview only. One rule for every photo
 * the album draws: the cover, a chapter's cover band, and each photo in the highlights and the
 * chapters' layouts.
 *
 * It moves the same focal point Adjust Cover / Adjust Photo set (through `dragTransform`), so a
 * photo has one placement, not two: whatever is dragged here is what those editors open on, and
 * what the client's page draws. The focal point stays 0-100, so the photo always covers its frame;
 * a photo shown whole (FIT), or in a frame of its own shape (`ownRatio`) and not zoomed, has no
 * spare edge and nothing to drag.
 *
 * While the pointer is down the position is local; on release it goes to `onCommit`, which saves
 * it. A save that fails puts the photo back where it was saved and says so on the photo.
 *
 * Without `onCommit` (the client's page) it hands back the saved transform and nothing else.
 * `hint` is "always" for the cover, "hover" for the many photos below it.
 */
const NONE = { frameProps: undefined, frameClass: "", hint: null };

export default function usePhotoDrag(image, savedTransform, onCommit, { ownRatio = false, hint: hintMode = "always" } = {}) {
  const [local, setLocal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);
  const drag = useRef(null);
  useEffect(() => {
    if (!failed) return undefined;
    const timer = window.setTimeout(() => setFailed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [failed]);

  if (!onCommit || !image) return { transform: savedTransform, ...NONE };
  const transform = local || savedTransform;
  const ratio = ratioOf(image);
  const shown = normalizeTransform(transform);
  if (!ratio || (shown.zoom === 1 && (shown.displayMode === "FIT" || ownRatio))) return { transform, ...NONE };

  function onPointerDown(event) {
    if (saving || (event.pointerType === "mouse" && event.button !== 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const overflow = overflowOf(rect.width, rect.height, ratio, transform);
    if (!overflow.x && !overflow.y) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: transform, overflow, moved: false };
    setLocal(transform);
    setDragging(true);
    setFailed(false);
  }
  function onPointerMove(event) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) current.moved = true;
    setLocal(dragTransform(current.start, dx, dy, current.overflow));
  }
  async function onPointerUp(event) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    const next = roundTransform(dragTransform(current.start, event.clientX - current.x, event.clientY - current.y, current.overflow));
    const start = roundTransform(current.start);
    if (!current.moved || (next.focalX === start.focalX && next.focalY === start.focalY)) { setLocal(null); return; }
    setLocal(next);
    setSaving(true);
    // Saved, the photo's own transform now holds `next`; failed, the editor has told the workspace
    // and the saved one is still the old place. Either way the local copy is done with.
    try { await onCommit(next); } catch { setFailed(true); }
    finally { setLocal(null); setSaving(false); }
  }
  // Only a drag still in progress is abandoned - the capture is also released after a normal release.
  function onPointerCancel() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setLocal(null);
  }

  const quiet = hintMode === "hover" && !saving && !failed;
  return {
    transform,
    frameProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel },
    frameClass: `group/drag touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`,
    hint: <span aria-live="polite" className={`pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 whitespace-nowrap rounded-full ${failed ? "bg-red-600/90" : "bg-black/60"} px-3 py-1 text-[11px] font-medium text-white shadow-sm transition-opacity duration-300 ${dragging ? "opacity-0" : quiet ? "opacity-0 group-hover/drag:opacity-100" : "opacity-100"}`}>{saving ? "Saving position..." : failed ? "Couldn't save - put back" : "Drag image to reposition"}</span>,
  };
}
