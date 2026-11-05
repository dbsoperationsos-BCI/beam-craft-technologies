"use client";

import { useState } from "react";
import { placeWatermark } from "@/lib/watermarkGeometry.mjs";
import useTextMark from "./useTextMark";

/**
 * A watermark drawn over a stand-in photograph, placed by the same `placeWatermark` the server
 * draws guest copies with. Everything is in percentages of the frame, so the preview is right at
 * any size it is shown and says nothing about the photo's pixels.
 *
 * `look` is a preset or an event's copy of one: `{ type, logo | logoUrl, text, textColor,
 * fontWeight, position, size, opacity, offsetX, offsetY }`. `orientation` switches the stand-in
 * between a landscape (3:2) and a portrait (2:3) frame. The stand-in is drawn, not a photo, so it is
 * never mistaken for a client's picture.
 */
const FRAMES = { landscape: { width: 3000, height: 2000, ratio: "3 / 2" }, portrait: { width: 2000, height: 3000, ratio: "2 / 3" } };
const SCENE = "radial-gradient(circle at 72% 30%, rgba(255,236,200,0.9) 0, rgba(255,236,200,0) 18%), linear-gradient(160deg, #f6c99a 0%, #c98a8c 38%, #6d6a9c 70%, #2f3b62 100%)";
const HILLS = "radial-gradient(120% 60% at 20% 100%, #3a4a3f 0 55%, transparent 56%), radial-gradient(110% 55% at 85% 100%, #2b3a33 0 50%, transparent 51%)";

export default function WatermarkPreview({ look, orientation = "landscape", className = "", label = "Watermark preview" }) {
  const frame = FRAMES[orientation] || FRAMES.landscape;
  const isText = look?.type === "TEXT";
  const { mark: textMark, error: textError } = useTextMark(look || {}, isText);
  const logoSrc = !isText ? (look?.logo || look?.logoUrl || null) : null;
  // The logo's own size, read off the picture once it has loaded; a text mark arrives with its size.
  const [logoSize, setLogoSize] = useState({ src: null, width: 0, height: 0, failed: false });
  const markSrc = isText ? textMark?.src : logoSrc;
  const markWidth = isText ? textMark?.width : logoSize.src === logoSrc ? logoSize.width : 0;
  const markHeight = isText ? textMark?.height : logoSize.src === logoSrc ? logoSize.height : 0;
  const place = markSrc && markWidth ? placeWatermark({ imageWidth: frame.width, imageHeight: frame.height, markWidth, markHeight, position: look.position, size: look.size, offsetX: look.offsetX, offsetY: look.offsetY }) : null;
  const logoFailed = !isText && logoSize.src === logoSrc && logoSize.failed;
  const problem = logoFailed ? "The logo could not be loaded." : textError;

  return <div role="img" aria-label={label} className={`relative w-full overflow-hidden rounded-lg bg-slate-200 ${className}`} style={{ aspectRatio: frame.ratio, backgroundImage: `${HILLS}, ${SCENE}` }}>
    {markSrc && !logoFailed && (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={markSrc}
        alt=""
        draggable={false}
        onLoad={isText ? undefined : (event) => setLogoSize({ src: logoSrc, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight, failed: false })}
        onError={isText ? undefined : () => setLogoSize({ src: logoSrc, width: 0, height: 0, failed: true })}
        className="pointer-events-none absolute select-none"
        style={place
          ? { left: `${(place.left / frame.width) * 100}%`, top: `${(place.top / frame.height) * 100}%`, width: `${(place.width / frame.width) * 100}%`, height: `${(place.height / frame.height) * 100}%`, opacity: Number(look.opacity) / 100 }
          : { opacity: 0, left: 0, top: 0, maxWidth: "10%" }}
      />
    )}
    {problem && <p className="absolute inset-x-2 bottom-2 rounded bg-white/90 px-2 py-1 text-center text-[11px] text-red-700">{problem}</p>}
  </div>;
}
