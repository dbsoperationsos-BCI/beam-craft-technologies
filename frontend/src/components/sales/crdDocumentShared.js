import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { DocumentLogo } from "@/components/shared/AppLogo";
import Button from "@/components/shared/Button";
import SharedTextField from "@/components/shared/TextField";
import DateField from "@/components/shared/DateField";
import TimeField from "@/components/shared/TimeField";
import Checkbox from "@/components/shared/Checkbox";
import HelpTip from "@/components/shared/HelpTip";
import { endsNextDay } from "@/lib/shootBoard.mjs";
import CloseIcon from "@/components/ui/CloseIcon";
import { compressImageFile } from "@/lib/imageCompression";
import { parseReferenceRows, stringifyReferenceRows } from "@/lib/crdReferenceRows.mjs";
import { ViewableImage } from "@/components/shared/ImageViewer";

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

/**
 * The page shell. `crd-public-form` is what makes its fields phone-sized (globals.css): the shared
 * form controls are compact for the studio's screens, and on a phone that compact 12px text is both
 * hard to read and what makes iOS zoom the page in on every tap. Scoped to this page, not changed
 * on the controls themselves, so no studio screen moves.
 */
export function PublicLayout({ children }) {
  return <main className="crd-public-form flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-slate-100">{children}</main>;
}

/**
 * The document's band across the top: the mark it was issued under, its title and its Event ID.
 *
 * On a phone the mark is the compact one and the title sits beside it in at most two short lines,
 * so the band takes a strip of the screen rather than a sixth of it; from `lg` the mark gets the
 * rail's own 256px slot, lined up with the section list under it.
 */
export function CrdDocumentHeader({ title, eventId, logoUrl }) {
  return <header className="sticky top-0 z-50 shrink-0 border-b border-slate-200 bg-white shadow-sm">
    <div className="flex min-w-0 items-center gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 sm:py-3 lg:pl-0">
      <div className="relative hidden h-11 w-64 shrink-0 lg:block">
        {/* The logo this document was issued under, from its own record rather than today's
            Settings - the same mark the client saw when the link reached them. */}
        <DocumentLogo variant="crd" src={logoUrl} priority className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <DocumentLogo variant="documentCompact" src={logoUrl} priority className="shrink-0 sm:hidden" />
      <DocumentLogo variant="document" src={logoUrl} priority className="hidden shrink-0 sm:block lg:hidden" />
      <div className="min-w-0">
        <h1 className="text-sm font-semibold leading-snug text-slate-900 sm:text-xl">{title}</h1>
        {eventId && <p className="mt-0.5 truncate text-xs text-slate-600 sm:text-sm">{eventId}</p>}
      </div>
    </div>
  </header>;
}

/**
 * The bar under the form: how complete the document is, and its actions (`children` - Save Draft
 * and Submit, or the wizard's Next / Back).
 *
 * On a phone it is one slim line of progress over a row of equal buttons, side by side rather than
 * stacked, and kept clear of the home bar - so the form keeps most of the screen. From `sm` the
 * progress sits left and the actions right, as before.
 */
