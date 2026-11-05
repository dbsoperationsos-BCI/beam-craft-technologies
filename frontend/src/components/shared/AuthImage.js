"use client";
import { useEffect, useState } from "react";
import { API_URL } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";
import { useImageViewer } from "@/components/shared/ImageViewer";

/**
 * A private picture behind the staff JWT - a face crop, an attendance selfie - fetched as a blob and
 * shown from an object URL. A bare `<img src>` cannot show one: it sends no `Authorization` header,
 * and `protect` reads nothing else. A picture the server refuses or cannot find says so rather than
 * pulsing as though it were still on its way.
 */
/** `viewable` makes the loaded picture open in the application's image viewer when pressed. */
export default function AuthImage({ path, alt = "", className = "", viewable = false }) {
  const openImages = useImageViewer();
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController(); let objectUrl = "";
    fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getAccessToken()}` }, signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("unavailable"))))
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setFailed(false); setUrl(objectUrl); })
      .catch(() => { if (!controller.signal.aborted) { setUrl(""); setFailed(true); } });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  const opens = viewable && openImages && url;
  const Frame = opens ? "button" : "div";
  return <Frame
    {...(opens ? { type: "button", "aria-label": alt ? `View ${alt}` : "View picture", onClick: (event) => { event.stopPropagation(); openImages([{ src: url, name: alt }]); } } : {})}
    className={`relative overflow-hidden bg-slate-100 ${opens ? "cursor-zoom-in" : ""} ${className}`}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url ? <img src={url} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
      : failed ? <span role="img" aria-label={alt ? `${alt} unavailable` : "Picture unavailable"} className="absolute inset-0 grid place-items-center text-[10px] font-medium text-slate-400">—</span>
        : <div className="absolute inset-0 animate-pulse bg-slate-100" aria-hidden="true" />}
  </Frame>;
}
