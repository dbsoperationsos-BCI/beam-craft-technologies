"use client";
import { useEffect, useState } from "react";
import { API_URL } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/** A private picture behind the staff JWT - a face crop - fetched as a blob and shown from an object URL. */
export default function AuthImage({ path, alt = "", className = "" }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController(); let objectUrl = "";
    fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getAccessToken()}` }, signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error("unavailable"))))
      .then((blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); })
      .catch(() => setUrl(""));
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return <div className={`relative overflow-hidden bg-slate-100 ${className}`}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url ? <img src={url} alt={alt} className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 animate-pulse bg-slate-100" aria-hidden="true" />}
  </div>;
}
