import { useId, useState } from "react";
import Image from "next/image";
import SharedTextField from "@/components/shared/TextField";
import CloseIcon from "@/components/ui/CloseIcon";
import { compressImageFile } from "@/lib/imageCompression";

/**
 * Pieces every CRD document link shares, regardless of vertical: the page shell, the loading /
 * error / thank-you states, and the plain labelled field. Each vertical's own body — Dum Dum's
 * groom/bride tabs, Qua Qua's single page — is its own component; only what looks the same across
 * both lives here.
 */

// The short code the tab title uses per vertical, so a studio user with both a Dum Dum and a Qua
// Qua link open can tell them apart at a glance. The same pairing the Projects register reads a
// vertical by, held in one place rather than written out again here.
export { VERTICAL_CODES as TITLE_PREFIX_BY_VERTICAL } from "./whatsappGroupNameUtils";

export const filled = (value) => String(value ?? "").trim() !== "";
// Ten digits, and nothing that is not a digit. Typing never reaches eleven, so the trim only bites
// on a paste — and it keeps the *last* ten, so "+91 98765 43210" loses the country code rather than
// the number. Mirrors the same rule on the server.
export const phoneDigits = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};
/** Digits and nothing else, for the fields that are numbers without being phone numbers. */
export const digitsOnly = (value, max) => String(value ?? "").replace(/\D/g, "").slice(0, max);

