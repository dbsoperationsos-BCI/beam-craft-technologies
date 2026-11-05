"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * One record, read only, drawn from the same `sections` a module already describes its info panel
 * with.
 *
 * How a value is shown is decided by the field's type, so a record is a list of fields rather than
 * markup. Only types every module shares live here; a module with its own shape passes its own
 * through `formatters` instead of this file learning about it — which is where the project shoot,
 * production and post-production summaries live, as `projectInfoFormatters`.
 *
 * It is a component of its own rather than part of `DataTableInfoPanel` because the same record is
 * read in two places, and those two have very different amounts of room:
 *
 * - `panel` is the column beside a table, about 20rem wide. A label sits above its value, because
 *   side by side there is no width left for either, and the sections run together without
 *   headings — the CRM's shape, which every module's panel now shares.
 * - `rows` is the full-screen `SchemaFormPanel` a row opens on double-click. That panel already
 *   heads each section and lists them in its rail, so this draws no heading of its own — only the
 *   fields, two abreast, with the label beside its value the way a filled-in form reads back.
 *
 * The variant is picked by name rather than passed in as classes, so the two layouts cannot drift
 * into each other. Everything else — which fields exist, what each value reads like — is shared, so
 * a field added to a module's sections appears in both without either being touched.
 */

const builtInFormatters = {
  date: (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
  },
  /*
   * For a field where the hour is part of the answer rather than noise.
   *
   * Most dates the studio holds are days - a joining date, a shoot date - and printing 00:00
   * beside them would be stating a precision the record does not have. A few are moments: when a
   * quotation was raised, when its link stops opening. Those read wrong as a bare day, because
   * "expires today" is a different thing at nine in the morning and at half past eleven at night.
   */
  datetime: (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
  },
  boolean: (value) => value ? "Yes" : "No",
};

const imageList = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];

