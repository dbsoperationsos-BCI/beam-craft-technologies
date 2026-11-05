"use client";

import { useEffect, useRef, useState } from "react";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import useEscapeKey from "@/components/shared/useEscapeKey";
import { initialsOf } from "@/lib/initials";
import { MAX_POINTS_PER_STROKE, strokePoints } from "@/lib/proofPaint.mjs";
import { timeAgo } from "@/lib/relativeTime.mjs";

/**
 * One spread with correction pins on it, shared by the QC review room, the client's proofing room
 * and the corrections dialog.
 *
 * A pin is a comment marker in the shape every reviewer already knows from Figma: a teardrop whose
 * point sits on the exact spot, carrying the author's initial, which opens into a bubble with who
 * said it, how long ago, and what they said — with Edit and Remove on the header line while the
 * comment is still the reviewer's to change. The alternative, a numbered dot whose text lives only
 * in a side list, made the reader hold a number in their head while looking from photo to list.
 *
 * Pins live in normalized 0..1 coordinates and are drawn as percentages of the rendered image, so
 * they land on the same spot at every screen size and zoom level. A dragged circle marks an area
 * the same way. Which spot a click reports, and whether anything may be added at all, is the
 * caller's business: this draws what it is given and reports back.
 */

// Bubble, avatar and ring per correction status. A comment still waiting on somebody is grey —
// it is a remark on the work, not an alarm, and grey sits on any photograph without competing
// with it. The two states that have actually moved keep their colour: resolved turns green and
// reopened violet, the same palette the lists beside the proof read in.
const TONES = {
  RESOLVED: { bubble: "bg-emerald-600", initial: "text-emerald-700", pending: "border-emerald-500 bg-emerald-500/10" },
  REOPENED: { bubble: "bg-violet-600", initial: "text-violet-700", pending: "border-violet-500 bg-violet-500/10" },
  DEFAULT: { bubble: "bg-slate-700", initial: "text-slate-700", pending: "border-slate-700 bg-slate-700/10" },
};
const toneOf = (pin) => TONES[pin?.status] || TONES.DEFAULT;

/**
 * The two actions that are drawn as icons on the header line, beside who wrote the comment.
 *
 * They sat in a row of their own under the text, behind a rule, which made a two-word comment into
 * a card three bands tall — most of it chrome — hanging over the very photograph being judged. A
 * pencil and a bin are the two symbols nobody has to read, so they cost a corner of a line that was
 * already there instead of a band of their own.
 *
 * Keyed by label, and anything not named here stays a **worded** button underneath. That is the
 * point of the map rather than a blanket "draw every action as an icon": the pin also carries
 * **Reopen** when a resolved correction is being reviewed, and there is no symbol for "reopen — not
 * fixed" that a reviewer would read correctly the first time. An action added later is worded until
 * somebody decides it has an obvious icon, which is the safe way round.
 */
const ICON_ACTIONS = {
  Edit: { Icon: EditRounded, hover: "hover:text-white" },
  // Warmer on hover than its neighbour, because it is the one that cannot be undone. Not coloured
  // at rest: a red icon sitting on the bubble would read as a warning about the comment itself.
  Remove: { Icon: DeleteOutlineRounded, hover: "hover:text-rose-200" },
};

// How much room the composer needs beside the point it is about, so the canvas can open it on the
// side that has room. `w-[min(17rem,70vw)]` at its widest, and about three typed lines tall.
const COMPOSER_WIDTH = 272;
const COMPOSER_HEIGHT = 120;
/** The marker's own size (`h-7 w-7`), and the air left between it and the card it opens. */
const PIN_HEIGHT = 28;
const PIN_WIDTH = 28;
const COMPOSER_GAP = 6;

/**
 * How wide a circle centred on this point may be drawn, as a fraction of the picture's width —
 * which is the unit a correction's radius is stored in.
 *
 * A circle marks an area of the spread, so it has to stay on the spread: it may reach an edge and
 * no further, in either direction, and never grow past half the picture. Without the vertical
 * half of that rule a circle drawn on a wide, shallow spread ran off the top and bottom of the
 * photograph while its stored radius was still under the old cap.
 */
function maxRadius(x, y, width, height) {
  if (!width || !height) return 0.5;
  return Math.max(0, Math.min(0.5, x, 1 - x, (Math.min(y, 1 - y) * height) / width));
}

