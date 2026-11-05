"use client";

import HelpTip from "./HelpTip";
import { useId, useState } from "react";
import { compressImageFile } from "@/lib/imageCompression";
import { leftOutNotice, splitBySize } from "@/lib/uploadFileLimits.mjs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export default function FileUploadField({
  label,
  value = [],
  onChange,
  accept,
  image = false,
  disabled = false,
  // Marked required and refused like every other field. A proof document nobody attached was the
  // one kind of missing answer this field could not show, because it took no `error` at all - the
  // form said so in its notice and the dashed box beside it looked no different from a filled one.
  required = false,
  error = "",
  helperText = "",
  className = "",
  // A single-file field replaces what is there when a new file is picked, rather than silently
  // refusing because the one slot is taken.
  maxFiles = 10,
  // For a documents field that also takes pictures - a ticket that is a PDF or a photo of one. The
  // pictures are compressed in the browser the way `image` mode compresses them, and keep their file
  // name; PDFs and other documents still go up untouched. Off by default, so every existing field
  // uploads exactly as it did.
  compressImages = false,
  // `lg` makes the pick buttons 44px tall, for a field used on a phone at a venue.
  size = "md",
}) {
  const inputId = useId();
  const cameraInputId = useId();
  const tall = size === "lg" ? "min-h-11 items-center" : "";
  // Only `compressImages` says why files were left out; every other field stays as it was.
  const [notice, setNotice] = useState("");

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    if (compressImages) { await addCompressing(files); return; }

    const oversized = files.find((file) => file.size > MAX_FILE_SIZE);
    if (oversized) return;

    // Images are compressed to <=150 KB in the browser; documents are uploaded untouched.
    const single = maxFiles === 1;
    const accepted = single ? files.slice(0, 1) : files.slice(0, maxFiles - value.length);
    const additions = image
      ? (await Promise.all(accepted.map((file) => compressImageFile(file).then((result) => result.dataUrl).catch(() => null)))).filter(Boolean)
      : (await Promise.all(accepted.map(readFile))).map((fileData, index) => ({ name: accepted[index].name, data: fileData }));
    if (!additions.length) return;
    onChange(single ? additions.slice(0, 1) : [...value, ...additions]);
  }

  /*
   * `compressImages`: pictures are held to 10 MB rather than 5 (they leave the phone at ~150 KB) and
   * compressed; documents are read as they are. Nothing is refused in silence - a file too big, one
   * that would not read or compress, or one past the room left is counted and said under the field.
   */
  async function addCompressing(files) {
    setNotice("");
    const { fitting } = splitBySize(files);
    const single = maxFiles === 1;
    const accepted = single ? fitting.slice(0, 1) : fitting.slice(0, Math.max(0, maxFiles - value.length));
    const read = await Promise.all(accepted.map((file) => ((file.type || "").startsWith("image/")
      ? compressImageFile(file).then((result) => result.dataUrl)
      : readFile(file)).catch(() => null)));
    const additions = read.map((data, index) => (data ? { name: accepted[index].name, data } : null)).filter(Boolean);
    // Too big, unreadable, or past the room left: every picked file that did not become an addition.
    setNotice(leftOutNotice(files.length - additions.length));
    if (additions.length) onChange(single ? additions.slice(0, 1) : [...value, ...additions]);
  }

  function remove(index) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className={`block text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>
      <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}<HelpTip text={helperText} /></span>
      <div aria-invalid={error ? true : undefined} className={`mt-1.5 rounded-lg border border-dashed p-3 ${error ? "border-red-400 bg-red-50/40" : "border-slate-300"}`}>
        <div className="flex flex-col gap-2 sm:flex-row">
          {image && <label htmlFor={cameraInputId} className={`inline-flex w-full cursor-pointer justify-center ${tall} rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 sm:hidden ${disabled ? "pointer-events-none opacity-60" : ""}`}>Take photo</label>}
          <label htmlFor={inputId} className={`inline-flex w-full cursor-pointer justify-center ${tall} rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:w-auto sm:text-sm ${disabled ? "pointer-events-none opacity-60" : ""}`}><span className="sm:hidden">{image ? "Choose from gallery" : "Choose files"}</span><span className="hidden sm:inline">Choose files</span></label>
        </div>
        <input id={inputId} type="file" multiple={maxFiles !== 1} accept={accept} disabled={disabled} onChange={addFiles} className="sr-only" />
        {image && <input id={cameraInputId} type="file" accept="image/*" capture="environment" disabled={disabled} onChange={addFiles} className="sr-only" />}
        <p className="mt-2 font-normal text-slate-500">{compressImages ? `Up to ${maxFiles} file${maxFiles === 1 ? "" : "s"}: PDFs up to 5 MB, photos up to 10 MB.` : maxFiles === 1 ? "Up to 5 MB." : `Up to ${maxFiles} files, 5 MB each.`}</p>
        {notice && <p className="mt-2 font-normal text-amber-700">{notice}</p>}
        {value.length > 0 && <ul className="mt-3 space-y-2">{value.map((item, index) => <li key={`${typeof item === "string" ? item.slice(0, 20) : item.name}-${index}`} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1.5 font-normal">{/* Stored documents carry the link they were uploaded to, so they can be opened from here. */}
          {!image && item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="truncate text-blue-700 underline">{item.name}</a> : <span className="truncate">{image ? `Image ${index + 1}` : item.name}</span>}<button type="button" disabled={disabled} onClick={() => remove(index)} className="text-red-600 disabled:opacity-60">Remove</button></li>)}</ul>}
      </div>
      {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}
    </div>
  );
}
