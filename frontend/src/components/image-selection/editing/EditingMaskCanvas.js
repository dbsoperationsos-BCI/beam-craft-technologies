"use client";

import { useRef, useState } from "react";
import Button from "@/components/shared/Button";
import { normalizeMasks } from "@/lib/aiEditingRecipe.mjs";

/**
 * The Remove Object painter: rectangles dragged over the photo, kept as fractions of the frame so
 * they mean the same thing whatever size the preview is drawn at or the engine renders at. Drawn
 * as an overlay on top of the preview; each rectangle has its own remove button, and Escape (or
 * a tap shorter than a few pixels) draws nothing. Read-only without `onChange`.
 */
export default function EditingMaskCanvas({ masks = [], onChange, className = "" }) {
  const surfaceRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const editable = typeof onChange === "function";

  const point = (event) => {
    const rect = surfaceRef.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  };
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  function down(event) {
    if (!editable || event.button !== 0) return;
    event.preventDefault();
    surfaceRef.current.setPointerCapture?.(event.pointerId);
    const start = point(event);
    setDraft({ start, end: start });
  }
  function move(event) {
    if (!draft) return;
    setDraft((current) => (current ? { ...current, end: point(event) } : current));
  }
  function keydown(event) { if (event.key === "Escape" && draft) { event.stopPropagation(); setDraft(null); } }
  function up(event) {
    if (!draft) return;
    const rect = rectOf(draft.start, point(event));
    setDraft(null);
    // Smaller than a tap is not a rectangle.
    if (rect.w < 0.01 || rect.h < 0.01) return;
    onChange(normalizeMasks([...masks, rect]));
  }

  return (
    <div
      ref={surfaceRef}
      role={editable ? "application" : undefined}
      aria-label={editable ? "Drag to mark what to remove" : undefined}
      className={`absolute inset-0 touch-none select-none ${editable ? "cursor-crosshair" : "pointer-events-none"} ${className}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDraft(null)}
      onKeyDown={keydown}
      tabIndex={editable ? 0 : undefined}
    >
      {masks.map((mask, index) => (
        <div key={index} className="absolute border-2 border-red-500 bg-red-500/20" style={{ left: `${mask.x * 100}%`, top: `${mask.y * 100}%`, width: `${mask.w * 100}%`, height: `${mask.h * 100}%` }}>
          {editable && (
            <Button size="none" variant="plain" ariaLabel={`Remove mark ${index + 1}`} onClick={(event) => { event.stopPropagation(); onChange(masks.filter((_, at) => at !== index)); }} onPointerDown={(event) => event.stopPropagation()} className="absolute -right-3 -top-3 grid h-7 w-7 place-items-center rounded-full bg-red-600 text-[13px] font-bold leading-none text-white shadow">
              ×
            </Button>
          )}
        </div>
      ))}
      {draft && (() => { const rect = rectOf(draft.start, draft.end); return <div className="absolute border-2 border-dashed border-red-400 bg-red-400/10" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />; })()}
    </div>
  );
}