export default function ProofSpreadCanvas({
  imageUrl, alt, pins = [], activePinId = null, pendingPin = null, pendingArea = null,
  composer = null, composerAnchor = null,
  tool = "none", penColor = "#ef4444", pendingStrokes = [], onPaintStroke,
  onSelectPin, onImageClick, onImageCircleDraw, className = "", imageClassName = "",
}) {
  // The stroke being drawn right now, before the pointer comes up and it joins the drawing.
  const [stroke, setStroke] = useState(null);
  const painting = tool === "pen" && Boolean(onPaintStroke);
  const [drawing, setDrawing] = useState(null);
  // A finished circle-drag or stroke is followed by a click event on the same spot; the guard keeps
  // that click from being read as a press on the spread once the mark it ends has been made.
  const suppressClick = useRef(false);
  const wrapperRef = useRef(null);
  const imageRef = useRef(null);

  /**
   * Where the photograph itself is drawn inside this box.
   *
   * The review rooms give the image the whole pane and let `object-contain` fit it, so a spread
   * that is wider than the pane leaves empty bands above and below it — and the element's own box
   * still covers them. Everything below is measured against the picture rather than that box, so
   * a pin cannot be dropped on the empty band beside a spread, and a correction's coordinates
   * always mean the same point of the photograph whatever the pane's shape.
   */
  const [picture, setPicture] = useState(null);
  useEffect(() => {
    const image = imageRef.current;
    const wrapper = wrapperRef.current;
    if (!image || !wrapper) return undefined;
    function measure() {
      const box = image.getBoundingClientRect();
      const outer = wrapper.getBoundingClientRect();
      const { naturalWidth, naturalHeight } = image;
      if (!box.width || !box.height || !naturalWidth || !naturalHeight) { setPicture(null); return; }
      // `object-contain` scales to the smaller ratio and centres what is left over. An image drawn
      // at its own size answers the same way, with nothing left over — so this covers both.
      const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
      const width = naturalWidth * scale;
      const height = naturalHeight * scale;
      setPicture({
        left: (box.left - outer.left) + (box.width - width) / 2,
        top: (box.top - outer.top) + (box.height - height) / 2,
        width,
        height,
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(image);
    observer.observe(wrapper);
    image.addEventListener("load", measure);
    return () => { observer.disconnect(); image.removeEventListener("load", measure); };
  }, [imageUrl]);

  // Escape closes an open comment, the way it dismisses any other transient surface — through the
  // one arbiter, so the open bubble is what the press reaches and not the room around it.
  useEscapeKey(() => onSelectPin?.(null), Boolean(activePinId && onSelectPin));

  function pointFromEvent(event, handler) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (!handler) return;
    const rect = event.currentTarget.getBoundingClientRect();
    handler({
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    });
  }

  function pointerPoint(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)), px: event.clientX - rect.left, py: event.clientY - rect.top, width: rect.width, height: rect.height };
  }
  /*
   * One drag, read by whichever tool is selected: the pen paints with it and the circle tool
   * measures a radius from it. Which tool the room is in is the room's state, so the same gesture
   * cannot mean two things at once.
   */
  function startCircle(event) {
    if (event.button !== 0) return;
    const point = pointerPoint(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (painting) { setStroke({ color: penColor, points: [[point.x, point.y]] }); return; }
    if (!onImageCircleDraw || tool !== "circle") return;
    setDrawing({ x: point.x, y: point.y, radius: 0 });
  }
  function moveCircle(event) {
    if (stroke) {
      const point = pointerPoint(event);
      // Capped as it is drawn, not after: a slow hand over a long spread would otherwise send
      // thousands of points for the server to refuse.
      setStroke((current) => (current && current.points.length < MAX_POINTS_PER_STROKE
        ? { ...current, points: [...current.points, [point.x, point.y]] }
        : current));
      return;
    }
    if (!drawing) return;
    const point = pointerPoint(event);
    const radius = Math.hypot(point.px - drawing.x * point.width, point.py - drawing.y * point.height) / point.width;
    setDrawing({ ...drawing, radius: Math.min(radius, maxRadius(drawing.x, drawing.y, point.width, point.height)) });
  }
  function endCircle() {
    if (stroke) {
      setStroke(null);
      suppressClick.current = true;
      onPaintStroke?.(stroke);
      return;
    }
    if (!drawing) return;
    setDrawing(null);
    if (drawing.radius >= 0.005) { suppressClick.current = true; onImageCircleDraw?.(drawing); }
  }

  const areas = [...pins, ...(pendingArea ? [{ id: "pending-area", ...pendingArea, pending: true }] : []), ...(drawing ? [{ id: "drawing-area", ...drawing, pending: true }] : [])].filter((pin) => pin.radius);

  // Where the composer opens: the point just marked, the centre of the circle just drawn, or —
  // when an existing comment is being edited — that correction's own spot, named by the caller.
  const anchor = composerAnchor || pendingPin || (pendingArea ? { x: pendingArea.x, y: pendingArea.y } : null);
  // Which side it opens on, measured rather than guessed: a pin two thirds across a wide spread has
  // room to its right, the same pin on a phone does not. Falls back to the pin bubble's own rule
  // until the picture has been measured.
  const flipComposerX = picture?.width ? anchor && anchor.x * picture.width + COMPOSER_WIDTH > picture.width : anchor?.x > 0.55;
  const flipComposerY = picture?.height ? anchor && anchor.y * picture.height + COMPOSER_HEIGHT > picture.height : anchor?.y > 0.6;

  return <div ref={wrapperRef} className={`relative inline-block max-w-full ${className}`}>
    <img ref={imageRef} src={imageUrl} alt={alt} className={`block max-h-full max-w-full select-none rounded ${imageClassName}`} draggable={false} />
    {/* Over the photograph and nothing else — see `picture` above. Until it has been measured the
        overlay covers the element, which is the same thing for an image drawn at its own size.
        touch-manipulation kills the browser's double-tap page zoom, so a double tap on the spread
        does not zoom the page out from under a drag — pinch and pan gestures are unaffected. */}
    <div
      style={picture ? { position: "absolute", left: picture.left, top: picture.top, width: picture.width, height: picture.height } : undefined}
      className={`${picture ? "" : "absolute inset-0"} touch-manipulation ${onImageCircleDraw || onImageClick ? "cursor-crosshair" : ""}`}
      onClick={(event) => { if (activePinId) { onSelectPin?.(null); return; } pointFromEvent(event, onImageClick); }}
      onPointerDown={startCircle}
      onPointerMove={moveCircle}
      onPointerUp={endCircle}
      onPointerCancel={endCircle}
    >
      {areas.map((pin) => <span
        key={pin.id}
        aria-hidden="true"
        className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${pin.pending ? "border-amber-400 bg-amber-400/15" : pin.id === activePinId ? "border-blue-500 bg-blue-500/10" : toneOf(pin).pending}`}
        // Clamped as it is drawn as well as while it is drawn, so a circle recorded before this
        // rule — or under a differently shaped pane — still stays on the photograph.
        style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%`, width: `${Math.min(pin.radius, maxRadius(pin.x, pin.y, picture?.width, picture?.height)) * 200}%`, aspectRatio: "1" }}
      />)}

      {/* Every drawing on this spread: the ones already saved against their corrections, the ones
          this reviewer has drawn and not yet sent, and the stroke under the pointer right now.
          One SVG in a 0..100 viewBox, scaled to the picture — the same normalized coordinates the
          pins use, so a drawing keeps its place at any pane size and any zoom. */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {[
          ...pins.flatMap((candidate) => (candidate.path || []).map((saved, index) => ({ key: `${candidate.id}-${index}`, saved, faded: activePinId ? candidate.id !== activePinId : false }))),
          ...pendingStrokes.map((saved, index) => ({ key: `pending-${index}`, saved, faded: false })),
          ...(stroke ? [{ key: "live", saved: stroke, faded: false }] : []),
        ].map(({ key, saved, faded }) => <polyline
          key={key}
          points={strokePoints(saved)}
          fill="none"
          stroke={saved.color}
          strokeWidth="0.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          // A drawn line is a mark on a photograph: it keeps its own colour, and steps back rather
          // than disappearing while a different correction is being read.
          className={`transition-opacity ${faded ? "opacity-25" : "opacity-95"}`}
          style={{ strokeWidth: 3 }}
        />)}
      </svg>

      {pins.map((pin) => <Pin
        key={pin.id}
        pin={pin}
        expanded={pin.id === activePinId}
        onToggle={() => onSelectPin?.(pin.id === activePinId ? null : pin.id)}
      />)}

      {pendingPin && <span aria-hidden="true" className="absolute grid h-7 w-7 -translate-y-full animate-pulse place-items-center rounded-full rounded-bl-none bg-amber-500 text-xs font-bold text-white shadow ring-2 ring-white" style={{ left: `${pendingPin.x * 100}%`, top: `${pendingPin.y * 100}%` }}>+</span>}

      {/* The composer, opened against the spot it is about — the same place, and the same flip
          rules, as the bubble an existing pin opens into. A remark is written where it is being
          made: the reviewer never looks away from the thing they are describing. */}
      {composer && anchor && <div
        className="absolute z-50"
        style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
        // The card sits on top of the drawing surface, so every gesture inside it stays inside it:
        // without this, typing on a card over the photo dropped a second pin behind it.
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="relative">
          {/* Clear of the marker by `COMPOSER_GAP`, whichever side it opens on. The marker is a
              28px teardrop hanging above the point, so a card at the point itself, or at 28px
              above it, ends up flush against the marker with nothing between the two — they read
              as one smudged control rather than a pin and the box that belongs to it. */}
          <div
            className={`absolute ${flipComposerX ? "right-0" : "left-0"}`}
            style={flipComposerY
              ? { bottom: `${PIN_HEIGHT + COMPOSER_GAP}px`, right: flipComposerX ? `${-PIN_WIDTH}px` : undefined }
              : { top: `${COMPOSER_GAP}px`, right: flipComposerX ? `${-PIN_WIDTH}px` : undefined }}
          >
            {composer}
          </div>
        </div>
      </div>}
    </div>
  </div>;
}

