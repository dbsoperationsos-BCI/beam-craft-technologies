"use client";

import { useId, useState } from "react";
import Image from "next/image";
import { compressImageFile } from "@/lib/imageCompression";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
// Resampled on this machine before being sent. AVIF and GIF are here because the picker offers them.
const RASTER_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
// A logo is very often one of these, and it cannot go through the canvas: an SVG has no pixels to
// resample and no intrinsic size for `createImageBitmap` to work from. It travels as it is and the
// server rasterises it, so nothing SVG-shaped is ever served back.
const VECTOR_TYPE = "image/svg+xml";
const ACCEPT = ".avif,.gif,.jpeg,.jpg,.png,.svg,.webp";
const ACCEPTED_LABEL = "JPG, PNG, WEBP, AVIF, GIF, or SVG up to 5 MB.";
// Windows hands over an empty `type` for some files, and for anything opened through the picker's
// "All files" option, so the name is the fallback rather than a silent rejection.
const TYPE_BY_EXTENSION = { avif: "image/avif", gif: "image/gif", jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: VECTOR_TYPE, webp: "image/webp" };
const typeOf = (file) => file.type || TYPE_BY_EXTENSION[String(file.name || "").split(".").pop()?.toLowerCase()] || "";

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
}

export default function ImageUploadField({
  label,
  required = false,
  value,
  onChange,
  error,
  className = "",
  disabled = false,
  /*
   * Whether the picture may be taken away, as opposed to swapped for another one.
   *
   * On a record's own photographs - an employee's profile picture, their Aadhaar and PAN cards -
   * there is no such thing as "no photo" being the right answer: the field exists because the
   * studio has to hold one. Remove was there only because it is the obvious partner to Choose, and
   * all it could do was empty a field that then had to be answered again before the record would
   * save. **Replace photo** is the whole of what those fields need, and it is the same one click.
   *
   * Left on where a picture genuinely is optional and taking it down is a real decision: a login
   * slide, a quotation's cover, the studio's own logo.
   */
  removable = true,
  /*
   * A surface whose picture must arrive exactly as it was picked.
   *
   * Resampling is right for a logo or a photograph: they are shown large, and the saving is real.
   * It is wrong for a favicon, which is a few kilobytes drawn at 16px - re-encoding it as WebP buys
   * nothing and hands the API a format it will not serve to a tab. `rawTypes` names the types this
   * field must not touch; `accept`, `acceptLabel` and `maxBytes` let that surface say what it takes.
   */
  rawTypes = null,
  accept: acceptTypes = ACCEPT,
  acceptLabel: acceptLabelProp,
  maxBytes = MAX_FILE_SIZE,
  /*
   * How much of the picture to keep once it is picked, as `{ maxBytes, maxDimension }` for
   * `compressImageFile`. The default squeezes a logo or a profile photo to 150 KB at 1600px, which
   * is right for a mark shown small and wrong for the quotation's cover photograph, shown a
   * thousand pixels wide: that caller asks for more. The server re-compresses to its own ceiling.
   */
  compress = null,
}) {
  // The hint says the limit the field actually enforces: a caller raising `maxBytes` must not be
  // left with a caption still promising 5 MB.
  const acceptLabel = acceptLabelProp || (maxBytes === MAX_FILE_SIZE ? ACCEPTED_LABEL : `JPG, PNG, WEBP, AVIF, GIF, or SVG up to ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  const inputId = useId();
  const cameraInputId = useId();
  /**
   * Why the last pick was refused, held here rather than only handed to `onChange`.
   *
   * This field is the only thing that knows a file was too big or the wrong kind, and it used to
   * report that as a second argument to `onChange` — which no caller has ever read. The schema form
   * passes a one-parameter setter and the asset dialog takes `(value) => …`, so every refusal landed
   * nowhere: the field cleared itself, said nothing, and left the studio looking at "No photo"
   * wondering why choosing a logo did not work. Owning the message means it is shown wherever this
   * field is used, without every form having to remember to thread it through.
   */
  const [failure, setFailure] = useState("");

  function refuse(message) {
    setFailure(message);
    // Still reported upward for any caller that does want it — it just is no longer the only route.
    onChange(null, message);
  }
  function accept(dataUrl) {
    setFailure("");
    onChange(dataUrl, "");
  }

  async function selectImage(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const type = typeOf(file);
    // Size first: it is the refusal a studio hits most, and saying so is more use than a complaint
    // about the format of a file that was never going to be read anyway.
    if (file.size > maxBytes) {
      const shown = maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / (1024 * 1024))} MB` : `${Math.round(maxBytes / 1024)} KB`;
      refuse(`That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Choose one of ${shown} or less.`);
      return;
    }
    // Named as untouchable by the caller, or a vector, which has no pixels to resample anyway.
    if (rawTypes?.includes(type) || type === VECTOR_TYPE) {
      try { accept(await readAsDataUrl(file)); }
      catch { refuse("Unable to read the selected image."); }
      return;
    }
    if (!RASTER_TYPES.has(type)) {
      refuse(`${file.name} is not an image this can use. Choose a ${acceptLabel.replace(/ up to .*$/, " image.")}`);
      return;
    }
    try {
      const compressed = await compressImageFile(file, compress || {});
      accept(compressed.dataUrl);
    } catch {
      refuse("Unable to read the selected image — it may be damaged, or in a format this browser cannot open.");
    }
  }

  // A message the form passes in wins: it is the answer from a save that has actually been tried.
  const shown = error || failure;

  return (
    <div className={`block text-[11px] font-semibold text-slate-600 sm:text-xs ${className}`}>
      <span>{label}{required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        {value ? (
          <Image
            src={value}
            alt={label ? `Selected ${String(label).toLowerCase()}` : "Selected image"}
            width={80}
            height={80}
            unoptimized
            className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 text-center text-[11px] font-normal text-slate-400">
            No photo
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-none">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label
              htmlFor={cameraInputId}
              className={`cursor-pointer rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-center text-xs font-medium text-blue-700 hover:bg-blue-100 sm:hidden ${disabled ? "pointer-events-none opacity-60" : ""}`}
            >
              Take photo
            </label>
            <label
              htmlFor={inputId}
              className={`cursor-pointer rounded-md border border-slate-300 px-3 py-2 text-center text-xs font-medium text-slate-700 hover:bg-slate-50 sm:text-sm ${disabled ? "pointer-events-none opacity-60" : ""}`}
            >
              <span className="sm:hidden">Choose from gallery</span>
              <span className="hidden sm:inline">{value ? "Replace photo" : "Choose photo"}</span>
            </label>
          </div>
          <input
            id={inputId}
            type="file"
            accept={acceptTypes}
            disabled={disabled}
            onChange={(event) => void selectImage(event)}
            className="sr-only"
          />
          <input id={cameraInputId} type="file" accept="image/*" capture="environment" disabled={disabled} onChange={selectImage} className="sr-only" />
          {value && removable && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => { setFailure(""); onChange(null, ""); }}
              className="w-fit text-left text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-60"
            >
              Remove photo
            </button>
          )}
          <span className="font-normal text-slate-500">{acceptLabel}</span>
        </div>
      </div>
      {shown && <p role="alert" className="mt-1.5 font-normal text-red-600">{shown}</p>}
    </div>
  );
}
