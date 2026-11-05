"use client";

import { useRef, useState } from "react";
import NebulaMark from "./NebulaMark";
import LeadNebulaPanel from "./LeadNebulaPanel";
import { clampOffset } from "@/lib/ai/dragBounds.mjs";

/**
 * Nebula inside the lead popup, about that lead and nothing else.
 *
 * The one floating button left in the application, and the exception is earned rather than
 * inherited. Everywhere else Nebula lives in the module header, because a control that floats over a
 * table covers a row. The lead popup has no header row to put a control in - its top strip is the
 * client's name and the two actions that close the record.
 *
 * It can be dragged, because the corner it rests in turned out not to be empty after all: Update and
 * Close and Update and Proceed Next sit there, and a button that covers the action ending the record
 * is worse than one somebody has to move.
 *
 * What is *not* kept is where it was moved to. An earlier version wrote the position to
 * `localStorage`, and a button nudged aside once to read a row was still nudged a week later with no
 * obvious way back. It resets whenever the popup does, so moving it is for the field in front of you
 * and never becomes a setting nobody remembers changing.
 *
 * The panel it opens is rendered *inside* this button's own container and positioned against it, so
 * dragging moves the pair as one thing. They were separate before - the button moved and the chat box
 * stayed anchored to the window corner - which left the two sitting apart with nothing joining them.
 *
 * `z-[135]`: above the popup the pair belongs to (120) and below the dialogs that open over that
 * popup (140 and up), so neither ever covers a confirmation somebody has to read.
 */

/** Past this many pixels a press is a drag, and so is not also a click that opens the panel. */
const DRAG_THRESHOLD = 3;

/**
 * The outer bounds of the button and, when it is open, the chat box above it.
 *
 * The box is positioned absolutely, so it does not count towards the container's own box - it has to
 * be measured and unioned in by hand, or the drag would be clamped as though only the button were
 * there.
 */
function boundsOf(button, panel) {
  const rect = button.getBoundingClientRect();
  if (!panel) return rect;
  const box = panel.getBoundingClientRect();
  const left = Math.min(rect.left, box.left);
  const top = Math.min(rect.top, box.top);
  return {
    left,
    top,
    width: Math.max(rect.right, box.right) - left,
    height: Math.max(rect.bottom, box.bottom) - top,
  };
}

export default function LeadNebulaButton({ leadId, lead, onError }) {
  const [open, setOpen] = useState(false);
  // Reset with the popup, by living no longer than this component does.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const buttonRef = useRef(null);
  const panelRef = useRef(null);
  // The drag in progress, and nothing else - cleared on release, so a later hover cannot resume it.
  const dragRef = useRef(null);
  // Whether that drag actually moved, kept past the release for the click that follows it.
  const movedRef = useRef(false);

  const startDrag = (event) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, base: offset };
    movedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDrag = (event) => {
    const drag = dragRef.current;
    const button = buttonRef.current;
    if (!drag || !button) return;

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    // A press that never really moved is a click, not a drag - fingers wobble.
    if (!movedRef.current && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    movedRef.current = true;

    /*
     * Clamped against the button *and the open chat box together*.
     *
     * Clamping the button alone would let it be dragged to a corner the box cannot follow it into,
     * and the box would then hang off the screen. Taking the pair's outer bounds means the limit is
     * whatever keeps all of it visible - so the box never leaves the window, and the two never come
     * apart to achieve it.
     *
     * The rects already include the offset they were last painted with, so taking that back off
     * gives the resting origin; the limits can then be expressed as an offset, which is what the
     * transform actually takes.
     */
    const bounds = boundsOf(button, panelRef.current);
    setOffset(clampOffset(
      { x: drag.base.x + dx, y: drag.base.y + dy },
      {
        origin: { left: bounds.left - offset.x, top: bounds.top - offset.y },
        size: { width: bounds.width, height: bounds.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
    ));
  };

  const endDrag = (event) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const onClick = () => {
    /*
     * Letting go at the end of a drag leaves the button where it was put; it does not also open the
     * panel. The flag is read and cleared here rather than on release, because the click arrives
     * after the pointer-up and would otherwise have nothing left to tell it what just happened.
     */
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    setOpen((current) => !current);
  };

  // A lead that has not been saved yet has no record to answer from.
  if (!leadId) return null;

  return (
    /*
     * One container for the pair, carrying the drag offset.
     *
     * `bottom-5 right-5` is where the button rests; the chat box is positioned against this same box
     * from inside it, so moving the container moves both and nothing has to be kept in step.
     *
     * Fixed to the window rather than the popup: the popup is a portal at `inset-0`, so the two
     * corners are the same place, and fixing it to the window means it does not move when the form
     * inside scrolls.
     */
    <div
      className="fixed bottom-5 right-5 z-[135]"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      {open && (
        <LeadNebulaPanel
          ref={panelRef}
          leadId={leadId}
          lead={lead}
          // A chat box, not the side drawer - the popup behind it is a form somebody is reading.
          variant="chat"
          onClose={() => setOpen(false)}
          onError={onError}
        />
      )}

      <button
        type="button"
        ref={buttonRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Ask Nebula about this lead"
        onClick={onClick}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        /*
         * `touch-none` so dragging it on a phone moves the pair rather than scrolling the form
         * underneath, and `cursor-grab` so it reads as something that can be picked up.
         */
        className={`flex cursor-grab touch-none items-center justify-center rounded-full
          text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)] transition-colors
          hover:bg-blue-700 hover:shadow-[0_20px_60px_rgba(15,23,42,0.22)]
          focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300
          active:cursor-grabbing
          ${open ? "bg-blue-700" : "bg-blue-600"}`}
        /*
         * 52px, the size it has always been - large enough to hit on a phone without being a target
         * in its own right. In a style rather than a class because Tailwind has no `h-13`.
         *
         * `transition-colors` above rather than `transition`, so the pair follows the pointer
         * exactly instead of easing after it.
         */
        style={{ height: 52, width: 52 }}
      >
        {/* A ~34px mark in the 52px disc, up from 19. The mark carries the whole control - there is
            no label beside it - so it should read at a glance rather than float in the middle. The
            disc itself stays 52: its size is measured for the drag bounds, not read from here. */}
        <NebulaMark size={38} />
      </button>
    </div>
  );
}