export function CrdDocumentFooter({ completion, children }) {
  return <div className="shrink-0 border-t border-slate-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:flex sm:items-center sm:justify-end sm:gap-3 sm:px-6 sm:py-3">
    <div className="mb-2.5 text-xs sm:mb-0 sm:mr-auto sm:w-56 sm:text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-slate-600">Completion</span>
        <span className="font-semibold text-slate-900">{completion}%</span>
      </div>
      <div role="progressbar" aria-valuenow={completion} aria-valuemin={0} aria-valuemax={100} aria-label="Document completion" className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 sm:mt-2 sm:h-2">
        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${completion}%` }} />
      </div>
    </div>
    <div className="grid auto-cols-fr grid-flow-col gap-2 sm:flex sm:gap-3">{children}</div>
  </div>;
}

/**
 * A footer action: the shared Button at a thumb-sized height, filling its column on a phone. Faded
 * while it cannot be pressed - the secondary button has no disabled look of its own, and a
 * not-allowed cursor says nothing on a touch screen - and kept to one line with tight padding there,
 * where Qua Qua's three share a 360px row.
 */
export function CrdFooterButton({ variant = "secondary", ...props }) {
  return <Button variant={variant} size="lg" className="w-full whitespace-nowrap !px-2 !text-sm !font-semibold disabled:opacity-60 sm:w-auto sm:!px-6" {...props} />;
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
  const navRef = useRef(null);
  // Whether more of the strip lies past its right edge - the fade says so, and only then.
  const [moreToRight, setMoreToRight] = useState(false);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const measure = () => setMoreToRight(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2);
    measure();
    nav.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => { nav.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [sections]);
  /*
   * Below `lg` the rail is a strip of tabs that runs off the screen's edge. The section being read
   * is kept in view in it - scrolling the form to Bride Details brings that tab across - so the
   * strip always says where the reader is. Only along the strip, never the page.
   */
  useEffect(() => {
    const nav = navRef.current;
    const tab = nav?.querySelector('[aria-current="true"]');
    if (!nav || !tab || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollTo({ left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [activeId]);

  return <aside className="relative shrink-0 bg-slate-50 lg:w-64 lg:border-r lg:border-slate-200">
    {/* The strip's own scrollbar is hidden on a phone; the fade at its right edge is the cue that
        there is more of it to swipe to, shown only while there is. */}
    <nav ref={navRef} className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:sticky lg:top-0 lg:block lg:space-y-1 lg:overflow-visible lg:border-b-0 lg:bg-slate-50 lg:px-3 lg:pb-3 lg:pt-2" aria-label="CRD document sections">
      {sections.map(([id, label]) => {
        const active = activeId === id;
        const locked = lockedIds?.has(id);
        return <button
          key={id}
          type="button"
          disabled={locked}
          aria-current={active ? "true" : undefined}
          onClick={() => onSelect(id)}
          className={`min-h-10 shrink-0 rounded-md px-3 py-1.5 text-left text-sm transition-colors lg:block lg:min-h-0 lg:w-full lg:py-2 ${active ? "bg-blue-50 font-medium text-blue-700" : locked ? "cursor-not-allowed text-slate-400" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
        >
          {label}
        </button>;
      })}
    </nav>
    {moreToRight && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent lg:hidden" />}
  </aside>;
}

/** A text field with the CRD's helper text as its ⓘ, and a red ring when required and empty. */
/*
 * `invalid` marks a required answer left blank once Submit has been pressed: the box turns red and
 * says so under itself, through the text field's own `error` - an added red border class lost to the
 * box's own grey one, so a client told something was missing could not see which field it was.
 */
export function Field({ label, value, onChange, helperText, required = false, type = "text", invalid = false, className = "", ...props }) {
  return <div className={className}>
    <SharedTextField
      label={label}
      required={required}
      type={type}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      error={invalid ? `${label} is required.` : ""}
      helperText={helperText}
      {...props}
    />
  </div>;
}

/**
 * The document's events, one per shoot of the project - a wedding booked for five shoots asks about
 * five events. Each is titled by its shoot and asks its date, start time and end time - three
 * answers, as the shoot keeps them - and a map link to its venue; the studio fills the shoot's date
 * and times where it knows them, and the client confirms or corrects them. None is required. The list itself is the project's: the server builds it from the
 * shoots, so the client neither adds nor removes an event here.
 */
export function CrdEventsFields({ events = [], onChange }) {
  const update = (index, field) => (value) => onChange(events.map((event, eventIndex) => (eventIndex === index ? { ...event, [field]: value } : event)));
  return <div className="flex flex-col gap-4">
    {events.map((event, index) => <section key={event.shootRef || index} className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{`Event ${index + 1}: ${event.shoot || "Event"}`}</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <DateField label="Date" placeholder="Select date" value={event.eventDate} helperText="The day this event takes place." onChange={update(index, "eventDate")} />
        <TimeField label="Start Time" twelveHour value={event.startTime} helperText="When this event begins on the day." onChange={(changed) => update(index, "startTime")(changed.target.value)} />
        <TimeField label={endsNextDay(event.startTime, event.endTime) ? "End Time (next day)" : "End Time"} twelveHour value={event.endTime} helperText="When this event finishes; earlier than the start means the next day." onChange={(changed) => update(index, "endTime")(changed.target.value)} />
        <Field className="md:col-span-3" label="Event Address Link" type="url" value={event.eventAddressLink} onChange={update(index, "eventAddressLink")} helperText="A Google Maps link to the venue." />
      </div>
    </section>)}
  </div>;
}

/**
 * The terms agreement at the foot of every CRD document. Left unticked at Submit, it turns red and
 * says what to do - it used to only darken its sentence, so a client told one answer was missing
 * could not see that it was this box.
 */
export function CrdTermsAgreement({ checked, onChange, invalid = false }) {
  return <div className="mt-4" aria-invalid={invalid ? true : undefined}>
    <label className={`flex items-start gap-3 rounded-lg border p-3 text-sm font-medium ${invalid ? "border-red-400 bg-red-50 text-red-800" : "border-transparent text-slate-700"}`}>
      <Checkbox checked={checked} onChange={(next) => onChange(next)} className="mt-0.5 shrink-0" ariaLabel="I agree to the terms & conditions" />
      <span>By clicking the submit button, I agree to terms &amp; conditions. <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></span>
    </label>
    {invalid && <p role="alert" className="mt-1.5 text-xs font-normal text-red-600">Tick the box to agree to the terms &amp; conditions.</p>}
  </div>;
}