/** A blank reference link is fine mid-draft; a filled one has to actually be a link. */
export function validHttpUrl(value) {
  const link = String(value ?? "").trim();
  if (!link) return true;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function PublicLayout({ children }) {
  return <main className="flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-slate-100">{children}</main>;
}

export function Notice({ title, children, tone = "slate" }) {
  const styles = tone === "red" ? "border-red-200 bg-red-50 text-red-800" : tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700";
  return <section className={`rounded-xl border p-6 shadow-sm ${styles}`}><h1 className="text-xl font-semibold">{title}</h1><div className="mt-2 text-sm leading-6">{children}</div></section>;
}

export function SectionHeading({ title, description }) {
  return <div className="mb-5"><h2 className="text-base font-semibold text-slate-900 sm:text-lg">{title}</h2>{description && <p className="mt-1 text-xs text-slate-500 sm:text-sm">{description}</p>}</div>;
}

/**
 * The left rail naming a document's sections.
 *
 * Dum Dum's document is one continuous page — every section is already in the DOM, and a rail click
 * just scrolls to it. Qua Qua's is a wizard — only the active section is rendered, and a section
 * ahead of the one being filled in is locked, so `lockedIds` marks those: present but not clickable,
 * so the client can see what is still ahead without being able to jump past what is unfinished.
 */
export function CrdSectionRail({ sections, activeId, onSelect, lockedIds }) {
  return <aside className="shrink-0 bg-slate-50 lg:w-64 lg:border-r lg:border-slate-200">
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:sticky lg:top-0 lg:block lg:space-y-1 lg:overflow-visible lg:border-b-0 lg:bg-slate-50 lg:px-3 lg:pb-3 lg:pt-2" aria-label="CRD document sections">
      {sections.map(([id, label]) => {
        const active = activeId === id;
        const locked = lockedIds?.has(id);
        return <button
          key={id}
          type="button"
          disabled={locked}
          onClick={() => onSelect(id)}
          className={`shrink-0 rounded-md px-3 py-1.5 text-left text-sm transition-colors lg:block lg:w-full lg:py-2 ${active ? "bg-blue-50 font-medium text-blue-700" : locked ? "cursor-not-allowed text-slate-400" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
        >
          {label}
        </button>;
      })}
    </nav>
  </aside>;
}

/** A text field with the helper line the CRD asks for underneath it, and a red ring when required and empty. */
export function Field({ label, value, onChange, helperText, required = false, type = "text", invalid = false, className = "", ...props }) {
  return <div className={className}>
    <SharedTextField
      label={label}
      required={required}
      type={type}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      inputClassName={invalid ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100" : ""}
      {...props}
    />
    {helperText && <p className="mt-1.5 text-[11px] font-normal text-slate-500 sm:text-xs">{helperText}</p>}
  </div>;
}

export const MAX_REFERENCE_IMAGES = 10;

export function compactReferenceValue(value) {
  return String(value ?? "").trim();
}

export function parseReferenceRows(value, { allowImages = false } = {}) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        link: compactReferenceValue(item?.link),
        remark: compactReferenceValue(item?.remark),
        image: allowImages ? compactReferenceValue(item?.image) : "",
      })).filter((item) => item.link || item.remark || item.image);
    }
  } catch {
    // Older documents stored one pasted link per line. Keep them editable as rows.
  }
  return String(value).split(/\n+/).map((link) => ({ link: compactReferenceValue(link), remark: "", image: "" })).filter((item) => item.link);
}

export function stringifyReferenceRows(rows, { allowImages = false } = {}) {
  const clean = rows.map((row) => ({
    link: compactReferenceValue(row.link),
    remark: compactReferenceValue(row.remark),
    image: allowImages ? compactReferenceValue(row.image) : "",
  })).filter((row) => row.link || row.remark || row.image);
  return clean.length ? JSON.stringify(clean) : "";
}

export function referenceRowsForEdit(value, options) {
  const rows = parseReferenceRows(value, options);
  return rows.length ? [...rows, { link: "", remark: "", image: "" }] : [{ link: "", remark: "", image: "" }];
}

export function PhotoReferenceImages({ value, onChange }) {
  const rows = parseReferenceRows(value, { allowImages: true });
  const images = rows.map((row) => row.image).filter(Boolean);
  const remark = rows.find((row) => row.remark)?.remark || "";
  const inputId = useId();
  const [error, setError] = useState("");

  function commit(nextImages, nextRemark = remark) {
    onChange(stringifyReferenceRows(nextImages.map((image, index) => ({ link: "", image, remark: index === 0 ? nextRemark : "" })), { allowImages: true }));
  }

  async function addFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const room = MAX_REFERENCE_IMAGES - images.length;
    if (room <= 0) {
      setError(`Up to ${MAX_REFERENCE_IMAGES} images.`);
      return;
    }
    setError("");
    const added = (await Promise.all(files.slice(0, room).map((file) => compressImageFile(file).then((result) => result.dataUrl).catch(() => null)))).filter(Boolean);
    if (!added.length) {
      setError("Unable to compress the selected image.");
      return;
    }
    if (added.length) commit([...images, ...added]);
  }

  return <div className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <span>Photo Reference Links</span>
    <div className="mt-1.5 flex flex-wrap items-center gap-3">
      {images.map((source, index) => <div key={`${index}-${String(source).slice(-24)}`} className="relative">
        <Image src={source} alt={`Photo reference ${index + 1}`} width={80} height={80} unoptimized className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
        <button
          type="button"
          aria-label={`Remove photo reference ${index + 1}`}
          onClick={() => commit(images.filter((_, imageIndex) => imageIndex !== index))}
          className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm hover:bg-red-50 hover:text-red-600"
        >
          ×
        </button>
      </div>)}
      {images.length < MAX_REFERENCE_IMAGES && <label htmlFor={inputId} className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center text-[11px] font-normal text-slate-500 hover:border-blue-400 hover:text-blue-700">
        <span className="text-lg leading-none">+</span>
        <span className="mt-1">Add photo</span>
      </label>}
      <input id={inputId} type="file" multiple accept=".avif,.gif,.jpeg,.jpg,.png,.webp" onChange={(event) => void addFiles(event)} className="sr-only" />
    </div>
    {error && <p className="mt-1.5 font-normal text-red-600">{error}</p>}
    <label className="mt-3 block max-w-xl text-[11px] font-semibold text-slate-600 sm:text-xs">
      <span>Remarks</span>
      <textarea
        value={remark}
        onChange={(event) => commit(images, event.target.value)}
        rows={4}
        placeholder="Remarks for photo references"
        className="mt-1.5 block min-h-28 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
      <span className="mt-1.5 block font-normal text-slate-500">Add remarks for photo references.</span>
    </label>
  </div>;
}

export function ReferenceLinks({ label, value, onChange }) {
  const rows = referenceRowsForEdit(value, { allowImages: false });
  const hasInvalidLink = rows.some((row) => row.link && !validHttpUrl(row.link));

  function commit(nextRows) {
    onChange(stringifyReferenceRows(nextRows, { allowImages: false }));
  }

  function update(index, field, nextValue) {
    const nextRows = rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: nextValue } : row);
    commit(nextRows);
  }

  function removeRow(index) {
    commit(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  return <div className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <span>{label}</span>
    </div>
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="hidden border-b border-slate-200 bg-white px-5 py-4 text-sm font-semibold text-slate-600 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem]">
        <span>Link</span>
        <span>Remark</span>
        <span />
      </div>
      {rows.map((row, index) => {
        const invalidLink = row.link && !validHttpUrl(row.link);
        const isBlankRow = index === rows.length - 1 && !row.link && !row.remark && !row.image;
        return <div key={`${index}-${row.image || ""}`} className="grid gap-2 border-b border-slate-200 px-5 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] sm:items-start">
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-slate-600 sm:hidden">Link</span>
            <input
              type="url"
              value={row.link}
              onChange={(event) => update(index, "link", event.target.value)}
              placeholder="https://..."
              className={`block min-h-10 w-full rounded-md border bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${invalidLink ? "border-rose-400 focus:border-rose-500 focus:ring-rose-100" : "border-slate-300"}`}
            />
            {invalidLink && <p className="mt-1 text-[11px] font-normal text-red-600">Enter a working http or https link.</p>}
          </div>
          <div>
            <span className="mb-1 block text-[11px] font-semibold text-slate-600 sm:hidden">Remark</span>
            <input
              type="text"
              value={row.remark}
              onChange={(event) => update(index, "remark", event.target.value)}
              placeholder="Remark for this reference"
              className="block min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex justify-end">
            {!isBlankRow && <button
              type="button"
              aria-label={`Remove ${label} row ${index + 1}`}
              onClick={() => removeRow(index)}
              className="inline-flex min-h-10 w-10 items-center justify-center rounded-md text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            >
              <CloseIcon className="h-4 w-4" />
            </button>}
          </div>
        </div>;
      })}
    </div>
    <p className={`mt-1.5 font-normal ${hasInvalidLink ? "text-red-600" : "text-slate-500"}`}>{hasInvalidLink ? "Only working http or https links are accepted." : "Add a link with a remark. A new row appears automatically."}</p>
  </div>;
}
