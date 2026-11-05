"use client";
import { useEffect, useState } from "react";
import { fetchGalleryImage } from "@/services/image-selection/public-gallery.service";
import isRemoteImage from "@/lib/isRemoteImage";
import { faceCropStyle } from "@/lib/faceCrop.mjs";

/**
 * One person's face as a circle, cut in the browser from the cover photo's existing thumbnail:
 * the response says which photo and where in it, and `faceCropStyle` places the image behind a
 * round window. No crop is stored anywhere. Without a usable cover the circle shows the person's
 * number instead, so the row never waits on an image.
 *
 * Thumbnails in R2 load as plain images; one served by the API needs the gallery session, the
 * same way the photo grid's own thumbnails do.
 */
// `className` is for the ring around the circle - the People section draws the selected state with it.
export default function FaceAvatar({ cover, label, sessionToken, size = 28, className = "" }) {
  const src = cover?.thumbnailUrl || "";
  const remote = isRemoteImage(src);
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => {
    if (!src || remote) return undefined;
    const controller = new AbortController(); let url = "";
    fetchGalleryImage(src, sessionToken, controller.signal).then((blob) => { url = URL.createObjectURL(blob); setObjectUrl(url); }).catch((error) => { if (error.name !== "AbortError") setObjectUrl(""); });
    // The object URL is revoked with the fetch that made it, so it is only ever shown for the
    // source it was made for: a remote source or none at all reads `src`, never the old blob.
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [remote, src, sessionToken]);

  const shown = remote ? src : src ? objectUrl : "";
  const crop = shown ? faceCropStyle(cover?.box, cover?.width, cover?.height, size) : null;
  const initial = String(label || "").replace(/\D/g, "") || "?";
  return (
    <span aria-hidden="true" className={`relative block shrink-0 overflow-hidden rounded-full bg-slate-200 text-xs font-semibold text-slate-500 ${className}`} style={{ width: size, height: size }}>
      {shown
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={shown} alt="" draggable={false} decoding="async" className={crop ? "absolute" : "absolute inset-0 h-full w-full object-cover"} style={crop ? { width: crop.width, height: crop.height, left: crop.left, top: crop.top, maxWidth: "none" } : undefined} />
        : <span className="grid h-full w-full place-items-center">{initial}</span>}
    </span>
  );
}