function displayValue(value, type, formatters) {
  const format = formatters?.[type] || builtInFormatters[type];
  // Empty arrays reach the formatter, since only it knows what "nothing here yet" reads like.
  if (format && (Array.isArray(value) || (value !== null && value !== undefined && value !== ""))) return format(value);
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

/** Shows four images and keeps the rest behind a button, so a long list cannot bury the fields under it. */
function RecordGallery({ images, columnsClass = "grid-cols-2", limit = 4 }) {
  const [showAll, setShowAll] = useState(false);
  const visibleImages = showAll ? images : images.slice(0, limit);

  return <>
    <div className={`mt-1.5 grid gap-2 ${columnsClass}`}>
      {visibleImages.map((source, index) => <div key={`${source.slice(0, 32)}-${index}`} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
        <Image src={source} alt={`Image ${index + 1}`} fill unoptimized sizes="160px" className="object-cover" />
      </div>)}
    </div>
    {!showAll && images.length > limit && <button type="button" onClick={() => setShowAll(true)} className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">Show more images</button>}
  </>;
}

/** A gallery with no images is dropped rather than shown as a dash, and takes an all-gallery section with it. */
const isEmptyGallery = (entity, [key, , type]) => type === "gallery" && !imageList(entity[key]).length;

/**
 * Nothing was recorded here. `false` and `0` are answers and are kept; only an absent value, an
 * empty string and an empty list are nothing.
 */
const isBlank = (value) => value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);

/**
 * Which of a section's fields this record actually has something to say for.
 *
 * `hideEmpty` is what separates a reference column from a reading of one record. The panel keeps
 * every field, dash and all, because it is the same shape for every row and is read by scanning to
 * a known position. A dialog is read once, top to bottom, so a field the record has no answer for
 * is a line of noise between two that matter — and these sections cover four kinds of request, so
 * on any one of them most fields belong to the other three.
 */
const visibleFields = (entity, section, hideEmpty) => section.fields.filter((field) => !isEmptyGallery(entity, field)
  && !(hideEmpty && field[2] !== "gallery" && isBlank(entity[field[0]])));

/**
 * The sections this record has something to say for, so a caller drawing its own headings — the
 * form panel, which also lists them in its rail — asks the same question this component would and
 * cannot end up with a heading over nothing.
 */
export const sectionsWithContent = (entity, sections = [], hideEmpty = false) => (entity
  ? sections.filter((section) => visibleFields(entity, section, hideEmpty).length)
  : []);

/**
 * Whether a value draws a block of its own — a gallery, or anything a module's formatter returns as
 * markup rather than text, such as the payment request expense table. Those get the full width of
 * their card and the run of their own row, since squeezing a table into a label's value column is
 * how the dialog ended up looking like a form nobody filled in.
 */
const isBlock = (type, content) => type === "gallery" || typeof content === "object";

/**
 * The CRM info panel's shape: label over value in one quiet run, with nothing drawn between the
 * rows — no bordered boxes, no hairlines, and no section headings. The labels carry the weight
 * (`font-semibold slate-700`, a point smaller at 13px) and the values sit under them a shade
 * lighter, a point larger at 15px, on a taller line - the answer is what the reader came for, the
 * label only says which one it is - which is what makes a 360px column of short answers read as a
 * list rather than a form.
 *
 * Sections still decide which fields are shown and in what order; they just do not head them. A
 * heading like "Employee information" over "Employee ID" said nothing the label under it did not,
 * and a panel with ten of them was mostly headings. The record view keeps the headings, in its
 * rail, where they are navigation rather than noise.
 */
function PanelSections({ entity, sections, formatters, hideEmpty }) {
  const fields = sections.flatMap((section) => visibleFields(entity, section, hideEmpty).map((field) => [section.title, ...field]));
  if (!fields.length) return null;
  return <dl className="space-y-2.5">
    {fields.map(([sectionTitle, key, label, type]) => {
      const content = type === "gallery" ? null : displayValue(entity[key], type, formatters);
      // A formatter that lists one shoot per line — and anything declared multiline — keeps its
      // line breaks, which would otherwise collapse into a single run of text.
      const preserveBreaks = type === "multiline" || (typeof content === "string" && content.includes("\n"));
      // Two sections may share a label ("Remarks" under both shoot and post-production), so the
      // section is part of the key even though it no longer draws.
      return <div key={`${sectionTitle}-${key}-${label}`}>
        <dt className="text-[13px] font-semibold text-slate-700">{label}</dt>
        <dd className={`mt-[3px] break-words text-[15px] leading-6 text-slate-600 ${preserveBreaks ? "whitespace-pre-wrap" : ""}`}>
          {type === "gallery" ? <RecordGallery key={key} images={imageList(entity[key])} /> : content}
        </dd>
      </div>;
    })}
  </dl>;
}

function RowSections({ entity, sections, formatters, hideEmpty }) {
  return sections.map((section) => {
    const fields = visibleFields(entity, section, hideEmpty);
    if (!fields.length) return null;
    return <dl key={section.title} className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      {fields.map(([key, label, type]) => {
        const content = type === "gallery" ? null : displayValue(entity[key], type, formatters);
        const preserveBreaks = type === "multiline" || (typeof content === "string" && content.includes("\n"));
        // A table or a gallery is given the width of both columns and the run of its own row, and
        // its value goes under its label rather than beside it — there is no label column wide
        // enough to sit next to a table without crushing it.
        if (isBlock(type, content)) return <div key={`${key}-${label}`} className="md:col-span-2">
          {/* A label that only repeats the section heading above it is left off — "Bills / Bills". */}
          {label !== section.title && <dt className="mb-2 text-xs font-medium text-slate-500">{label}</dt>}
          <dd>{type === "gallery"
            ? <RecordGallery key={key} images={imageList(entity[key])} columnsClass="grid-cols-3 sm:grid-cols-4 lg:grid-cols-6" limit={6} />
            : content}</dd>
        </div>;
        return <div key={`${key}-${label}`} className="min-w-0 border-b border-slate-100 pb-3">
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className={`mt-1 break-words font-medium text-slate-800 ${preserveBreaks ? "whitespace-pre-wrap" : ""}`}>{content}</dd>
        </div>;
      })}
    </dl>;
  });
}

export default function RecordDetails({ entity, sections = [], formatters, variant = "panel", hideEmpty = false, className = "" }) {
  if (!entity) return null;
  const Sections = variant === "rows" ? RowSections : PanelSections;
  return <div className={className}><Sections entity={entity} sections={sections} formatters={formatters} hideEmpty={hideEmpty} /></div>;
}
