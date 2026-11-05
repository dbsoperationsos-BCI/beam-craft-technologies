"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeTransform, overflowOf, dragTransform, parseAspect, ratioOf, ZOOM_MIN, ZOOM_MAX } from "@/lib/signatureAlbumTransform.mjs";

/**
 * The editor's state: a draft transform, the drag that moves its focal point, and the zoom.
 *
 * Dragging is pointer events on the frame - mouse, pen and touch alike - with the pointer
 * captured so a drag that leaves the frame still ends cleanly. Each move is converted through the
 * frame's rendered size and the photo's ratio into focal percentages, so the same numbers the
 * client page draws from are what the studio sees moving. Nothing is saved here: the caller
 * takes the draft on Apply.
 *
 * Whether there is anything to drag depends only on the frame's shape, so it is decided from the
 * aspect during render; the frame's real pixel size is read from the DOM only inside the pointer
 * handlers, where a drag actually has to be turned into percentages.
 */
export default function useImageTransform({ image, initial, frameAspect }) {
  const [draft, setDraft] = useState(() => normalizeTransform(initial));
  const frameRef = useRef(null);
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const imageRatio = ratioOf(image) || 1.5;
  const nominalRatio = parseAspect(frameAspect) || imageRatio;
  const nominal = overflowOf(600, 600 / nominalRatio, imageRatio, draft);
  const canDrag = nominal.x > 0 || nominal.y > 0;

  const measuredOverflow = useCallback((transform) => {
    const rect = frameRef.current?.getBoundingClientRect();
    const w = rect?.width || 600;
    const h = rect?.height || 600 / nominalRatio;
    return overflowOf(w, h, imageRatio, transform);
  }, [imageRatio, nominalRatio]);

  const onPointerDown = useCallback((event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const o = measuredOverflow(draft);
    if (o.x <= 0 && o.y <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, start: draft, overflow: o };
    setDragging(true);
  }, [draft, measuredOverflow]);
  const onPointerMove = useCallback((event) => {
    if (!drag.current) return;
    event.preventDefault();
    const { x, y, start, overflow: o } = drag.current;
    setDraft(dragTransform(start, event.clientX - x, event.clientY - y, o));
  }, []);
  const endDrag = useCallback((event) => {
    if (!drag.current) return;
    event?.currentTarget?.releasePointerCapture?.(event.pointerId);
    drag.current = null;
    setDragging(false);
  }, []);
  useEffect(() => () => { drag.current = null; }, []);

  const setZoom = useCallback((zoom) => setDraft((current) => ({ ...current, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(zoom) || 1)) })), []);
  const setMode = useCallback((displayMode) => setDraft((current) => ({ ...current, displayMode })), []);
  const patch = useCallback((values) => setDraft((current) => normalizeTransform({ ...current, ...values })), []);
  const reset = useCallback(() => setDraft(normalizeTransform(null)), []);

  return { draft, frameRef, dragging, canDrag, onPointerDown, onPointerMove, endDrag, setZoom, setMode, patch, reset, imageRatio };
}