/**
 * One comment marker: the teardrop, and the bubble it opens into.
 *
 * The teardrop's point is the correction's exact spot, so the marker hangs up and to the right of
 * it and never covers what it is pointing at. The bubble opens on whichever side has room — left
 * of the marker past the middle of the spread, above it low down — so a pin near an edge still
 * reads without the pane having to scroll.
 */
function Pin({ pin, expanded, onToggle }) {
  // Pointing at a marker is enough to read it: the comment opens under the pointer and closes when
  // it leaves, so looking through a spread costs no clicks. A click still pins it open, which is
  // what a touch screen has instead of a pointer, and what the list beside the proof selects with.
  const [hovered, setHovered] = useState(false);
  const open = expanded || hovered;
  const tone = toneOf(pin);
  const author = pin.author || (pin.source === "CLIENT" ? "Client" : "QC");
  const initial = pin.initial || initialsOf(author).slice(0, 1);
  const when = timeAgo(pin.createdAt);
  // Edit and Remove go up on the header line; anything else keeps its words below. See ICON_ACTIONS.
  const actions = pin.actions || [];
  const iconActions = actions.filter((action) => ICON_ACTIONS[action.label]);
  const wordedActions = actions.filter((action) => !ICON_ACTIONS[action.label]);
  const flipX = pin.x > 0.55;
  const flipY = pin.y > 0.6;

  return <div
    className="absolute"
    style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
  >
    {/* Zero-size origin: everything below is placed against the correction's exact point. */}
    <div className="relative">
      <button
        type="button"
        aria-label={`Correction ${pin.number} by ${author}`}
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); onToggle(); }}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className={`absolute bottom-0 left-0 grid h-7 w-7 place-items-center rounded-full rounded-bl-none shadow-md ring-2 ring-white transition hover:scale-110 ${tone.bubble} ${open ? "z-30 scale-110 ring-blue-400" : "z-10"}`}
      >
        <span className={`grid h-5 w-5 place-items-center rounded-full bg-white text-[10px] font-bold uppercase ${tone.initial}`}>{initial}</span>
      </button>

      {open && <div
        className={`absolute z-40 w-[min(17rem,60vw)] cursor-default rounded-2xl px-3.5 py-3 text-white shadow-xl ring-1 ring-black/10 ${tone.bubble} ${flipX ? "-right-7 rounded-br-sm" : "left-0 rounded-bl-sm"} ${flipY ? "bottom-7" : "top-0"}`}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[11px] font-bold uppercase ${tone.initial}`}>{initial}</span>
          <span className="min-w-0 truncate text-[13px] font-semibold">{author}</span>
          {when && <span className="shrink-0 text-[11px] text-white/70">{when}</span>}
          {/* `ml-auto` pins them to the right edge whatever the name and the time take up; the name
              beside them already truncates, so a long one gives way rather than pushing them off.
              Icon-only, so each says in `aria-label` and `title` what its shape says to everyone
              else. */}
          {iconActions.length > 0 && <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {iconActions.map((action) => {
              const { Icon, hover } = ICON_ACTIONS[action.label];
              return <button
                key={action.label}
                type="button"
                aria-label={action.label}
                title={action.label}
                disabled={action.disabled}
                onClick={(event) => { event.stopPropagation(); action.onSelect(); }}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/75 transition hover:bg-white/20 ${hover} disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white`}
              >
                <Icon style={{ fontSize: 15 }} />
              </button>;
            })}
          </span>}
        </div>
        <p className="mt-2 whitespace-pre-wrap wrap-break-word text-[13px] leading-5">{pin.comment}</p>
        {pin.resolutionNote && <p className="mt-2 rounded-lg bg-white/15 px-2 py-1.5 text-[11px] leading-4">Resolution: {pin.resolutionNote}</p>}
        {wordedActions.length > 0 && <div className="mt-2.5 flex flex-wrap gap-3 border-t border-white/20 pt-2 text-[12px] font-medium">
          {wordedActions.map((action) => <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={(event) => { event.stopPropagation(); action.onSelect(); }}
            className="text-white/85 underline-offset-2 hover:text-white hover:underline disabled:opacity-50"
          >{action.label}</button>)}
        </div>}
      </div>}
    </div>
  </div>;
}