/** What a CRD document says when Submit (or Next) finds a required answer blank: the fields say which. */
export const FILL_MANDATORY = "Please fill the mandatory fields.";

/**
 * The section the reader is on, for the rail: the last of `ids` whose top has passed near the top of
 * the screen - or the last section of all once the form is scrolled to its end, since a short last
 * section (Terms & Conditions) can never reach the top and would otherwise never be the one shown.
 */
export function sectionInView(container, ids) {
  if (!container || !ids.length) return null;
  if (container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 4) return ids[ids.length - 1];
  const positions = ids
    .map((id) => ({ id, top: container.querySelector(`#${CSS.escape(id)}`)?.getBoundingClientRect().top ?? Infinity }))
    .filter((item) => Number.isFinite(item.top));
  return positions.reduce((best, item) => (item.top <= 180 && item.top > best.top ? item : best), { id: positions[0]?.id || ids[0], top: -Infinity }).id;
}

/*
 * A section picked on the rail keeps its highlight while the form scrolls to it, instead of the
 * highlight running through every section passed on the way: `holdRail` when it is picked, and
 * `railHeld` from the scroll handler, which skips while the scroll is still moving (released once it
 * has been still a moment, or after a second when there was nothing to scroll).
 */
export function holdRail(hold) {
  hold.picking = true;
  window.clearTimeout(hold.timer);
  hold.timer = window.setTimeout(() => { hold.picking = false; }, 1000);
}

export function railHeld(hold) {
  if (!hold.picking) return false;
  window.clearTimeout(hold.timer);
  hold.timer = window.setTimeout(() => { hold.picking = false; }, 150);
  return true;
}

/**
 * Brings the first answer marked missing into view - the field itself, not the top of its section,
 * so nobody has to hunt for the red. Waits a moment for the marks to be drawn.
 */
export function scrollToFirstMissing(root) {
  window.setTimeout(() => {
    root?.querySelector('[aria-invalid="true"], [role="alert"]')?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 60);
}

export const MAX_REFERENCE_IMAGES = 10;

// The reference rows' parsing, and keeping what is on screen across a save, are plain functions -
// `lib/crdReferenceRows.mjs` - so they can be tested without the form.
export { compactReferenceValue, parseReferenceRows, stringifyReferenceRows, mergeSavedDocument } from "@/lib/crdReferenceRows.mjs";

const hasRemark = (row) => String(row.remark ?? "").trim() !== "";

export function referenceRowsForEdit(value, options) {
  const rows = parseReferenceRows(value, options);
  return rows.length ? [...rows, { link: "", remark: "", image: "" }] : [{ link: "", remark: "", image: "" }];
}

export function PhotoReferenceImages({ value, onChange }) {
  const rows = parseReferenceRows(value, { allowImages: true });
  const images = rows.map((row) => row.image).filter(Boolean);
  const remark = rows.find(hasRemark)?.remark || "";
  const inputId = useId();
  const [error, setError] = useState("");

  // The remark rides on the first photo's row - or on a row of its own while there is no photo, so a
  // remark can be written before (or without) any picture.
  function commit(nextImages, nextRemark = remark) {
    const nextRows = nextImages.length
      ? nextImages.map((image, index) => ({ link: "", image, remark: index === 0 ? nextRemark : "" }))
      : [{ link: "", image: "", remark: nextRemark }];
    onChange(stringifyReferenceRows(nextRows, { allowImages: true }));
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
    <span>Photo Reference Links<HelpTip text="Add photos in a style you like, so the team sees what you want." /></span>
    <div className="mt-1.5 flex flex-wrap items-center gap-3">
      {images.map((source, index) => <div key={`${index}-${String(source).slice(-24)}`} className="relative">
        <ViewableImage images={images} index={index} label={`View photo reference ${index + 1}`} className="rounded-lg">
          <Image src={source} alt={`Photo reference ${index + 1}`} width={80} height={80} unoptimized className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
        </ViewableImage>
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
      <span>Remarks<HelpTip text="What you like about these photos, for the team to follow." /></span>
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

export function ReferenceLinks({ label, helperText = "", value, onChange }) {
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
      <span>{label}<HelpTip text={`${helperText ? `${helperText} ` : ""}Add a link with a remark. A new row appears automatically.`} /></span>
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
    {hasInvalidLink && <p role="alert" className="mt-1.5 font-normal text-red-600">Only working http or https links are accepted.</p>}
  </div>;
}
