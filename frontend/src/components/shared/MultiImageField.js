"use client";

import HelpTip from "./HelpTip";
import { useEffect, useId, useRef, useState } from "react";
import CloudUploadOutlined from "@mui/icons-material/CloudUploadOutlined";
import PhotoCameraOutlined from "@mui/icons-material/PhotoCameraOutlined";
import PhotoLibraryOutlined from "@mui/icons-material/PhotoLibraryOutlined";
import CameraCaptureDialog from "@/components/shared/CameraCaptureDialog";
import { compressImageFile } from "@/lib/imageCompression";
import { ViewableImage } from "@/components/shared/ImageViewer";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Several photos, taken with the camera or uploaded, in one list - and both as often as wanted.
 *
 * `ImageUploadField` holds one picture and `FileUploadField` holds files; neither takes a series of
 * photos with a live camera. Here **Take photo** opens `CameraCaptureDialog`, which stays open and
 * adds a photo per press, and **Upload from gallery** picks any number of files at once; either can be
 * used again afterwards, in any order, and everything lands in the same list of thumbnails, each
 * with its own remove. The first is marked as the cover.
 *
 * `value` is an array of data URIs, each compressed in the browser by `compressImageFile` with
 * `compress`. Additions are appended to the list as it stands *now* rather than to the `value` of
 * the render that started them, so photos captured faster than the parent re-renders - or a camera
 * capture landing while an upload is still being compressed - are never dropped.
 */
export default function MultiImageField({
  label,
  value = [],
  onChange,
  max = 10,
  required = false,
  disabled = false,
  error = "",
  helperText = "",
  compress = null,
  className = "",
  cameraLayer = "dialogOverPanel",
  size = "md",
  // The line under the buttons. By default it counts the photos held here; a caller that hands each
  // photo on as it is picked (so this list stays empty) says what it does count instead.
  hint,
}) {
  const inputId = useId();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [reading, setReading] = useState(false);
  /*
   * The list as it stands now. `append` and `remove` move it on themselves the moment they act, so a
   * second capture before the parent has re-rendered builds on the first; the effect catches it up
   * with anything the parent changed on its own, such as clearing the form.
   */
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);

  /** Appends to the list as it stands now, up to `max`, and says what did not fit. */
  function append(additions) {
    const room = Math.max(0, max - latest.current.length);
    const kept = additions.slice(0, room);
    if (kept.length) {
      const next = [...latest.current, ...kept];
      latest.current = next;
      onChange(next);
    }
    if (additions.length > kept.length) setNotice(`Only ${max} photos can be added; ${additions.length - kept.length} were left out.`);
  }

  async function upload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setNotice("");
    const tooBig = files.filter((file) => file.size > MAX_FILE_SIZE);
    const usable = files.filter((file) => file.size <= MAX_FILE_SIZE && (file.type || "").startsWith("image/"));
    setReading(true);
    try {
      const results = await Promise.all(usable.map((file) => compressImageFile(file, compress || {}).then((result) => result.dataUrl).catch(() => null)));
      const read = results.filter(Boolean);
      append(read);
      const skipped = tooBig.length + (files.length - tooBig.length - usable.length) + (usable.length - read.length);
      if (skipped) setNotice((current) => current || `${skipped} file${skipped === 1 ? "" : "s"} could not be added - photos only, up to 10 MB each.`);
    } finally {
      setReading(false);
    }
  }

  function remove(index) {
    const next = latest.current.filter((_, position) => position !== index);
    latest.current = next;
    onChange(next);
    setNotice("");
  }

  const full = value.length >= max;
  // `lg` is the phone-at-a-venue size: 44px tall; on a phone both buttons run full width, stacked.
  const buttonClass = `inline-flex items-center justify-center gap-1.5 rounded-md border px-4 py-2 text-xs font-medium sm:text-sm w-full sm:w-auto ${size === "lg" ? "min-h-11" : "min-h-9"}`;

  return <div className={`text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>
    <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={helperText} /></span>
    <div aria-invalid={error ? true : undefined} className={`mt-1.5 rounded-lg border border-dashed p-4 ${error ? "border-red-400 bg-red-50/40" : "border-slate-300 bg-slate-50/50"}`}>
      {/* The two ways in, under one upload mark: the camera (as many shots as wanted) or the gallery. */}
      <div className="flex flex-col items-center gap-3 text-center">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <CloudUploadOutlined />
        </span>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button type="button" disabled={disabled || full} onClick={() => { setNotice(""); setCameraOpen(true); }} className={`${buttonClass} border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60`}>
            <PhotoCameraOutlined style={{ fontSize: 18 }} aria-hidden="true" />
            Take photo
          </button>
          <label htmlFor={inputId} className={`${buttonClass} cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-50 ${disabled || full ? "pointer-events-none opacity-60" : ""}`}>
            <PhotoLibraryOutlined style={{ fontSize: 18 }} aria-hidden="true" />
            {reading ? "Adding..." : "Upload from gallery"}
          </label>
        </div>
        <input id={inputId} type="file" accept="image/*" multiple disabled={disabled || full} onChange={(event) => void upload(event)} className="sr-only" />
        <p className="font-normal text-slate-500">{hint ?? `${value.length} of ${max} photos · as many times as you like${value.length > 0 ? " · the first is the cover" : ""}`}</p>
      </div>
      {notice && <p className="mt-2 font-normal text-amber-700">{notice}</p>}
      {value.length > 0 && <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {value.map((source, index) => <li key={`${index}-${source.slice(-24)}`} className="group relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-slate-100">
          {/* Opens the viewer among all the photos; the × beside it still removes. */}
          <ViewableImage images={value} index={index} label={`View photo ${index + 1} of ${value.length}`} className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={source} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
          </ViewableImage>
          {index === 0 && <span className="absolute left-1 top-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">Cover</span>}
          <button
            type="button"
            disabled={disabled}
            onClick={() => remove(index)}
            aria-label={`Remove photo ${index + 1}`}
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-sm leading-none text-white hover:bg-red-600 disabled:opacity-50"
          >×</button>
        </li>)}
      </ul>}
    </div>
    {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}
    {cameraOpen && <CameraCaptureDialog
      taken={value.length}
      max={max}
      compress={compress}
      layer={cameraLayer}
      onCapture={(dataUrl) => append([dataUrl])}
      onClose={() => setCameraOpen(false)}
    />}
  </div>;
}
