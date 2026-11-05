"use client";

import { collageAspectRatio, collageCellStyle, collageLayout } from "@/lib/infrastructureCollage.mjs";

/**
 * One branch's infrastructure photographs, laid out by how many there are.
 *
 * The composition itself is `@/lib/infrastructureCollage.mjs`; this draws it. Both places that show
 * a collage use this one component, so the studio arranging pictures in Settings is looking at the
 * same composition the client will be sent - the preview is the document, not a drawing of it.
 *
 * The pictures fill their frames (`object-cover`), so a portrait taken on a phone and a wide shot
 * off a camera both sit in whatever slot the layout gives them without stretching or leaving a
 * margin. What that crops is decided by the slot, which is why the studio arranges the order.
 *
 * `renderCell` and `cellProps` are what the settings preview reaches in through: the first replaces
 * what is drawn inside a frame, the second puts handlers on the frame itself so a picture can be
 * dragged into a new position. Neither is given on the client's copy, which draws the photograph
 * and nothing else.
 */
export default function InfrastructureImageGrid({ photos, className = "", cellClassName = "", renderCell, cellProps }) {
  const list = (photos || []).filter(Boolean);
  const { rows, slots } = collageLayout(list.length);
  if (!rows) return null;

  return <div
    className={`grid grid-cols-12 gap-1.5 ${className}`}
    style={{ aspectRatio: collageAspectRatio(rows), gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
  >
    {list.map((photo, index) => {
      // A caller's own classes are added to the frame's, never put in place of them: the frame has
      // to keep `relative` for the handles drawn inside it to sit on it, and `overflow-hidden` for
      // the rounded corner to cut the photograph rather than the photograph to square it off.
      const { className: extra = "", ...handlers } = (cellProps ? cellProps(index) : null) || {};
      return <div
        key={`${photo}-${index}`}
        style={collageCellStyle(slots[index])}
        className={`relative overflow-hidden rounded-sm ${cellClassName} ${extra}`}
        {...handlers}
      >
        {renderCell
          ? renderCell(photo, index)
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={photo} alt="" className="h-full w-full object-cover" loading="eager" />}
      </div>;
    })}
  </div>;
}
