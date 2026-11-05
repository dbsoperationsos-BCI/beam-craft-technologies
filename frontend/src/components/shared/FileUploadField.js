"use client";

import { useId } from "react";
import { compressImageFile } from "@/lib/imageCompression";

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
  className = "",
  // A single-file field replaces what is there when a new file is picked, rather than silently
  // refusing because the one slot is taken.
  maxFiles = 10,
}) {
  const inputId = useId();
  const cameraInputId = useId();

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;

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

  function remove(index) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className={`block text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>
      <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>
      <div aria-invalid={error ? true : undefined} className={`mt-1.5 rounded-lg border border-dashed p-3 ${error ? "border-red-400 bg-red-50/40" : "border-slate-300"}`}>
        <div className="flex flex-col gap-2 sm:flex-row">
          {image && <label htmlFor={cameraInputId} className={`inline-flex w-full cursor-pointer justify-center rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 sm:hidden ${disabled ? "pointer-events-none opacity-60" : ""}`}>Take photo</label>}
          <label htmlFor={inputId} className={`inline-flex w-full cursor-pointer justify-center rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:w-auto sm:text-sm ${disabled ? "pointer-events-none opacity-60" : ""}`}><span className="sm:hidden">{image ? "Choose from gallery" : "Choose files"}</span><span className="hidden sm:inline">Choose files</span></label>
        </div>
        <input id={inputId} type="file" multiple={maxFiles !== 1} accept={accept} disabled={disabled} onChange={addFiles} className="sr-only" />
        {image && <input id={cameraInputId} type="file" accept="image/*" capture="environment" disabled={disabled} onChange={addFiles} className="sr-only" />}
        <p className="mt-2 font-normal text-slate-500">{maxFiles === 1 ? "Up to 5 MB." : `Up to ${maxFiles} files, 5 MB each.`}</p>
        {value.length > 0 && <ul className="mt-3 space-y-2">{value.map((item, index) => <li key={`${typeof item === "string" ? item.slice(0, 20) : item.name}-${index}`} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1.5 font-normal">{/* Stored documents carry the link they were uploaded to, so they can be opened from here. */}
          {!image && item.url ? <a href={item.url} target="_blank" rel="noreferrer" className="truncate text-blue-700 underline">{item.name}</a> : <span className="truncate">{image ? `Image ${index + 1}` : item.name}</span>}<button type="button" disabled={disabled} onClick={() => remove(index)} className="text-red-600 disabled:opacity-60">Remove</button></li>)}</ul>}
      </div>
      {error && <p role="alert" className="mt-1.5 font-normal text-red-600">{error}</p>}
    </div>
  );
}
